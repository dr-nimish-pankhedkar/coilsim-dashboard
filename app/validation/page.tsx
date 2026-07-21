'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import useSWR from 'swr'
import type { DesignCase, ValidationStatusResponse, ValidationBiasReport } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

type Phase = 'setup' | 'running' | 'results' | 'promoted'

interface PreflightCheck { name: string; ok: boolean; detail: string }
interface PreflightResult { design_case_id: number; name: string; all_ok: boolean; checks: PreflightCheck[] }

// ── How It Works modal ───────────────────────────────────────────────────────
const STEPS = [
  { n: 1, title: 'Pull DCS history',    body: 'Completed simulation_tasks from the selected date range are bucketed by the chosen sample interval.' },
  { n: 2, title: 'Filter noisy points', body: 'Rows with COT < 780 °C (plugged-tube indicator) or a frozen dilution ratio (>7 days unchanged) are dropped.' },
  { n: 3, title: 'Queue CoilSim runs',  body: 'One validation_results shell row and one simulation_task (type = "validation") are inserted per surviving data point at raw DCS COT.' },
  { n: 4, title: 'Worker runs CoilSim', body: 'The Python worker picks up each task, writes exp.txt from DCS conditions, executes the CoilSim engine, and writes yields back to validation_results.' },
  { n: 5, title: 'Fit COT bias',        body: 'After all runs complete, /compute-bias uses a 0.18 wt%/°C ethane sensitivity to derive the COT offset that closes the C₂H₄ gap vs. plant data.' },
  { n: 6, title: 'Acceptance gate',     body: 'Yield errors, run failure rate, and thermal efficiency are checked. N/A criteria (no plant tag) are shown as ⚠ amber — they do not block promotion.' },
  { n: 7, title: 'Promote',             body: 'On approval the design case is set as the active operating case. The fitted COT bias is applied to every subsequent hourly CoilSim run automatically.' },
]

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,20,30,0.55)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-900">How Validation Works</p>
            <p className="text-xs text-gray-400 mt-0.5">7-step backend pipeline from DCS history to operating case</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors text-xl leading-none"
            aria-label="Close"
          >×</button>
        </div>

        {/* Body — two columns */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: steps */}
          <div className="w-[52%] overflow-y-auto px-6 py-5 space-y-4 border-r border-gray-100">
            {STEPS.map(s => (
              <div key={s.n} className="flex gap-3">
                <span
                  className="shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                  style={{ background: '#1976d2', color: '#fff' }}
                >{s.n}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-800">{s.title}</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{s.body}</p>
                </div>
              </div>
            ))}
            <p className="text-[10px] text-gray-300 pt-2">
              Click anywhere outside to close
            </p>
          </div>

          {/* Right: flowchart */}
          <div className="flex-1 overflow-auto flex items-start justify-center px-4 py-5">
            <ValidationFlowchart />
          </div>
        </div>
      </div>
    </div>
  )
}

function ValidationFlowchart() {
  // Palette
  const C = { blue: '#1976d2', blueLt: '#e3f0fb', gray: '#64748b', grayLt: '#f1f5f9',
               amber: '#b45309', amberLt: '#fef3c7', green: '#15803d', greenLt: '#dcfce7',
               border: '#cbd5e1', text: '#1e293b', dim: '#94a3b8', white: '#ffffff' }

  const W = 260, H = 570
  const bw = 148, bh = 34   // box width/height
  const cx = W / 2           // centre x
  const lx = cx - bw / 2     // left edge of boxes

  // Node y positions
  const Y = [30, 105, 180, 255, 330, 405, 488, 488]
  // arrow tip: bottom of current box → top of next
  const arr = (y: number) => (
    <line x1={cx} y1={y + bh} x2={cx} y2={y + bh + 37} stroke={C.border} strokeWidth={1.5}
      markerEnd="url(#arrowhead)" />
  )

  const box = (
    y: number, label: string, sub: string,
    fill: string, stroke: string, textCol = C.text
  ) => (
    <g key={y}>
      <rect x={lx} y={y} width={bw} height={bh} rx={6}
        fill={fill} stroke={stroke} strokeWidth={1.2} />
      <text x={cx} y={y + 13} textAnchor="middle" fill={textCol}
        fontSize={9} fontWeight={600} fontFamily="ui-monospace,monospace">{label}</text>
      <text x={cx} y={y + 24} textAnchor="middle" fill={C.dim}
        fontSize={7.5} fontFamily="system-ui,sans-serif">{sub}</text>
    </g>
  )

  const diamond = (y: number) => {
    const mx = cx, my = y + 20
    const pts = `${mx},${my - 18} ${mx + 36},${my} ${mx},${my + 18} ${mx - 36},${my}`
    return (
      <g key={y}>
        <polygon points={pts} fill={C.amberLt} stroke={C.amber} strokeWidth={1.2} />
        <text x={mx} y={my - 3} textAnchor="middle" fill={C.amber}
          fontSize={8} fontWeight={700} fontFamily="system-ui,sans-serif">Acceptance</text>
        <text x={mx} y={my + 9} textAnchor="middle" fill={C.amber}
          fontSize={8} fontFamily="system-ui,sans-serif">Gate</text>
      </g>
    )
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg"
      style={{ fontFamily: 'system-ui,sans-serif', overflow: 'visible' }}>
      <defs>
        <marker id="arrowhead" markerWidth={6} markerHeight={6} refX={3} refY={3} orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill={C.border} />
        </marker>
        <marker id="arrowGreen" markerWidth={6} markerHeight={6} refX={3} refY={3} orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill={C.green} />
        </marker>
        <marker id="arrowAmber" markerWidth={6} markerHeight={6} refX={3} refY={3} orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill={C.amber} />
        </marker>
      </defs>

      {/* Step 1 — DCS History */}
      {box(Y[0], 'DCS Historian', 'completed simulation_tasks', C.blueLt, C.blue)}
      {arr(Y[0])}

      {/* Step 2 — Filter */}
      {box(Y[1], 'Filter', 'COT < 780 · stale composition', C.grayLt, C.border)}
      {arr(Y[1])}

      {/* Step 3 — Queue */}
      {box(Y[2], 'Queue runs', 'validation_results + simulation_tasks', C.grayLt, C.border)}
      {arr(Y[2])}

      {/* Step 4 — Worker */}
      {box(Y[3], 'CoilSim Worker', 'exp.txt → engine → yields', C.blueLt, C.blue)}
      {arr(Y[3])}

      {/* Step 5 — Fit bias */}
      {box(Y[4], 'Fit COT Bias', '0.18 wt%/°C sensitivity', C.blueLt, C.blue)}
      {arr(Y[4])}

      {/* Step 6 — Gate (diamond) */}
      {diamond(Y[5])}

      {/* Arrows from gate */}
      {/* ✓ Promote — straight down */}
      <line x1={cx} y1={Y[5] + 38} x2={cx} y2={Y[5] + 60} stroke={C.green} strokeWidth={1.5}
        markerEnd="url(#arrowGreen)" />
      <rect x={lx} y={Y[5] + 60} width={bw} height={bh} rx={6}
        fill={C.greenLt} stroke={C.green} strokeWidth={1.2} />
      <text x={cx} y={Y[5] + 73} textAnchor="middle" fill={C.green}
        fontSize={9} fontWeight={600} fontFamily="ui-monospace,monospace">Promote</text>
      <text x={cx} y={Y[5] + 84} textAnchor="middle" fill={C.dim}
        fontSize={7.5}>set as active operating case</text>

      {/* ✗ Requires review — right side arm */}
      <line x1={cx + 36} y1={Y[5] + 20} x2={cx + 80} y2={Y[5] + 20}
        stroke={C.amber} strokeWidth={1.5} markerEnd="url(#arrowAmber)" />
      <text x={cx + 84} y={Y[5] + 17} fill={C.amber} fontSize={7.5} fontWeight={600}>
        Requires
      </text>
      <text x={cx + 84} y={Y[5] + 28} fill={C.amber} fontSize={7.5}>
        review
      </text>

      {/* Step labels on left */}
      {[1,2,3,4,5].map((n, i) => (
        <text key={n} x={lx - 6} y={Y[i] + 21} textAnchor="end"
          fill={C.dim} fontSize={8} fontWeight={600}>
          {n}
        </text>
      ))}
      <text x={lx - 6} y={Y[5] + 22} textAnchor="end" fill={C.dim} fontSize={8} fontWeight={600}>6</text>
      <text x={lx - 6} y={Y[5] + 78} textAnchor="end" fill={C.dim} fontSize={8} fontWeight={600}>7</text>
    </svg>
  )
}

