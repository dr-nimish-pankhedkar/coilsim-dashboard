'use client'

import { useState, useCallback, useEffect } from 'react'
import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface DesignCase { id: number; name: string; project_name: string; coil_id: number; feed_id: number }

interface ParamRange { min: number; max: number; current: number }
interface ParamRanges { cot: ParamRange; flow: ParamRange; shc: ParamRange }

interface OptRun {
  id: number
  status: 'pending' | 'running_sims' | 'fitting' | 'complete' | 'failed'
  n_samples: number
  n_sims_total: number
  n_sims_complete: number
  regression_type: string
  regression_metrics: { r2: number; rmse: number; n: number } | null
  optimal_params: { cot: number; flow: number; shc: number } | null
  predicted_yield: number | null
  current_yield: number | null
  yield_improvement_pct: number | null
  sensitivity_json: Record<string, { x: number; y: number }[]> | null
  param_ranges: ParamRanges
  created_at: string
}

interface DcsStats {
  cot_mean: number; cot_std: number; cot_min: number; cot_max: number
  flow_mean: number; flow_std: number; flow_min: number; flow_max: number
  shc_mean: number; shc_std: number; shc_min: number; shc_max: number
}

const PARAM_LABELS: Record<string, { label: string; unit: string; decimals: number }> = {
  cot:  { label: 'COT',      unit: '°C',   decimals: 1 },
  flow: { label: 'HC Flow',  unit: 'kg/h', decimals: 0 },
  shc:  { label: 'SHC',      unit: '',     decimals: 3 },
}

