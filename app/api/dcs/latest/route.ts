import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT
        id,
        cot_input,
        flow_input,
        dilution_ratio,
        cit_input,
        cip_input,
        cop_input,
        project_name,
        created_at
      FROM cs_py_int.simulation_tasks
      ORDER BY id DESC
      LIMIT 1
    `)
    if (!result.rows.length) {
      return NextResponse.json({ error: 'No DCS data yet' }, { status: 404 })
    }
    return NextResponse.json(result.rows[0])
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
