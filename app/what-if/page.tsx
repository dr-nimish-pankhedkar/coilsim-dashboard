'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface DesignCase {
  id: number
  name: string
  uploaded_proj_id?: number | null
  source?: string | null
}

interface ParamRange { min: number; max: number; current: number }
interface ParamRanges { cot: ParamRange; flow: ParamRange; shc: ParamRange }

interface OptRun {
  id: number
  status: string
  n_samples: number
  param_ranges: ParamRanges
  regression_metrics: { r2: number; rmse: number; n: number } | null
  regression_coefficients: number[] | null
  optimal_params: { cot: number; flow: number; shc: number } | null
  predicted_yield: number | null
  current_yield: number | null
  yield_improvement_pct: number | null
  created_at: string
}

const PARAM_LABELS: Record<string, { label: string; unit: string; decimals: number }> = {
  cot:  { label: 'COT',     unit: '°C',   decimals: 1 },
  flow: { label: 'HC Flow', unit: 'kg/h', decimals: 0 },
  shc:  { label: 'SHC',     unit: '',     decimals: 3 },
}

// ── Surrogate math ────────────────────────────────────────────────────────────
function polyFeatures(x1: number, x2: number, x3: number): number[] {
  return [1, x1, x2, x3, x1*x1, x2*x2, x3*x3, x1*x2, x1*x3, x2*x3]
}
function dotProd(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0)
}
function normVal(v: number, lo: number, hi: number): number {
  return hi > lo ? (2 * (v - lo) / (hi - lo)) - 1 : 0
}
function surrogatePredict(beta: number[], pr: ParamRanges, cot: number, flow: number, shc: number): number {
  return dotProd(polyFeatures(
    normVal(cot,  pr.cot.min,  pr.cot.max),
    normVal(flow, pr.flow.min, pr.flow.max),
    normVal(shc,  pr.shc.min,  pr.shc.max),
  ), beta)
}

