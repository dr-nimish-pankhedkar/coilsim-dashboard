import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import type { ValidationBiasReport } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Ethane cracking sensitivity: +1 °C COT ≈ +0.18 wt% C₂H₄ yield
const COT_SENSITIVITY_WT_PCT_PER_DEG = 0.18

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
    const totalN   = parseInt(total)        || 0
    const successN = parseInt(successCount) || 0
    const failedN  = parseInt(failedCount)  || 0
    const failRate = totalN > 0 ? (failedN / totalN) * 100 : 0

    // Overall C2H4 aggregates from simulation
    const overallRes = await client.query(`
      SELECT
        AVG(c2h4_yield_wt)   AS avg_c2h4_yield,
        AVG(h2_ch4_yield_wt) AS avg_h2ch4_yield,
        AVG(c3plus_yield_wt) AS avg_c3plus_yield,
        SUM(c2h4_kg_hr)      AS sum_c2h4_kg_hr,
        AVG(coil_heat_kj_hr) AS avg_coil_heat
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
    `, [design_case_id])
    const ov = overallRes.rows[0]
    const avgC2H4Yield = ov.avg_c2h4_yield  ? parseFloat(ov.avg_c2h4_yield)  : null
    const simC2H4Total = ov.sum_c2h4_kg_hr  ? parseFloat(ov.sum_c2h4_kg_hr)  : 0
    const avgCoilHeat  = ov.avg_coil_heat   ? parseFloat(ov.avg_coil_heat)    : null

    // Plant-side C₂H₄ — not yet available (hourly_data tag schema TBD).
    // When tags are configured, query them here and compute error%.
    const plantC2H4Total: number | null = null  // needs plant yield analyser tag

    // ── COT bias recommendation ──────────────────────────────────────────────
    // The recommended COT bias is the offset (°C) that closes the C₂H₄ yield gap.
    // Formula: gap_wt_pct / sensitivity_per_deg
    // This is only computable once plant data is available.
    let recommendedCotBias: number | null = null
    let c2h4ErrorBeforeBias: number | null = null  // % error at raw DCS COT
    let c2h4ErrorAfterBias:  number | null = null  // estimated residual after bias correction

    if (plantC2H4Total != null && plantC2H4Total > 0 && avgC2H4Yield != null) {
      const errorFraction = (plantC2H4Total - simC2H4Total) / plantC2H4Total
      c2h4ErrorBeforeBias = parseFloat((errorFraction * 100).toFixed(2))

      // Gap in wt% space → COT offset required
      const gapWtPct = errorFraction * avgC2H4Yield
      recommendedCotBias = Math.round((gapWtPct / COT_SENSITIVITY_WT_PCT_PER_DEG) * 10) / 10

      // Estimated residual error after applying that bias (should be ~0 by construction)
      const correctedGap = errorFraction - (recommendedCotBias * COT_SENSITIVITY_WT_PCT_PER_DEG / avgC2H4Yield)
      c2h4ErrorAfterBias = parseFloat((correctedGap * 100).toFixed(2))
    }

    // Per-furnace aggregates
    const furnaceRes = await client.query(`
      SELECT
        furnace_id,
        AVG(c2h4_yield_wt) AS avg_c2h4_yield,
        SUM(c2h4_kg_hr)    AS sum_c2h4_kg_hr,
        COUNT(*)           AS n
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY furnace_id
      ORDER BY furnace_id
    `, [design_case_id])

    // Per-furnace bias (kg/hr gap vs plant) — zero until plant data available
    const perFurnace = furnaceRes.rows.map(r => ({
      furnace_id:   r.furnace_id,
      sim_c2h4_avg: parseFloat(r.sum_c2h4_kg_hr) / (parseInt(r.n) || 1),
      bias_kg_hr:   0,   // requires plant yield per furnace
    }))
    const perFurnaceBiasAvailability: 'computed' | 'unavailable' = 'unavailable'

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
      month:            r.month,
      sim_c2h4_mt:      parseFloat(r.sim_c2h4_mt)  || 0,
      h2_ch4_error_pct: null as number | null,
      c3plus_error_pct: null as number | null,
    }))

    // Acceptance checklist — N/A checks shown as ⚠️ amber, do NOT block promotion
    const overallC2H4ErrorPct = c2h4ErrorBeforeBias
    const h2Ch4ErrorPct       = null as number | null
    const c3PlusErrorPct      = null as number | null

    const checks = [
      {
        name:      'C₂H₄ overall error ≤ ±2%',
        passed:    overallC2H4ErrorPct != null ? Math.abs(overallC2H4ErrorPct) <= 2 : null,
        value:     overallC2H4ErrorPct != null ? `${overallC2H4ErrorPct.toFixed(2)}%` : 'N/A — plant yield analyser tags not configured',
        threshold: '±2%',
      },
      {
        name:      'No month exceeds ±5%',
        passed:    null as boolean | null,
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
        passed:    null as boolean | null,
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

    // allPassed: null = N/A (skipped); false = hard fail
    const allPassed = checks.every(c => c.passed !== false)
    const nextStatus = allPassed ? 'complete' : 'requires_review'

    // Persist computed outputs to design_cases.
    // cot_bias_degc is written here as a computed output — promote/route reads it back unchanged.
    const biasJsonb = Object.fromEntries(perFurnace.map(f => [f.furnace_id, f.bias_kg_hr]))
    await client.query(`
      UPDATE cs_py_int.design_cases SET
        cot_bias_degc             = $1,
        c2h4_yield_bias_kg_hr     = $2,
        validation_c2h4_error_pct = $3,
        validation_runs_failed    = $4,
        validation_status         = $5
      WHERE id = $6
    `, [
      recommendedCotBias,
      JSON.stringify(biasJsonb),
      overallC2H4ErrorPct,
      failedN,
      nextStatus,
      design_case_id,
    ])
    await client.query('COMMIT')

    const report: ValidationBiasReport = {
      all_passed:                   allPassed,
      checks,
      per_furnace:                  perFurnace,
      per_furnace_bias_availability: perFurnaceBiasAvailability,
      monthly,
      run_failure_rate_pct:         failRate,
      overall_c2h4_error_pct:       overallC2H4ErrorPct,
      avg_coil_heat_kj_hr:          avgCoilHeat,
      recommended_cot_bias:         recommendedCotBias,
      c2h4_error_before_bias:       c2h4ErrorBeforeBias,
      c2h4_error_after_bias:        c2h4ErrorAfterBias,
    }
    return NextResponse.json(report)
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
