'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import type { ChannelConfig } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Case Parameters Card ─────────────────────────────────────────────────────

const SEVERITY_OPTIONS = [
  { value: 'cot',          label: 'COT — Coil Outlet Temperature' },
  { value: 'pe_ratio',     label: 'P/E ratio' },
  { value: 'mp_ratio',     label: 'M/P ratio' },
  { value: 'ethane_conv',  label: 'Ethane conversion' },
  { value: 'propane_conv', label: 'Propane conversion' },
  { value: 'nbutane_conv', label: 'n-Butane conversion' },
  { value: 'npentane_conv',label: 'n-Pentane conversion' },
  { value: 'nhexane_conv', label: 'n-Hexane conversion' },
  { value: 'yield_max',    label: 'Yield maximum' },
  { value: 'ethylene_yield', label: 'Ethylene yield' },
  { value: 'methane_yield',  label: 'Methane yield' },
  { value: 'conversion',   label: 'Conversion' },
  { value: 'mixture_conv', label: 'Mixture conversion' },
]

const INPUT_OPTIONS = [
  { key: 'cot',  label: 'COT (°C)' },
  { key: 'flow', label: 'HC Flow (kg/h)' },
  { key: 'shc',  label: 'SHC ratio' },
  { key: 'cit',  label: 'CIT (°C)' },
  { key: 'cip',  label: 'CIP (atm)' },
  { key: 'cop',  label: 'COP (atm)' },
]

const KPI_GROUPS = [
  {
    label: 'Light Gases',
    keys: ['H2', 'CH4', 'C2H2', 'C2H4', 'C2H6'],
  },
  {
    label: 'C3 Species',
    keys: ['ProDiene', 'C3H6', 'C3H8', 'CycC3H6'],
  },
  {
    label: 'C4 Species',
    keys: ['1.3-C4H6', '1C4H8', '2C4H8', 'iC4H8', 'nC4H10', 'iC4H10', '13BD'],
  },
  {
    label: 'C5 Species',
    keys: ['C5H6', 'CycC5', 'CycPD', 'iC5H10', 'nC5H10', 'iC5H12', 'nC5H12', 'CyC5H8'],
  },
  {
    label: 'C6+ & Aromatics',
    keys: ['Benzene', 'Toluene', 'EthBenz', 'Xylene', 'Styrene', 'Naphthalene', 'IndDene', 'C9', 'C10Plus', 'CycC6', 'MeCyC5'],
  },
  {
    label: 'Process Outputs',
    keys: ['TMT_max', 'Coil_Heat', 'Pressure_Drop', 'Max_Conversion', 'Max_Coke_Thickness'],
  },
]

const KPI_LABELS: Record<string, string> = {
  'H2':                  'H₂',
  'CH4':                 'CH₄',
  'C2H2':                'C₂H₂ (acetylene)',
  'C2H4':                'C₂H₄ (ethylene)',
  'C2H6':                'C₂H₆ (ethane)',
  'ProDiene':            'Propadiene (C₃H₄)',
  'C3H6':                'C₃H₆ (propylene)',
  'C3H8':                'C₃H₈ (propane)',
  'CycC3H6':             'Cyclopropane',
  '1.3-C4H6':            '1,3-Butadiene',
  '1C4H8':               '1-Butene',
  '2C4H8':               '2-Butene',
  'iC4H8':               'Isobutylene',
  'nC4H10':              'n-Butane',
  'iC4H10':              'Isobutane',
  '13BD':                '1,3-Butadiene (alt)',
  'C5H6':                'Cyclopentadiene',
  'CycC5':               'Cyclopentane',
  'CycPD':               'Cyclopentadiene',
  'iC5H10':              'Isopentene',
  'nC5H10':              'n-Pentene',
  'iC5H12':              'Isopentane',
  'nC5H12':              'n-Pentane',
  'CyC5H8':              'Methylcyclobutane',
  'Benzene':             'Benzene (C₆H₆)',
  'Toluene':             'Toluene',
  'EthBenz':             'Ethylbenzene',
  'Xylene':              'Xylene',
  'Styrene':             'Styrene',
  'Naphthalene':         'Naphthalene',
  'IndDene':             'Indene',
  'C9':                  'C₉ aromatics',
  'C10Plus':             'C₁₀+ heavies',
  'CycC6':               'Cyclohexane',
  'MeCyC5':              'Methylcyclopentane',
  'TMT_max':             'Max TMT (°C)',
  'Coil_Heat':           'Absorbed heat (kJ/hr)',
  'Pressure_Drop':       'Pressure drop (atm)',
  'Max_Conversion':      'Mass conversion (%)',
  'Max_Coke_Thickness':  'Max coke thickness (mm)',
}

