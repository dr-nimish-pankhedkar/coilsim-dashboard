'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { OperatingCoilRow, DesignCase, ChannelConfig } from '@/lib/types'

const EXTRA_DCS_KEYS = ['steam_dilution', 'cop', 'cit', 'cip'] as const
type ExtraDcsKey = typeof EXTRA_DCS_KEYS[number]
const EXTRA_DCS_FIELD: Record<ExtraDcsKey, { label: string; unit: string; dbKey: string; decimals: number }> = {
  steam_dilution: { label: 'Steam Dilution', unit: 'kg/kg HC', dbKey: 'dilution_ratio', decimals: 4 },
  cop:            { label: 'Coil Outlet Pressure', unit: 'atm',    dbKey: 'cop_input',      decimals: 4 },
  cit:            { label: 'Coil Inlet Temperature', unit: '°C',   dbKey: 'cit_input',      decimals: 2 },
  cip:            { label: 'Coil Inlet Pressure', unit: 'atm',     dbKey: 'cip_input',      decimals: 4 },
}

type DcsRow = {
  id: number
  cot_input: number
  flow_input: number
  dilution_ratio: number | null
  cit_input: number | null
  cip_input: number | null
  cop_input: number | null
  project_name: string | null
  created_at: string
}

const ACTIVE_MODEL_KEY = 'coilsim_active_design_case_id'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white'

function dcsAge(ts: string): string {
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (secs < 60)  return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

// ── DCS live value display ────────────────────────────────────────────────────
function DcsValueBox({ label, unit, value }: { label: string; unit: string; value: number | null }) {
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-blue-700">{label}</span>
        <span className="text-[9px] font-semibold uppercase tracking-widest text-blue-500">{unit}</span>
      </div>
      <p className="text-lg font-bold tabular-nums text-blue-900">
        {value != null ? value : '—'}
      </p>
    </div>
  )
}

// ── Verification badge ───────────────────────────────────────────────────────

type VerifStatus = 'pending' | 'verified' | 'failed'

interface VerifData {
  verification_status: VerifStatus
  verified_at: string | null
  verification_error: string | null
  severity_type: string | null
  severity_nominal: number | null
}

