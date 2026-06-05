'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface HeartbeatData {
  alive: boolean
  worker_name: string | null
  last_pulse: string | null
  status_message: string | null
  current_task_id: number | null
  age_seconds: number
}

function dotColor(alive: boolean, status: string | null) {
  if (!alive) return { dot: 'bg-red-400', ring: '#fee2e2', label: 'text-red-500' }
  const s = (status ?? '').toLowerCase()
  if (s.includes('busy') || s.includes('running') || s.includes('processing'))
    return { dot: 'bg-amber-400', ring: '#fef3c7', label: 'text-amber-600' }
  return { dot: 'bg-emerald-400', ring: '#d1fae5', label: 'text-emerald-600' }
}

function formatAge(seconds: number): string {
  if (seconds < 60)   return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

export default function WorkerBadge() {
  const { data, isLoading } = useSWR<HeartbeatData>('/api/heartbeat', fetcher, {
    refreshInterval: 15000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gray-200 animate-pulse" />
        <span className="text-xs text-gray-400">Checking…</span>
      </div>
    )
  }

  const alive = data?.alive ?? false
  const status = data?.status_message ?? null
  const { dot, ring, label } = dotColor(alive, status)

  const statusLabel = !alive
    ? 'Dead'
    : (status ?? 'Online')

  return (
    <div className="space-y-2">
      {/* Status dot + label */}
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${dot}`}
          style={{ boxShadow: `0 0 0 3px ${ring}` }}
        />
        <span className={`text-xs font-semibold ${label}`}>{statusLabel}</span>
      </div>

      {/* Worker name */}
      {data?.worker_name && (
        <p className="text-[11px] text-gray-400 pl-4 leading-tight">{data.worker_name}</p>
      )}

      {/* Last pulse age */}
      {data?.last_pulse && (
        <p className="text-[11px] text-gray-400 pl-4">
          {alive ? `Pulse: ${new Date(data.last_pulse).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : `Last seen: ${formatAge(data.age_seconds)}`}
        </p>
      )}

      {/* Current task if busy */}
      {alive && data?.current_task_id && (
        <p className="text-[11px] text-amber-500 pl-4 font-medium">Task #{data.current_task_id}</p>
      )}
    </div>
  )
}
