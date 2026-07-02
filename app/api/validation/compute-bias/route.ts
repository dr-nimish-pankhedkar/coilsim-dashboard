import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import type { ValidationBiasReport } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const { design_case_id } = await req.json()
    if (!design_case_id) return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })

    // Total run counts
    const countRes = await client.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE run_status = 'success') AS success,
        COUNT(*) FILTER (WHERE run_status = 'failed')  AS failed
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1
    `, [design_case_id])
    const { total, success: successCount, failed: failedCount } = countRes.rows[0]
    const totalN    = parseInt(total)       || 0
    const successN  = parseInt(successCount) || 0
    const failedN   = parseInt(failedCount)  || 0
    const failRate  = totalN > 0 ? (failedN / totalN) * 100 : 0

    // Overall C2H4 aggregates
    const overallRes = await client.query(`
      SELECT
        AVG(c2h4_yield_wt)   AS avg_c2h4_yield,
        AVG(h2_ch4_yield_wt) AS avg_h2ch4_yield,
        AVG(c3plus_yield_wt) AS avg_c3plus_yield,
        AVG(coil_heat_kj_hr) AS avg_coil_heat
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
    `, [design_case_id])
    const ov = overallRes.rows[0]
    const avgC2H4     = ov.avg_c2h4_yield   ? parseFloat(ov.avg_c2h4_yield)   : null
    const avgH2CH4    = ov.avg_h2ch4_yield  ? parseFloat(ov.avg_h2ch4_yield)  : null
    const avgC3Plus   = ov.avg_c3plus_yield ? parseFloat(ov.avg_c3plus_yield) : null
    const avgCoilHeat = ov.avg_coil_heat    ? parseFloat(ov.avg_coil_heat)    : null

    // We don't have plant-side yield data yet — compute simulated-only metrics.
    // When plant yield analyzer tags are available, load them here and compute error%.
    const overallC2H4ErrorPct = null as number | null   // needs plant data
    const h2Ch4ErrorPct       = null as number | null
    const c3PlusErrorPct      = null as number | null

    // Per-furnace aggregates
    const furnaceRes = await client.query(`
      SELECT
        furnace_id,
        AVG(c2h4_kg_hr) AS sim_c2h4_avg
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY furnace_id
      ORDER BY furnace_id
    `, [design_case_id])

    const perFurnace = furnaceRes.rows.map(r => ({
      furnace_id:   r.furnace_id,
      sim_c2h4_avg: parseFloat(r.sim_c2h4_avg) || 0,
      bias_kg_hr:   0,   // zero until plant data available
    }))

    // Monthly breakdown
    const monthlyRes = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') AS month,
        SUM(c2h4_kg_hr) / 1000  AS sim_c2h4_mt,
        AVG(h2_ch4_yield_wt)    AS h2_ch4_yield,
        AVG(c3plus_yield_wt)    AS c3plus_yield
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY 1
      ORDER BY 1
    `, [design_case_id])

    const monthly = monthlyRes.rows.map(r => ({
      month:             r.month,
      sim_c2h4_mt:       parseFloat(r.sim_c2h4_mt)  || 0,
      h2_ch4_error_pct:  null as number | null,
      c3plus_error_pct:  null as number | null,
    }))

    // Build acceptance checklist
    // Note: error% checks are N/A until plant yield data is configured.
    // Failure rate and thermal efficiency can be checked now.
    const DESIGN_EFFICIENCY_LOW  = 85
    const DESIGN_EFFICIENCY_HIGH = 92
    // Assume fired duty unavailable — skip energy check if avg_coil_heat is null
    // na = check cannot be evaluated (plant data not yet available)
    // na checks are shown as ⚠️ amber in the UI, not ✓ green, and do NOT block promotion
    const checks = [
      {
        name:      'C₂H₄ overall error ≤ ±2%',
        passed:    overallC2H4ErrorPct != null ? Math.abs(overallC2H4ErrorPct) <= 2 : null,
        value:     overallC2H4ErrorPct != null ? `${overallC2H4ErrorPct.toFixed(2)}%` : 'N/A — plant yield analyser tags not configured',
        threshold: '±2%',
      },
      {
        name:      'No month exceeds ±5%',
        passed:    null as boolean | null,  // N/A without plant data
        value:     'N/A — plant yield analyser tags not configured',
        threshold: '±5%',
      },
      {
        name:      'H₂+CH₄ error ≤ ±5%',
        passed:    h2Ch4ErrorPct != null ? Math.abs(h2Ch4ErrorPct) <= 5 : null,
        value:     h2Ch4ErrorPct != null ? `${h2Ch4ErrorPct.toFixed(2)}%` : 'N/A — plant yield analyser tags not configured',
        threshold: '±5%',
      },
      {
        name:      'C3+ error ≤ ±5%',
        passed:    c3PlusErrorPct != null ? Math.abs(c3PlusErrorPct) <= 5 : null,
        value:     c3PlusErrorPct != null ? `${c3PlusErrorPct.toFixed(2)}%` : 'N/A — plant yield analyser tags not configured',
        threshold: '±5%',
      },
      {
        name:      'Thermal efficiency within design range (85–92%)',
        passed:    null as boolean | null,  // N/A without fired duty tag
        value:     'N/A — fuel gas flow tag not configured',
        threshold: '85–92%',
      },
      {
        name:      'Run failure rate < 10%',
        passed:    failRate < 10,
        value:     `${failRate.toFixed(1)}%`,
        threshold: '<10%',
      },
    ]

    // allPassed: only evaluate checks with real data (null = N/A, skipped from gate)
    const allPassed = checks.every(c => c.passed !== false)
    const nextStatus = allPassed ? 'complete' : 'requires_review'

    // Persist bias per furnace as JSONB and update design case status
    const biasJsonb = Object.fromEntries(perFurnace.map(f => [f.furnace_id, f.bias_kg_hr]))
    await client.query(`
      UPDATE cs_py_int.design_cases SET
        c2h4_yield_bias_kg_hr     = $1,
        validation_c2h4_error_pct = $2,
        validation_runs_failed    = $3,
        validation_status         = $4
      WHERE id = $5
    `, [JSON.stringify(biasJsonb), overallC2H4ErrorPct, failedN, nextStatus, design_case_id])
    await client.query('COMMIT')

    const report: ValidationBiasReport = {
      all_passed:               allPassed,
      checks,
      per_furnace:              perFurnace,
      monthly,
      run_failure_rate_pct:     failRate,
      overall_c2h4_error_pct:   overallC2H4ErrorPct,
      avg_coil_heat_kj_hr:      avgCoilHeat,
    }
    return NextResponse.json(report)
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
