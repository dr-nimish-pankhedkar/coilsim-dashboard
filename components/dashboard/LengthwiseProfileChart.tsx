'use client'

import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer,
} from 'recharts'
import type { ProfileDetail } from '@/lib/types'

interface Props { profiles: ProfileDetail[] }

export default function LengthwiseProfileChart({ profiles }: Props) {
  if (!profiles.length) {
    return (
      <div className="card flex items-center justify-center h-64 text-sm text-gray-400">
        No axial profile data for this run
      </div>
    )
  }

  return (
    <div className="card">
      <p className="label mb-1">Lengthwise Profiles</p>
      <p className="text-xs text-gray-400 mb-4">Simulated — current run</p>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={profiles} margin={{ left: 0, right: 20, top: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="axial_position"
            label={{ value: 'Axial Position [m]', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#9ca3af' }}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#d32f2f' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'T Gas (°C)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#d32f2f' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#1976d2' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Conversion (%)', angle: 90, position: 'insideRight', fontSize: 11, fill: '#1976d2' }}
          />
          <Tooltip
            contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
            formatter={(v: number, name: string) => [v.toFixed(2), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="tgas"
            name="T Gas (°C)"
            stroke="#d32f2f"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="mass_conversion"
            name="Mass Conversion (%)"
            stroke="#1976d2"
            strokeWidth={2.5}
            strokeDasharray="6 3"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
