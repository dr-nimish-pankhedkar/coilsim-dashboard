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

    // Fetch design case metadata including plant data mode
    const dcRes = await client.query(
      `SELECT plant_data_mode FROM cs_py_int.design_cases WHERE id = $1`,
      [design_case_id]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const plantMode: 'header' | 'per_furnace' | 'per_pass' | null = dcRes.rows[0].plant_data_mode

    // ── Run counts ───────────────────────────────────────────────────────────
    const countRes = await client.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE run_status = 'success') AS success,
        COUNT(*) FILTER (WHERE run_status = 'failed')  AS failed
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1
    `, [design_case_id])
    const totalN   = parseInt(countRes.rows[0].total)        || 0
    const successN = parseInt(countRes.rows[0].success)      || 0
    const failedN  = parseInt(countRes.rows[0].failed)       || 0
    const failRate = totalN > 0 ? (failedN / totalN) * 100  : 0

    // ── Per-row aggregates (sim + plant) ─────────────────────────────────────
    const rowsRes = await client.query(`
      SELECT
        furnace_id,
        pass_id,
        SUM(c2h4_kg_hr)        AS sim_c2h4_kg_hr,
        SUM(plant_c2h4_kg_hr)  AS plant_c2h4_kg_hr,
        AVG(c2h4_yield_wt)     AS avg_c2h4_yield_wt,
        AVG(coil_heat_kj_hr)   AS avg_coil_heat,
        COUNT(*)               AS n,
        COUNT(*) FILTER (WHERE plant_c2h4_kg_hr IS NOT NULL) AS plant_n
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY furnace_id, pass_id
      ORDER BY furnace_id, pass_id
    `, [design_case_id])
    const detailRows = rowsRes.rows

    // Overall totals
    const simC2H4Total   = detailRows.reduce((s, r) => s + (parseFloat(r.sim_c2h4_kg_hr)   || 0), 0)
    const plantC2H4Total = detailRows.reduce((s, r) => s + (parseFloat(r.plant_c2h4_kg_hr) || 0), 0)
    const plantCount     = detailRows.reduce((s, r) => s + (parseInt(r.plant_n)             || 0), 0)
    const avgC2H4Yield   = detailRows.length
      ? detailRows.reduce((s, r) => s + (parseFloat(r.avg_c2h4_yield_wt) || 0), 0) / detailRows.length
      : null
    const avgCoilHeat    = detailRows.length
      ? detailRows.reduce((s, r) => s + (parseFloat(r.avg_coil_heat) || 0), 0) / detailRows.length
      : null

    // ── COT bias fitting (mode-agnostic — always uses global total) ──────────
    let recommendedCotBias:    number | null = null
    let c2h4ErrorBeforeBias:   number | null = null
    let c2h4ErrorAfterBias:    number | null = null
    let overallC2H4ErrorPct:   number | null = null

    if (plantC2H4Total > 0 && plantCount > 0 && avgC2H4Yield != null) {
      const errorFraction = (plantC2H4Total - simC2H4Total) / plantC2H4Total
      c2h4ErrorBeforeBias  = parseFloat((errorFraction * 100).toFixed(2))
      overallC2H4ErrorPct  = c2h4ErrorBeforeBias

      const gapWtPct = errorFraction * avgC2H4Yield
      recommendedCotBias = Math.round((gapWtPct / COT_SENSITIVITY_WT_PCT_PER_DEG) * 10) / 10

      const residual = errorFraction - (recommendedCotBias * COT_SENSITIVITY_WT_PCT_PER_DEG / avgC2H4Yield)
      c2h4ErrorAfterBias = parseFloat((residual * 100).toFixed(2))
    }

    // ── Per-furnace bias ─────────────────────────────────────────────────────
    type FurnaceRow = { furnace_id: string; sim_c2h4_avg: number; bias_kg_hr: number }
    const furnaceMap = new Map<string, { sim: number; plant: number; n: number }>()
    for (const r of detailRows) {
      const fid = r.furnace_id ?? 'unknown'
      const cur = furnaceMap.get(fid) ?? { sim: 0, plant: 0, n: 0 }
      furnaceMap.set(fid, {
        sim:   cur.sim   + (parseFloat(r.sim_c2h4_kg_hr)   || 0),
        plant: cur.plant + (parseFloat(r.plant_c2h4_kg_hr) || 0),
        n:     cur.n     + (parseInt(r.n) || 0),
      })
    }

    const perFurnace: FurnaceRow[] = []
    const perFurnaceBiasJsonb: Record<string, number> = {}
    const canComputePerFurnace = plantMode === 'per_furnace' || plantMode === 'per_pass'

    for (const [fid, vals] of furnaceMap.entries()) {
      const simAvg  = vals.n > 0 ? vals.sim  / vals.n : 0
      const biasKgHr = canComputePerFurnace && vals.plant > 0
        ? Math.round(((vals.plant - vals.sim) / vals.n) * 10) / 10
        : 0
      perFurnace.push({ furnace_id: fid, sim_c2h4_avg: parseFloat(simAvg.toFixed(2)), bias_kg_hr: biasKgHr })
      if (biasKgHr !== 0) perFurnaceBiasJsonb[fid] = biasKgHr
    }

    const perFurnaceBiasAvailability: 'computed' | 'unavailable' =
      canComputePerFurnace && plantC2H4Total > 0 ? 'computed' : 'unavailable'

    // ── Monthly breakdown ────────────────────────────────────────────────────
    const monthlyRes = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') AS month,
        SUM(c2h4_kg_hr)     / 1000 AS sim_c2h4_mt,
        AVG(h2_ch4_yield_wt)       AS h2_ch4_yield,
        AVG(c3plus_yield_wt)       AS c3plus_yield
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY 1 ORDER BY 1
    `, [design_case_id])

    const monthly = monthlyRes.rows.map(r => ({
      month:            r.month,
      sim_c2h4_mt:      parseFloat(r.sim_c2h4_mt)  || 0,
      h2_ch4_error_pct: null as number | null,
      c3plus_error_pct: null as number | null,
    }))

    // ── Acceptance checks ────────────────────────────────────────────────────
    const h2Ch4ErrorPct  = null as number | null
    const c3PlusErrorPct = null as number | null

    const checks = [
      {
        name:      'C₂H₄ overall error ≤ ±2%',
        passed:    overallC2H4ErrorPct != null ? Math.abs(overallC2H4ErrorPct) <= 2 : null,
        value:     overallC2H4ErrorPct != null ? `${overallC2H4ErrorPct.toFixed(2)}%` : 'N/A — plant yield tags not configured or not found in historian',
        threshold: '±2%',
      },
      {
        name:      'No month exceeds ±5%',
        passed:    null as boolean | null,
        value:     'N/A — plant yield tags not configured',
        threshold: '±5%',
      },
      {
        name:      'H₂+CH₄ error ≤ ±5%',
        passed:    h2Ch4ErrorPct != null ? Math.abs(h2Ch4ErrorPct) <= 5 : null,
        value:     h2Ch4ErrorPct != null ? `${h2Ch4ErrorPct.toFixed(2)}%` : 'N/A',
        threshold: '±5%',
      },
      {
        name:      'C3+ error ≤ ±5%',
        passed:    c3PlusErrorPct != null ? Math.abs(c3PlusErrorPct) <= 5 : null,
        value:     c3PlusErrorPct != null ? `${c3PlusErrorPct.toFixed(2)}%` : 'N/A',
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

    const allPassed  = checks.every(c => c.passed !== false)
    const nextStatus = allPassed ? 'complete' : 'requires_review'

    // ── Persist to design_cases ──────────────────────────────────────────────
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
      JSON.stringify(perFurnaceBiasJsonb),
      overallC2H4ErrorPct,
      failedN,
      nextStatus,
      design_case_id,
    ])
    await client.query('COMMIT')

    const report: ValidationBiasReport = {
      all_passed:                    allPassed,
      checks,
      per_furnace:                   perFurnace,
      per_furnace_bias_availability: perFurnaceBiasAvailability,
      monthly,
      run_failure_rate_pct:          failRate,
      overall_c2h4_error_pct:        overallC2H4ErrorPct,
      avg_coil_heat_kj_hr:           avgCoilHeat,
      recommended_cot_bias:          recommendedCotBias,
      c2h4_error_before_bias:        c2h4ErrorBeforeBias,
      c2h4_error_after_bias:         c2h4ErrorAfterBias,
      plant_data_mode:               plantMode,
    }
    return NextResponse.json(report)
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
