'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
} from 'recharts'
import type { YieldRecord } from '@/lib/types'

interface Props { yields: YieldRecord[] }

export default function ProductSlateChart({ yields }: Props) {
  const data = [...yields]
    .sort((a, b) => a.yield_value - b.yield_value)
    .slice(-10)

  const max = Math.max(...data.map(d => d.yield_value), 1)

  return (
    <div className="card">
      <p className="label mb-1">Product Slate</p>
      <p className="text-xs text-gray-400 mb-4">Simulated yields — current run</p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40, top: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="component_name"
            width={80}
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v: number) => [`${v.toFixed(2)}%`, 'Yield']}
            contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
          />
          <Bar dataKey="yield_value" radius={[0, 4, 4, 0]}>
            {data.map((entry, i) => {
              const t = entry.yield_value / max
              const r = Math.round(25 + t * (211 - 25))
              const g = Math.round(118 + t * (47 - 118))
              const b = Math.round(210 + t * (47 - 210))
              return <Cell key={i} fill={`rgb(${r},${g},${b})`} />
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
