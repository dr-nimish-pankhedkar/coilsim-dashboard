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
    const norm = (v: number, lo: number, hi: number) => hi > lo ? (2 * (v - lo) / (hi - lo)) - 1 : 0

    // For uploaded models COT is fixed — use 2D poly (flow+SHC only, 6 terms)
    // to avoid a singular XᵀX. Beta is then padded to 10 terms (zeros for COT
    // positions) so the frontend 10-term evaluator still works correctly.
    const cotValues = pts.map(p => p.cot)
    const cotIsFixed = cotValues.every(v => Math.abs(v - cotValues[0]) < 0.01) || !isFinite(cotValues[0])
    const fixedCot = cotIsFixed ? (isFinite(cotValues[0]) ? cotValues[0] : pr.cot.current) : 0

    let beta10: number[]

    if (cotIsFixed) {
      // 2D fit: features = [1, x_flow, x_shc, x_flow², x_shc², x_flow*x_shc]
      const Xraw2d = pts.map(p => makePolyFeatures2D(
        norm(p.flow, pr.flow.min, pr.flow.max),
        norm(p.shc,  pr.shc.min,  pr.shc.max),
      ))
      const y = pts.map(p => p.y)
      const beta2d = fitOLS(Xraw2d, y)
      if (!beta2d) {
        await client.query(`UPDATE cs_py_int.optimization_runs SET status='failed', error_message='Singular matrix — too few unique points' WHERE id=$1`, [runId])
        return NextResponse.json({ error: 'Regression failed — singular matrix' }, { status: 422 })
      }
      // Expand to 10 terms: [b0, 0(cot), b1(flow), b2(shc), 0(cot²), b3(flow²), b4(shc²), 0(cot·flow), 0(cot·shc), b5(flow·shc)]
      beta10 = [beta2d[0], 0, beta2d[1], beta2d[2], 0, beta2d[3], beta2d[4], 0, 0, beta2d[5]]
    } else {
      const Xraw = pts.map(p => makePolyFeatures(
        norm(p.cot,  pr.cot.min,  pr.cot.max),
        norm(p.flow, pr.flow.min, pr.flow.max),
        norm(p.shc,  pr.shc.min,  pr.shc.max),
      ))
      const y = pts.map(p => p.y)
      const b = fitOLS(Xraw, y)
      if (!b) {
        await client.query(`UPDATE cs_py_int.optimization_runs SET status='failed', error_message='Singular matrix — too few unique points' WHERE id=$1`, [runId])
        return NextResponse.json({ error: 'Regression failed — singular matrix' }, { status: 422 })
      }
      beta10 = b
    }

    const beta = beta10
    const Xall = pts.map(p => makePolyFeatures(
      norm(cotIsFixed ? fixedCot : p.cot, pr.cot.min, pr.cot.max),
      norm(p.flow, pr.flow.min, pr.flow.max),
      norm(p.shc,  pr.shc.min,  pr.shc.max),
    ))
    const y = pts.map(p => p.y)

    // Compute R²
    const yPred = Xall.map(row => dot(row, beta))
    const yMean = mean(y)
    const ss_res = sum(y.map((yi, i) => (yi - yPred[i]) ** 2))
    const ss_tot = sum(y.map(yi => (yi - yMean) ** 2))
    const r2   = ss_tot > 0 ? 1 - ss_res / ss_tot : 0
    const rmse = Math.sqrt(ss_res / y.length)

    // Grid search optimisation
    const GRID = 25
    let bestY = -Infinity
    let bestParams = { cot: fixedCot, flow: pr.flow.current, shc: pr.shc.current }
    const cotGridMin = cotIsFixed ? fixedCot : constraints.cot.min
    const cotGridMax = cotIsFixed ? fixedCot : constraints.cot.max

    for (let ic = 0; ic < GRID; ic++) {
      for (let if_ = 0; if_ < GRID; if_++) {
        for (let is = 0; is < GRID; is++) {
          const cot  = cotGridMin + (ic / (GRID - 1)) * (cotGridMax - cotGridMin)
          const flow = constraints.flow.min + (if_ / (GRID - 1)) * (constraints.flow.max - constraints.flow.min)
          const shc  = constraints.shc.min  + (is / (GRID - 1)) * (constraints.shc.max  - constraints.shc.min)
          const feat = makePolyFeatures(norm(cot, pr.cot.min, pr.cot.max), norm(flow, pr.flow.min, pr.flow.max), norm(shc, pr.shc.min, pr.shc.max))
          const pred = dot(feat, beta)
          if (isFinite(pred) && pred > bestY) { bestY = pred; bestParams = { cot, flow, shc } }
        }
      }
    }

    if (!isFinite(bestY)) {
      await client.query(`UPDATE cs_py_int.optimization_runs SET status='failed', error_message='Optimization produced no finite result' WHERE id=$1`, [runId])
      return NextResponse.json({ error: 'Optimization produced no finite result' }, { status: 422 })
    }

    // Current operating yield estimate
    const currentFeat = makePolyFeatures(norm(cotIsFixed ? fixedCot : pr.cot.current, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
    const currentYield = dot(currentFeat, beta)

    const improvement = currentYield > 0 ? ((bestY - currentYield) / currentYield) * 100 : null

    // Build sensitivity curves (±range, other params at current)
    const SENS_PTS = 40
    const sensitivity: Record<string, { x: number; y: number }[]> = {
      flow: Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.flow.min + (i / (SENS_PTS - 1)) * (pr.flow.max - pr.flow.min)
        const f = makePolyFeatures(norm(cotIsFixed ? fixedCot : pr.cot.current, pr.cot.min, pr.cot.max), norm(v, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
        return { x: round(v, 0), y: round(dot(f, beta), 4) }
      }),
      shc:  Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.shc.min  + (i / (SENS_PTS - 1)) * (pr.shc.max  - pr.shc.min)
        const f = makePolyFeatures(norm(cotIsFixed ? fixedCot : pr.cot.current, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(v, pr.shc.min, pr.shc.max))
        return { x: round(v, 3), y: round(dot(f, beta), 4) }
      }),
    }
    if (!cotIsFixed) {
      sensitivity.cot = Array.from({ length: SENS_PTS }, (_, i) => {
        const v = pr.cot.min  + (i / (SENS_PTS - 1)) * (pr.cot.max  - pr.cot.min)
        const f = makePolyFeatures(norm(v, pr.cot.min, pr.cot.max), norm(pr.flow.current, pr.flow.min, pr.flow.max), norm(pr.shc.current, pr.shc.min, pr.shc.max))
        return { x: round(v, 1), y: round(dot(f, beta), 4) }
      })
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

// 2D polynomial (flow + SHC only): 6 terms [1, x1, x2, x1², x2², x1x2]
function makePolyFeatures2D(x1: number, x2: number): number[] {
  return [1, x1, x2, x1*x1, x2*x2, x1*x2]
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
