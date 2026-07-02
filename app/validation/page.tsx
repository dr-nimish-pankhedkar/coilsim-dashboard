'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import type { DesignCase, ValidationStatusResponse, ValidationBiasReport } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Phase = 'setup' | 'running' | 'results' | 'promoted'

interface PreflightCheck { name: string; ok: boolean; detail: string }
interface PreflightResult { design_case_id: number; name: string; all_ok: boolean; checks: PreflightCheck[] }

interface SetupForm {
  design_case_id: string
  start_date: string
  end_date: string
  mb_filter_pct: '1' | '2'
  sample_interval_hrs: '1' | '4' | '8' | '12'
}

interface StartResult {
  queued_count: number
  filtered_count: number
  filter_breakdown: {
    total_scanned: number
    cot_low: number
    mass_balance: number
    composition_stale: number
    queued: number
  }
}

interface PromoteResult {
  name: string
  cot_bias: number
  next_review: string
}

// ── helpers ──────────────────────────────────────────────────────────────────
function pct(n: number | null): string {
  if (n == null) return '—'
  const s = n >= 0 ? '+' : ''
  return `${s}${n.toFixed(2)}%`
}

function errCls(v: number | null, warn = 2, bad = 5) {
  if (v == null) return 'text-gray-400'
  const a = Math.abs(v)
  if (a <= warn) return 'text-emerald-700 font-semibold'
  if (a <= bad)  return 'text-amber-700 font-semibold'
  return 'text-red-700 font-semibold'
}

const inp   = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white'
const lbl   = 'block text-xs font-medium text-gray-600 mb-1'
const radio = (active: boolean) =>
  `px-4 py-1.5 rounded-md text-sm font-medium border transition-colors cursor-pointer ${
    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
  }`

