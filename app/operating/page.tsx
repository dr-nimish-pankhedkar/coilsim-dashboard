'use client'

import { useState } from 'react'
import useSWR from 'swr'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import type { OperatingCoilRow } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

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
            40-coil coke monitoring — auto-refreshes every 30 s
          </p>
        </div>
        <Legend />
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
