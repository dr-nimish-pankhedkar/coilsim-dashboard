'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import type { DashboardData, DesignCase } from '@/lib/types'
import ProcessSchematic from '@/components/dashboard/ProcessSchematic'
import ProductSlateChart from '@/components/dashboard/ProductSlateChart'
import LengthwiseProfileChart from '@/components/dashboard/LengthwiseProfileChart'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const ACTIVE_MODEL_KEY = 'coilsim_active_design_case_id'

function ActiveModelCard() {
  const { data: rawDcs } = useSWR<DesignCase[]>('/api/design-cases', fetcher, { refreshInterval: 60_000 })
  const designCases: DesignCase[] = Array.isArray(rawDcs) ? rawDcs : []

  const [selectedId, setSelectedId] = useState<number | null>(null)

  // Load from DB on mount, fall back to localStorage for instant paint
  useEffect(() => {
    const local = localStorage.getItem(ACTIVE_MODEL_KEY)
    if (local) setSelectedId(Number(local))
    fetch('/api/settings/active-model')
      .then(r => r.json())
      .then(d => {
        if (d.active_design_case_id != null) {
          setSelectedId(d.active_design_case_id)
          localStorage.setItem(ACTIVE_MODEL_KEY, String(d.active_design_case_id))
        }
      })
      .catch(() => {})
  }, [])

  function handleChange(val: string) {
    const id = val ? Number(val) : null
    setSelectedId(id)
    if (id != null) localStorage.setItem(ACTIVE_MODEL_KEY, String(id))
    else localStorage.removeItem(ACTIVE_MODEL_KEY)
    // Persist to DB so worker picks it up for tasks without an explicit project_name
    fetch('/api/settings/active-model', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    }).catch(() => {})
  }

  const selected = designCases.find(d => d.id === selectedId)

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="label">Active Model</p>
        {selected && (
          <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">
            ACTIVE
          </span>
        )}
      </div>
      <select
        value={selectedId ?? ''}
        onChange={e => handleChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
      >
        <option value="">— template / config default —</option>
        {designCases.map(dc => (
          <option key={dc.id} value={dc.id}>{dc.name}</option>
        ))}
      </select>
      {selected && (
        <p className="text-xs text-gray-400 font-mono truncate">{selected.project_name}</p>
      )}
      {!selected && designCases.length === 0 && (
        <p className="text-xs text-amber-600">No design cases yet — build one in the wizard.</p>
      )}
    </div>
  )
}

function KpiCard({ label, value, unit, accent }: {
  label: string; value: string; unit?: string; accent?: string
}) {
  return (
    <div className="card flex flex-col gap-1.5">
      <p className="label">{label}</p>
      <p className="text-2xl font-semibold tabular-nums" style={{ color: accent ?? '#111827' }}>
        {value}
        {unit && <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>}
      </p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Completed: 'bg-emerald-50 text-emerald-700',
    Processing: 'bg-blue-50 text-blue-700',
    Pending:    'bg-amber-50 text-amber-700',
    Failed:     'bg-red-50 text-red-700',
  }
  return (
    <div className="card flex flex-col gap-1.5">
      <p className="label">Status</p>
      <span className={`self-start text-sm font-semibold px-3 py-1 rounded-full ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    </div>
  )
}

export default function DashboardPage() {
  const { data, isLoading, error } = useSWR<DashboardData>('/api/dashboard', fetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-gray-400">
        Loading…
      </div>
    )
  }

  if (error || !data?.task) {
    return (
      <div className="card text-sm text-gray-400 text-center py-20">
        {error ? 'Database connection error.' : 'Awaiting first simulation run.'}
      </div>
    )
  }

  const { task, profiles, yields } = data
  const ts = task.completed_at
    ? new Date(task.completed_at).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—'

  return (
    <div className="space-y-5 max-w-6xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Live Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Run <span className="font-mono">#{task.id}</span> · Last updated {ts}
          </p>
        </div>
        <span className="text-xs text-gray-400 bg-white border border-gray-100 px-3 py-1.5 rounded-full shadow-sm">
          ↻ Auto-refresh 30s
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Run ID"  value={`#${task.id}`} />
        <StatusBadge status={task.status} />
        <KpiCard label="COT"     value={task.cot_input  != null ? task.cot_input.toFixed(1)  : '—'} unit="°C"   accent="#d32f2f" />
        <KpiCard label="HC Feed" value={task.flow_input != null ? task.flow_input.toFixed(0) : '—'} unit="kg/h" accent="#1976d2" />
        <ActiveModelCard />
      </div>

      {/* Schematic + Profile side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ProcessSchematic cot={task.cot_input} flow={task.flow_input} />
        <LengthwiseProfileChart profiles={profiles} />
      </div>

      {/* Product Slate full width */}
      <ProductSlateChart yields={yields} />
    </div>
  )
}
