'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function WorkerBadge() {
  const { data, isLoading } = useSWR('/api/heartbeat', fetcher, { refreshInterval: 15000 })

  const pulse: string | null = data?.last_pulse ?? null

  // Consider worker online if it pulsed within the last 15 minutes
  const online = pulse
    ? Date.now() - new Date(pulse).getTime() < 15 * 60 * 1000
    : false

  const timeStr = pulse
    ? new Date(pulse).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-gray-200 animate-pulse" />
        <span className="text-xs text-gray-400">Checking…</span>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${online ? 'bg-emerald-400' : 'bg-gray-300'}`}
          style={online ? { boxShadow: '0 0 0 3px #d1fae5' } : {}}
        />
        <span className={`text-xs font-medium ${online ? 'text-emerald-600' : 'text-gray-400'}`}>
          {online ? 'Online' : 'Offline'}
        </span>
      </div>
      {timeStr && (
        <p className="text-[11px] text-gray-400 pl-4">{timeStr}</p>
      )}
    </div>
  )
}
