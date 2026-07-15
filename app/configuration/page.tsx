'use client'

import { useState, useEffect } from 'react'
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

const KPI_OPTIONS = [
  'C2H4', 'H2', 'CH4', 'C2H6', 'C3H6', 'C3H8',
  '1.3-C4H6', 'Benzene', 'Toluene', 'Xylene', 'Styrene',
]

interface DesignCase { id: number; name: string; project_name: string }
interface CaseParams {
  severity_type: string
  active_inputs: string[]
  kpi_outputs: string[]
}

function CaseParamsCard() {
  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 30_000 })
  const designCases = Array.isArray(rawDcs) ? rawDcs : []

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [params, setParams] = useState<CaseParams>({
    severity_type: 'cot',
    active_inputs: ['cot', 'flow', 'shc'],
    kpi_outputs: ['C2H4', 'H2', 'CH4'],
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
      kpi_outputs:   loadedParams.kpi_outputs   ?? ['C2H4', 'H2', 'CH4'],
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

  function toggleKpi(k: string) {
    setParams(p => ({
      ...p,
      kpi_outputs: p.kpi_outputs.includes(k)
        ? p.kpi_outputs.filter(x => x !== k)
        : [...p.kpi_outputs, k],
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
      <div>
        <p className="label">Case Parameters</p>
        <p className="text-sm text-gray-400 mt-0.5">
          Configure which severity input, operating parameters, and output KPIs apply to each design case.
        </p>
      </div>

      {/* Design case selector */}
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Design case</label>
        <select
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
          value={selectedId ?? ''}
          onChange={e => { setSelectedId(e.target.value ? Number(e.target.value) : null); setDirty(false) }}
        >
          <option value="">— select a design case —</option>
          {designCases.map(dc => (
            <option key={dc.id} value={dc.id}>{dc.name || dc.project_name}</option>
          ))}
        </select>
      </div>

      {selectedId && (
        <>
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
            <label className="block text-xs font-medium text-gray-500 mb-2">Output KPIs (highlighted in results and validation)</label>
            <div className="flex flex-wrap gap-2">
              {KPI_OPTIONS.map(k => {
                const active = params.kpi_outputs.includes(k)
                return (
                  <button
                    key={k}
                    onClick={() => toggleKpi(k)}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-gray-400'
                    }`}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">Selected KPIs are shown prominently in yield output and validation tables.</p>
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

      {/* Per-case input/output parameters */}
      <CaseParamsCard />

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
