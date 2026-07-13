import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { run_id: string } }
) {
  const runId = parseInt(params.run_id)
  if (isNaN(runId)) return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 })

  const client = await pool.connect()
  try {
    const runRes = await client.query(
      `SELECT * FROM cs_py_int.optimization_runs WHERE id = $1`,
      [runId]
    )
    if (!runRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const run = runRes.rows[0]

    // Count truly completed sims (in case n_sims_complete counter drifted)
    const cntRes = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status='completed') AS done,
              COUNT(*) AS total
       FROM cs_py_int.optimization_sim_results WHERE optimization_run_id = $1`,
      [runId]
    )
    const done = parseInt(cntRes.rows[0].done)
    const total = parseInt(cntRes.rows[0].total)

    return NextResponse.json({ run: { ...run, n_sims_complete: done, n_sims_total: total } })
  } finally {
    client.release()
  }
}

// POST ?action=fit — run regression + optimization over completed sim data
export async function POST(
  _req: NextRequest,
  { params }: { params: { run_id: string } }
) {
  const runId = parseInt(params.run_id)
  if (isNaN(runId)) return NextResponse.json({ error: 'Invalid run_id' }, { status: 400 })

  const client = await pool.connect()
  try {
    // Fetch run config
    const runRes = await client.query(`SELECT * FROM cs_py_int.optimization_runs WHERE id = $1`, [runId])
    if (!runRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const run = runRes.rows[0]

    // Fetch all completed simulation results
    const simRes = await client.query(`
      SELECT params, c2h4_yield_wt
      FROM cs_py_int.optimization_sim_results
      WHERE optimization_run_id = $1 AND status = 'completed' AND c2h4_yield_wt IS NOT NULL
    `, [runId])

    if (simRes.rows.length < 10) {
      return NextResponse.json({ error: `Only ${simRes.rows.length} completed sims — need at least 10 to fit` }, { status: 422 })
    }

    await client.query(
      `UPDATE cs_py_int.optimization_runs SET status = 'fitting' WHERE id = $1`, [runId]
    )

    // Build dataset
    const pts = simRes.rows.map(r => ({
      cot: parseFloat(r.params.cot),
      flow: parseFloat(r.params.flow),
      shc: parseFloat(r.params.shc),
      y: parseFloat(r.c2h4_yield_wt),
    }))

    const pr = run.param_ranges as { cot: Range; flow: Range; shc: Range }
    const constraints = (run.constraint_json ?? run.param_ranges) as { cot: Range; flow: Range; shc: Range }

    // Normalise inputs to [-1,1] for numerical stability
    const norm = (v: number, lo: number, hi: number) => (2 * (v - lo) / (hi - lo)) - 1

    const Xraw = pts.map(p => makePolyFeatures(
      norm(p.cot,  pr.cot.min,  pr.cot.max),
      norm(p.flow, pr.flow.min, pr.flow.max),
      norm(p.shc,  pr.shc.min,  pr.shc.max),
    ))
    const y = pts.map(p => p.y)

    // Fit polynomial degree-2 via normal equations β = (XᵀX)⁻¹Xᵀy
    const beta = fitOLS(Xraw, y)
    if (!beta) {
      await client.query(`UPDATE cs_py_int.optimization_runs SET status='failed', error_message='Singular matrix — too few unique points' WHERE id=$1`, [runId])
      return NextResponse.json({ error: 'Regression failed — singular matrix' }, { status: 422 })
    }

    // Compute R²
    const yPred = Xraw.map(row => dot(row, beta))
    const yMean = mean(y)
    const ss_res = sum(y.map((yi, i) => (yi - yPred[i]) ** 2))
    const ss_tot = sum(y.map(yi => (yi - yMean) ** 2))
    const r2   = ss_tot > 0 ? 1 - ss_res / ss_tot : 0
    const rmse = Math.sqrt(ss_res / y.length)

    // Grid search optimisation (25×25×25 = 15625 points)
    const GRID = 25
    let bestY = -Infinity
    let bestParams = { cot: pr.cot.current, flow: pr.flow.current, shc: pr.shc.current }

    for (let ic = 0; ic < GRID; ic++) {
      for (let if_ = 0; if_ < GRID; if_++) {
        for (let is = 0; is < GRID; is++) {
          const cot  = constraints.cot.min  + (ic / (GRID - 1)) * (constraints.cot.max  - constraints.cot.min)
          const flow = constraints.flow.min + (if_ / (GRID - 1)) * (constraints.flow.max - constraints.flow.min)
          const shc  = constraints.shc.min  + (is / (GRID - 1)) * (constraints.shc.max  - constraints.shc.min)
          const feat = makePolyFeatures(norm(cot, pr.cot.min, pr.cot.max), norm(flow, pr.flow.min, pr.flow.max), norm(shc, pr.shc.min, pr.shc.max))
          const pred = dot(feat, beta)
          if (pred > bestY) { bestY = pred; bestParams = { cot, flow, shc } }
        }
      }
    }

    // Current operating yield estimate
    const currentFeat = makePolyFeatures(norm(pr.cot.current, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
    const currentYield = dot(currentFeat, beta)

    const improvement = currentYield > 0 ? ((bestY - currentYield) / currentYield) * 100 : null

    // Build sensitivity curves (±range, other params at current)
    const SENS_PTS = 40
    const sensitivity = {
      cot:  Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.cot.min  + (i / (SENS_PTS - 1)) * (pr.cot.max  - pr.cot.min)
        const f = makePolyFeatures(norm(v, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
        return { x: round(v, 1), y: round(dot(f, beta), 4) }
      }),
      flow: Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.flow.min + (i / (SENS_PTS - 1)) * (pr.flow.max - pr.flow.min)
        const f = makePolyFeatures(norm(pr.cot.current, pr.cot.min, pr.cot.max), norm(v, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
        return { x: round(v, 0), y: round(dot(f, beta), 4) }
      }),
      shc:  Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.shc.min  + (i / (SENS_PTS - 1)) * (pr.shc.max  - pr.shc.min)
        const f = makePolyFeatures(norm(pr.cot.current, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(v, pr.shc.min, pr.shc.max))
        return { x: round(v, 3), y: round(dot(f, beta), 4) }
      }),
    }

    // Persist results
    await client.query(`
      UPDATE cs_py_int.optimization_runs SET
        status = 'complete',
        regression_metrics = $1,
        regression_coefficients = $2,
        optimal_params = $3,
        predicted_yield = $4,
        current_yield = $5,
        yield_improvement_pct = $6,
        sensitivity_json = $7,
        completed_at = NOW()
      WHERE id = $8
    `, [
      JSON.stringify({ r2: round(r2, 4), rmse: round(rmse, 4), n: pts.length }),
      JSON.stringify(beta),
      JSON.stringify({ cot: round(bestParams.cot, 1), flow: round(bestParams.flow, 0), shc: round(bestParams.shc, 4) }),
      round(bestY, 4),
      round(currentYield, 4),
      improvement != null ? round(improvement, 2) : null,
      JSON.stringify(sensitivity),
      runId,
    ])

    return NextResponse.json({
      r2: round(r2, 4), rmse: round(rmse, 4), n_points: pts.length,
      optimal_params: bestParams, predicted_yield: round(bestY, 4),
      current_yield: round(currentYield, 4),
      yield_improvement_pct: improvement != null ? round(improvement, 2) : null,
    })
  } catch (err: any) {
    await client.query(
      `UPDATE cs_py_int.optimization_runs SET status='failed', error_message=$1 WHERE id=$2`,
      [String(err?.message).slice(0, 300), runId]
    ).catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'Fit failed' }, { status: 500 })
  } finally {
    client.release()
  }
}

// ── Linear algebra helpers ───────────────────────────────────────────────────

type Range = { min: number; max: number; current: number }

// Polynomial degree-2 feature vector for 3 variables: 10 terms
// [1, x1, x2, x3, x1², x2², x3², x1x2, x1x3, x2x3]
function makePolyFeatures(x1: number, x2: number, x3: number): number[] {
  return [1, x1, x2, x3, x1*x1, x2*x2, x3*x3, x1*x2, x1*x3, x2*x3]
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0)
}

function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length, n = B[0].length, k = B.length
  return Array.from({ length: m }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      Array.from({ length: k }, (_, l) => A[i][l] * B[l][j]).reduce((s, v) => s + v, 0)
    )
  )
}

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map(row => row[j]))
}

// Solve Ax = b via Gauss-Jordan elimination; returns null if singular
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = A.length
  const aug = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r
    }
    [aug[col], aug[pivot]] = [aug[pivot], aug[col]]
    if (Math.abs(aug[col][col]) < 1e-12) return null
    const scale = aug[col][col]
    aug[col] = aug[col].map(v => v / scale)
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = aug[r][col]
      aug[r] = aug[r].map((v, j) => v - f * aug[col][j])
    }
  }
  return aug.map(row => row[n])
}

function fitOLS(X: number[][], y: number[]): number[] | null {
  const Xt = transpose(X)
  const XtX = matMul(Xt, X)
  const Xty = Xt.map(row => dot(row, y))
  return solveLinear(XtX, Xty)
}

function mean(arr: number[]) { return arr.reduce((s, v) => s + v, 0) / arr.length }
function sum(arr: number[]) { return arr.reduce((s, v) => s + v, 0) }
function round(v: number, d: number) { const f = 10**d; return Math.round(v*f)/f }