// ── Heatmap ───────────────────────────────────────────────────────────────────
function FlowShcHeatmap({ beta, pr, cotFixed, crosshair }: {
  beta: number[]
  pr: ParamRanges
  cotFixed: number
  crosshair: { flow: number; shc: number }
}) {
  const N = 50
  const W = 420, H = 220

  const cells = useMemo(() => {
    const yields: number[] = []
    let yMin = Infinity, yMax = -Infinity
    for (let fi = 0; fi < N; fi++) {
      for (let si = 0; si < N; si++) {
        const flow = pr.flow.min + (fi / (N - 1)) * (pr.flow.max - pr.flow.min)
        const shc  = pr.shc.min  + (si / (N - 1)) * (pr.shc.max  - pr.shc.min)
        const y = surrogatePredict(beta, pr, cotFixed, flow, shc)
        yields.push(y)
        if (y < yMin) yMin = y
        if (y > yMax) yMax = y
      }
    }
    const span = yMax - yMin || 1
    return { yields, yMin, yMax, span }
  }, [beta, pr, cotFixed])

  const cellW = W / N
  const cellH = H / N

  const heatColor = (t: number) => {
    const r = t < 0.5 ? Math.round(t * 2 * 20)   : Math.round(20  + (t - 0.5) * 2 * 235)
    const g = Math.round(60 + t * 185)
    const b = t < 0.5 ? Math.round(190 - t * 2 * 110) : Math.round(80 - (t - 0.5) * 2 * 80)
    return `rgb(${r},${g},${b})`
  }

  const chX = ((crosshair.flow - pr.flow.min) / (pr.flow.max - pr.flow.min || 1)) * W
  const chY = H - ((crosshair.shc - pr.shc.min) / (pr.shc.max - pr.shc.min || 1)) * H

  return (
    <div>
      <svg width={W} height={H} style={{ display: 'block', borderRadius: 8, overflow: 'hidden' }}>
        {cells.yields.map((y, i) => {
          const fi = Math.floor(i / N)
          const si = i % N
          const t = (y - cells.yMin) / cells.span
          return (
            <rect
              key={i}
              x={fi * cellW}
              y={H - (si + 1) * cellH}
              width={cellW + 0.5}
              height={cellH + 0.5}
              fill={heatColor(t)}
            />
          )
        })}
        <line x1={chX} y1={0} x2={chX} y2={H} stroke="white" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />
        <line x1={0} y1={chY} x2={W} y2={chY} stroke="white" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.9} />
        <circle cx={chX} cy={chY} r={6} fill="white" stroke="#1d4ed8" strokeWidth={2} />
        <text x={6} y={H - 5} fontSize={10} fill="white" opacity={0.85}>{pr.flow.min.toFixed(0)}</text>
        <text x={W - 6} y={H - 5} fontSize={10} fill="white" opacity={0.85} textAnchor="end">{pr.flow.max.toFixed(0)}</text>
        <text x={6} y={12} fontSize={10} fill="white" opacity={0.85}>SHC {pr.shc.max.toFixed(3)}</text>
        <text x={6} y={H - 16} fontSize={10} fill="white" opacity={0.85}>SHC {pr.shc.min.toFixed(3)}</text>
        <text x={W / 2} y={H - 5} fontSize={10} fill="white" opacity={0.85} textAnchor="middle">HC Flow (kg/h) →</text>
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1" style={{ maxWidth: W }}>
        <span>◼ Low yield</span>
        <span>◼ High yield</span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WhatIfPage() {
  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher)
  const designCases: DesignCase[] = Array.isArray(rawDcs) ? rawDcs : []

  const [selectedDcId, setSelectedDcId] = useState<number | null>(null)
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)

  const selectedDc = designCases.find(d => d.id === selectedDcId) ?? null
  const isUploaded = !!(selectedDc?.uploaded_proj_id || selectedDc?.source === 'uploaded_proj')

  // Fetch completed runs for this design case
  const { data: runsData } = useSWR<{ runs: OptRun[] }>(
    selectedDcId ? `/api/optimization?design_case_id=${selectedDcId}` : null,
    fetcher
  )
  const completedRuns = (runsData?.runs ?? []).filter(r => r.status === 'complete' && r.regression_coefficients)

  // Auto-select latest completed run
  useEffect(() => {
    if (completedRuns.length > 0 && selectedRunId == null) {
      setSelectedRunId(completedRuns[0].id)
    }
  }, [completedRuns.length, selectedRunId])

  // Reset run selection when design case changes
  useEffect(() => {
    setSelectedRunId(null)
  }, [selectedDcId])

  const run = completedRuns.find(r => r.id === selectedRunId) ?? null
  const beta = run?.regression_coefficients ?? null
  const pr   = run?.param_ranges ?? null

  // Slider state initialised from run's current operating point
  const [vals, setVals] = useState({ cot: 845, flow: 1300, shc: 0.35 })
  useEffect(() => {
    if (pr) setVals({ cot: pr.cot.current, flow: pr.flow.current, shc: pr.shc.current })
  }, [run?.id])

  const whatIfYield  = beta && pr ? surrogatePredict(beta, pr, vals.cot, vals.flow, vals.shc) : null
  const currentYield = run?.current_yield ?? (beta && pr ? surrogatePredict(beta, pr, pr.cot.current, pr.flow.current, pr.shc.current) : null)
  const delta = whatIfYield != null && currentYield != null ? whatIfYield - currentYield : null

  const sliderParams = (isUploaded ? ['flow', 'shc'] : ['cot', 'flow', 'shc']) as (keyof typeof vals)[]

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">What-If Explorer</h1>
          <p className="text-sm text-gray-500 mt-1">
            Select a design case and a fitted surrogate model, then drag sliders to explore how yield responds — no CoilSim runs needed.
          </p>
        </div>

        {/* Selectors */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Design case</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={selectedDcId ?? ''}
                onChange={e => setSelectedDcId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— select —</option>
                {designCases.map(dc => (
                  <option key={dc.id} value={dc.id}>{dc.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fitted model (optimization run)</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                value={selectedRunId ?? ''}
                onChange={e => setSelectedRunId(e.target.value ? Number(e.target.value) : null)}
                disabled={!selectedDcId || completedRuns.length === 0}
              >
                {completedRuns.length === 0
                  ? <option value="">— no fitted runs —</option>
                  : completedRuns.map(r => (
                    <option key={r.id} value={r.id}>
                      Run #{r.id} — {r.n_samples} samples, R²={r.regression_metrics?.r2.toFixed(3)} — {new Date(r.created_at).toLocaleDateString()}
                    </option>
                  ))
                }
              </select>
            </div>
          </div>

          {/* Model quality strip */}
          {run?.regression_metrics && (
            <div className="mt-4 flex flex-wrap gap-6 p-3 bg-gray-50 rounded-lg">
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">{run.regression_metrics.r2.toFixed(3)}</div>
                <div className="text-[10px] text-gray-400">R²</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">{run.regression_metrics.rmse.toFixed(4)}</div>
                <div className="text-[10px] text-gray-400">RMSE (wt%)</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">{run.regression_metrics.n}</div>
                <div className="text-[10px] text-gray-400">Data points</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-900">Poly-2</div>
                <div className="text-[10px] text-gray-400">Surrogate</div>
              </div>
              {run.predicted_yield != null && (
                <div className="text-center">
                  <div className="text-lg font-bold text-green-700">
                    {run.predicted_yield.toFixed(3)} wt%
                  </div>
                  <div className="text-[10px] text-gray-400">Peak yield (optimal)</div>
                </div>
              )}
              {run.yield_improvement_pct != null && (
                <div className="text-center">
                  <div className="text-lg font-bold text-green-600">+{run.yield_improvement_pct.toFixed(2)}%</div>
                  <div className="text-[10px] text-gray-400">vs current</div>
                </div>
              )}
            </div>
          )}

          {/* No fitted runs message */}
          {selectedDcId && completedRuns.length === 0 && runsData && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
              No fitted optimization runs found for this design case. Go to <a href="/optimization" className="underline font-medium">Optimization</a> to run and fit a model first.
            </div>
          )}
        </div>

        {/* Explorer */}
        {run && beta && pr && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

              {/* Sliders */}
              <div>
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Adjust operating conditions</h2>
                <div className="space-y-6">
                  {sliderParams.map(p => {
                    const info  = PARAM_LABELS[p]
                    const range = pr[p]
                    return (
                      <div key={p}>
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-sm font-medium text-gray-700">
                            {info.label}
                            {info.unit && <span className="text-gray-400 ml-1 text-xs">({info.unit})</span>}
                          </span>
                          <span className="text-base font-mono font-bold text-blue-700">
                            {vals[p].toFixed(info.decimals)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={range.min}
                          max={range.max}
                          step={p === 'shc' ? 0.001 : p === 'flow' ? 1 : 0.5}
                          value={vals[p]}
                          onChange={e => setVals(v => ({ ...v, [p]: parseFloat(e.target.value) }))}
                          className="w-full accent-blue-500"
                        />
                        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                          <span>{range.min.toFixed(info.decimals)}</span>
                          <span className="text-gray-300">current: {range.current.toFixed(info.decimals)}</span>
                          <span>{range.max.toFixed(info.decimals)}</span>
                        </div>
                      </div>
                    )
                  })}

                  <div className="flex gap-4 pt-1">
                    <button
                      onClick={() => setVals({ cot: pr.cot.current, flow: pr.flow.current, shc: pr.shc.current })}
                      className="text-xs text-gray-400 hover:text-gray-700 underline"
                    >
                      Reset to current
                    </button>
                    {run.optimal_params && (
                      <button
                        onClick={() => setVals({
                          cot:  run.optimal_params!.cot,
                          flow: run.optimal_params!.flow,
                          shc:  run.optimal_params!.shc,
                        })}
                        className="text-xs text-blue-500 hover:text-blue-700 underline"
                      >
                        Jump to optimal
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Yield readout */}
              <div className="flex flex-col items-center justify-center bg-gray-50 rounded-xl p-8 text-center h-full">
                <div className="text-[10px] text-gray-400 uppercase tracking-widest mb-3">Predicted C₂H₄ Yield</div>
                <div className="text-6xl font-bold text-gray-900 tabular-nums leading-none">
                  {whatIfYield?.toFixed(3)}
                </div>
                <div className="text-lg text-gray-400 mt-2">wt%</div>

                {delta != null && (
                  <>
                    <div className={`mt-5 text-xl font-bold ${delta > 0.0005 ? 'text-green-600' : delta < -0.0005 ? 'text-red-500' : 'text-gray-400'}`}>
                      {delta >= 0 ? '+' : ''}{delta.toFixed(3)} wt%
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      vs current ({currentYield?.toFixed(3)} wt%)
                    </div>
                    {Math.abs(delta) > 0.0005 && currentYield && currentYield > 0 && (
                      <div className={`text-sm font-semibold mt-2 ${delta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {delta > 0 ? '+' : ''}{((delta / currentYield) * 100).toFixed(2)}% relative
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Heatmap */}
            <div className="mt-7">
              <h3 className="text-xs font-semibold text-gray-600 mb-2">
                HC Flow × SHC yield surface
                {!isUploaded && <span className="text-gray-400 font-normal ml-1">(COT fixed at {vals.cot.toFixed(1)} °C)</span>}
                <span className="text-gray-400 font-normal ml-1">— white dot tracks slider position</span>
              </h3>
              <FlowShcHeatmap
                beta={beta}
                pr={pr}
                cotFixed={vals.cot}
                crosshair={{ flow: vals.flow, shc: vals.shc }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
