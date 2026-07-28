import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import type { ValidationBiasReport } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Sensitivity: change in wt% C₂H₄ yield per unit change in each parameter
const SENSITIVITY: Record<string, number> = {
  cot_bias:    0.18,   // wt%/°C
  cip_bias:   -0.15,   // wt%/atm  (higher P → less cracking)
  flux_mult:   2.50,   // wt% per 0.1 unit (i.e. 0.25/0.1)
  adiabatic_l: 0.08,   // wt%/m
  shc_bias:   -12.0,   // wt% per 0.01 kg/kg (i.e. -0.12/0.01)
}

interface TuningParamCfg {
  enabled: boolean
  min: number
  max: number
  step: number
  unit?: string
  result?: number | null
}

function range(min: number, max: number, step: number): number[] {
  const vals: number[] = []
  for (let v = min; v <= max + 1e-9; v = Math.round((v + step) * 1e6) / 1e6) {
    vals.push(v)
  }
  return vals
}

// Grid search: for each enabled parameter, iterate over its range independently
// (sequential single-axis search — fast and interpretable for 1–2 params)
function gridSearch(
  params: Record<string, TuningParamCfg>,
  errorFraction: number,   // (plant - sim) / plant — positive means sim under-predicts
  avgYieldWtPct: number,   // average C₂H₄ yield wt% across all runs
): Record<string, number | null> {
  // Start from 0 offset for all params; find best single-axis correction per param
  const results: Record<string, number | null> = {}
  let remainingError = errorFraction * avgYieldWtPct  // in wt% yield space

  // Process COT bias first (primary parameter), then others in order
  const order = ['cot_bias', 'cip_bias', 'flux_mult', 'adiabatic_l', 'shc_bias']
  for (const key of order) {
    const cfg = params[key]
    if (!cfg?.enabled) { results[key] = null; continue }

    const sens = SENSITIVITY[key] ?? 0
    if (Math.abs(sens) < 1e-9) { results[key] = 0; continue }

    const candidates = range(cfg.min, cfg.max, cfg.step)
    let bestVal = 0
    let bestErr = Math.abs(remainingError)

    for (const v of candidates) {
      const corrected = Math.abs(remainingError - sens * v)
      if (corrected < bestErr) { bestErr = corrected; bestVal = v }
    }

    results[key] = bestVal
    remainingError -= sens * bestVal  // reduce remaining gap for next param
  }

  return results
}

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const { design_case_id } = await req.json()
    if (!design_case_id) return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })

    // Fetch design case metadata including tuning_params
    const dcRes = await client.query(
      `SELECT plant_data_mode, design_cot_bias_degc, tuning_params, validation_mode
       FROM cs_py_int.design_cases WHERE id = $1`,
      [design_case_id]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const plantMode: 'header' | 'per_furnace' | 'per_pass' | null = dcRes.rows[0].plant_data_mode
    const designBias: number = parseFloat(dcRes.rows[0].design_cot_bias_degc ?? '0') || 0
    const tuningParams: Record<string, TuningParamCfg> = dcRes.rows[0].tuning_params ?? {}
    const validationMode: string = dcRes.rows[0].validation_mode ?? 'design'

    // ── Run counts ───────────────────────────────────────────────────────────
    const countRes = await client.query(`
      SELECT
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE run_status = 'success') AS success,
        COUNT(*) FILTER (WHERE run_status = 'failed')  AS failed
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1
    `, [design_case_id])
    const totalN   = parseInt(countRes.rows[0].total)       || 0
    const successN = parseInt(countRes.rows[0].success)     || 0
    const failedN  = parseInt(countRes.rows[0].failed)      || 0
    const failRate = totalN > 0 ? (failedN / totalN) * 100 : 0

    // ── Per-row aggregates (sim + plant) ─────────────────────────────────────
    const rowsRes = await client.query(`
      SELECT
        furnace_id,
        pass_id,
        -- sim matched to plant: only count rows where plant data exists
        SUM(c2h4_kg_hr)        FILTER (WHERE plant_c2h4_kg_hr IS NOT NULL) AS sim_c2h4_kg_hr,
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

    const simC2H4Total   = detailRows.reduce((s, r) => s + (parseFloat(r.sim_c2h4_kg_hr)   || 0), 0)
    const plantC2H4Total = detailRows.reduce((s, r) => s + (parseFloat(r.plant_c2h4_kg_hr) || 0), 0)
    const plantCount     = detailRows.reduce((s, r) => s + (parseInt(r.plant_n)             || 0), 0)
    const avgC2H4Yield   = detailRows.length
      ? detailRows.reduce((s, r) => s + (parseFloat(r.avg_c2h4_yield_wt) || 0), 0) / detailRows.length
      : null
    const avgCoilHeat    = detailRows.length
      ? detailRows.reduce((s, r) => s + (parseFloat(r.avg_coil_heat) || 0), 0) / detailRows.length
      : null

    // ── Multi-parameter tuning (grid search) ─────────────────────────────────
    let recommendedCotBias:  number | null = null
    let c2h4ErrorBeforeBias: number | null = null
    let c2h4ErrorAfterBias:  number | null = null
    let overallC2H4ErrorPct: number | null = null
    let tuningResults: Record<string, { result: number | null; sensitivity_used?: number }> = {}

    const hasTuningParams = Object.values(tuningParams).some(p => p.enabled)

    if (plantC2H4Total > 0 && plantCount > 0 && avgC2H4Yield != null) {
      const errorFraction = (plantC2H4Total - simC2H4Total) / plantC2H4Total
      c2h4ErrorBeforeBias  = parseFloat((errorFraction * 100).toFixed(2))
      overallC2H4ErrorPct  = c2h4ErrorBeforeBias

      if (hasTuningParams) {
        // Multi-parameter grid search
        const paramResults = gridSearch(tuningParams, errorFraction, avgC2H4Yield)

        // Build tuning_results response and updated tuning_params JSONB
        const updatedTuningParams = { ...tuningParams }
        for (const [key, val] of Object.entries(paramResults)) {
          tuningResults[key] = {
            result:            val,
            sensitivity_used:  val != null ? SENSITIVITY[key] : undefined,
          }
          if (updatedTuningParams[key]) {
            updatedTuningParams[key] = { ...updatedTuningParams[key], result: val }
          }
        }

        // Residual error after all tuning
        let residualWtPct = errorFraction * avgC2H4Yield
        for (const [key, val] of Object.entries(paramResults)) {
          if (val != null) residualWtPct -= (SENSITIVITY[key] ?? 0) * val
        }
        c2h4ErrorAfterBias = parseFloat(((residualWtPct / avgC2H4Yield) * 100).toFixed(2))

        // COT bias is the primary tuning result
        recommendedCotBias = (paramResults['cot_bias'] as number | null) ?? null

        // Persist updated tuning_params with results filled in
        await client.query(
          `UPDATE cs_py_int.design_cases SET tuning_params = $1 WHERE id = $2`,
          [JSON.stringify(updatedTuningParams), design_case_id]
        )
      } else {
        // Step search: 0.5°C coarse over ±30°C, then 0.1°C fine ±1°C around best
        const gapWtPct = errorFraction * avgC2H4Yield
        const COARSE = 0.5, FINE = 0.1, LIMIT = 30.0
        let bestBias = 0
        let bestGap  = Math.abs(gapWtPct)

        for (let b = -LIMIT; b <= LIMIT + 1e-9; b = Math.round((b + COARSE) * 1e6) / 1e6) {
          const gap = Math.abs(gapWtPct - SENSITIVITY.cot_bias * b)
          if (gap < bestGap) { bestGap = gap; bestBias = b }
        }
        const fineMin = bestBias - 1.0, fineMax = bestBias + 1.0
        for (let b = fineMin; b <= fineMax + 1e-9; b = Math.round((b + FINE) * 1e6) / 1e6) {
          const gap = Math.abs(gapWtPct - SENSITIVITY.cot_bias * b)
          if (gap < bestGap) { bestGap = gap; bestBias = b }
        }

        recommendedCotBias = Math.round(bestBias * 10) / 10
        const residualWtPct = gapWtPct - SENSITIVITY.cot_bias * recommendedCotBias
        c2h4ErrorAfterBias  = parseFloat(((residualWtPct / avgC2H4Yield) * 100).toFixed(2))
        tuningResults = { cot_bias: { result: recommendedCotBias, sensitivity_used: SENSITIVITY.cot_bias } }
      }
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
      const simAvg   = vals.n > 0 ? vals.sim / vals.n : 0
      const biasKgHr = canComputePerFurnace && vals.plant > 0
        ? Math.round(((vals.plant - vals.sim) / vals.n) * 10) / 10 : 0
      perFurnace.push({ furnace_id: fid, sim_c2h4_avg: parseFloat(simAvg.toFixed(2)), bias_kg_hr: biasKgHr })
      if (biasKgHr !== 0) perFurnaceBiasJsonb[fid] = biasKgHr
    }

    const perFurnaceBiasAvailability: 'computed' | 'unavailable' =
      canComputePerFurnace && plantC2H4Total > 0 ? 'computed' : 'unavailable'

    // ── Monthly breakdown ────────────────────────────────────────────────────
    const monthlyRes = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'YYYY-MM') AS month,
        SUM(c2h4_kg_hr) / 1000 AS sim_c2h4_mt,
        AVG(h2_ch4_yield_wt)   AS h2_ch4_yield,
        AVG(c3plus_yield_wt)   AS c3plus_yield
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
      GROUP BY 1 ORDER BY 1
    `, [design_case_id])

    const monthly = monthlyRes.rows.map(r => ({
      month:            r.month,
      sim_c2h4_mt:      parseFloat(r.sim_c2h4_mt) || 0,
      h2_ch4_error_pct: null as number | null,
      c3plus_error_pct: null as number | null,
    }))

    // ── Acceptance checks ────────────────────────────────────────────────────
    const checks = [
      {
        name:      'C₂H₄ overall error ≤ ±2%',
        passed:    overallC2H4ErrorPct != null ? Math.abs(overallC2H4ErrorPct) <= 2 : null,
        value:     overallC2H4ErrorPct != null ? `${overallC2H4ErrorPct.toFixed(2)}%` : 'N/A — plant yield tags not configured',
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
        passed:    null as boolean | null,
        value:     'N/A',
        threshold: '±5%',
      },
      {
        name:      'C3+ error ≤ ±5%',
        passed:    null as boolean | null,
        value:     'N/A',
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
    const totalCotBias = recommendedCotBias != null ? designBias + recommendedCotBias : null
    await client.query(`
      UPDATE cs_py_int.design_cases SET
        cot_bias_degc             = $1,
        c2h4_yield_bias_kg_hr     = $2,
        validation_c2h4_error_pct = $3,
        validation_runs_failed    = $4,
        validation_status         = $5
      WHERE id = $6
    `, [
      totalCotBias,
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
    return NextResponse.json({
      ...report,
      tuning_results:   tuningResults,
      validation_mode:  validationMode,
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
