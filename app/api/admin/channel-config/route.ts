import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await pool.query(
      `SELECT param_key, channel_type, param_label, unit, enabled, source, static_value, exp_row, display_order
       FROM cs_py_int.channel_config
       ORDER BY channel_type, display_order`
    )
    return NextResponse.json(res.rows)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const channels: Array<{
      param_key: string
      enabled?: boolean
      source?: string
      static_value?: number | null
    }> = Array.isArray(body) ? body : body.channels ?? []

    for (const ch of channels) {
      await pool.query(
        `UPDATE cs_py_int.channel_config
         SET enabled      = COALESCE($2, enabled),
             source       = COALESCE($3, source),
             static_value = $4
         WHERE param_key = $1`,
        [ch.param_key, ch.enabled ?? null, ch.source ?? null, ch.static_value ?? null]
      )
    }
    return NextResponse.json({ ok: true, updated: channels.length })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
