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
        COUNT(vr.id) FILTER (WHERE vr.run_status = 'pending') AS runs_pending
      FROM cs_py_int.design_cases dc
      LEFT JOIN cs_py_int.validation_results vr ON vr.design_case_id = dc.id
      WHERE dc.id = $1
      GROUP BY dc.id, dc.validation_status, dc.validation_runs_total,
               dc.validation_runs_failed, dc.cot_bias_degc, dc.c2h4_yield_bias_kg_hr
    `, [dcId])

    // Monthly rollup in a separate query (window fn inside aggregate is illegal in PG)
    const monthlyRes = await pool.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') AS month,
        ROUND((SUM(c2h4_kg_hr) / 1000)::numeric, 2) AS sim_c2h4_mt
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success' AND c2h4_kg_hr IS NOT NULL
      GROUP BY DATE_TRUNC('month', timestamp)
      ORDER BY 1
    `, [dcId])

    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = res.rows[0]

    const runsComplete = parseInt(row.runs_complete)    || 0
    const runsFailed   = parseInt(row.runs_failed_live) || 0
    const runsTotal    = row.validation_runs_total      || 0
    let status: string = row.validation_status

    // Auto-transition running → complete when all simulation_tasks for this run are done
    // (Completed or Error). Non-converging validation tasks are left as pending in
    // validation_results but are marked Error in simulation_tasks — so we check tasks, not results.
    if (status === 'running') {
      // Transition when no Pending or Processing tasks remain for this design case.
      const taskRes = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('Pending','Processing')) AS active,
          COUNT(*) AS total
        FROM cs_py_int.simulation_tasks
        WHERE design_case_id = $1 AND task_type = 'validation'
      `, [dcId])
      const taskActive = parseInt(taskRes.rows[0]?.active) || 0
      const taskTotal  = parseInt(taskRes.rows[0]?.total)  || 0
      if (taskTotal > 0 && taskActive === 0) {
        const failRate = runsTotal > 0 ? (runsFailed / runsTotal) * 100 : 0
        const nextStatus = failRate < 10 ? 'complete' : 'requires_review'
        await pool.query(
          `UPDATE cs_py_int.design_cases
           SET validation_status = $1, validation_runs_failed = $2 WHERE id = $3`,
          [nextStatus, runsFailed, dcId]
        )
        status = nextStatus
      }
    }

    // Progress based on simulation_tasks done count — scoped to latest runsTotal tasks
    const taskDoneForPct = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE status IN ('Completed','Error')) AS done
      FROM (
        SELECT status FROM cs_py_int.simulation_tasks
        WHERE design_case_id = $1 AND task_type = 'validation'
        ORDER BY id DESC
        LIMIT $2
      ) recent
    `, [dcId, runsTotal || 9999])
    const doneCount = parseInt(taskDoneForPct.rows[0]?.done) || (runsComplete + runsFailed)
    const pct = runsTotal > 0 ? Math.round((doneCount / runsTotal) * 100) : 0

    const months = monthlyRes.rows.map(m => ({
      month:        m.month as string,
      sim_c2h4_mt:  parseFloat(m.sim_c2h4_mt) || 0,
      error_pct:    null as number | null,
    }))

    const runsNotConverged = parseInt(row.runs_pending) || 0

    return NextResponse.json({
      status,
      runs_total:         runsTotal,
      runs_complete:      runsComplete,
      runs_failed:        runsFailed,
      runs_not_converged: runsNotConverged,
      pct_complete:       pct,
      months,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