type ValidationTab = 'design' | 'operating'

interface TuningParamCfg {
  enabled: boolean
  min: number
  max: number
  step: number
  unit: string
  result?: number | null
}
type TuningParams = Record<string, TuningParamCfg>

const TUNING_DEFAULTS: TuningParams = {
  cot_bias:    { enabled: true,  min: -5,    max: 30,   step: 0.5,  unit: '°C'    },
  cip_bias:    { enabled: false, min: -0.3,  max: 0.3,  step: 0.05, unit: 'atm'   },
  flux_mult:   { enabled: false, min: 0.85,  max: 1.15, step: 0.05, unit: '—'     },
  adiabatic_l: { enabled: false, min: 0.0,   max: 2.0,  step: 0.25, unit: 'm'     },
  shc_bias:    { enabled: false, min: -0.05, max: 0.05, step: 0.01, unit: 'kg/kg' },
}

const TUNING_META: Record<string, { label: string; desc: string }> = {
  cot_bias:    { label: 'COT Bias',          desc: 'Temperature offset applied to DCS coil outlet temperature' },
  cip_bias:    { label: 'CIP Bias',          desc: 'Inlet pressure offset' },
  flux_mult:   { label: 'Flux Multiplier',   desc: 'Scale factor applied to entire heat flux profile' },
  adiabatic_l: { label: 'Adiabatic Length',  desc: 'Additional reaction length after heated zone' },
  shc_bias:    { label: 'SHC Bias',          desc: 'Offset to steam/HC ratio' },
}

