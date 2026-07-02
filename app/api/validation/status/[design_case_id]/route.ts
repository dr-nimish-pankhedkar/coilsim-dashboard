import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { design_case_id: string } }
) {
  const dcId = parseInt(params.design_case_id, 10)
  if (isNaN(dcId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    // Single aggregated query: design case status + result counts + monthly rollup
    const res = await pool.query(`
      SELECT
        dc.validation_status,
        dc.validation_runs_total,
        dc.validation_runs_failed,
        dc.cot_bias_degc,
        dc.c2h4_yield_bias_kg_hr,
        COUNT(vr.id) FILTER (WHERE vr.run_status = 'success') AS runs_complete,
        COUNT(vr.id) FILTER (WHERE vr.run_status = 'failed')  AS runs_failed_live,
        COUNT(vr.id) FILTER (WHERE vr.run_status = 'pending') AS runs_pending,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'month', TO_CHAR(DATE_TRUNC('month', vr.timestamp), 'YYYY-MM'),
              'sim_c2h4_mt', ROUND((SUM(vr.c2h4_kg_hr) OVER (PARTITION BY DATE_TRUNC('month', vr.timestamp)) / 1000)::numeric, 2)
            ) ORDER BY DATE_TRUNC('month', vr.timestamp)
          ) FILTER (WHERE vr.run_status = 'success' AND vr.c2h4_kg_hr IS NOT NULL),
          '[]'
        ) AS monthly_raw
      FROM cs_py_int.design_cases dc
      LEFT JOIN cs_py_int.validation_results vr ON vr.design_case_id = dc.id
      WHERE dc.id = $1
      GROUP BY dc.id, dc.validation_status, dc.validation_runs_total,
               dc.validation_runs_failed, dc.cot_bias_degc, dc.c2h4_yield_bias_kg_hr
    `, [dcId])

    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = res.rows[0]

    const runsComplete = parseInt(row.runs_complete)  || 0
    const runsFailed   = parseInt(row.runs_failed_live) || 0
    const runsTotal    = row.validation_runs_total    || 0
    const hasPending   = parseInt(row.runs_pending)   > 0
    let status: string = row.validation_status

    // Auto-transition running → complete when no pending results remain
    if (status === 'running' && !hasPending && runsTotal > 0 && runsComplete + runsFailed >= runsTotal) {
      const failRate = runsTotal > 0 ? (runsFailed / runsTotal) * 100 : 0
      const nextStatus = failRate < 10 ? 'complete' : 'requires_review'
      await pool.query(
        `UPDATE cs_py_int.design_cases
         SET validation_status = $1, validation_runs_failed = $2 WHERE id = $3`,
        [nextStatus, runsFailed, dcId]
      )
      status = nextStatus
    }

    const pct = runsTotal > 0
      ? Math.round(((runsComplete + runsFailed) / runsTotal) * 100)
      : 0

    // Deduplicate monthly rows (window fn produces one row per vr row)
    const monthlyRaw: Array<{ month: string; sim_c2h4_mt: number }> = row.monthly_raw || []
    const monthMap = new Map<string, number>()
    for (const m of monthlyRaw) {
      if (m.month) monthMap.set(m.month, parseFloat(String(m.sim_c2h4_mt)) || 0)
    }
    const months = Array.from(monthMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, sim_c2h4_mt]) => ({ month, sim_c2h4_mt, error_pct: null as number | null }))

    return NextResponse.json({
      status,
      runs_total:    runsTotal,
      runs_complete: runsComplete,
      runs_failed:   runsFailed,
      pct_complete:  pct,
      months,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
