'use client'

import useSWR from 'swr'
import type { DashboardData } from '@/lib/types'
import ProcessSchematic from '@/components/dashboard/ProcessSchematic'
import ProductSlateChart from '@/components/dashboard/ProductSlateChart'
import LengthwiseProfileChart from '@/components/dashboard/LengthwiseProfileChart'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function StatCard({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="card">
      <p className="label mb-2">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 tabular-nums">
        {value}
        {unit && <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>}
      </p>
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
        Loading...
      </div>
    )
  }

  if (error || !data?.task) {
    return (
      <div className="card text-sm text-gray-400 text-center py-16">
        {error ? 'Database connection error.' : 'Awaiting first completed simulation run.'}
      </div>
    )
  }

  const { task, profiles, yields } = data
  const ts = task.completed_at
    ? new Date(task.completed_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Live Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">Run #{task.id} · Last updated {ts}</p>
        </div>
        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
          Auto-refresh 30s
        </span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Run ID" value={`#${task.id}`} />
        <StatCard label="Status" value={task.status} />
        <StatCard label="COT" value={task.cot_input != null ? task.cot_input.toFixed(1) : '—'} unit="°C" />
        <StatCard label="HC Feed" value={task.flow_input != null ? task.flow_input.toFixed(0) : '—'} unit="kg/h" />
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProcessSchematic cot={task.cot_input} flow={task.flow_input} />
        <LengthwiseProfileChart profiles={profiles} />
      </div>

      <ProductSlateChart yields={yields} />
    </div>
  )
}