interface SetupForm {
  design_case_id: string
  start_date: string
  end_date: string
  mb_filter_pct: '1' | '2'
  sample_interval_hrs: '1' | '4' | '8' | '12'
  recalibration_threshold: string
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

// ── Stage 1: Design Case Validation ─────────────────────────────────────────

const DESIGN_COMPONENTS = [
  { key: 'H2',        label: 'H₂',                   group: 'Light' },
  { key: 'CH4',       label: 'CH₄',                  group: 'Light' },
  { key: 'C2H2',      label: 'C₂H₂ (acetylene)',      group: 'C₂' },
  { key: 'C2H4',      label: 'C₂H₄ (ethylene)',       group: 'C₂' },
  { key: 'C2H6',      label: 'C₂H₆ (ethane)',         group: 'C₂' },
  { key: 'ProDiene',  label: 'Propadiene / MA',        group: 'C₃' },
  { key: 'C3H6',      label: 'C₃H₆ (propylene)',      group: 'C₃' },
  { key: 'C3H8',      label: 'C₃H₈ (propane)',        group: 'C₃' },
  { key: '1.3-C4H6',  label: '1,3-Butadiene',         group: 'C₄' },
  { key: '1C4H8',     label: '1-Butene',              group: 'C₄' },
  { key: 'nC4H10',    label: 'n-C₄H₁₀ (n-butane)',   group: 'C₄' },
  { key: 'iC4H10',    label: 'i-C₄H₁₀ (isobutane)',  group: 'C₄' },
  { key: 'Benzene',   label: 'Benzene',                group: 'BTX' },
  { key: 'Toluene',   label: 'Toluene',                group: 'BTX' },
  { key: 'Xylene',    label: 'Xylene',                group: 'BTX' },
  { key: 'Styrene',   label: 'Styrene',               group: 'BTX' },
]

const FEED_PRESETS: Record<string, { label: string; components: string[] }> = {
  ethane:  { label: 'Ethane cracker',  components: ['H2','CH4','C2H4','C2H6'] },
  propane: { label: 'Propane cracker', components: ['H2','CH4','C2H4','C2H6','C3H6','C3H8'] },
  naphtha: { label: 'Naphtha cracker', components: ['H2','CH4','C2H4','C3H6','1.3-C4H6','Benzene','Toluene'] },
  gasoil:  { label: 'Gas oil cracker', components: ['H2','CH4','C2H4','C3H6','Benzene','Toluene','Xylene'] },
}

const DC_GROUPS = ['Light','C₂','C₃','C₄','BTX'] as const

function DesignValidation({ designCaseId, onAccepted }: {
  designCaseId: number
  onAccepted: (biasDegc: number | null) => void
}) {
  const [expanded,  setExpanded]  = useState(false)
  const [preset,    setPreset]    = useState<string | null>(null)
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [measYields,setMeasYields]= useState<Record<string,string>>({})
  const [cond, setCond] = useState({ cot:'', flow:'', shc:'', cit:'650', cip:'2.59', cop:'2.053' })
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState('')

  const { data, mutate } = useSWR<any>(
    `/api/validation/design-validate/${designCaseId}`,
    fetcher,
    { refreshInterval: (data: any) => data?.run?.status === 'running' ? 5000 : 0 }
  )

  // Notify parent when validated
  useEffect(() => {
    if (data?.design_validation_status === 'validated') {
      onAccepted(data.design_cot_bias_degc ?? null)
    }
  }, [data?.design_validation_status, data?.design_cot_bias_degc, onAccepted])

  // Pre-fill form from last run when expanding
  useEffect(() => {
    const run = data?.run
    if (!run || !expanded) return
    if (run.cot_degc)   setCond(p => ({ ...p, cot: String(run.cot_degc) }))
    if (run.flow_kg_hr) setCond(p => ({ ...p, flow: String(run.flow_kg_hr) }))
    if (run.shc_ratio)  setCond(p => ({ ...p, shc: String(run.shc_ratio) }))
    if (run.cit_degc)   setCond(p => ({ ...p, cit: String(run.cit_degc) }))
    if (run.cip_atm)    setCond(p => ({ ...p, cip: String(run.cip_atm) }))
    if (run.cop_atm)    setCond(p => ({ ...p, cop: String(run.cop_atm) }))
    if (run.selected_components?.length) setSelected(new Set(run.selected_components))
    if (run.measured_yields) setMeasYields(Object.fromEntries(Object.entries(run.measured_yields).map(([k,v]) => [k, String(v)])))
  }, [expanded])

  function applyPreset(key: string) {
    setPreset(key)
    const comps = FEED_PRESETS[key]?.components ?? []
    setSelected(new Set(comps))
    setMeasYields(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => comps.includes(k))))
  }

  function toggleComp(key: string) {
    setSelected(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  function parseCsv(file: File) {
    const reader = new FileReader()
    reader.onload = e => {
      const text = (e.target?.result ?? '') as string
      const newY: Record<string,string> = {}
      const newSel = new Set(selected)
      for (const line of text.split('\n')) {
        const [rawComp, rawVal] = line.split(',').map(s => s.trim())
        if (!rawComp || !rawVal) continue
        const val = parseFloat(rawVal)
        if (isNaN(val)) continue  // skip header
        const match = DESIGN_COMPONENTS.find(c =>
          c.key.toLowerCase() === rawComp.toLowerCase() ||
          c.label.toLowerCase().includes(rawComp.toLowerCase())
        )
        if (match) { newY[match.key] = String(val); newSel.add(match.key) }
      }
      setMeasYields(prev => ({ ...prev, ...newY }))
      setSelected(newSel)
    }
    reader.readAsText(file)
  }

  async function handleRun() {
    const measured: Record<string,number> = {}
    for (const k of selected) {
      const v = parseFloat(measYields[k] ?? '')
      if (!isNaN(v)) measured[k] = v
    }
    if (!cond.cot || !cond.flow || !cond.shc) { setErrMsg('COT, HC flow, and SHC are required.'); return }
    if (!Object.keys(measured).length)         { setErrMsg('Enter at least one measured yield.'); return }
    setErrMsg(''); setBusy(true)
    try {
      const res = await fetch(`/api/validation/design-validate/${designCaseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cot_degc: Number(cond.cot), flow_kg_hr: Number(cond.flow), shc_ratio: Number(cond.shc),
          cit_degc: Number(cond.cit), cip_atm: Number(cond.cip), cop_atm: Number(cond.cop),
          measured_yields: measured, selected_components: Array.from(selected),
        }),
      })
      if (!res.ok) { const d = await res.json(); setErrMsg(d.error ?? 'Error'); return }
      mutate()
    } catch (e: any) { setErrMsg(e.message) }
    finally { setBusy(false) }
  }

  async function handleAccept() {
    const run = data?.run
    if (!run) return
    await fetch(`/api/validation/design-validate/${designCaseId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept', run_id: run.id, bias_degc: run.bias_degc }),
    })
    mutate()
    setExpanded(false)
  }

  const isValidated = data?.design_validation_status === 'validated'
  const run = data?.run
  const isRunning = run?.status === 'running'

  return (
    <div className={`card border-2 transition-colors ${isValidated ? 'border-emerald-200 bg-emerald-50/30' : 'border-blue-100 bg-blue-50/20'}`}>
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${isValidated ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white'}`}>1</div>
          <div>
            <p className="text-sm font-semibold text-gray-900">Design Case Validation</p>
            <p className="text-xs text-gray-400 mt-0.5">
              {isValidated
                ? `Design COT bias accepted: ${data.design_cot_bias_degc != null ? `${Number(data.design_cot_bias_degc) > 0 ? '+' : ''}${data.design_cot_bias_degc} °C` : '0 °C'} — applied in plant validation (Stage 2)`
                : 'Validate model against design / guarantee data. Computes COT bias applied before plant validation.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isValidated && <span className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full font-medium">✓ Stage 1 done</span>}
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-700 px-2 py-1 rounded border border-gray-200 hover:border-gray-400 transition-colors"
          >{expanded ? 'Collapse ▲' : isValidated ? 'Re-validate' : 'Configure ▼'}</button>
        </div>
      </div>

      {expanded && (
        <div className="mt-5 space-y-5 border-t border-gray-100 pt-5">

          {/* Feed preset buttons */}
          <div>
            <p className={lbl}>Feed type — pre-selects typical components</p>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(FEED_PRESETS).map(([key, val]) => (
                <button key={key} onClick={() => applyPreset(key)}
                  className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${preset === key ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}
                >{val.label}</button>
              ))}
            </div>
          </div>

          {/* Component checklist */}
          <div>
            <p className={lbl}>Components to match</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 mt-2">
              {['Light','C₂','C₃','C₄','BTX'].map(group => {
                const comps = DESIGN_COMPONENTS.filter(c => c.group === group || (group === 'C₂' && c.group === 'C₂') || (group === 'C₃' && c.group === 'C₃') || (group === 'C₄' && c.group === 'C₄') || (group === 'BTX' && c.group === 'BTX') || (group === 'Light' && c.group === 'Light'))
                if (!comps.length) return null
                return (
                  <div key={group}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">{group}</p>
                    <div className="space-y-1">
                      {comps.map(c => (
                        <label key={c.key} className="flex items-center gap-2 cursor-pointer select-none">
                          <input type="checkbox" checked={selected.has(c.key)} onChange={() => toggleComp(c.key)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"/>
                          <span className="text-xs text-gray-700">{c.label}
                            {c.key === 'C2H4' && <span className="ml-1 text-[9px] text-blue-400 font-medium">bias driver</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Operating conditions */}
          <div>
            <p className={lbl}>Design operating conditions</p>
            <div className="grid grid-cols-3 gap-3 mt-1">
              {([['cot','COT (°C)','840'],['flow','HC Flow (kg/h)','1300'],['shc','SHC ratio','0.35'],
                 ['cit','CIT (°C)','650'],['cip','CIP (atm)','2.59'],['cop','COP (atm)','2.053']] as [string,string,string][]).map(([k,label,ph]) => (
                <div key={k}>
                  <label className={lbl}>{label}</label>
                  <input type="number" step="any" placeholder={ph} value={cond[k as keyof typeof cond]}
                    onChange={e => setCond(p => ({ ...p, [k]: e.target.value }))} className={inp}/>
                </div>
              ))}
            </div>
          </div>

          {/* Yield inputs + CSV upload */}
          {selected.size > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className={lbl}>Measured yields (wt %)</p>
                <label className="text-xs text-blue-600 hover:text-blue-800 cursor-pointer font-medium">
                  ↑ Upload CSV
                  <input type="file" accept=".csv,.txt" className="hidden"
                    onChange={e => e.target.files?.[0] && parseCsv(e.target.files[0])}/>
                </label>
              </div>
              <p className="text-[10px] text-gray-400 mb-2">CSV: two columns — Component, Yield_wt_pct (header row optional)</p>
              <div className="grid grid-cols-4 gap-2">
                {Array.from(selected).map(key => {
                  const comp = DESIGN_COMPONENTS.find(c => c.key === key)
                  return (
                    <div key={key}>
                      <label className={lbl}>{comp?.label ?? key}</label>
                      <input type="number" step="any" placeholder="wt%" value={measYields[key] ?? ''}
                        onChange={e => setMeasYields(p => ({ ...p, [key]: e.target.value }))} className={inp}/>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Running indicator */}
          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
              <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
              CoilSim running design validation… polling every 5 s
            </div>
          )}

          {/* Results */}
          {run?.status === 'completed' && run.errors_json && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-700">Results — last run</p>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-400 font-medium">
                    <th className="text-left py-1.5">Component</th>
                    <th className="text-right py-1.5">Measured</th>
                    <th className="text-right py-1.5">Simulated</th>
                    <th className="text-right py-1.5">Δ wt%</th>
                    <th className="text-right py-1.5">Error %</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(run.errors_json as Record<string,any>).map(([comp, e]) => (
                    <tr key={comp} className="border-b border-gray-100">
                      <td className="py-1.5 text-gray-700 font-medium">
                        {DESIGN_COMPONENTS.find(c => c.key === comp)?.label ?? comp}
                        {comp === 'C2H4' && <span className="ml-1 text-[9px] text-blue-400">bias driver</span>}
                      </td>
                      <td className="text-right py-1.5">{(e as any).measured.toFixed(3)}</td>
                      <td className="text-right py-1.5">{(e as any).sim.toFixed(3)}</td>
                      <td className={`text-right py-1.5 ${Math.abs((e as any).abs_err) > 1 ? 'text-amber-600' : 'text-gray-500'}`}>
                        {(e as any).abs_err > 0 ? '+' : ''}{(e as any).abs_err.toFixed(3)}
                      </td>
                      <td className={`text-right py-1.5 ${errCls((e as any).rel_err_pct)}`}>
                        {(e as any).rel_err_pct > 0 ? '+' : ''}{(e as any).rel_err_pct.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div>
                  <p className="text-xs font-semibold text-blue-900">Recommended design COT bias</p>
                  <p className="text-xl font-bold text-blue-700 mt-0.5 leading-tight">
                    {run.bias_degc != null
                      ? `${Number(run.bias_degc) > 0 ? '+' : ''}${run.bias_degc} °C`
                      : 'N/A — C₂H₄ not selected'}
                  </p>
                  <p className="text-[10px] text-blue-500 mt-0.5">
                    Applied to every COT in Stage 2 plant validation before queuing CoilSim
                  </p>
                </div>
                <button onClick={handleAccept}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors">
                  Accept bias →
                </button>
              </div>
            </div>
          )}

          {run?.status === 'failed' && (
            <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded border border-red-200">
              Design validation failed: {run.error_message ?? 'Worker error'}
            </p>
          )}

          {errMsg && <p className="text-xs text-red-500">{errMsg}</p>}

          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleRun} disabled={busy || isRunning || selected.size === 0}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-colors">
              {busy || isRunning ? 'Running…' : run ? 'Re-run Design Validation' : 'Run Design Validation'}
            </button>
            <p className="text-[10px] text-gray-400">Worker must be active — runs one CoilSim job at the design conditions.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Plant Data Configuration ─────────────────────────────────────────────────
interface TagRow {
  furnace_id:   string | null
  pass_id:      string | null
  tag_name:     string
  tag_unit:     'wt%' | 'kg/hr' | 'fraction'
  status:       'idle' | 'checking' | 'found' | 'not_found'
  sample_value: number | null
  last_seen:    string | null
}

interface PlantCfgData {
  plant_data_mode:    'header' | 'per_furnace' | 'per_pass' | null
  tags:               Array<{ furnace_id: string|null; pass_id: string|null; tag_name: string; tag_unit: string }>
  fuel_gas_flow_tag:  string | null
  fuel_gas_lhv_kj_kg: number
  furnaces:           string[]
  passes:             Array<{ furnace_id: string; pass_id: string }>
  tag_validation:     Array<{ tag_name: string; exists: boolean; sample_value: number|null; last_seen: string|null }>
}

const MODE_OPTIONS = [
  {
    key:      'header'      as const,
    label:    'Combined header',
    desc:     'Single tag for all furnaces combined',
    computes: 'Global COT bias only',
  },
  {
    key:      'per_furnace' as const,
    label:    'Per-furnace analyzer',
    desc:     'One tag per furnace outlet',
    computes: 'Global COT bias + per-furnace residual',
  },
  {
    key:      'per_pass'    as const,
    label:    'Per-pass (coil-level)',
    desc:     'Individual yield tag per coil pass',
    computes: 'Global + per-furnace + per-pass bias',
  },
]

function buildTagRows(
  mode: 'header' | 'per_furnace' | 'per_pass',
  cfg: PlantCfgData,
  saved: PlantCfgData['tags']
): TagRow[] {
  const blank = (f: string|null, p: string|null): TagRow => {
    const s = saved.find(t => t.furnace_id === f && t.pass_id === p)
    return { furnace_id: f, pass_id: p, tag_name: s?.tag_name ?? '', tag_unit: (s?.tag_unit as TagRow['tag_unit']) ?? 'wt%',
             status: 'idle', sample_value: null, last_seen: null }
  }
  if (mode === 'header') return [blank(null, null)]
  if (mode === 'per_furnace') {
    const furnaces = cfg.furnaces.length ? cfg.furnaces : ['furnace_1']
    return furnaces.map(f => blank(f, null))
  }
  const pairs = cfg.passes.length ? cfg.passes : [{ furnace_id: 'furnace_1', pass_id: 'pass_1' }]
  return pairs.map(p => blank(p.furnace_id, p.pass_id))
}

function TagStatus({ row }: { row: TagRow }) {
  if (row.status === 'idle')     return <span className="text-gray-300 text-[10px]">—</span>
  if (row.status === 'checking') return <span className="text-gray-400 text-[10px] italic">checking…</span>
  if (row.status === 'found') {
    const age = row.last_seen
      ? (() => { const m = Math.floor((Date.now() - new Date(row.last_seen).getTime()) / 60000); return m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago` })()
      : ''
    return (
      <span className="text-emerald-600 text-[10px]">
        ● {row.sample_value != null ? row.sample_value.toFixed(2) : ''}
        {row.tag_unit ? ` ${row.tag_unit}` : ''}{age ? ` · ${age}` : ''}
      </span>
    )
  }
  return <span className="text-red-500 text-[10px]">✗ Not found in historian</span>
}

function PlantDataConfig({
  designCaseId,
  disabled,
  onConfigChange,
}: {
  designCaseId: number
  disabled:     boolean
  onConfigChange: (saved: boolean, hasFound: boolean) => void
}) {
  const [mode,       setMode]       = useState<'header'|'per_furnace'|'per_pass'|null>(null)
  const [tags,       setTags]       = useState<TagRow[]>([])
  const [fuelTag,    setFuelTag]    = useState('')
  const [fuelLHV,    setFuelLHV]    = useState(47000)
  const [energyOpen, setEnergyOpen] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saveOk,     setSaveOk]     = useState(false)
  const [saveErr,    setSaveErr]    = useState('')
  const loaded = useRef<number | null>(null)
  const prevNotify = useRef({ saved: false, hasFound: false })

  const { data: cfg } = useSWR<PlantCfgData>(
    `/api/validation/plant-config/${designCaseId}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  // Initialise from saved config once per design case
  useEffect(() => {
    if (!cfg || loaded.current === designCaseId) return
    loaded.current = designCaseId
    setMode(cfg.plant_data_mode ?? null)
    setFuelTag(cfg.fuel_gas_flow_tag ?? '')
    setFuelLHV(cfg.fuel_gas_lhv_kj_kg ?? 47000)
    if (cfg.plant_data_mode) {
      const rows = buildTagRows(cfg.plant_data_mode, cfg, cfg.tags)
      // Restore validation status from saved tag_validation
      setTags(rows.map(r => {
        const v = cfg.tag_validation.find(tv => tv.tag_name === r.tag_name && r.tag_name !== '')
        return v ? { ...r, status: v.exists ? 'found' : 'not_found', sample_value: v.sample_value, last_seen: v.last_seen } : r
      }))
      setSaveOk(cfg.tags.length > 0)
    }
  }, [cfg, designCaseId])

  // Reset when design case changes
  useEffect(() => {
    loaded.current = null
    setMode(null); setTags([]); setSaveOk(false); setSaveErr('')
  }, [designCaseId])

  // Notify parent — guarded by ref to avoid infinite loops
  useEffect(() => {
    const hasFound = tags.some(t => t.status === 'found')
    if (prevNotify.current.saved !== saveOk || prevNotify.current.hasFound !== hasFound) {
      prevNotify.current = { saved: saveOk, hasFound }
      onConfigChange(saveOk, hasFound)
    }
  })

  const handleMode = (m: 'header'|'per_furnace'|'per_pass') => {
    setMode(m); setSaveOk(false)
    if (cfg) setTags(buildTagRows(m, cfg, []))
  }

  const updateTag = (i: number, key: 'tag_name'|'tag_unit', val: string) => {
    setTags(prev => prev.map((t, n) => n === i ? { ...t, [key]: val, status: 'idle' } : t))
    setSaveOk(false)
  }

  const checkTag = async (tagName: string, i: number) => {
    if (!tagName.trim()) return
    setTags(prev => prev.map((t, n) => n === i ? { ...t, status: 'checking' } : t))
    try {
      const r = await fetch(`/api/validation/plant-config/${designCaseId}?check_tag=${encodeURIComponent(tagName)}`)
      const j = await r.json()
      setTags(prev => prev.map((t, n) => n === i
        ? { ...t, status: j.exists ? 'found' : 'not_found', sample_value: j.sample_value, last_seen: j.last_seen }
        : t))
    } catch {
      setTags(prev => prev.map((t, n) => n === i ? { ...t, status: 'not_found' } : t))
    }
  }

  const handleSave = async () => {
    if (!mode) return
    setSaving(true); setSaveErr('')
    try {
      const res = await fetch(`/api/validation/plant-config/${designCaseId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plant_data_mode:    mode,
          tags:               tags.map(t => ({ furnace_id: t.furnace_id, pass_id: t.pass_id, tag_name: t.tag_name, tag_unit: t.tag_unit })),
          fuel_gas_flow_tag:  fuelTag || null,
          fuel_gas_lhv_kj_kg: fuelLHV,
        }),
      })
      const json = await res.json()
      if (!res.ok) { setSaveErr(json.error ?? 'Save failed'); return }
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const tinp = 'w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white'
  const tsel = 'border border-gray-200 rounded-md px-1.5 py-1.5 text-xs bg-white focus:outline-none w-full'

  return (
    <div className="col-span-2 space-y-4 pt-4 border-t border-gray-100">
      <div>
        <p className="text-xs font-semibold text-gray-800">Plant Data Configuration</p>
        <p className="text-[11px] text-gray-400 mt-0.5">
          Tell the system how plant C₂H₄ is measured in your DCS historian. Saved once per design case — required to compute COT bias.
        </p>
      </div>

      {/* Mode selector — 3 radio cards */}
      <div className="grid grid-cols-3 gap-2.5">
        {MODE_OPTIONS.map(opt => {
          const active = mode === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              disabled={disabled}
              onClick={() => handleMode(opt.key)}
              className={`text-left rounded-xl border px-3 py-3 transition-all text-xs disabled:opacity-40 disabled:cursor-not-allowed ${
                active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`w-3 h-3 rounded-full border-2 shrink-0 flex items-center justify-center ${active ? 'border-white' : 'border-gray-400'}`}>
                  {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                </span>
                <span className="font-semibold text-[11px]">{opt.label}</span>
              </div>
              <p className={`text-[10px] leading-relaxed ${active ? 'text-gray-300' : 'text-gray-400'}`}>{opt.desc}</p>
              <p className={`text-[10px] mt-1.5 font-medium ${active ? 'text-blue-300' : 'text-blue-500'}`}>→ {opt.computes}</p>
            </button>
          )
        })}
      </div>

      {/* Tag mapping table */}
      {mode && (
        <div className="rounded-lg border border-gray-100 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-500 uppercase tracking-wider text-[10px]">
              <tr>
                {mode !== 'header'   && <th className="px-3 py-2 text-left font-semibold">Furnace</th>}
                {mode === 'per_pass' && <th className="px-3 py-2 text-left font-semibold">Pass</th>}
                {mode === 'header'   && <th className="px-3 py-2 text-left font-semibold">Label</th>}
                <th className="px-3 py-2 text-left font-semibold">Tag Name</th>
                <th className="px-3 py-2 text-left font-semibold w-24">Unit</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {tags.map((t, i) => (
                <tr key={i}>
                  {mode !== 'header' && (
                    <td className="px-3 py-2 font-medium text-gray-600 capitalize whitespace-nowrap">
                      {t.furnace_id?.replace(/_/g, ' ')}
                    </td>
                  )}
                  {mode === 'per_pass' && (
                    <td className="px-3 py-2 text-gray-500 capitalize whitespace-nowrap">
                      {t.pass_id?.replace(/_/g, ' ')}
                    </td>
                  )}
                  {mode === 'header' && (
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">Cracked gas C₂H₄</td>
                  )}
                  <td className="px-3 py-2">
                    <input
                      value={t.tag_name}
                      placeholder="e.g. FIC_2401_C2H4_YLD"
                      className={tinp}
                      disabled={disabled}
                      onChange={e => updateTag(i, 'tag_name', e.target.value)}
                      onBlur={() => checkTag(t.tag_name, i)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select value={t.tag_unit} className={tsel} disabled={disabled}
                      onChange={e => updateTag(i, 'tag_unit', e.target.value as TagRow['tag_unit'])}>
                      <option value="wt%">wt%</option>
                      <option value="kg/hr">kg/hr</option>
                      <option value="fraction">fraction</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap"><TagStatus row={t} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Energy balance — optional, collapsible */}
      {mode && (
        <div>
          <button type="button" onClick={() => setEnergyOpen(v => !v)}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
            <span className="text-[10px]">{energyOpen ? '▾' : '▸'}</span>
            Energy Balance (Optional)
          </button>
          {energyOpen && (
            <div className="mt-3 grid grid-cols-2 gap-4 pl-3 border-l-2 border-gray-100">
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">Fuel gas flow tag</label>
                <input value={fuelTag} placeholder="e.g. FIG_4501_FG_FLOW"
                  className={tinp} disabled={disabled}
                  onChange={e => { setFuelTag(e.target.value); setSaveOk(false) }} />
              </div>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1">LHV (kJ/kg)</label>
                <input type="number" value={fuelLHV} className={tinp} disabled={disabled}
                  onChange={e => { setFuelLHV(Number(e.target.value)); setSaveOk(false) }} />
              </div>
              <p className="col-span-2 text-[10px] text-gray-400 -mt-2">
                Used to compute thermal efficiency. Leave blank to skip energy balance.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Save */}
      {mode && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleSave}
            disabled={disabled || saving || tags.every(t => !t.tag_name.trim())}
            className="btn-ghost text-sm disabled:opacity-40 disabled:cursor-not-allowed">
            {saving ? 'Saving…' : 'Save Configuration'}
          </button>
          {saveOk && <span className="text-xs text-emerald-600 font-medium">✓ Configuration saved</span>}
          {saveErr && <span className="text-xs text-red-500">{saveErr}</span>}
          {!saveOk && !saveErr && tags.some(t => t.status === 'found') && (
            <span className="text-[10px] text-amber-600">Save to apply changes before starting validation</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Tuning Parameters card ───────────────────────────────────────────────────
function TuningParamsCard({
  params, onChange, disabled, results,
}: {
  params: TuningParams
  onChange: (p: TuningParams) => void
  disabled?: boolean
  results?: Record<string, { result: number | null; sensitivity_used?: number }>
}) {
  const keys = Object.keys(TUNING_DEFAULTS)

  function updateField(key: string, field: keyof TuningParamCfg, value: unknown) {
    onChange({ ...params, [key]: { ...params[key], [field]: value } })
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Tuning Parameters</p>
        <button
          type="button"
          onClick={() => onChange(TUNING_DEFAULTS)}
          disabled={disabled}
          className="text-[10px] text-indigo-600 underline underline-offset-2 disabled:opacity-40"
        >
          Reset to defaults
        </button>
      </div>

      <div className="space-y-3">
        {keys.map(key => {
          const cfg = params[key] ?? TUNING_DEFAULTS[key]
          const meta = TUNING_META[key]
          const res = results?.[key]
          return (
            <div key={key} className="rounded-lg border border-gray-100 px-3 py-2.5">
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={cfg.enabled}
                  disabled={disabled}
                  onChange={e => updateField(key, 'enabled', e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-gray-900 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-800">{meta.label}</span>
                    <span className="text-[10px] text-gray-400">{meta.desc}</span>
                    {res?.result != null && (
                      <span className="ml-auto text-xs font-semibold text-blue-700 tabular-nums">
                        → {res.result >= 0 ? '+' : ''}{res.result} {cfg.unit}
                      </span>
                    )}
                  </div>
                  {cfg.enabled && (
                    <div className="flex gap-3 mt-2 items-center">
                      {(['min','max','step'] as const).map(field => (
                        <label key={field} className="flex items-center gap-1 text-[10px] text-gray-500">
                          {field.charAt(0).toUpperCase() + field.slice(1)}:
                          <input
                            type="number"
                            value={cfg[field] as number}
                            step={field === 'step' ? 'any' : undefined}
                            disabled={disabled}
                            onChange={e => updateField(key, field, parseFloat(e.target.value))}
                            className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-gray-900"
                          />
                          <span className="text-gray-400">{cfg.unit}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ValidationPage() {
  const today = new Date().toISOString().slice(0, 10)
  const d90   = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const d30   = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

  const [activeTab, setActiveTab] = useState<ValidationTab>('design')
  const [tuningParams, setTuningParams] = useState<TuningParams>(TUNING_DEFAULTS)
  const [tuningResults, setTuningResults] = useState<Record<string, { result: number | null; sensitivity_used?: number }>>({})
  const [driftData, setDriftData] = useState<any>(null)

  const [form, setForm] = useState<SetupForm>({
    design_case_id:          '',
    start_date:              d90,
    end_date:                today,
    mb_filter_pct:           '2',
    sample_interval_hrs:     '1',
    recalibration_threshold: '2.0',
  })
  const [phase,       setPhase]       = useState<Phase>('setup')
  const [activeDcId,  setActiveDcId]  = useState<number | null>(null)
  const [startResult, setStartResult] = useState<StartResult | null>(null)
  const [pollData,    setPollData]    = useState<ValidationStatusResponse | null>(null)
  const [biasReport,  setBiasReport]  = useState<ValidationBiasReport | null>(null)
  const [promoted,    setPromoted]    = useState<PromoteResult | null>(null)
  const [busyStart,        setBusyStart]        = useState(false)
  const [busyBias,         setBusyBias]         = useState(false)
  const [busyPromote,      setBusyPromote]      = useState(false)
  const [errMsg,           setErrMsg]           = useState('')
  const [showHow,          setShowHow]          = useState(false)
  const [plantConfigSaved, setPlantConfigSaved] = useState(false)
  const [plantHasFound,    setPlantHasFound]    = useState(false)
  const [designBias,       setDesignBias]       = useState<number | null>(null)

  const handleDesignAccepted = useCallback((bias: number | null) => { setDesignBias(bias) }, [])

  const handlePlantConfigChange = useCallback((saved: boolean, hasFound: boolean) => {
    setPlantConfigSaved(saved)
    setPlantHasFound(hasFound)
  }, [])

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
          validation_mode:     activeTab,
          tuning_params:       tuningParams,
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
      if (json.tuning_results) setTuningResults(json.tuning_results)
      // Fetch drift data for operating tab
      if (activeTab === 'operating' && activeDcId) {
        const drift = await fetch(
          `/api/validation/drift?design_case_id=${activeDcId}&threshold=${form.recalibration_threshold}`
        ).then(r => r.json()).catch(() => null)
        setDriftData(drift)
      }
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
    setPlantConfigSaved(false)
    setPlantHasFound(false)
    setTuningResults({})
    setDriftData(null)
  }

  const f = (k: keyof SetupForm, v: string) => setForm(prev => ({ ...prev, [k]: v }))

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 max-w-4xl">
      {/* How It Works modal */}
      {showHow && <HowItWorksModal onClose={() => setShowHow(false)} />}

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Validation</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Batch-validate a design case against historical DCS data · close energy &amp; material balance · promote to operating case
          </p>
        </div>
        <button
          onClick={() => setShowHow(true)}
          className="shrink-0 flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 border border-gray-200 hover:border-gray-400 rounded-lg px-3 py-1.5 transition-colors"
          title="How validation works"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx={12} cy={12} r={10} />
            <path strokeLinecap="round" d="M12 16v-4m0-4h.01" />
          </svg>
          How it works
        </button>
      </div>

      {/* Tab switcher */}
      {phase === 'setup' && (
        <div className="flex border-b border-gray-200">
          {([
            { key: 'design'    as const, label: 'Design Data Validation',    desc: 'Historical batch · calibrates the model' },
            { key: 'operating' as const, label: 'Operating Data Validation',  desc: 'Recent data · monitors for drift' },
          ] as const).map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key)
                setForm(f => ({
                  ...f,
                  start_date: tab.key === 'operating' ? d30 : d90,
                  end_date:   today,
                }))
              }}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
                activeTab === tab.key
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              {tab.label}
              <span className="block text-[10px] font-normal opacity-60">{tab.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Section 1: Setup ──────────────────────────────────────────────────── */}
      <Section
        title="1 — Setup"
        sub={activeTab === 'design'
          ? 'Calibrate the model against historical plant data. Finds the parameter offsets that best match plant C₂H₄ production over the selected period.'
          : 'Monitor model accuracy against recent plant data. Detects drift and triggers re-calibration when error exceeds threshold.'}
      >
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
              {(activeTab === 'operating'
                ? designCases.filter(dc => dc.verification_status === 'verified')
                : designCases
              ).map(dc => (
                <option key={dc.id} value={dc.id}>{dc.name}</option>
              ))}
            </select>
          </div>

          {/* Stage 1 — Design Case Validation */}
          {form.design_case_id && (
            <div className="col-span-2">
              <DesignValidation
                designCaseId={Number(form.design_case_id)}
                onAccepted={handleDesignAccepted}
              />
              {designBias != null && (
                <p className="text-[10px] text-blue-600 mt-1.5">
                  Design bias {designBias > 0 ? '+' : ''}{designBias} °C will be added to DCS COT when Stage 2 plant validation runs.
                </p>
              )}
            </div>
          )}

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

          {/* ── Plant Data Configuration — shown when a design case is selected ── */}
          {form.design_case_id && (
            <PlantDataConfig
              designCaseId={Number(form.design_case_id)}
              disabled={phase === 'running'}
              onConfigChange={handlePlantConfigChange}
            />
          )}

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

          {/* Operating-only: recalibration threshold */}
          {activeTab === 'operating' && (
            <div className="col-span-2">
              <label className={lbl}>Re-calibration Threshold</label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">Trigger re-tuning if C₂H₄ error exceeds ±</span>
                <input
                  type="number"
                  min={0.5} max={10} step={0.5}
                  value={form.recalibration_threshold}
                  onChange={e => f('recalibration_threshold', e.target.value)}
                  disabled={phase === 'running'}
                  className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </div>
          )}

        </div>

        {/* Tuning Parameters */}
        <TuningParamsCard
          params={tuningParams}
          onChange={setTuningParams}
          disabled={phase === 'running'}
          results={Object.keys(tuningResults).length > 0 ? tuningResults : undefined}
        />

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

        {form.design_case_id && !plantConfigSaved && (
          <p className="text-[11px] text-amber-600">
            ⚠ Save plant data configuration above before starting — COT bias cannot be computed without it.
          </p>
        )}
        {form.design_case_id && plantConfigSaved && !plantHasFound && (
          <p className="text-[11px] text-amber-600">
            ⚠ At least one plant tag must show "Found" in historian before starting.
          </p>
        )}
        <button
          onClick={handleStart}
          disabled={busyStart || phase === 'running' || !form.design_case_id || !plantConfigSaved || !plantHasFound}
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
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Recommended Calibration Parameters
                    </p>
                    {biasReport.plant_data_mode && (
                      <span className="text-[10px] text-gray-400 bg-white border border-gray-200 rounded px-2 py-0.5">
                        {biasReport.plant_data_mode === 'header' && 'Combined header mode'}
                        {biasReport.plant_data_mode === 'per_furnace' && 'Per-furnace mode'}
                        {biasReport.plant_data_mode === 'per_pass' && 'Per-pass mode'}
                      </span>
                    )}
                  </div>

                  {biasReport.recommended_cot_bias != null ? (
                    <div className="space-y-3">
                      {/* Multi-parameter tuning table */}
                      {Object.keys(tuningResults).length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-white/60">
                              <tr className="text-gray-500 uppercase tracking-wider text-[10px]">
                                <th className="text-left py-1 pr-4">Parameter</th>
                                <th className="text-right py-1 px-2">Before</th>
                                <th className="text-right py-1 px-2">After (recommended)</th>
                                <th className="text-right py-1 px-2">Sensitivity</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-blue-100">
                              {Object.entries(tuningResults)
                                .filter(([, r]) => r.result != null)
                                .map(([key, r]) => {
                                  const cfg = tuningParams[key] ?? TUNING_DEFAULTS[key]
                                  const meta = TUNING_META[key]
                                  const sensLabel = key === 'cot_bias'    ? `${r.sensitivity_used} wt%/°C`
                                                  : key === 'cip_bias'    ? `${r.sensitivity_used} wt%/atm`
                                                  : key === 'flux_mult'   ? `${r.sensitivity_used} wt%/0.1`
                                                  : key === 'adiabatic_l' ? `${r.sensitivity_used} wt%/m`
                                                  : key === 'shc_bias'    ? `${r.sensitivity_used} wt%/0.01`
                                                  : '—'
                                  return (
                                    <tr key={key}>
                                      <td className="py-1.5 pr-4 font-medium text-gray-800">{meta.label}</td>
                                      <td className="py-1.5 px-2 text-right text-gray-400">—</td>
                                      <td className="py-1.5 px-2 text-right font-semibold text-blue-800 tabular-nums">
                                        {(r.result ?? 0) >= 0 ? '+' : ''}{r.result} {cfg.unit}
                                      </td>
                                      <td className="py-1.5 px-2 text-right text-gray-400 tabular-nums">{sensLabel}</td>
                                    </tr>
                                  )
                                })}
                              <tr className="border-t border-blue-200 font-semibold">
                                <td className="py-1.5 pr-4 text-gray-700">C₂H₄ error</td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-red-700">
                                  {biasReport.c2h4_error_before_bias != null
                                    ? `${biasReport.c2h4_error_before_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_before_bias.toFixed(2)}%` : '—'}
                                </td>
                                <td className="py-1.5 px-2 text-right tabular-nums text-emerald-700">
                                  {biasReport.c2h4_error_after_bias != null
                                    ? `${biasReport.c2h4_error_after_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_after_bias.toFixed(2)}% (est.)` : '—'}
                                </td>
                                <td />
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        /* Fallback: legacy single COT bias display */
                        <div className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
                          <div>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">COT Bias</p>
                            <p className="text-2xl font-bold text-blue-800 tabular-nums">
                              {biasReport.recommended_cot_bias >= 0 ? '+' : ''}{biasReport.recommended_cot_bias.toFixed(1)} °C
                            </p>
                            <p className="text-[10px] text-gray-400 mt-0.5">Add to DCS COT before each hourly CoilSim run</p>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wide">C₂H₄ error before bias</p>
                              <p className={`text-sm font-semibold tabular-nums ${biasReport.c2h4_error_before_bias != null && Math.abs(biasReport.c2h4_error_before_bias) > 5 ? 'text-red-700' : 'text-gray-800'}`}>
                                {biasReport.c2h4_error_before_bias != null ? `${biasReport.c2h4_error_before_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_before_bias.toFixed(2)}%` : '—'}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] text-gray-500 uppercase tracking-wide">C₂H₄ error after bias (est.)</p>
                              <p className="text-sm font-semibold text-emerald-700 tabular-nums">
                                {biasReport.c2h4_error_after_bias != null ? `${biasReport.c2h4_error_after_bias >= 0 ? '+' : ''}${biasReport.c2h4_error_after_bias.toFixed(2)}%` : '—'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-x-10 text-sm">
                      {/* Per-furnace bias note based on mode */}
                      <div className="col-span-2 pt-1 border-t border-blue-100">
                        {biasReport.plant_data_mode === 'header' ? (
                          <p className="text-[10px] text-gray-500">
                            ℹ Per-furnace bias not available — header mode computes global COT bias only.
                          </p>
                        ) : biasReport.per_furnace_bias_availability === 'computed' ? (
                          <p className="text-[10px] text-gray-500">
                            Per-furnace residual bias — see table below (3c).
                          </p>
                        ) : (
                          <p className="text-[10px] text-gray-500">
                            ℹ Per-furnace bias: no plant data matched — tags may not have historian values in this date range.
                          </p>
                        )}
                      </div>
                    </div>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-800">
                      COT bias cannot be computed — plant C₂H₄ yield data not available.
                      Configure plant yield tags in Section 1 and ensure at least one tag is found in the historian.
                    </p>
                  )}
                </div>

                {/* Drift panel — operating mode only */}
                {activeTab === 'operating' && driftData && (
                  <div className={`rounded-xl border-2 p-5 ${
                    driftData.exceeds_threshold
                      ? 'border-amber-300 bg-amber-50'
                      : 'border-emerald-200 bg-emerald-50'
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-800">Model Drift Monitor</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Monthly C₂H₄ error trend vs {driftData.threshold}% recalibration threshold
                        </p>
                      </div>
                      {driftData.exceeds_threshold ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-3 py-1">
                          ⚠ Recalibration Recommended
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 border border-emerald-200 rounded-full px-3 py-1">
                          ✓ Within Threshold
                        </span>
                      )}
                    </div>

                    {/* Monthly error sparkline table */}
                    {driftData.monthly_errors.length > 0 ? (
                      <div className="overflow-x-auto mb-4">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500 uppercase tracking-wider text-[10px]">
                            <tr>
                              {driftData.monthly_errors.map((m: {month: string; error_pct: number | null}) => (
                                <th key={m.month} className="pb-1 text-center font-medium">{m.month}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {driftData.monthly_errors.map((m: {month: string; error_pct: number | null}) => (
                                <td key={m.month} className={`text-center tabular-nums font-semibold ${
                                  m.error_pct == null ? 'text-gray-300'
                                  : Math.abs(m.error_pct) > driftData.threshold ? 'text-red-700'
                                  : Math.abs(m.error_pct) > driftData.threshold * 0.7 ? 'text-amber-700'
                                  : 'text-emerald-700'
                                }`}>
                                  {m.error_pct != null
                                    ? `${m.error_pct >= 0 ? '+' : ''}${m.error_pct.toFixed(1)}%`
                                    : '—'}
                                </td>
                              ))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-500 mb-4">No historical validation data found in the last 6 months.</p>
                    )}

                    {/* Previous calibration info */}
                    {driftData.previous_calibration?.date && (
                      <p className="text-[11px] text-gray-500 mb-3">
                        Last calibration: {new Date(driftData.previous_calibration.date).toLocaleDateString()}
                        {driftData.previous_calibration.cot_bias != null
                          ? ` — COT bias ${driftData.previous_calibration.cot_bias >= 0 ? '+' : ''}${driftData.previous_calibration.cot_bias.toFixed(1)} °C`
                          : ''}
                      </p>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={handlePromote}
                        disabled={busyPromote || phase === 'promoted'}
                        className="flex-1 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold hover:bg-blue-800 disabled:opacity-50 transition-colors"
                      >
                        {busyPromote ? 'Applying…' : 'Apply Recommended Parameters'}
                      </button>
                      <button
                        onClick={handleRetry}
                        className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-xs font-semibold hover:bg-gray-50 transition-colors"
                      >
                        Keep Current
                      </button>
                    </div>
                  </div>
                )}

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
