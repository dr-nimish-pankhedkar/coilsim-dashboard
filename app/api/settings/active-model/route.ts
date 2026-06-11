import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const res = await pool.query<{ value: string }>(
      "SELECT value FROM cs_py_int.app_settings WHERE key = 'active_design_case_id'"
    )
    const raw = res.rows[0]?.value ?? ''
    return NextResponse.json({ active_design_case_id: raw ? Number(raw) : null })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json()
    const value = id != null ? String(Number(id)) : ''
    await pool.query(
      `INSERT INTO cs_py_int.app_settings (key, value) VALUES ('active_design_case_id', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [value]
    )
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