// Tiny SVG line chart
function TinyChart({ data, color = '#3b82f6', label, unit }: { data: { x: number; y: number }[]; color?: string; label: string; unit: string }) {
  if (!data || data.length < 2) return null
  const xs = data.map(d => d.x)
  const ys = data.map(d => d.y)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const W = 240, H = 100, PAD = 4
  const px = (x: number) => PAD + ((x - xMin) / (xMax - xMin || 1)) * (W - 2 * PAD)
  const py = (y: number) => (H - PAD) - ((y - yMin) / (yMax - yMin || 1)) * (H - 2 * PAD)
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(d.x).toFixed(1)},${py(d.y).toFixed(1)}`).join(' ')
  const optX = xs[ys.indexOf(Math.max(...ys))]
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label} sensitivity</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="border border-gray-100 rounded">
        <path d={path} fill="none" stroke={color} strokeWidth="2" />
        <line x1={px(optX)} y1={PAD} x2={px(optX)} y2={H - PAD} stroke="#f59e0b" strokeWidth="1" strokeDasharray="3,2" />
        <text x={PAD} y={H - 1} fontSize="9" fill="#6b7280">{xMin.toFixed(1)}</text>
        <text x={W - PAD} y={H - 1} fontSize="9" fill="#6b7280" textAnchor="end">{xMax.toFixed(1)}</text>
        <text x={W / 2} y={H - 1} fontSize="8" fill="#6b7280" textAnchor="middle">{unit}</text>
      </svg>
      <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
        <span>min {Math.min(...ys).toFixed(3)} wt%</span>
        <span>max {Math.max(...ys).toFixed(3)} wt%</span>
      </div>
    </div>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{done} / {total} simulations</span>
        <span>{pct}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div className="bg-blue-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function OptimizationPage() {
  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 60_000 })
  const designCases: DesignCase[] = Array.isArray(rawDcs) ? rawDcs : []

  const [selectedDcId, setSelectedDcId] = useState<number | null>(null)
  const [nSamples, setNSamples] = useState(100)
  const [regressionType] = useState('poly2')
  const [ranges, setRanges] = useState<ParamRanges>({
    cot:  { min: 820, max: 870, current: 845 },
    flow: { min: 1100, max: 1500, current: 1300 },
    shc:  { min: 0.28, max: 0.45, current: 0.35 },
  })
  const [activeRunId, setActiveRunId] = useState<number | null>(null)
  const [launching, setLaunching] = useState(false)
  const [fitting, setFitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch past optimization runs for selected design case
  const runsKey = selectedDcId ? `/api/optimization?design_case_id=${selectedDcId}` : null
  const { data: runsData, mutate: mutateRuns } = useSWR<{ runs: OptRun[] }>(runsKey, fetcher, { refreshInterval: 5_000 })
  const runs = runsData?.runs ?? []

  // Poll active run
  const activeRunKey = activeRunId ? `/api/optimization/${activeRunId}` : null
  const { data: activeRunData, mutate: mutateActive } = useSWR<{ run: OptRun }>(
    activeRunKey, fetcher,
    { refreshInterval: activeRunId ? 4_000 : 0 }
  )
  const activeRun = activeRunData?.run ?? null

  // When an existing run is complete, stop polling
  useEffect(() => {
    if (activeRun?.status === 'complete' || activeRun?.status === 'failed') {
      mutateRuns()
    }
  }, [activeRun?.status, mutateRuns])

  // Fetch DCS stats for the selected design case to auto-fill ranges
  const { data: dcsStats } = useSWR<DcsStats>(
    selectedDcId ? `/api/optimization/dcs-stats?design_case_id=${selectedDcId}` : null,
    fetcher
  )

  useEffect(() => {
    if (!dcsStats) return
    setRanges({
      cot:  { min: round(dcsStats.cot_mean  - 2 * dcsStats.cot_std,  1), max: round(dcsStats.cot_mean  + 2 * dcsStats.cot_std,  1), current: round(dcsStats.cot_mean,  1) },
      flow: { min: round(dcsStats.flow_mean - 2 * dcsStats.flow_std, 0), max: round(dcsStats.flow_mean + 2 * dcsStats.flow_std, 0), current: round(dcsStats.flow_mean, 0) },
      shc:  { min: round(dcsStats.shc_mean  - 2 * dcsStats.shc_std,  3), max: round(dcsStats.shc_mean  + 2 * dcsStats.shc_std,  3), current: round(dcsStats.shc_mean,  3) },
    })
  }, [dcsStats])

  const setParam = useCallback((param: keyof ParamRanges, field: keyof ParamRange, val: string) => {
    const n = parseFloat(val)
    if (isNaN(n)) return
    setRanges(prev => ({ ...prev, [param]: { ...prev[param], [field]: n } }))
  }, [])

  async function launch() {
    if (!selectedDcId) return
    setLaunching(true); setError(null)
    try {
      const res = await fetch('/api/optimization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design_case_id: selectedDcId,
          param_ranges: ranges,
          n_samples: nSamples,
          regression_type: regressionType,
          objective: 'c2h4_yield_wt',
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setActiveRunId(data.run_id)
      mutateRuns()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLaunching(false)
    }
  }

  async function fitAndOptimize() {
    if (!activeRunId) return
    setFitting(true); setError(null)
    try {
      const res = await fetch(`/api/optimization/${activeRunId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      mutateActive()
      mutateRuns()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setFitting(false)
    }
  }

  const displayRun = activeRun ?? (runs.length > 0 ? runs[0] : null)
  const simsRunning = displayRun?.status === 'running_sims'
  const simsComplete = displayRun && displayRun.n_sims_complete >= displayRun.n_sims_total && displayRun.n_sims_total > 0
  const isComplete = displayRun?.status === 'complete'

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Yield Optimization</h1>
          <p className="text-sm text-gray-500 mt-1">
            Generate synthetic CoilSim data around the current operating point, fit a polynomial surrogate, and find the parameter combination that maximises C₂H₄ yield.
          </p>
        </div>

        {/* How it works */}
        <HowItWorks />

        {/* Setup card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Setup</h2>

          {/* Design case selector */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-600 mb-1">Operating design case</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={selectedDcId ?? ''}
              onChange={e => { setSelectedDcId(e.target.value ? Number(e.target.value) : null); setActiveRunId(null) }}
            >
              <option value="">— select —</option>
              {designCases.map(dc => (
                <option key={dc.id} value={dc.id}>{dc.name}</option>
              ))}
            </select>
          </div>

          {/* Parameter ranges */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">Parameter ranges</span>
              {dcsStats && <span className="text-[10px] text-blue-500">Auto-filled from last 30 days DCS ±2σ</span>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left py-1 pr-3">Parameter</th>
                    <th className="text-left py-1 pr-3">Min</th>
                    <th className="text-left py-1 pr-3">Current</th>
                    <th className="text-left py-1">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(ranges) as (keyof ParamRanges)[]).map(p => (
                    <tr key={p} className="border-t border-gray-50">
                      <td className="py-1.5 pr-3 font-medium text-gray-700">
                        {PARAM_LABELS[p].label}
                        {PARAM_LABELS[p].unit && <span className="text-gray-400 ml-1">({PARAM_LABELS[p].unit})</span>}
                      </td>
                      {(['min', 'current', 'max'] as const).map(f => (
                        <td key={f} className="py-1.5 pr-3">
                          <input
                            type="number"
                            className="w-24 border border-gray-200 rounded px-2 py-1 text-xs"
                            value={ranges[p][f]}
                            step={p === 'shc' ? 0.01 : p === 'flow' ? 10 : 1}
                            onChange={e => setParam(p, f, e.target.value)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sample count */}
          <div className="flex items-center gap-6 mb-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Samples (LHS)</label>
              <input
                type="number" min={20} max={500} step={10}
                className="w-24 border border-gray-200 rounded px-3 py-1.5 text-sm"
                value={nSamples}
                onChange={e => setNSamples(Math.max(20, Math.min(500, parseInt(e.target.value) || 100)))}
              />
            </div>
            <div className="text-xs text-gray-400 pt-4">
              Latin Hypercube Sampling — uniform space coverage with {nSamples} CoilSim runs<br />
              Approx. {Math.ceil(nSamples * 3 / 60)} – {Math.ceil(nSamples * 5 / 60)} min compute time
            </div>
          </div>

          {error && <div className="text-red-500 text-xs mb-3 bg-red-50 border border-red-100 rounded p-2">{error}</div>}

          <button
            disabled={!selectedDcId || launching || simsRunning}
            onClick={launch}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {launching ? 'Launching…' : simsRunning ? 'Running…' : 'Run optimization'}
          </button>
        </div>

        {/* Progress + results */}
        {displayRun && (
          <div className="space-y-4">

            {/* Progress */}
            {(displayRun.status === 'running_sims' || displayRun.status === 'fitting') && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">
                  {displayRun.status === 'running_sims' ? 'Generating synthetic data' : 'Fitting regression…'}
                </h2>
                <ProgressBar done={displayRun.n_sims_complete} total={displayRun.n_sims_total} />
                {simsComplete && displayRun.status === 'running_sims' && (
                  <div className="mt-4">
                    <p className="text-xs text-gray-500 mb-2">All simulations complete. Click to fit the polynomial surrogate and run optimisation.</p>
                    <button
                      disabled={fitting}
                      onClick={fitAndOptimize}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40"
                    >
                      {fitting ? 'Fitting…' : 'Fit & Optimise'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Failed */}
            {displayRun.status === 'failed' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                Optimization run failed. Run a new one with adjusted settings.
              </div>
            )}

            {/* Results */}
            {isComplete && displayRun.regression_metrics && displayRun.optimal_params && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-4">Results</h2>

                {/* Model quality */}
                <div className="flex gap-6 mb-5 p-3 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{displayRun.regression_metrics.r2.toFixed(3)}</div>
                    <div className="text-[10px] text-gray-400">R² (fit quality)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{displayRun.regression_metrics.rmse.toFixed(4)}</div>
                    <div className="text-[10px] text-gray-400">RMSE (wt%)</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{displayRun.regression_metrics.n}</div>
                    <div className="text-[10px] text-gray-400">Data points</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">Poly-2</div>
                    <div className="text-[10px] text-gray-400">Surrogate model</div>
                  </div>
                </div>

                {/* Optimal params vs current */}
                <div className="mb-5">
                  <h3 className="text-xs font-semibold text-gray-600 mb-2">Optimal operating point</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-400 border-b border-gray-100">
                          <th className="text-left py-1.5 pr-4">Parameter</th>
                          <th className="text-right py-1.5 pr-4">Current</th>
                          <th className="text-right py-1.5 pr-4">Optimal</th>
                          <th className="text-right py-1.5">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Object.keys(displayRun.optimal_params) as (keyof typeof displayRun.optimal_params)[]).map(p => {
                          const info = PARAM_LABELS[p]
                          const curr = displayRun.param_ranges[p]?.current
                          const opt  = displayRun.optimal_params![p]
                          const delta = curr != null ? opt - curr : null
                          return (
                            <tr key={p} className="border-b border-gray-50">
                              <td className="py-2 pr-4 font-medium text-gray-700">{info?.label} {info?.unit && <span className="text-gray-400 text-xs">({info.unit})</span>}</td>
                              <td className="py-2 pr-4 text-right text-gray-500">{curr?.toFixed(info?.decimals ?? 1)}</td>
                              <td className="py-2 pr-4 text-right font-semibold text-blue-700">{opt.toFixed(info?.decimals ?? 1)}</td>
                              <td className={`py-2 text-right text-xs ${delta != null && delta > 0 ? 'text-green-600' : delta != null && delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                {delta != null ? (delta > 0 ? '+' : '') + delta.toFixed(info?.decimals ?? 1) : '—'}
                              </td>
                            </tr>
                          )
                        })}
                        <tr className="border-t-2 border-gray-200">
                          <td className="py-2 pr-4 font-medium text-gray-700">C₂H₄ yield <span className="text-gray-400 text-xs">(wt%)</span></td>
                          <td className="py-2 pr-4 text-right text-gray-500">{displayRun.current_yield?.toFixed(3)}</td>
                          <td className="py-2 pr-4 text-right font-bold text-green-700">{displayRun.predicted_yield?.toFixed(3)}</td>
                          <td className="py-2 text-right text-xs text-green-600">
                            {displayRun.yield_improvement_pct != null ? `+${displayRun.yield_improvement_pct.toFixed(2)}%` : '—'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sensitivity charts */}
                {displayRun.sensitivity_json && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-600 mb-3">Parameter sensitivity (C₂H₄ yield, others at current)</h3>
                    <div className="flex flex-wrap gap-6">
                      {(Object.keys(displayRun.sensitivity_json) as string[]).map((p, i) => (
                        <TinyChart
                          key={p}
                          data={displayRun.sensitivity_json![p]}
                          color={['#3b82f6', '#10b981', '#f59e0b'][i % 3]}
                          label={PARAM_LABELS[p]?.label ?? p}
                          unit={PARAM_LABELS[p]?.unit ?? ''}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Run history */}
            {runs.length > 1 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Run history</h2>
                <div className="space-y-2">
                  {runs.map(r => (
                    <div
                      key={r.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${activeRunId === r.id || (activeRunId == null && r.id === runs[0].id) ? 'border-blue-200 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}
                      onClick={() => setActiveRunId(r.id)}
                    >
                      <StatusDot status={r.status} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-700">
                          Run #{r.id} — {r.n_samples} samples, {r.regression_type}
                        </div>
                        <div className="text-[10px] text-gray-400">{new Date(r.created_at).toLocaleString()}</div>
                      </div>
                      {r.status === 'complete' && r.yield_improvement_pct != null && (
                        <span className="text-xs font-semibold text-green-600">+{r.yield_improvement_pct.toFixed(2)}%</span>
                      )}
                      {r.status === 'running_sims' && (
                        <span className="text-xs text-blue-500">{r.n_sims_complete}/{r.n_sims_total}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function HowItWorks() {
  const [open, setOpen] = useState(false)
  const steps = [
    {
      n: '1',
      title: 'Define parameter ranges',
      color: 'bg-blue-100 text-blue-700',
      body: 'Set the min / max / current value for COT, HC flow, and SHC ratio. Ranges are auto-filled from the last 30 days of DCS data (±2σ) so they reflect realistic operating variation. Tighten or widen them as needed.',
    },
    {
      n: '2',
      title: 'Latin Hypercube Sampling',
      color: 'bg-purple-100 text-purple-700',
      body: 'N sample points are drawn using Latin Hypercube Sampling — a stratified random design that fills the parameter space evenly. Each point is a unique (COT, flow, SHC) combination. More samples → better surrogate accuracy but longer compute time.',
    },
    {
      n: '3',
      title: 'CoilSim simulation batch',
      color: 'bg-amber-100 text-amber-700',
      body: 'Each sample point is queued as a CoilSim simulation task. The worker picks them up sequentially, patches exp.txt with the sampled conditions (design COT bias already applied), runs the CoilSim engine, and scrapes the C₂H₄ yield from yields.csv.',
    },
    {
      n: '4',
      title: 'Polynomial surrogate fit',
      color: 'bg-green-100 text-green-700',
      body: 'Once all simulations complete, a degree-2 polynomial (quadratic) is fitted to the (COT, flow, SHC) → C₂H₄ yield data using ordinary least squares. The 10-term model captures linear effects, squared terms, and two-way interactions. R² and RMSE confirm fit quality.',
    },
    {
      n: '5',
      title: 'Grid-search optimisation',
      color: 'bg-rose-100 text-rose-700',
      body: 'A 25×25×25 grid (≈15k points) is evaluated over the constrained parameter space using the fitted surrogate. The combination with the highest predicted C₂H₄ yield is reported as the optimal operating point, along with the estimated yield improvement vs current.',
    },
    {
      n: '6',
      title: 'Sensitivity analysis',
      color: 'bg-teal-100 text-teal-700',
      body: 'Each parameter is swept independently (others held at current value) through the surrogate to produce sensitivity curves. These show how yield responds to each handle individually — useful for understanding which parameter has the most leverage.',
    },
  ]

  return (
    <div className="mb-5 border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          How it works
        </span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {steps.map(s => (
              <div key={s.n} className="flex gap-3">
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${s.color}`}>
                  {s.n}
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-800 mb-1">{s.title}</div>
                  <div className="text-xs text-gray-500 leading-relaxed">{s.body}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
            <strong>Tip:</strong> Start with 50–100 samples for a quick exploration. If R² is below 0.90, increase samples or tighten the parameter ranges so the surrogate has less variance to capture.
          </div>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: OptRun['status'] }) {
  const cls = {
    pending:      'bg-gray-300',
    running_sims: 'bg-blue-400 animate-pulse',
    fitting:      'bg-purple-400 animate-pulse',
    complete:     'bg-green-400',
    failed:       'bg-red-400',
  }[status]
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${cls}`} />
}

function round(v: number, d: number) { const f = 10**d; return Math.round(v*f)/f }
