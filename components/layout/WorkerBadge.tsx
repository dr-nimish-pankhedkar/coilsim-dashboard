'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function WorkerBadge() {
  const { data } = useSWR('/api/heartbeat', fetcher, { refreshInterval: 15000 })

  const pulse: string | null = data?.last_pulse ?? null
  const online = pulse
    ? Date.now() - new Date(pulse).getTime() < 2 * 60 * 1000
    : false

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span
        className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-gray-300'}`}
        style={online ? { boxShadow: '0 0 0 3px #d1fae5' } : {}}
      />
      <span>
        {online
          ? `Worker online · ${new Date(pulse!).toLocaleTimeString()}`
          : 'Worker offline'}
      </span>
    </div>
  )
}
