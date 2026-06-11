'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { SimulationTask, YieldRecord, ProfileDetail, ChannelConfig } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TABS = ['Task Summary', 'Component Yields', 'Axial Profiles'] as const
type Tab = typeof TABS[number]

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    Completed:  'bg-emerald-50 text-emerald-700',
    Processing: 'bg-blue-50 text-blue-700',
    Pending:    'bg-amber-50 text-amber-700',
    Error:      'bg-red-50 text-red-700',
    Failed:     'bg-red-50 text-red-700',
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function TypeBadge({ type }: { type: string | null }) {
  if (!type) return <span className="text-gray-300">—</span>
  const cls =
    type === 'design_case' || type === 'fresh' ? 'bg-purple-50 text-purple-700' :
    type === 'hourly'                           ? 'bg-sky-50   text-sky-700'     :
                                                  'bg-gray-100 text-gray-600'
  const label = (type === 'design_case' || type === 'fresh') ? 'design case' : type
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

function fmt(d: string | null) {
  if (!d) return '—'
  const utc = d.includes('+') || d.endsWith('Z') ? d : d.replace(' ', 'T') + 'Z'
  return new Date(utc).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function TaskSummaryTab() {
  const { data, isLoading, error, mutate } = useSWR<SimulationTask[]>('/api/logs/tasks', fetcher)
  const [deleting, setDeleting] = useState<number | null>(null)

  async function deleteTask(id: number) {
    setDeleting(id)
    await fetch(`/api/logs/tasks/${id}`, { method: 'DELETE' })
    await mutate()
    setDeleting(null)
  }

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  if (error || (data as any)?.error) return <p className="text-sm text-red-400 py-8 text-center">Database connection error — check firewall / env vars.</p>
  if (!data?.length) return <p className="text-sm text-gray-400 py-8 text-center">No tasks found.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            {['ID', 'Type', 'Status', 'Project', 'Created', 'Completed', 'COT (°C)', 'Feed (kg/h)', ''].map(h => (
              <th key={h} className="text-left label py-3 pr-5 whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map(t => (
            <>
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="py-2.5 pr-5 font-mono text-gray-500">#{t.id}</td>
                <td className="py-2.5 pr-5"><TypeBadge type={t.task_type} /></td>
                <td className="py-2.5 pr-5"><StatusBadge status={t.status} /></td>
                <td className="py-2.5 pr-5 text-gray-600 max-w-[120px] truncate" title={t.project_name ?? ''}>{t.project_name ?? '—'}</td>
                <td className="py-2.5 pr-5 text-gray-500 whitespace-nowrap">{fmt(t.created_at)}</td>
                <td className="py-2.5 pr-5 text-gray-500 whitespace-nowrap">{fmt(t.completed_at)}</td>
                <td className="py-2.5 pr-5 tabular-nums">{t.cot_input?.toFixed(1) ?? '—'}</td>
                <td className="py-2.5 pr-5 tabular-nums">{t.flow_input?.toFixed(0) ?? '—'}</td>
                <td className="py-2.5">
                  {(t.status === 'Error' || t.status === 'Failed') && (
                    <button
                      onClick={() => deleteTask(t.id)}
                      disabled={deleting === t.id}
                      className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors px-1"
                      title="Delete this failed task"
                    >
                      {deleting === t.id ? '…' : '✕'}
                    </button>
                  )}
                </td>
              </tr>
              {(t.status === 'Error' || t.status === 'Failed') && t.error_message && (
                <tr key={`${t.id}-err`} className="border-b border-red-50 bg-red-50/40">
                  <td colSpan={9} className="px-3 py-2">
                    <p className="text-xs text-red-700 font-mono break-all">
                      <span className="font-semibold not-italic font-sans mr-2">Error:</span>
                      {t.error_message}
                    </p>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function YieldsTab() {
  const { data, isLoading } = useSWR<YieldRecord[]>('/api/logs/yields', fetcher)
  const [selected, setSelected] = useState<string[]>([])
  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  if (!data?.length) return <p className="text-sm text-gray-400 py-8 text-center">No yields found.</p>

  const components = [...new Set(data.map(d => d.component_name))].sort()
  const filtered = selected.length ? data.filter(d => selected.includes(d.component_name)) : data

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {components.map(c => (
          <button
            key={c}
            onClick={() => setSelected(s => s.includes(c) ? s.filter(x => x !== c) : [...s, c])}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              selected.includes(c) ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}
          >{c}</button>
        ))}
        {selected.length > 0 && (
          <button onClick={() => setSelected([])} className="text-xs text-gray-400 hover:text-gray-700 px-2">Clear</button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {['Run ID', 'Component', 'Yield (%)'].map(h => (
                <th key={h} className="text-left label py-3 pr-6">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((y, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 pr-6 font-mono text-gray-500">#{y.task_id}</td>
                <td className="py-2 pr-6">{y.component_name}</td>
                <td className="py-2 pr-6 tabular-nums">{y.yield_value.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PROFILE_COLS: Array<{
  key: keyof ProfileDetail
  label: string
  fmt: (v: number | null) => string
}> = [
  { key: 'axial_position',  label: 'Axial Pos [m]',  fmt: v => v != null ? v.toFixed(2)  : '—' },
  { key: 'tgas',            label: 'T Gas (°C)',      fmt: v => v != null ? v.toFixed(1)  : '—' },
  { key: 'mass_conversion', label: 'Conversion (%)',  fmt: v => v != null ? v.toFixed(2)  : '—' },
  { key: 'velocity',        label: 'Velocity (m/s)',  fmt: v => v != null ? v.toFixed(2)  : '—' },
  { key: 'pressure',        label: 'Pressure (atm)',  fmt: v => v != null ? v.toFixed(4)  : '—' },
  { key: 'heat_flux',       label: 'Heat Flux (kW/m²)', fmt: v => v != null ? v.toFixed(1) : '—' },
  { key: 'coke_thickness',  label: 'Coke (m)',        fmt: v => v != null ? v.toFixed(6)  : '—' },
]

function ProfilesTab() {
  const { data, isLoading }       = useSWR<ProfileDetail[]>('/api/logs/profiles', fetcher)
  const { data: rawChannels }     = useSWR<ChannelConfig[]>('/api/admin/channel-config', fetcher)

  const enabledOutputKeys = new Set<string>(
    Array.isArray(rawChannels)
      ? rawChannels.filter(c => c.channel_type === 'output' && c.enabled).map(c => c.param_key)
      : ['tgas', 'mass_conversion']
  )

  const visibleCols = PROFILE_COLS.filter(c =>
    c.key === 'axial_position' || enabledOutputKeys.has(c.key as string)
  )

  if (isLoading) return <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
  if (!data?.length) return <p className="text-sm text-gray-400 py-8 text-center">No profile data found.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left label py-3 pr-6">Run ID</th>
            {visibleCols.map(c => (
              <th key={c.key as string} className="text-left label py-3 pr-6 whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-2 pr-6 font-mono text-gray-500">#{p.task_id}</td>
              {visibleCols.map(c => (
                <td key={c.key as string} className="py-2 pr-6 tabular-nums">
                  {c.fmt(p[c.key] as number | null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function LogsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Task Summary')
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Simulation Logs</h1>
      <div className="card">
        <div className="flex gap-6 border-b border-gray-100 mb-6">
          {TABS.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm ${activeTab === tab ? 'tab-active' : 'tab-inactive'}`}>
              {tab}
            </button>
          ))}
        </div>
        {activeTab === 'Task Summary'    && <TaskSummaryTab />}
        {activeTab === 'Component Yields' && <YieldsTab />}
        {activeTab === 'Axial Profiles'  && <ProfilesTab />}
      </div>
    </div>
  )
}