function VerificationBadge({ dc }: { dc: DesignCase }) {
  const isPending = !dc.verification_status || dc.verification_status === 'pending'
  const { data, mutate } = useSWR<VerifData>(
    `/api/design-cases/${dc.id}/verification`,
    fetcher,
    { refreshInterval: isPending ? 15_000 : 0 }
  )
  const [retrying, setRetrying] = useState(false)
  const [errorOpen, setErrorOpen] = useState(false)

  const status: VerifStatus = data?.verification_status ?? dc.verification_status ?? 'pending'

  async function retry() {
    setRetrying(true)
    await fetch(`/api/design-cases/${dc.id}/verification`, { method: 'POST' })
    await mutate()
    setRetrying(false)
  }

  const cfg = {
    pending:  { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700', bg: 'bg-amber-50 border-amber-200', label: 'Verification pending…' },
    verified: { dot: 'bg-emerald-400',             text: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200', label: 'Verified & Ready' },
    failed:   { dot: 'bg-red-400',                 text: 'text-red-700',   bg: 'bg-red-50 border-red-200',   label: 'Verification failed' },
  }[status]

  return (
    <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${cfg.bg}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 font-medium ${cfg.text}`}>
          <span className={`w-2 h-2 rounded-full inline-block ${cfg.dot}`} />
          {cfg.label}
          {status === 'verified' && data?.severity_type && (
            <span className="font-normal opacity-70 ml-1">
              · {data.severity_type.replace(/_/g, ' ')} = {data.severity_nominal?.toFixed(3)}
            </span>
          )}
        </span>
        {status === 'failed' && (
          <div className="flex items-center gap-2">
            <button onClick={() => setErrorOpen(o => !o)} className="underline text-red-600">
              {errorOpen ? 'Hide error' : 'Show error'}
            </button>
            <button
              onClick={retry}
              disabled={retrying}
              className="px-2 py-0.5 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}
      </div>
      {status === 'failed' && errorOpen && data?.verification_error && (
        <p className="mt-1.5 text-red-600 font-mono text-[10px] break-all">
          {data.verification_error}
        </p>
      )}
    </div>
  )
}

// ── Hourly Run panel ──────────────────────────────────────────────────────────
function HourlyRunPanel() {
  const [selectedDcId, setSelectedDcId] = useState<number | null>(null)
  const [state,        setState]        = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [msg,          setMsg]          = useState('')

  const { data: rawDcs }      = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 60_000 })
  const { data: rawChannels } = useSWR<ChannelConfig[]>('/api/admin/channel-config', fetcher, { refreshInterval: 120_000 })
  // Poll DCS live feed every 30 s
  const { data: dcsLive, error: dcsErr } = useSWR<DcsRow>('/api/dcs/latest', fetcher, { refreshInterval: 30_000 })

  const channels: ChannelConfig[] = Array.isArray(rawChannels) ? rawChannels : []
  const designCases: DesignCase[] = Array.isArray(rawDcs) ? rawDcs : []
  const selectedDc = designCases.find(d => d.id === selectedDcId) ?? null

  // Which extra params are configured as DCS?
  const extraDcsKeys = EXTRA_DCS_KEYS.filter(k => {
    const ch = channels.find(c => c.param_key === k)
    return ch?.source === 'dcs' && ch?.enabled
  })

  // Load active model on mount
  useEffect(() => {
    const local = localStorage.getItem(ACTIVE_MODEL_KEY)
    if (local) setSelectedDcId(Number(local))
    fetch('/api/settings/active-model')
      .then(r => r.json())
      .then(d => {
        if (d.active_design_case_id != null) {
          setSelectedDcId(d.active_design_case_id)
          localStorage.setItem(ACTIVE_MODEL_KEY, String(d.active_design_case_id))
        }
      })
      .catch(() => {})
  }, [])

  function handleDcChange(val: string) {
    const id = val ? Number(val) : null
    setSelectedDcId(id)
    if (id != null) localStorage.setItem(ACTIVE_MODEL_KEY, String(id))
    else localStorage.removeItem(ACTIVE_MODEL_KEY)
    fetch('/api/settings/active-model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }

  async function submit() {
    if (!dcsLive) { setMsg('No DCS data available yet.'); setState('err'); return }
    setState('loading')
    const body: Record<string, any> = {
      type:           'hourly',
      cot:            dcsLive.cot_input,
      flow:           dcsLive.flow_input,
      project_name:   selectedDc?.project_name ?? null,
      design_case_id: selectedDcId ?? null,
    }
    // Include all DCS-configured extras from live feed
    for (const k of extraDcsKeys) {
      const dbKey = EXTRA_DCS_FIELD[k].dbKey as keyof DcsRow
      const apiKey: Record<ExtraDcsKey, string> = { steam_dilution: 'dilution', cop: 'cop', cit: 'cit', cip: 'cip' }
      const val = dcsLive[dbKey]
      if (val != null) body[apiKey[k]] = val
    }
    const res = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { setState('err'); setMsg(json.error ?? 'Failed'); return }
    setState('ok'); setMsg(`Task #${json.id} queued.`)
    setTimeout(() => { setState('idle'); setMsg('') }, 4000)
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const hasDcs = dcsLive && !dcsErr && !(dcsLive as any).error
  const dcsStale = hasDcs
    ? (Date.now() - new Date(dcsLive!.created_at).getTime()) > 15 * 60 * 1000  // >15 min old
    : false

  return (
    <div className="card space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Hourly Run</p>
          <p className="text-xs text-gray-400 mt-0.5">Values pulled live from DCS feed · refreshes every 30s</p>
        </div>
        {/* DCS status badge */}
        {hasDcs ? (
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${dcsStale ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dcsStale ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
            {dcsStale ? `STALE · ${dcsAge(dcsLive!.created_at)}` : `LIVE · ${dcsAge(dcsLive!.created_at)}`}
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-400 border border-gray-200">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
            NO FEED
          </div>
        )}
      </div>

      {/* Furnace model */}
      <div>
        <label className={lbl}>Furnace Model</label>
        {designCases.length === 0 ? (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-2.5 text-xs text-amber-700">
            No design cases found — build one in the Design Case wizard first.
          </div>
        ) : (
          <select value={selectedDcId ?? ''} onChange={e => handleDcChange(e.target.value)} className={inp}>
            <option value="">— use default model —</option>
            {designCases.map(dc => (
              <option key={dc.id} value={dc.id}>{dc.name}</option>
            ))}
          </select>
        )}
        {selectedDc && <VerificationBadge dc={selectedDc} />}
      </div>

      {/* DCS live values grid */}
      {hasDcs ? (
        <div className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            DCS Live Values
            {dcsLive?.project_name && (
              <span className="ml-2 font-normal normal-case tracking-normal text-gray-400">
                from <span className="text-gray-600">{dcsLive.project_name}</span>
              </span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <DcsValueBox label="COT Target" unit="°C" value={dcsLive!.cot_input} />
            <DcsValueBox label="HC Feed Flow" unit="kg/h" value={dcsLive!.flow_input} />
            {extraDcsKeys.map(k => {
              const f = EXTRA_DCS_FIELD[k]
              const val = dcsLive![f.dbKey as keyof DcsRow] as number | null
              return <DcsValueBox key={k} label={f.label} unit={f.unit} value={val} />
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-gray-50 border border-dashed border-gray-200 px-4 py-5 text-center space-y-1">
          <p className="text-sm text-gray-400">No DCS data in database yet.</p>
          <p className="text-xs text-gray-300">Start the DCS simulator script to begin feeding live values.</p>
        </div>
      )}

      <div className="flex items-center gap-4 pt-1">
        <button
          onClick={submit}
          disabled={state === 'loading' || !hasDcs}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state === 'loading' ? 'Submitting…' : 'Queue Run with Live Values →'}
        </button>
        {state === 'ok'  && <p className="text-sm text-emerald-600 font-medium">✓ {msg}</p>}
        {state === 'err' && <p className="text-sm text-red-500">{msg}</p>}
      </div>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deltaCls(delta: number | null) {
  if (delta == null) return 'bg-gray-50 border-gray-100 text-gray-400'
  const abs = Math.abs(delta)
  if (abs <= 1)  return 'bg-emerald-50  border-emerald-200 text-emerald-900'
  if (abs <= 3)  return 'bg-amber-50    border-amber-200   text-amber-900'
  return               'bg-red-50      border-red-200     text-red-900'
}

function deltaLabel(delta: number | null) {
  if (delta == null) return '—'
  const sign = delta >= 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)} °C`
}

function fmtTime(ts: string | null) {
  if (!ts) return '—'
  const d = new Date(ts)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function fmtCoke(v: number | null) {
  if (v == null) return '—'
  // Display in mm (input is m)
  return `${(v * 1000).toFixed(3)} mm`
}

// ── Coke trend mini-chart ─────────────────────────────────────────────────────

function CokeTrend({ coil }: { coil: number }) {
  const { data: rawTrend, isLoading } = useSWR(
    `/api/operating-case/coke-trend?coil=${coil}`, fetcher, { refreshInterval: 60_000 }
  )
  const data: { updated_at: string; coke_thickness: number }[] =
    Array.isArray(rawTrend) ? rawTrend : []

  if (isLoading) return <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
  if (!data.length) return <p className="text-xs text-gray-400 py-4 text-center">No coke history yet.</p>

  const chartData = [...data].reverse().map(r => ({
    t: fmtTime(r.updated_at),
    mm: +(r.coke_thickness * 1000).toFixed(4),
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} unit=" mm" width={52} />
        <Tooltip
          contentStyle={{ fontSize: 11, borderRadius: 8 }}
          formatter={(v: number) => [`${v} mm`, 'Coke thickness']}
        />
        <Line type="monotone" dataKey="mm" stroke="#6366f1" strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Coil cell ─────────────────────────────────────────────────────────────────

function CoilCell({ row, onClick, selected }: {
  row: OperatingCoilRow
  onClick: () => void
  selected: boolean
}) {
  const delta = (row.sim_cot != null && row.dcs_cot != null)
    ? row.sim_cot - row.dcs_cot
    : null

  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-all hover:shadow-sm ${
        selected ? 'ring-2 ring-gray-900 ' : ''
      }${deltaCls(delta)}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-gray-500">COIL {row.coil_number}</span>
        {row.task_status === 'Processing' && (
          <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">RUNNING</span>
        )}
      </div>

      {/* COT row */}
      <div className="flex gap-3 text-xs">
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">DCS COT</p>
          <p className="font-semibold tabular-nums">{row.dcs_cot?.toFixed(1) ?? '—'} °C</p>
        </div>
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Sim COT</p>
          <p className="font-semibold tabular-nums">{row.sim_cot?.toFixed(1) ?? '—'} °C</p>
        </div>
        <div>
          <p className="text-[9px] text-gray-400 uppercase tracking-wide">Δ</p>
          <p className="font-bold tabular-nums">{deltaLabel(delta)}</p>
        </div>
      </div>

      {/* Coke + time */}
      <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
        <span>🕯 {fmtCoke(row.coke_thickness)}</span>
        <span>{fmtTime(row.completed_at)}</span>
      </div>
    </button>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
  return (
    <div className="flex gap-4 text-xs text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-emerald-100 border border-emerald-200 inline-block" />
        Δ ≤ 1 °C
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-amber-100 border border-amber-200 inline-block" />
        1–3 °C
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-3 rounded-sm bg-red-100 border border-red-200 inline-block" />
        &gt; 3 °C
      </span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OperatingCasePage() {
  const { data: rawData, isLoading, error } = useSWR(
    '/api/operating-case', fetcher, { refreshInterval: 30_000 }
  )
  const [selected, setSelected] = useState<number | null>(null)

  // Guard: API returns { error } when tables don't exist yet
  const rows: OperatingCoilRow[] = Array.isArray(rawData) ? rawData : []
  const apiError: string | null = rawData?.error ?? null

  // Build full 1-40 grid — fill gaps with empty rows
  const rowMap = new Map(rows.map(r => [r.coil_number, r]))
  const grid: (OperatingCoilRow | null)[] = Array.from({ length: 40 }, (_, i) =>
    rowMap.get(i + 1) ?? null
  )

  const selRow = selected != null ? rowMap.get(selected) : null

  const hasData = rows.length > 0
  const stats = hasData ? {
    running: rows.filter(r => r.task_status === 'Processing').length,
    green:   rows.filter(r => {
      const d = r.sim_cot != null && r.dcs_cot != null ? Math.abs(r.sim_cot - r.dcs_cot) : null
      return d != null && d <= 1
    }).length,
    amber:   rows.filter(r => {
      const d = r.sim_cot != null && r.dcs_cot != null ? Math.abs(r.sim_cot - r.dcs_cot) : null
      return d != null && d > 1 && d <= 3
    }).length,
    red:     rows.filter(r => {
      const d = r.sim_cot != null && r.dcs_cot != null ? Math.abs(r.sim_cot - r.dcs_cot) : null
      return d != null && d > 3
    }).length,
  } : null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Operating Case</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Hourly run submission and 40-coil coke monitoring
          </p>
        </div>
        <Legend />
      </div>

      {/* Hourly Run */}
      <HourlyRunPanel />

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-100" />
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Coil Monitoring</p>
        <div className="flex-1 h-px bg-gray-100" />
      </div>

      {/* Summary pills */}
      {stats && (
        <div className="flex gap-3">
          {[
            { label: 'Running',    val: stats.running, cls: 'bg-blue-50 text-blue-700' },
            { label: 'Good (≤1°)', val: stats.green,   cls: 'bg-emerald-50 text-emerald-700' },
            { label: 'Watch (1-3°)',val: stats.amber,  cls: 'bg-amber-50 text-amber-700' },
            { label: 'High (>3°)', val: stats.red,     cls: 'bg-red-50 text-red-700' },
          ].map(s => (
            <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${s.cls}`}>
              <span className="text-base font-bold">{s.val}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main layout: grid + detail panel */}
      <div className="flex gap-5 items-start">

        {/* 40-coil grid — 8 columns × 5 rows */}
        <div className="flex-1 min-w-0">
          {isLoading && (
            <p className="text-sm text-gray-400 py-12 text-center">Loading coil data…</p>
          )}
          {(error || apiError) && (
            <div className="py-8 text-center space-y-1">
              <p className="text-sm text-red-400">
                {apiError
                  ? apiError.includes('does not exist')
                    ? 'DB tables not created yet — run the migration SQL first.'
                    : apiError
                  : 'Failed to load — check DB connection.'}
              </p>
              {apiError?.includes('does not exist') && (
                <p className="text-xs text-gray-400">
                  Need: <code>CREATE TABLE cs_py_int.design_cases</code> and <code>coil_coke_profiles</code>
                </p>
              )}
            </div>
          )}
          {!isLoading && (
            <div className="grid grid-cols-8 gap-2">
              {grid.map((row, i) => {
                const num = i + 1
                if (!row) {
                  return (
                    <div key={num}
                      className="rounded-xl border border-dashed border-gray-150 bg-gray-50 p-3 text-center">
                      <p className="text-[10px] font-bold text-gray-300">COIL {num}</p>
                      <p className="text-[9px] text-gray-300 mt-1">No data</p>
                    </div>
                  )
                }
                return (
                  <CoilCell
                    key={num}
                    row={row}
                    selected={selected === num}
                    onClick={() => setSelected(selected === num ? null : num)}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected != null && (
          <div className="w-72 shrink-0 card space-y-4 sticky top-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Coil {selected} — Detail</h2>
              <button onClick={() => setSelected(null)}
                className="text-gray-300 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            {selRow ? (
              <>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-gray-50">
                    {[
                      ['DCS COT',    `${selRow.dcs_cot?.toFixed(1) ?? '—'} °C`],
                      ['Sim COT',    `${selRow.sim_cot?.toFixed(1) ?? '—'} °C`],
                      ['Δ COT',      (() => {
                        const d = selRow.sim_cot != null && selRow.dcs_cot != null
                          ? selRow.sim_cot - selRow.dcs_cot : null
                        return deltaLabel(d)
                      })()],
                      ['Flow',       `${selRow.flow_input?.toFixed(0) ?? '—'} kg/h`],
                      ['Coke',       fmtCoke(selRow.coke_thickness)],
                      ['Coke updated', fmtTime(selRow.coke_updated_at)],
                      ['Design case', selRow.design_case_name ?? '—'],
                      ['Last run',   fmtTime(selRow.completed_at)],
                      ['Status',     selRow.task_status ?? '—'],
                    ].map(([k, v]) => (
                      <tr key={k as string}>
                        <td className="py-1.5 label pr-3 whitespace-nowrap">{k}</td>
                        <td className="py-1.5 font-medium text-gray-800">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
                    Coke thickness trend
                  </p>
                  <CokeTrend coil={selected} />
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400">No data for this coil yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
