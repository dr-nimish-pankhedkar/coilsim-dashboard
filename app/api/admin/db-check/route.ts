import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/admin/db-check
// Returns which required columns / tables exist so you can diagnose migration gaps.
export async function GET() {
  try {
    const [colRes, tblRes] = await Promise.all([
      pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'cs_py_int'
          AND table_name   = 'simulation_tasks'
        ORDER BY ordinal_position
      `),
      pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'cs_py_int'
        ORDER BY table_name
      `),
    ])

    const cols   = colRes.rows.map((r: any) => r.column_name) as string[]
    const tables = tblRes.rows.map((r: any) => r.table_name) as string[]

    const required_cols = [
      // original cols used by hourly run (should already exist):
      'cot_input', 'flow_input', 'status', 'task_type',
      // cols added for design_case run:
      'coil_id', 'feed_id', 'project_name',
      'dilution_ratio', 'cit_input', 'cip_input',
      'severity_type', 'flux_profile',
      'design_case_id', 'coil_number',
    ]
    const required_tables = [
      'simulation_tasks', 'coil_geometries', 'feedstock_definitions',
      'design_cases', 'coil_coke_profiles',
      'profile_details', 'yield_history', 'worker_heartbeat',
    ]

    const missing_cols   = required_cols.filter(c => !cols.includes(c))
    const missing_tables = required_tables.filter(t => !tables.includes(t))

    return NextResponse.json({
      ok: missing_cols.length === 0 && missing_tables.length === 0,
      tables,
      simulation_tasks_columns: cols,
      missing_cols,
      missing_tables,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
