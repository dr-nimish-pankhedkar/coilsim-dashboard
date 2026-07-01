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
    // Design case status
    const dcRes = await pool.query(
      `SELECT validation_status, validation_runs_total, validation_runs_failed,
              cot_bias_degc, c2h4_yield_bias_kg_hr
       FROM cs_py_int.design_cases WHERE id = $1`,
      [dcId]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const dc = dcRes.rows[0]

    // Count completed/failed validation results for this design case
    const countRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE run_status = 'success') AS completed,
        COUNT(*) FILTER (WHERE run_status = 'failed')  AS failed,
        COUNT(*) FILTER (WHERE run_status = 'pending') AS pending
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1
    `, [dcId])
    const counts = countRes.rows[0]
    const runsComplete = parseInt(counts.completed) || 0
    const runsFailed   = parseInt(counts.failed)    || 0
    const runsTotal    = dc.validation_runs_total   || 0

    // If there are no pending validation results left, mark complete (worker may have finished)
    const hasPending = parseInt(counts.pending) > 0
    let status = dc.validation_status
    if (status === 'running' && !hasPending && runsTotal > 0 && runsComplete + runsFailed >= runsTotal) {
      // Auto-transition: update design case status to complete
      const failRate = runsTotal > 0 ? (runsFailed / runsTotal) * 100 : 0
      const nextStatus = failRate < 10 ? 'complete' : 'requires_review'
      await pool.query(
        `UPDATE cs_py_int.design_cases
         SET validation_status = $1, validation_runs_failed = $2 WHERE id = $3`,
        [nextStatus, runsFailed, dcId]
      )
      status = nextStatus
    }

    // Monthly breakdown of simulation results so far
    const monthlyRes = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') AS month,
        SUM(c2h4_kg_hr) / 1000 AS sim_c2h4_mt
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY 1
      ORDER BY 1
    `, [dcId])

    const pct = runsTotal > 0
      ? Math.round(((runsComplete + runsFailed) / runsTotal) * 100)
      : 0

    return NextResponse.json({
      status,
      runs_total:    runsTotal,
      runs_complete: runsComplete,
      runs_failed:   runsFailed,
      pct_complete:  pct,
      months: monthlyRes.rows.map(r => ({
        month:         r.month,
        sim_c2h4_mt:   parseFloat(r.sim_c2h4_mt) || 0,
        error_pct:     null,   // plant yield not yet available
      })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