const DEFAULT_KPI_OUTPUTS = ['C2H4', 'H2', 'CH4', 'C3H6', 'Benzene', 'TMT_max', 'Coil_Heat']

// ── KPI multi-select combobox ─────────────────────────────────────────────────

function KpiMultiSelect({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggle = (k: string) =>
    onChange(selected.includes(k) ? selected.filter(x => x !== k) : [...selected, k])

  const visible = (keys: string[]) =>
    search
      ? keys.filter(k =>
          k.toLowerCase().includes(search.toLowerCase()) ||
          (KPI_LABELS[k] || '').toLowerCase().includes(search.toLowerCase())
        )
      : keys

  return (
    <div ref={ref} className="relative">
      {/* Trigger chip-box */}
      <div
        onClick={() => setOpen(o => !o)}
        className="min-h-[42px] w-full border border-gray-200 rounded-lg px-3 py-2 flex flex-wrap gap-1.5 cursor-pointer hover:border-gray-400 bg-white"
      >
        {selected.length === 0 && (
          <span className="text-sm text-gray-400 self-center">Select KPI components…</span>
        )}
        {selected.map(k => (
          <span
            key={k}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-xs font-medium"
          >
            {KPI_LABELS[k] ?? k}
            <button
              onClick={e => { e.stopPropagation(); toggle(k) }}
              className="hover:text-blue-600 leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <span className="ml-auto self-center text-gray-400 text-xs pl-2">▾</span>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
            <input
              autoFocus
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded-md outline-none focus:border-gray-400"
              placeholder="Search components…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          {KPI_GROUPS.map(group => {
            const shown = visible(group.keys)
            if (!shown.length) return null
            return (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 border-b border-gray-100 sticky top-[41px]">
                  {group.label}
                </div>
                {shown.map(k => (
                  <label
                    key={k}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(k)}
                      onChange={() => toggle(k)}
                      className="rounded accent-blue-600"
                    />
                    <span className="flex-1 text-sm">{KPI_LABELS[k] ?? k}</span>
                    {KPI_LABELS[k] && (
                      <span className="text-[10px] text-gray-400 font-mono">{k}</span>
                    )}
                  </label>
                ))}
              </div>
            )
          })}
          {KPI_GROUPS.every(g => !visible(g.keys).length) && (
            <div className="px-3 py-4 text-sm text-gray-400 text-center">No components match</div>
          )}
          <div className="p-2 border-t border-gray-100 flex justify-between items-center sticky bottom-0 bg-white">
            <span className="text-xs text-gray-400">{selected.length} selected</span>
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-gray-600 hover:text-gray-900 px-3 py-1 border border-gray-200 rounded-md"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface DesignCase { id: number; name: string; project_name: string }
interface CaseParams {
  severity_type: string
  active_inputs: string[]
  kpi_outputs: string[]
}

function CaseParamsCard({ selectedId }: { selectedId: number }) {
  const [params, setParams] = useState<CaseParams>({
    severity_type: 'cot',
    active_inputs: ['cot', 'flow', 'shc'],
    kpi_outputs: DEFAULT_KPI_OUTPUTS,
  })
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')

  // Load params when design case changes
  const paramsKey = selectedId ? `/api/design-cases/${selectedId}/params` : null
  const { data: loadedParams } = useSWR<CaseParams>(paramsKey, fetcher)

  useEffect(() => {
    if (!loadedParams) return
    setParams({
      severity_type: loadedParams.severity_type ?? 'cot',
      active_inputs: loadedParams.active_inputs ?? ['cot', 'flow', 'shc'],
      kpi_outputs:   loadedParams.kpi_outputs   ?? DEFAULT_KPI_OUTPUTS,
    })
    setDirty(false)
  }, [loadedParams])

  function toggleInput(key: string) {
    setParams(p => ({
      ...p,
      active_inputs: p.active_inputs.includes(key)
        ? p.active_inputs.filter(k => k !== key)
        : [...p.active_inputs, key],
    }))
    setDirty(true)
  }

  async function save() {
    if (!selectedId) return
    setSaveStatus('saving')
    const res = await fetch(`/api/design-cases/${selectedId}/params`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    if (res.ok) {
      setSaveStatus('ok'); setDirty(false)
      setTimeout(() => setSaveStatus('idle'), 2500)
    } else {
      setSaveStatus('err')
    }
  }

  return (
    <div className="card space-y-5">
      {/* Severity type */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Severity input (CoilSim shooting method target)</label>
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              value={params.severity_type}
              onChange={e => { setParams(p => ({ ...p, severity_type: e.target.value })); setDirty(true) }}
            >
              {SEVERITY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              {params.severity_type !== 'cot'
                ? 'Note: COT input field will still appear for reference — the selected target drives the simulation severity.'
                : 'CoilSim iterates COT until the target is matched.'}
            </p>
          </div>

          {/* Active inputs */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Active input parameters</label>
            <div className="flex flex-wrap gap-2">
              {INPUT_OPTIONS.map(({ key, label }) => {
                const active = params.active_inputs.includes(key)
                const required = key === 'cot' || key === 'flow'
                return (
                  <button
                    key={key}
                    disabled={required}
                    onClick={() => toggleInput(key)}
                    title={required ? 'Required — always active' : undefined}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      active
                        ? 'bg-gray-900 border-gray-900 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    } ${required ? 'opacity-60 cursor-default' : ''}`}
                  >
                    {label}
                    {required && <span className="ml-1 text-[9px] opacity-60">required</span>}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Active inputs are shown in the Run wizard and Operating page for this case.</p>
          </div>

          {/* KPI outputs */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">
              Output KPIs — highlighted in results and validation
            </label>
            <KpiMultiSelect
              selected={params.kpi_outputs}
              onChange={kpis => { setParams(p => ({ ...p, kpi_outputs: kpis })); setDirty(true) }}
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Covers all yields.csv components and general_info.csv process outputs. Selected KPIs are shown prominently in validation tables.
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              disabled={!dirty || saveStatus === 'saving'}
              onClick={save}
              className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save case params'}
            </button>
            {saveStatus === 'ok'  && <span className="text-sm text-emerald-600">✓ Saved</span>}
            {saveStatus === 'err' && <span className="text-sm text-red-500">Save failed</span>}
          </div>
    </div>
  )
}

// ── Severity Source card ──────────────────────────────────────────────────────

const SEV_LABELS: Record<string, string> = {
  cot: 'COT (°C)', pe_ratio: 'P/E ratio', mp_ratio: 'M/P ratio',
  ethane_conversion: 'Ethane conversion', propane_conversion: 'Propane conversion',
  nbutane_conversion: 'n-Butane conversion', npentane_conversion: 'n-Pentane conversion',
  nhexane_conversion: 'n-Hexane conversion', yield_maximization: 'Yield maximization',
  ethylene_yield: 'Ethylene yield', methane_yield: 'Methane yield',
  conversion: 'Conversion', mixture_conversion: 'Mixture conversion',
}

interface VerifData {
  verification_status: 'pending' | 'verified' | 'failed' | null
  severity_type: string | null
  severity_nominal: number | null
  case_params: Record<string, unknown>
}

function SeveritySourceCard({ selectedId }: { selectedId: number | null }) {
  const { data: verif, mutate } = useSWR<VerifData>(
    selectedId ? `/api/design-cases/${selectedId}/verification` : null,
    fetcher,
    { refreshInterval: 30_000 }
  )

  const [source, setSource]   = useState<'dcs_tag' | 'calculated' | 'fixed'>('fixed')
  const [tag, setTag]         = useState('')
  const [cotTag, setCotTag]   = useState('')
  const [baseCot, setBaseCot] = useState('840')
  const [sens, setSens]       = useState('0.30')
  const [tagLive, setTagLive] = useState<number | null>(null)
  const [tagStatus, setTagStatus] = useState<'idle' | 'ok' | 'miss'>('idle')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')

  // Populate from case_params when data loads
  useEffect(() => {
    if (!verif?.case_params) return
    const cp = verif.case_params as Record<string, unknown>
    if (cp.severity_source) setSource(cp.severity_source as 'dcs_tag' | 'calculated' | 'fixed')
    if (cp.severity_tag)    setTag(String(cp.severity_tag))
    if (cp.cot_tag)         setCotTag(String(cp.cot_tag))
    if (cp.base_cot)        setBaseCot(String(cp.base_cot))
    if (cp.cot_to_conv_sensitivity) setSens(String(cp.cot_to_conv_sensitivity))
  }, [verif])

  async function checkTag() {
    const res = await fetch(`/api/dcs/check-tag?tag=${encodeURIComponent(tag)}`)
    const j = await res.json()
    if (j.found) { setTagLive(j.latest_value); setTagStatus('ok') }
    else         { setTagLive(null);            setTagStatus('miss') }
  }

  async function save() {
    if (!selectedId) return
    setSaveStatus('saving')
    const body: Record<string, unknown> = { severity_source: source }
    if (source === 'dcs_tag')    body.severity_tag = tag
    if (source === 'calculated') {
      body.cot_tag = cotTag; body.base_cot = Number(baseCot)
      body.cot_to_conv_sensitivity = Number(sens)
    }
    const res = await fetch(`/api/design-cases/${selectedId}/severity-config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) { setSaveStatus('ok'); mutate(); setTimeout(() => setSaveStatus('idle'), 2500) }
    else        { setSaveStatus('err') }
  }

  if (!selectedId) return null

  const sevLabel  = verif?.severity_type ? (SEV_LABELS[verif.severity_type] ?? verif.severity_type) : null
  const isCot     = !verif?.severity_type || verif.severity_type === 'cot'

  const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white'
  const radioBase = 'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors'
  const radioActive = 'border-gray-900 bg-gray-50'
  const radioInactive = 'border-gray-200 hover:border-gray-300'

  return (
    <div className="card space-y-5">
      <div>
        <p className="label">Severity Configuration</p>
        <p className="text-sm text-gray-400 mt-0.5">
          Configure how the severity input is sourced for live hourly runs.
        </p>
      </div>

      {/* Detected severity type */}
      {sevLabel && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 space-y-0.5">
          <p className="text-xs font-medium text-blue-700">
            Severity type from .proj: <span className="font-semibold">{sevLabel}</span>
          </p>
          {verif?.severity_nominal != null && (
            <p className="text-xs text-blue-600">
              Nominal value: <span className="font-semibold">{Number(verif.severity_nominal).toFixed(3)}</span>
              {isCot ? ' °C' : ''}
            </p>
          )}
        </div>
      )}

      <p className="text-xs font-medium text-gray-500">How to source severity for live runs:</p>

      {/* DCS tag */}
      <label className={`${radioBase} ${source === 'dcs_tag' ? radioActive : radioInactive}`}>
        <input type="radio" name="sev_source" value="dcs_tag" checked={source === 'dcs_tag'}
          onChange={() => setSource('dcs_tag')} className="mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-gray-900">From DCS tag</p>
          {source === 'dcs_tag' && (
            <div className="space-y-1.5">
              <div className="flex gap-2">
                <input className={inp} placeholder="e.g. UTD1_Ethane_Conversion_pct"
                  value={tag} onChange={e => { setTag(e.target.value); setTagStatus('idle') }} />
                <button onClick={checkTag}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium hover:border-gray-400 whitespace-nowrap">
                  Check
                </button>
              </div>
              {tagStatus === 'ok'  && (
                <p className="text-xs text-emerald-600">
                  ✓ Found · current value: <span className="font-semibold">{tagLive?.toFixed(4)}</span>
                </p>
              )}
              {tagStatus === 'miss' && (
                <p className="text-xs text-amber-600">
                  ⚠ Tag not found in historian — falls back to nominal on live runs
                </p>
              )}
            </div>
          )}
        </div>
      </label>

      {/* Calculate from COT */}
      <label className={`${radioBase} ${source === 'calculated' ? radioActive : radioInactive}`}>
        <input type="radio" name="sev_source" value="calculated" checked={source === 'calculated'}
          onChange={() => setSource('calculated')} className="mt-0.5" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-gray-900">Calculate from COT tag</p>
          {source === 'calculated' && (
            <div className="space-y-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">COT DCS tag</label>
                <input className={inp} placeholder="e.g. UTD1_COT_degC"
                  value={cotTag} onChange={e => setCotTag(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Base COT (°C)</label>
                  <input className={inp} type="number" value={baseCot}
                    onChange={e => setBaseCot(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Sensitivity (unit/°C)</label>
                  <input className={inp} type="number" step="0.01" value={sens}
                    onChange={e => setSens(e.target.value)} />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">
                severity = nominal + (COT − base_COT) × sensitivity
              </p>
            </div>
          )}
        </div>
      </label>

      {/* Fixed nominal */}
      <label className={`${radioBase} ${source === 'fixed' ? radioActive : radioInactive}`}>
        <input type="radio" name="sev_source" value="fixed" checked={source === 'fixed'}
          onChange={() => setSource('fixed')} className="mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">Use fixed nominal value</p>
          <p className="text-xs text-amber-600 mt-0.5">⚠ Not recommended for live runs — severity will not track plant conditions.</p>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saveStatus === 'saving'}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {saveStatus === 'saving' ? 'Saving…' : 'Save Severity Configuration'}
        </button>
        {saveStatus === 'ok'  && <span className="text-sm text-emerald-600">✓ Saved</span>}
        {saveStatus === 'err' && <span className="text-sm text-red-500">Save failed</span>}
      </div>
    </div>
  )
}

// ── Combined case config section (shared selector → CaseParamsCard + SeveritySourceCard) ─

function CaseConfigSection() {
  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 30_000 })
  const designCases = Array.isArray(rawDcs) ? rawDcs : []
  const [selectedId, setSelectedId] = useState<number | null>(null)

  return (
    <div className="space-y-4">
      {/* Shared design case selector */}
      <div className="card space-y-3">
        <div>
          <p className="label">Case Parameters</p>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure severity input, operating parameters, and output KPIs per design case.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Design case</label>
          <select
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            value={selectedId ?? ''}
            onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— select a design case —</option>
            {designCases.map(dc => (
              <option key={dc.id} value={dc.id}>{dc.name || dc.project_name}</option>
            ))}
          </select>
        </div>
      </div>

      {selectedId && (
        <>
          <CaseParamsCard selectedId={selectedId} />
          <SeveritySourceCard selectedId={selectedId} />
        </>
      )}
    </div>
  )
}

// ── Channel Configuration card ────────────────────────────────────────────────

const FIXED_DCS = new Set(['cot', 'hc_flow'])  // always DCS, not editable

function ChannelConfigCard() {
  const { data, isLoading, mutate } = useSWR<ChannelConfig[]>('/api/admin/channel-config', fetcher)
  const [local, setLocal] = useState<Record<string, Partial<ChannelConfig>>>({})
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [tab, setTab] = useState<'inputs' | 'outputs'>('inputs')
  const [password, setPassword] = useState('')

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (!data || (data as any).error) return (
    <p className="text-sm text-red-500">
      Channel config table not found — run migration 010 first.
    </p>
  )

  const inputs  = data.filter(c => c.channel_type === 'input')
  const outputs = data.filter(c => c.channel_type === 'output')

  function patch(param_key: string, update: Partial<ChannelConfig>) {
    setLocal(prev => ({ ...prev, [param_key]: { ...prev[param_key], ...update } }))
    setSaveStatus('idle')
  }

  function merged(ch: ChannelConfig): ChannelConfig {
    return { ...ch, ...local[ch.param_key] }
  }

  async function save() {
    if (!password) { setSaveStatus('err'); return }
    setSaveStatus('saving')
    const payload = [...inputs, ...outputs].map(ch => ({
      param_key:    ch.param_key,
      enabled:      merged(ch).enabled,
      source:       merged(ch).source,
      static_value: merged(ch).static_value,
    }))
    const res = await fetch('/api/admin/channel-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${password}` },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setSaveStatus('ok')
      setLocal({})
      setPassword('')
      await mutate()
      setTimeout(() => setSaveStatus('idle'), 3000)
    } else {
      setSaveStatus('err')
    }
  }

  const isDirty = Object.keys(local).length > 0
  const lbl = 'block text-xs font-medium text-gray-500 mb-1'

  return (
    <div className="card space-y-5">
      <div>
        <p className="label">Channel Configuration</p>
        <p className="text-sm text-gray-400 mt-0.5">
          Configure which inputs come from the DCS or use a fixed static value, and which output columns to display.
        </p>
      </div>

      {saveStatus === 'ok'  && <p className="text-sm text-emerald-600">✓ Saved.</p>}
      {saveStatus === 'err' && <p className="text-sm text-red-500">{password ? 'Save failed — check password.' : 'Enter admin password to save.'}</p>}

      {/* Tab bar */}
      <div className="flex gap-6 border-b border-gray-100">
        {(['inputs', 'outputs'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2.5 text-sm capitalize ${tab === t ? 'tab-active' : 'tab-inactive'}`}
          >
            {t === 'inputs' ? 'Input Channels' : 'Output Channels'}
          </button>
        ))}
      </div>

      {/* Inputs */}
      {tab === 'inputs' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            <span className="font-medium text-gray-600">DCS</span> — value entered each run on the Operating page.&ensp;
            <span className="font-medium text-gray-600">Static</span> — fixed value applied by the worker every run.
          </p>
          {inputs.map(ch => {
            const m = merged(ch)
            const isFixed = FIXED_DCS.has(ch.param_key)
            return (
              <div key={ch.param_key} className="flex items-center gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                {/* Label */}
                <div className="w-48 shrink-0">
                  <p className="text-sm font-medium text-gray-900">{ch.param_label}</p>
                  <p className="text-xs text-gray-400">{ch.unit}</p>
                </div>

                {/* DCS / Static toggle */}
                {isFixed ? (
                  <span className="text-xs font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full">
                    DCS (fixed)
                  </span>
                ) : (
                  <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs font-medium">
                    {(['dcs', 'static'] as const).map(src => (
                      <button
                        key={src}
                        onClick={() => patch(ch.param_key, { source: src })}
                        className={`px-3 py-1.5 uppercase tracking-wide transition-colors ${
                          m.source === src
                            ? 'bg-gray-900 text-white'
                            : 'bg-white text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {src}
                      </button>
                    ))}
                  </div>
                )}

                {/* Static value input */}
                {!isFixed && m.source === 'static' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      value={m.static_value ?? ''}
                      onChange={e => patch(ch.param_key, { static_value: e.target.value ? Number(e.target.value) : null })}
                      className="w-28 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                      placeholder="value"
                    />
                    <span className="text-xs text-gray-400">{ch.unit}</span>
                  </div>
                )}

                {!isFixed && m.source === 'dcs' && (
                  <span className="text-xs text-gray-400">User enters each run</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Outputs */}
      {tab === 'outputs' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">
            Toggle which axial profile columns appear in the Simulation Logs → Axial Profiles tab.
            Data is always stored; this only controls visibility.
          </p>
          {outputs.map(ch => {
            const m = merged(ch)
            return (
              <label key={ch.param_key}
                className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={e => patch(ch.param_key, { enabled: e.target.checked })}
                  className="w-4 h-4 accent-gray-900"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">{ch.param_label}</p>
                  <p className="text-xs text-gray-400">{ch.unit}</p>
                </div>
              </label>
            )
          })}
        </div>
      )}

      {/* Password + Save */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
        <input
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setSaveStatus('idle') }}
          placeholder="Admin password"
          className="w-48 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        <button
          onClick={save}
          disabled={!isDirty || !password || saveStatus === 'saving'}
          className="btn-primary text-sm disabled:opacity-40"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}

// ── Admin actions ─────────────────────────────────────────────────────────────

export default function ConfigurationPage() {
  const [password,   setPassword]   = useState('')
  const [status,     setStatus]     = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message,    setMessage]    = useState('')

  const [dcPassword, setDcPassword] = useState('')
  const [dcStatus,   setDcStatus]   = useState<'idle' | 'confirm' | 'loading' | 'success' | 'error'>('idle')
  const [dcMessage,  setDcMessage]  = useState('')

  async function handleDeleteDesignCases() {
    setDcStatus('loading')
    try {
      const res = await fetch('/api/admin/delete-design-cases', {
        method: 'POST',
        headers: { Authorization: `Bearer ${dcPassword}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setDcStatus('error')
        setDcMessage(json.error ?? 'Failed')
      } else {
        setDcStatus('success')
        setDcMessage(`Deleted ${json.deleted} dashboard design case(s). Pre-existing .proj models are unchanged.`)
        setDcPassword('')
      }
    } catch {
      setDcStatus('error')
      setDcMessage('Network error')
    }
  }

  async function handleReset() {
    setStatus('loading')
    try {
      const res = await fetch('/api/admin/reset-tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
      })
      const json = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(json.error ?? 'Failed')
      } else {
        setStatus('success')
        setMessage(`Reset ${json.reset} task(s) to Pending.`)
        setPassword('')
      }
    } catch {
      setStatus('error')
      setMessage('Network error')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-gray-900">Configuration</h1>

      {/* Per-case input/output parameters + severity config share a selector */}
      <CaseConfigSection />

      {/* Channel Configuration */}
      <ChannelConfigCard />

      {/* Admin actions */}
      <div className="card space-y-4">
        <p className="label">Admin Actions</p>
        <p className="text-sm text-gray-500">
          Reset tasks stuck in &quot;Processing&quot; or &quot;Error&quot; state back to &quot;Pending&quot; so the worker picks them up again.
        </p>
        <div className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setStatus('idle') }}
            placeholder="Admin password"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
          />
          <button
            onClick={handleReset}
            disabled={!password || status === 'loading'}
            className="btn-primary w-full"
          >
            {status === 'loading' ? 'Resetting…' : 'Reset Processing & Error Tasks'}
          </button>
          {status === 'success' && (
            <p className="text-sm text-emerald-600">{message}</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-red-600">{message}</p>
          )}
        </div>
      </div>

      {/* Delete dashboard design cases */}
      <div className="card space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="label">Delete Dashboard Design Cases</p>
            <p className="text-sm text-gray-500 mt-1">
              Removes all design cases created via the wizard from the DB.
              Pre-existing models registered from <code className="text-xs bg-gray-100 px-1 rounded">.proj</code> files are not affected.
            </p>
          </div>
          <span className="text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 px-2 py-1 rounded-full whitespace-nowrap">Destructive</span>
        </div>

        {dcStatus !== 'confirm' && dcStatus !== 'loading' ? (
          <div className="space-y-3">
            <input
              type="password"
              value={dcPassword}
              onChange={e => { setDcPassword(e.target.value); setDcStatus('idle') }}
              placeholder="Admin password"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              onClick={() => { if (dcPassword) setDcStatus('confirm') }}
              disabled={!dcPassword}
              className="w-full rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm font-medium py-2 hover:bg-red-100 transition-colors disabled:opacity-40"
            >
              Delete Dashboard Design Cases…
            </button>
            {dcStatus === 'success' && <p className="text-sm text-emerald-600">{dcMessage}</p>}
            {dcStatus === 'error'   && <p className="text-sm text-red-600">{dcMessage}</p>}
          </div>
        ) : dcStatus === 'loading' ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 text-center">
            Deleting…
          </div>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-red-700">Are you sure?</p>
            <p className="text-xs text-red-600">
              This will permanently delete all wizard-built design cases from the database.
              The CoilSim project folders on disk are not deleted.
            </p>
            <div className="flex gap-3">
              <button onClick={handleDeleteDesignCases}
                className="flex-1 rounded-lg bg-red-600 text-white text-sm font-semibold py-2 hover:bg-red-700 transition-colors disabled:opacity-60">
                Yes, delete all
              </button>
              <button onClick={() => { setDcStatus('idle'); setDcPassword('') }}
                className="flex-1 rounded-lg border border-gray-200 text-gray-600 text-sm py-2 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