// ── Section wrappers ──────────────────────────────────────────────────────────
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card space-y-5">
      <div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {children}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ValidationPage() {
  const today = new Date().toISOString().slice(0, 10)
  const d90 = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)

  const [form, setForm] = useState<SetupForm>({
    design_case_id:      '',
    start_date:          d90,
    end_date:            today,
    mb_filter_pct:       '2',
    sample_interval_hrs: '1',
  })
  const [phase,       setPhase]       = useState<Phase>('setup')
  const [activeDcId,  setActiveDcId]  = useState<number | null>(null)
  const [startResult, setStartResult] = useState<StartResult | null>(null)
  const [pollData,    setPollData]    = useState<ValidationStatusResponse | null>(null)
  const [biasReport,  setBiasReport]  = useState<ValidationBiasReport | null>(null)
  const [promoted,    setPromoted]    = useState<PromoteResult | null>(null)
  const [busyStart,   setBusyStart]   = useState(false)
  const [busyBias,    setBusyBias]    = useState(false)
  const [busyPromote, setBusyPromote] = useState(false)
  const [errMsg,      setErrMsg]      = useState('')

  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 60_000 })
  const designCases: DesignCase[] = Array.isArray(rawDcs) ? rawDcs : []

  const preflightKey = form.design_case_id && phase === 'setup'
    ? `/api/validation/preflight/${form.design_case_id}` : null
  const { data: preflight } = useSWR<PreflightResult>(preflightKey, fetcher, { refreshInterval: 30_000 })

  // Poll validation status while running
  const pollStatus = useCallback(async () => {
    if (!activeDcId) return
    const res = await fetch(`/api/validation/status/${activeDcId}`)
    if (!res.ok) return
    const data: ValidationStatusResponse = await res.json()
    setPollData(data)
    if (data.status === 'complete' || data.status === 'requires_review') {
      setPhase('results')
    }
  }, [activeDcId])

  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(pollStatus, 10_000)
    pollStatus()
    return () => clearInterval(id)
  }, [phase, pollStatus])

  const selectedDc = designCases.find(d => d.id === Number(form.design_case_id)) ?? null

  // ── handlers ────────────────────────────────────────────────────────────────
  async function handleStart() {
    if (!form.design_case_id) { setErrMsg('Select a design case.'); return }
    setBusyStart(true); setErrMsg('')
    try {
      const res = await fetch('/api/validation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          design_case_id:      Number(form.design_case_id),
          start_date:          form.start_date,
          end_date:            form.end_date,
          mb_filter_pct:       Number(form.mb_filter_pct),
          sample_interval_hrs: Number(form.sample_interval_hrs),
        }),
      })
      const json = await res.json()
      if (!res.ok) { setErrMsg(json.error ?? 'Start failed'); return }
      if (json.queued_count === 0) {
        setErrMsg('No DCS data found in date range. Run the DCS simulator for historical data first.')
        return
      }
      setStartResult(json)
      setActiveDcId(Number(form.design_case_id))
      setPhase('running')
    } finally {
      setBusyStart(false)
    }
  }

  async function handleComputeBias() {
    if (!activeDcId) return
    setBusyBias(true)
    try {
      const res = await fetch('/api/validation/compute-bias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design_case_id: activeDcId }),
      })
      const json = await res.json()
      if (!res.ok) { setErrMsg(json.error ?? 'Bias compute failed'); return }
      setBiasReport(json)
    } finally {
      setBusyBias(false)
    }
  }

  async function handlePromote() {
    if (!activeDcId) return
    setBusyPromote(true)
    try {
      const res = await fetch('/api/validation/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ design_case_id: activeDcId }),
      })
      const json = await res.json()
      if (!res.ok) { setErrMsg(json.error ?? 'Promote failed'); return }
      setPromoted(json)
      setPhase('promoted')
    } finally {
      setBusyPromote(false)
    }
  }

  function handleRetry() {
    setPhase('setup')
    setBiasReport(null)
    setStartResult(null)
    setPollData(null)
  }

  const f = (k: keyof SetupForm, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Validation</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Batch-validate a design case against historical DCS data · close energy &amp; material balance · promote to operating case
        </p>
      </div>

      {/* ── Section 1: Setup ──────────────────────────────────────────────────── */}
      <Section title="1 — Setup" sub="Select a design case and define the validation date range and bias parameters.">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">

          <div className="col-span-2">
            <label className={lbl}>Design Case</label>
            <select
              value={form.design_case_id}
              onChange={e => f('design_case_id', e.target.value)}
              className={inp}
              disabled={phase === 'running'}
            >
              <option value="">— select a design case —</option>
              {designCases.map(dc => (
                <option key={dc.id} value={dc.id}>{dc.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={lbl}>Start Date</label>
            <input type="date" value={form.start_date}
              onChange={e => f('start_date', e.target.value)}
              className={inp} disabled={phase === 'running'} />
          </div>
          <div>
            <label className={lbl}>End Date</label>
            <input type="date" value={form.end_date}
              onChange={e => f('end_date', e.target.value)}
              className={inp} disabled={phase === 'running'} />
          </div>

          <div>
            <label className={lbl}>Sample Interval</label>
            <select value={form.sample_interval_hrs}
              onChange={e => f('sample_interval_hrs', e.target.value as SetupForm['sample_interval_hrs'])}
              className={inp} disabled={phase === 'running'}>
              {[['1','Every hour'],['4','Every 4 hrs'],['8','Every 8 hrs'],['12','Every 12 hrs']].map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="col-span-2">
            <label className={lbl}>Mass Balance Filter</label>
            <div className="flex gap-2 mt-1">
              {(['1','2'] as const).map(v => (
                <button key={v} type="button"
                  className={radio(form.mb_filter_pct === v)}
                  onClick={() => f('mb_filter_pct', v)}
                  disabled={phase === 'running'}>
                  ±{v}%
                </button>
              ))}
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Timestamps where the plant mass balance error exceeds this threshold are filtered out.
              (Requires plant mass balance tag — currently applied as COT &lt; 780°C filter only.)
            </p>
          </div>

        </div>

        {/* Preflight checks — shown once a design case is selected */}
        {preflight && (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 flex items-center gap-2">
              <span className={`text-xs font-semibold ${preflight.all_ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {preflight.all_ok ? '✓ Pre-flight OK' : '⚠ Pre-flight issues'}
              </span>
              <span className="text-[10px] text-gray-400">{preflight.name}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {preflight.checks.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className={`text-xs mt-0.5 shrink-0 ${c.ok ? 'text-emerald-600' : 'text-amber-500'}`}>
                    {c.ok ? '✓' : '⚠'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700">{c.name}</p>
                    <p className="text-[10px] text-gray-400">{c.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {errMsg && <p className="text-sm text-red-500">{errMsg}</p>}

        <button
          onClick={handleStart}
          disabled={busyStart || phase === 'running' || !form.design_case_id}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busyStart ? 'Starting…' : phase === 'running' ? 'Validation running…' : 'Start Validation →'}
        </button>
      </Section>

      {/* ── Section 2: Progress ───────────────────────────────────────────────── */}
      {(phase === 'running' || (phase === 'results' && startResult)) && (
        <Section title="2 — Progress" sub="CoilSim is processing historical DCS data points. This page auto-updates every 10 seconds.">

          {startResult && (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                  <tr>
                    {['Total scanned','COT < 780°C','Mass balance','Composition stale','Queued'].map(h => (
                      <th key={h} className="px-4 py-2 text-right first:text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-100">
                    {[
                      startResult.filter_breakdown.total_scanned,
                      startResult.filter_breakdown.cot_low,
                      startResult.filter_breakdown.mass_balance,
                      startResult.filter_breakdown.composition_stale,
                      startResult.filter_breakdown.queued,
                    ].map((v, i) => (
                      <td key={i} className={`px-4 py-2.5 font-medium tabular-nums ${i === 0 ? '' : i === 4 ? 'text-right text-emerald-700' : 'text-right text-gray-500'}`}>
                        {v}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {pollData && (
            <div className="space-y-3">
              {/* Progress bar */}
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                  <div
                    className="bg-indigo-500 h-2.5 rounded-full transition-all duration-500"
                    style={{ width: `${pollData.pct_complete}%` }}
                  />
                </div>
                <span className="text-xs font-semibold tabular-nums text-gray-700 w-12 text-right">
                  {pollData.pct_complete}%
                </span>
              </div>
              <p className="text-xs text-gray-500">
                {pollData.runs_complete} / {pollData.runs_total} runs complete
                {pollData.runs_failed > 0 && (
                  <span className="text-amber-600"> · {pollData.runs_failed} failed</span>
                )}
              </p>

              {/* Live monthly preview */}
              {pollData.months.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Simulated C₂H₄ by month (live)
                  </p>
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-2 text-left">Month</th>
                          <th className="px-4 py-2 text-right">Sim C₂H₄ (MT)</th>
                          <th className="px-4 py-2 text-right">Error %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {pollData.months.map(m => (
                          <tr key={m.month}>
                            <td className="px-4 py-2 font-medium">{m.month}</td>
                            <td className="px-4 py-2 text-right tabular-nums">{m.sim_c2h4_mt.toFixed(1)}</td>
                            <td className={`px-4 py-2 text-right tabular-nums ${errCls(m.error_pct)}`}>
                              {pct(m.error_pct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* ── Section 3: Results ────────────────────────────────────────────────── */}
      {phase === 'results' && (
        <>
          <Section title="3 — Results" sub="Aggregated material and energy balance from all successful validation runs.">

            {/* 3a — Compute bias button */}
            {!biasReport && (
              <button
                onClick={handleComputeBias}
                disabled={busyBias}
                className="btn-primary disabled:opacity-40"
              >
                {busyBias ? 'Computing…' : 'Compute Bias & Close Balance →'}
              </button>
            )}

            {biasReport && (
              <div className="space-y-6">

                {/* 3-pre — Recommended Calibration Parameters */}
                <div className={`rounded-xl border px-5 py-4 space-y-3 ${
                  biasReport.recommended_cot_bias != null
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-amber-200 bg-amber-50'
                }`}>
                  <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Recommended Calibration Parameters
                  </p>
                  {biasReport.recommended_cot_bias != null ? (
                    <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">COT Bias</p>
                        <p className="text-2xl font-bold text-blue-800 tabular-nums">
                          {biasReport.recommended_cot_bias >= 0 ? '+' : ''}{biasReport.recommended_cot_bias.toFixed(1)} °C
                        </p>
                        <p className="text-[10px] text-gray-400 mt-0.5">
                          Add to DCS COT before each hourly CoilSim run
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide">C₂H₄ error before bias</p>
                          <p className={`text-sm font-semibold tabular-nums ${
                            biasReport.c2h4_error_before_bias != null && Math.abs(biasReport.c2h4_error_before_bias) > 5
                              ? 'text-red-700' : 'text-gray-800'
                          }`}>
                            {biasReport.c2h4_error_before_bias != null
                              ? `${biasReport.c2h4_error_before_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_before_bias.toFixed(2)}%`
                              : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wide">C₂H₄ error after bias (est.)</p>
                          <p className="text-sm font-semibold text-emerald-700 tabular-nums">
                            {biasReport.c2h4_error_after_bias != null
                              ? `${biasReport.c2h4_error_after_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_after_bias.toFixed(2)}%`
                              : '—'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">
                      COT bias cannot be computed — plant C₂H₄ yield data not available.
                      Run will complete but bias recommendation requires manual input once
                      plant yield analyser tags are configured.
                    </p>
                  )}
                </div>

                {/* 3a — Material Balance */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">3a — Material Balance by Month</p>
                  <div className="rounded-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                        <tr>
                          <th className="px-4 py-2 text-left">Month</th>
                          <th className="px-4 py-2 text-right">Sim C₂H₄ (MT)</th>
                          <th className="px-4 py-2 text-right">C₂H₄ Error %</th>
                          <th className="px-4 py-2 text-right">H₂+CH₄ Error %</th>
                          <th className="px-4 py-2 text-right">C3+ Error %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {biasReport.monthly.map(m => (
                          <tr key={m.month}>
                            <td className="px-4 py-2.5 font-medium">{m.month}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">{m.sim_c2h4_mt.toFixed(1)}</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${errCls(null)}`}>—</td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${errCls(m.h2_ch4_error_pct)}`}>
                              {pct(m.h2_ch4_error_pct)}
                            </td>
                            <td className={`px-4 py-2.5 text-right tabular-nums ${errCls(m.c3plus_error_pct)}`}>
                              {pct(m.c3plus_error_pct)}
                            </td>
                          </tr>
                        ))}
                        {/* Grand total */}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-2.5">Total</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {biasReport.monthly.reduce((s, m) => s + m.sim_c2h4_mt, 0).toFixed(1)}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums ${errCls(biasReport.overall_c2h4_error_pct)}`}>
                            {pct(biasReport.overall_c2h4_error_pct)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-400">—</td>
                          <td className="px-4 py-2.5 text-right text-gray-400">—</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-amber-600 mt-1">
                    Plant C₂H₄ yield data not configured — Error % will be available once plant yield analyzer tags are connected.
                  </p>
                </div>

                {/* 3b — Energy Balance */}
                <div>
                  <p className="text-xs font-semibold text-gray-700 mb-2">3b — Energy Balance</p>
                  <div className="rounded-lg border border-gray-100 px-5 py-4">
                    {biasReport.avg_coil_heat_kj_hr != null ? (
                      <div className="grid grid-cols-4 gap-4 text-xs">
                        <div>
                          <p className="text-gray-400 mb-0.5">Avg absorbed duty</p>
                          <p className="font-semibold tabular-nums">
                            {(biasReport.avg_coil_heat_kj_hr / 1000).toFixed(0)} MJ/hr
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-0.5">Fired duty</p>
                          <p className="text-gray-300">N/A — tag not configured</p>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-0.5">Thermal efficiency</p>
                          <p className="text-gray-300">N/A</p>
                        </div>
                        <div>
                          <p className="text-gray-400 mb-0.5">Design range</p>
                          <p className="text-gray-500">85–92%</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">
                        Energy balance: tag not configured — fuel gas flow tag required for fired duty.
                      </p>
                    )}
                  </div>
                </div>

                {/* 3c — Bias per Furnace */}
                {biasReport.per_furnace.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-700 mb-2">3c — Bias per Furnace</p>
                    <div className="rounded-lg border border-gray-100 overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider">
                          <tr>
                            <th className="px-4 py-2 text-left">Furnace</th>
                            <th className="px-4 py-2 text-right">Avg Sim C₂H₄ (kg/hr)</th>
                            <th className="px-4 py-2 text-right">Bias (kg/hr)</th>
                            <th className="px-4 py-2 text-right">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {biasReport.per_furnace.map(f => (
                            <tr key={f.furnace_id}>
                              <td className="px-4 py-2.5 font-medium capitalize">{f.furnace_id.replace('_', ' ')}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{f.sim_c2h4_avg.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{f.bias_kg_hr.toFixed(2)}</td>
                              <td className="px-4 py-2.5 text-right text-gray-400 text-[10px]">
                                Plant data required
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ── Section 4: Acceptance Gate ────────────────────────────────────── */}
          {biasReport && (
            <Section
              title="4 — Acceptance Gate"
              sub="All criteria must pass before the design case can be promoted to operating case."
            >
              <div className="space-y-2">
                {biasReport.checks.map((check, i) => {
                  const isNA = check.passed === null
                  const borderCls = isNA
                    ? 'border-amber-100 bg-amber-50'
                    : check.passed
                      ? 'border-emerald-100 bg-emerald-50'
                      : 'border-red-100 bg-red-50'
                  const iconCls = isNA ? 'text-amber-500' : check.passed ? 'text-emerald-600' : 'text-red-500'
                  const textCls = isNA ? 'text-amber-900' : check.passed ? 'text-emerald-900' : 'text-red-900'
                  const icon    = isNA ? '⚠' : check.passed ? '✓' : '✗'
                  return (
                    <div key={i} className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${borderCls}`}>
                      <span className={`text-base mt-0.5 shrink-0 ${iconCls}`}>{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-sm font-medium ${textCls}`}>{check.name}</p>
                          {isNA && <span className="text-[10px] text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">N/A</span>}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Value: <span className="font-medium">{check.value}</span>
                          <span className="ml-3">Threshold: {check.threshold}</span>
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {biasReport.all_passed ? (
                <div className="space-y-3">
                  {biasReport.checks.some(c => c.passed === null) ? (
                    <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                      Criteria with real data all passed. ⚠ Some checks are N/A (plant yield / fired duty tags not yet configured) — promotion is allowed but full verification is incomplete.
                    </div>
                  ) : (
                    <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                      All acceptance criteria passed. This design case is ready to be promoted.
                    </div>
                  )}
                  <button
                    onClick={handlePromote}
                    disabled={busyPromote}
                    className="btn-primary disabled:opacity-40"
                  >
                    {busyPromote ? 'Promoting…' : 'Promote to Operating Case →'}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                    Validation requires review — one or more criteria did not pass.
                    Adjust parameters and re-run validation, or override after engineering review.
                  </div>
                  <button onClick={handleRetry} className="text-sm text-indigo-600 underline underline-offset-2">
                    ← Retry with adjusted parameters
                  </button>
                </div>
              )}

              {errMsg && <p className="text-sm text-red-500">{errMsg}</p>}
            </Section>
          )}
        </>
      )}

      {/* ── Section 5: Post-Promotion ─────────────────────────────────────────── */}
      {phase === 'promoted' && promoted && (
        <Section title="5 — Promoted" sub="The design case is now the active operating case.">
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-6 py-5 space-y-1">
            <p className="text-sm font-semibold text-emerald-900">
              ✓ Design case &quot;{promoted.name}&quot; is now the active operating case.
            </p>
            <p className="text-xs text-emerald-700">
              Hourly simulations will apply COT bias +{promoted.cot_bias}°C and per-furnace C₂H₄ bias corrections.
            </p>
            <p className="text-xs text-emerald-600 mt-2">
              Next revalidation due: <span className="font-medium">{promoted.next_review}</span>
            </p>
          </div>
          <button onClick={handleRetry} className="text-sm text-indigo-600 underline underline-offset-2">
            Run another validation
          </button>
        </Section>
      )}
    </div>
  )
}
