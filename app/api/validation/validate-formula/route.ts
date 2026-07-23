import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SQL_KEYWORDS =
  /\b(select|insert|update|delete|drop|create|alter|truncate|grant|revoke|where|from|join|union|into|exec|execute|cast|convert|begin|commit|rollback|case|when|then|else|end|null|true|false|and|or|not|is|in|like|between|exists|having|group|order|by|limit|offset|returning)\b/i

function sanitize(
  formula: string,
  validColumns: Set<string>,
): { ok: true } | { ok: false; error: string } {
  // Allow only column names, numbers, arithmetic operators, parens, whitespace, dots
  if (!/^[a-zA-Z0-9_\s+\-*/(). ]+$/.test(formula)) {
    return {
      ok: false,
      error:
        'Invalid characters — only column names, numbers, and operators (+, -, *, /, (), .) are allowed.',
    }
  }
  if (SQL_KEYWORDS.test(formula)) {
    return { ok: false, error: 'Formula cannot contain SQL keywords.' }
  }
  // Every word token must be a valid numeric column name
  const tokens = formula.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) ?? []
  for (const tok of tokens) {
    if (!validColumns.has(tok)) {
      return {
        ok: false,
        error: `Column '${tok}' not found in validation_reference_data.`,
      }
    }
  }
  return { ok: true }
}

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const { formula, mb_filter_pct = 2 } = await req.json()
    if (!formula || typeof formula !== 'string') {
      return NextResponse.json({ valid: false, error: 'formula required' }, { status: 400 })
    }

    const trimmed = formula.trim()

    // Fetch numeric columns from validation_reference_data
    const colRes = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'cs_py_int'
        AND table_name   = 'validation_reference_data'
        AND data_type IN (
          'numeric', 'double precision', 'real',
          'integer', 'bigint', 'smallint'
        )
    `)
    const validColumns = new Set(colRes.rows.map(r => r.column_name))

    const check = sanitize(trimmed, validColumns)
    if (!check.ok) return NextResponse.json({ valid: false, error: check.error })

    // Run formula against 3 recent rows (formula is safe — all tokens are whitelisted column names)
    const previewRes = await client.query(`
      SELECT
        to_char(timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS ts,
        (${trimmed})::numeric                                        AS val
      FROM cs_py_int.validation_reference_data
      WHERE (${trimmed}) IS NOT NULL
      ORDER BY timestamp DESC
      LIMIT 3
    `)

    const threshold = Number(mb_filter_pct) || 2
    const preview = previewRes.rows.map(r => ({
      timestamp:        r.ts as string,
      value:            parseFloat(r.val),
      within_threshold: Math.abs(parseFloat(r.val)) <= threshold,
    }))

    return NextResponse.json({ valid: true, preview })
  } catch (err: any) {
    return NextResponse.json({
      valid: false,
      error: err?.message ?? 'DB error — check formula syntax.',
    })
  } finally {
    client.release()
  }
}
