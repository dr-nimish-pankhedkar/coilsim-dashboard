import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Returns mean/std/min/max for COT, HC flow, and SHC from the last 30 days of
// hourly simulation_tasks for a given design case's project/coil config.
// Used to auto-populate the parameter ranges on the optimization page.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const design_case_id = searchParams.get('design_case_id')
  if (!design_case_id) return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(`
      SELECT
        AVG(cot_input::numeric)        AS cot_mean,
        STDDEV(cot_input::numeric)     AS cot_std,
        MIN(cot_input::numeric)        AS cot_min,
        MAX(cot_input::numeric)        AS cot_max,
        AVG(flow_input::numeric)       AS flow_mean,
        STDDEV(flow_input::numeric)    AS flow_std,
        MIN(flow_input::numeric)       AS flow_min,
        MAX(flow_input::numeric)       AS flow_max,
        AVG(dilution_ratio::numeric)   AS shc_mean,
        STDDEV(dilution_ratio::numeric)AS shc_std,
        MIN(dilution_ratio::numeric)   AS shc_min,
        MAX(dilution_ratio::numeric)   AS shc_max
      FROM cs_py_int.simulation_tasks
      WHERE design_case_id = $1
        AND task_type = 'hourly'
        AND status = 'Completed'
        AND created_at >= NOW() - INTERVAL '30 days'
        AND cot_input IS NOT NULL
        AND flow_input IS NOT NULL
        AND dilution_ratio IS NOT NULL
    `, [design_case_id])

    const row = res.rows[0]
    if (!row || row.cot_mean == null) {
      return NextResponse.json({ error: 'No recent hourly data for this design case' }, { status: 404 })
    }

    const std = (v: string | null, fallback: number) => Math.max(parseFloat(v ?? '0') || fallback, fallback)

    return NextResponse.json({
      cot_mean:  parseFloat(row.cot_mean),
      cot_std:   std(row.cot_std, 5),
      cot_min:   parseFloat(row.cot_min),
      cot_max:   parseFloat(row.cot_max),
      flow_mean: parseFloat(row.flow_mean),
      flow_std:  std(row.flow_std, 50),
      flow_min:  parseFloat(row.flow_min),
      flow_max:  parseFloat(row.flow_max),
      shc_mean:  parseFloat(row.shc_mean),
      shc_std:   std(row.shc_std, 0.02),
      shc_min:   parseFloat(row.shc_min),
      shc_max:   parseFloat(row.shc_max),
    })
  } finally {
    client.release()
  }
}
