import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Latin Hypercube Sampling: returns N samples in [0,1] for one dimension, permuted.
function lhsColumn(n: number, seed: number): number[] {
  // Deterministic shuffle using a simple LCG seeded per column
  const pts: number[] = []
  for (let i = 0; i < n; i++) pts.push((i + 0.5) / n)  // midpoints
  // Fisher-Yates with deterministic pseudo-random based on seed
  let s = seed
  const rand = () => { s = (s * 1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pts[i], pts[j]] = [pts[j], pts[i]]
  }
  return pts
}

interface ParamRange { min: number; max: number; current: number }
interface ParamRanges { cot: ParamRange; flow: ParamRange; shc: ParamRange; cit?: ParamRange; cip?: ParamRange }

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const body = await req.json()
    const {
      design_case_id,
      param_ranges,
      n_samples = 100,
      regression_type = 'poly2',
      objective = 'c2h4_yield_wt',
      constraint_json,
    }: {
      design_case_id: number
      param_ranges: ParamRanges
      n_samples?: number
      regression_type?: string
      objective?: string
      constraint_json?: unknown
    } = body

    if (!design_case_id || !param_ranges) {
      return NextResponse.json({ error: 'design_case_id and param_ranges required' }, { status: 400 })
    }

    const dcRes = await client.query(
      'SELECT * FROM cs_py_int.design_cases WHERE id = $1',
      [design_case_id]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Design case not found' }, { status: 404 })
    const dc = dcRes.rows[0]
    const isUploaded = !!(dc.uploaded_proj_id || dc.source === 'uploaded_proj')

    await client.query('BEGIN')

    // Cancel any Pending/Processing/Error optimization tasks from prior runs on this design case
    // so a fresh launch is always clean — no stale tasks left behind from aborted runs
    await client.query(`
      UPDATE cs_py_int.simulation_tasks
      SET status = 'Cancelled'
      WHERE design_case_id = $1
        AND task_type = 'optimization'
        AND status IN ('Pending', 'Processing', 'Error')
    `, [design_case_id])

    // Create the optimization run record
    const runRes = await client.query(`
      INSERT INTO cs_py_int.optimization_runs
        (design_case_id, param_ranges, n_samples, sampling_method, objective,
         regression_type, constraint_json, status, n_sims_total)
      VALUES ($1,$2,$3,'lhs',$4,$5,$6,'running_sims',$3)
      RETURNING id
    `, [design_case_id, JSON.stringify(param_ranges), n_samples, objective, regression_type,
        JSON.stringify(constraint_json ?? param_ranges)])
    const runId: number = runRes.rows[0].id

    // Generate LHS samples — uploaded models sweep flow+SHC only (severity is fixed)
    const lhsDims = isUploaded ? ['flow', 'shc'] as const : ['cot', 'flow', 'shc'] as const
    const extraParams = ['cit', 'cip'] as const
    const allParams = [...lhsDims, ...extraParams.filter(p => param_ranges[p])]

    const columns: Record<string, number[]> = {}
    allParams.forEach((p, i) => { columns[p] = lhsColumn(n_samples, i + 1) })

    // Scale to actual ranges and queue simulation tasks (or reuse cached results)
    const designBias = parseFloat(dc.design_cot_bias_degc ?? '0') || 0
    let cacheHits = 0
    let newRuns   = 0

    for (let i = 0; i < n_samples; i++) {
      const pr = param_ranges
      const flow = pr.flow.min + columns['flow'][i] * (pr.flow.max - pr.flow.min)
      const shc  = pr.shc.min  + columns['shc'][i]  * (pr.shc.max  - pr.shc.min)
      const cot  = isUploaded
        ? (parseFloat(dc.severity_nominal) || 0)   // fixed — not patched by worker
        : (pr.cot.min + (columns['cot'] as number[])[i] * (pr.cot.max - pr.cot.min))
      const cit  = pr.cit ? pr.cit.min + (columns['cit']?.[i] ?? 0.5) * (pr.cit.max - pr.cit.min) : (parseFloat(dc.cit_degc) || 668)
      const cip  = pr.cip ? pr.cip.min + (columns['cip']?.[i] ?? 0.5) * (pr.cip.max - pr.cip.min) : (parseFloat(dc.cip_atm) || 2.59)

      const sampleParams = { cot: round(cot, 2), flow: round(flow, 1), shc: round(shc, 4), cit: round(cit, 2), cip: round(cip, 3) }

      // Cache lookup — uploaded models match on flow+SHC only (COT is fixed/irrelevant)
      const cached = isUploaded
        ? await client.query(`
            SELECT id, c2h4_yield_wt, task_id
            FROM cs_py_int.optimization_sim_results
            WHERE design_case_id = $1
              AND ABS(flow_input - $2) <= 0.5
              AND ABS(shc_input  - $3) <= 0.001
              AND c2h4_yield_wt IS NOT NULL
              AND cache_hit = FALSE
            ORDER BY id DESC LIMIT 1
          `, [design_case_id, flow, shc])
        : await client.query(`
            SELECT id, c2h4_yield_wt, task_id
            FROM cs_py_int.optimization_sim_results
            WHERE design_case_id = $1
              AND ABS(cot_input  - $2) <= 0.1
              AND ABS(flow_input - $3) <= 0.5
              AND ABS(shc_input  - $4) <= 0.001
              AND c2h4_yield_wt IS NOT NULL
              AND cache_hit = FALSE
            ORDER BY id DESC LIMIT 1
          `, [design_case_id, cot, flow, shc])

      if (cached.rows.length > 0) {
        const hit = cached.rows[0]
        await client.query(`
          INSERT INTO cs_py_int.optimization_sim_results
            (optimization_run_id, design_case_id, params,
             cot_input, flow_input, shc_input,
             c2h4_yield_wt, cache_hit, source_task_id, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,'completed')
        `, [runId, design_case_id, JSON.stringify(sampleParams),
            isUploaded ? null : round(cot, 2), round(flow, 1), round(shc, 4),
            hit.c2h4_yield_wt, hit.task_id])
        cacheHits++
      } else {
        const osrRes = await client.query(`
          INSERT INTO cs_py_int.optimization_sim_results
            (optimization_run_id, design_case_id, params,
             cot_input, flow_input, shc_input, status)
          VALUES ($1,$2,$3,$4,$5,$6,'pending')
          RETURNING id
        `, [runId, design_case_id, JSON.stringify(sampleParams),
            isUploaded ? null : round(cot, 2), round(flow, 1), round(shc, 4)])
        const osrId = osrRes.rows[0].id

        const cotCoilsim = isUploaded ? null : round(cot + designBias, 2)
        const taskRes = await client.query(`
          INSERT INTO cs_py_int.simulation_tasks
            (status, task_type, project_name, design_case_id, coil_id, feed_id,
             cot_input, flow_input, dilution_ratio, cit_input, cip_input, cop_input,
             severity_type, flux_profile, optimization_sim_result_id)
          VALUES ('Pending','optimization',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,2,4,$11)
          RETURNING id
        `, [dc.project_name, design_case_id, dc.coil_id, dc.feed_id,
            cotCoilsim, flow, shc, cit, cip, parseFloat(dc.cop_atm) || 2.053, osrId])

        await client.query(
          'UPDATE cs_py_int.optimization_sim_results SET task_id = $1 WHERE id = $2',
          [taskRes.rows[0].id, osrId]
        )
        newRuns++
      }
    }

    await client.query('COMMIT')
    return NextResponse.json({
      run_id:          runId,
      total_samples:   n_samples,
      cache_hits:      cacheHits,
      new_runs_queued: newRuns,
      cache_hit_pct:   n_samples > 0 ? parseFloat((cacheHits / n_samples * 100).toFixed(1)) : 0,
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}

function round(v: number, decimals: number) {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

// GET: list optimization runs for a design case
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const design_case_id = searchParams.get('design_case_id')
  if (!design_case_id) return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(`
      SELECT id, status, n_samples, n_sims_total, n_sims_complete, regression_type,
             objective, param_ranges, optimal_params, predicted_yield, current_yield,
             yield_improvement_pct, regression_metrics, regression_coefficients,
             sensitivity_json, created_at, completed_at
      FROM cs_py_int.optimization_runs
      WHERE design_case_id = $1
      ORDER BY id DESC
    `, [design_case_id])
    return NextResponse.json({ runs: res.rows })
  } finally {
    client.release()
  }
}
