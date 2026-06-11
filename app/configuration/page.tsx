'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { ChannelConfig } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Channel Configuration card ────────────────────────────────────────────────

const FIXED_DCS = new Set(['cot', 'hc_flow'])  // always DCS, not editable

function ChannelConfigCard() {
  const { data, isLoading, mutate } = useSWR<ChannelConfig[]>('/api/admin/channel-config', fetcher)
  const [local, setLocal] = useState<Record<string, Partial<ChannelConfig>>>({})
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')
  const [tab, setTab] = useState<'inputs' | 'outputs'>('inputs')

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
    setSaveStatus('saving')
    const payload = [...inputs, ...outputs].map(ch => ({
      param_key:    ch.param_key,
      enabled:      merged(ch).enabled,
      source:       merged(ch).source,
      static_value: merged(ch).static_value,
    }))
    const res = await fetch('/api/admin/channel-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setSaveStatus('ok')
      setLocal({})
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
      <div className="flex items-center justify-between">
        <div>
          <p className="label">Channel Configuration</p>
          <p className="text-sm text-gray-400 mt-0.5">
            Configure which inputs come from the DCS or use a fixed static value, and which output columns to display.
          </p>
        </div>
        <button
          onClick={save}
          disabled={!isDirty || saveStatus === 'saving'}
          className="btn-primary text-sm disabled:opacity-40"
        >
          {saveStatus === 'saving' ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {saveStatus === 'ok'  && <p className="text-sm text-emerald-600">✓ Saved.</p>}
      {saveStatus === 'err' && <p className="text-sm text-red-500">Save failed.</p>}

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

      {/* Channel Configuration */}
      <ChannelConfigCard />

      {/* Input mapping — static reference */}
      <div className="card space-y-4">
        <p className="label">Input Assignment — exp.txt</p>
        <p className="text-sm text-gray-500">
          Maps PostgreSQL columns to CoilSim 1D input file rows.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="label mb-1">Row 3</p>
            <p className="text-sm font-medium text-gray-900">COT</p>
            <p className="text-xs text-gray-400 mt-0.5">← cot_input column</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="label mb-1">Row 9</p>
            <p className="text-sm font-medium text-gray-900">HC Flow</p>
            <p className="text-xs text-gray-400 mt-0.5">← flow_input column</p>
          </div>
        </div>
        <p className="text-xs text-gray-400">
          NULL inputs preserve existing exp.txt values on the worker side.
        </p>
      </div>

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
