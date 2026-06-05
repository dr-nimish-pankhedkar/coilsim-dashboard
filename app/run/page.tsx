'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { CoilGeometry, FeedstockDefinition, LegDefinition, ComponentDefinition } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const COIL_TYPES: Record<number, string> = { 2: 'Millisecond', 3: 'U-coil', 4: 'W-coil', 5: 'SRT-I' }

const KNOWN_COMPONENTS: Record<number, string> = {
  1: 'H₂', 2: 'CH₄', 4: 'C₂H₄', 5: 'C₂H₆', 8: 'C₃H₆', 9: 'C₃H₈',
}

// ── Shared input styles ──────────────────────────────────────────────────────
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'
const sel = inp + ' bg-white'

// ── Section wrapper ──────────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</p>
      {children}
    </div>
  )
}

// ── Hourly Run Tab ───────────────────────────────────────────────────────────
function HourlyRunTab() {
  const [cot, setCot]   = useState('')
  const [flow, setFlow] = useState('')
  const [state, setState] = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [msg, setMsg] = useState('')

  async function submit() {
    if (!cot || !flow) { setMsg('Enter both COT and Flow rate.'); setState('err'); return }
    setState('loading')
    const res = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'hourly', cot: Number(cot), flow: Number(flow) }) })
    const json = await res.json()
    if (!res.ok) { setState('err'); setMsg(json.error ?? 'Failed'); return }
    setState('ok'); setMsg(`Task #${json.id} queued successfully.`); setCot(''); setFlow('')
  }

  return (
    <div className="space-y-5 max-w-sm">
      <p className="text-sm text-gray-500">Queue a simulation run using current exp.txt geometry and feedstock. Only operating conditions are changed.</p>
      <Section title="Operating Conditions">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">COT (°C)</label>
            <input type="number" value={cot} onChange={e => { setCot(e.target.value); setState('idle') }} placeholder="e.g. 837" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Flow Rate (kg/h)</label>
            <input type="number" value={flow} onChange={e => { setFlow(e.target.value); setState('idle') }} placeholder="e.g. 1298" className={inp} />
          </div>
        </div>
      </Section>
      <button onClick={submit} disabled={state === 'loading'} className="btn-primary w-full">
        {state === 'loading' ? 'Submitting…' : 'Queue Hourly Run'}
      </button>
      {state === 'ok'  && <p className="text-sm text-emerald-600">{msg}</p>}
      {state === 'err' && <p className="text-sm text-red-500">{msg}</p>}
    </div>
  )
}

// ── Fresh Run Tab ────────────────────────────────────────────────────────────
function FreshRunTab() {
  const { data: coils }   = useSWR<CoilGeometry[]>('/api/coil-geometries', fetcher)
  const { data: feeds }   = useSWR<FeedstockDefinition[]>('/api/feedstock-definitions', fetcher)
  const [mode, setMode]   = useState<'new'|'saved'>('new')

  // Saved mode
  const [savedCoilId, setSavedCoilId] = useState('')
  const [savedFeedId, setSavedFeedId] = useState('')

  // New coil
  const [coilName,  setCoilName]  = useState('')
  const [ncoil,     setNcoil]     = useState<number>(4)
  const [passes,    setPasses]    = useState(4)
  const [legs, setLegs] = useState<LegDefinition[]>(
    Array.from({ length: 4 }, () => ({ length: 14, diameter: 0.09, wall_thickness: 0.007, bend_length: 0.27 }))
  )

  // New feedstock
  const [feedName,  setFeedName]  = useState('')
  const [comps, setComps] = useState<(ComponentDefinition & { _key: number })[]>([
    { _key: 0, component_id: 5, wt_frac: 0.9646, in_conversion: true },
    { _key: 1, component_id: 9, wt_frac: 0.0208, in_conversion: false },
  ])
  const [nextKey, setNextKey] = useState(2)

  // Operating conditions
  const [cot,  setCot]  = useState('')
  const [flow, setFlow] = useState('')
  const [proj, setProj] = useState('')

  const [state, setState] = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [msg,   setMsg]   = useState('')

  // Passes → sync leg rows
  function handlePassesChange(n: number) {
    setPasses(n)
    setLegs(prev => {
      if (n > prev.length) return [...prev, ...Array.from({ length: n - prev.length }, () => ({ length: 14, diameter: 0.09, wall_thickness: 0.007, bend_length: 0.27 }))]
      return prev.slice(0, n)
    })
  }

  function updateLeg(i: number, field: keyof LegDefinition, val: string) {
    setLegs(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: Number(val) } : l))
  }

  function addComp() {
    setComps(prev => [...prev, { _key: nextKey, component_id: 2, wt_frac: 0, in_conversion: false }])
    setNextKey(k => k + 1)
  }

  function removeComp(key: number) {
    setComps(prev => prev.filter(c => c._key !== key))
  }

  function updateComp(key: number, field: string, val: string | boolean) {
    setComps(prev => prev.map(c => c._key === key ? { ...c, [field]: field === 'in_conversion' ? val : (field === 'component_id' ? Number(val) : parseFloat(val as string) || 0) } : c))
  }

  const totalWt = comps.reduce((s, c) => s + (c.wt_frac || 0), 0)
  const wtWarning = Math.abs(totalWt - 1) > 0.0001

  async function submit() {
    setState('loading'); setMsg('')
    try {
      let coil_id: number, feed_id: number

      if (mode === 'saved') {
        if (!savedCoilId || !savedFeedId) { setState('err'); setMsg('Select a saved coil and feedstock.'); return }
        coil_id = Number(savedCoilId)
        feed_id = Number(savedFeedId)
      } else {
        if (!coilName) { setState('err'); setMsg('Enter a coil geometry name.'); return }
        if (!feedName) { setState('err'); setMsg('Enter a feedstock name.'); return }

        // Normalize weights
        const normalised = comps.map(c => ({ ...c, wt_frac: c.wt_frac / totalWt }))

        const [coilRes, feedRes] = await Promise.all([
          fetch('/api/coil-geometries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: coilName, ncoil, legs }) }),
          fetch('/api/feedstock-definitions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: feedName, components: normalised.map(({ _key, ...c }) => c), product_ids: [] }) }),
        ])

        if (!coilRes.ok || !feedRes.ok) { setState('err'); setMsg('Failed to save geometry or feedstock.'); return }
        coil_id = (await coilRes.json()).id
        feed_id = (await feedRes.json()).id
      }

      if (!cot || !flow || !proj) { setState('err'); setMsg('Enter COT, Flow rate and Project name.'); return }

      const runRes = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fresh', coil_id, feed_id, cot: Number(cot), flow: Number(flow), project_name: proj }) })
      const json = await runRes.json()
      if (!runRes.ok) { setState('err'); setMsg(json.error ?? 'Failed'); return }

      setState('ok'); setMsg(`Fresh run task #${json.id} queued.`)
    } catch {
      setState('err'); setMsg('Network error')
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['new', 'saved'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`text-sm px-4 py-1.5 rounded-full border transition-colors ${mode === m ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
            {m === 'new' ? 'Define new geometry & feedstock' : 'Use saved configuration'}
          </button>
        ))}
      </div>

      {mode === 'saved' ? (
        <Section title="Saved Configurations">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Coil Geometry</label>
              <select value={savedCoilId} onChange={e => setSavedCoilId(e.target.value)} className={sel}>
                <option value="">— select —</option>
                {(coils ?? []).map(c => <option key={c.id} value={c.id}>{c.name} ({COIL_TYPES[c.ncoil] ?? c.ncoil})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Feedstock</label>
              <select value={savedFeedId} onChange={e => setSavedFeedId(e.target.value)} className={sel}>
                <option value="">— select —</option>
                {(feeds ?? []).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          </div>
        </Section>
      ) : (
        <>
          {/* ── Coil geometry ── */}
          <Section title="Coil Geometry">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Geometry Name</label>
                <input value={coilName} onChange={e => setCoilName(e.target.value)} placeholder="e.g. YSB_Geo_v1" className={inp} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Coil Type</label>
                <select value={ncoil} onChange={e => setNcoil(Number(e.target.value))} className={sel}>
                  {Object.entries(COIL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Number of Passes</label>
              <input type="number" min={1} max={20} value={passes} onChange={e => handlePassesChange(Number(e.target.value))} className={inp + ' max-w-[100px]'} />
            </div>

            {/* Leg table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left label py-2 pr-3 w-8">Leg</th>
                    <th className="text-left label py-2 pr-3">Length (m)</th>
                    <th className="text-left label py-2 pr-3">Diameter (m)</th>
                    <th className="text-left label py-2 pr-3">Wall (m)</th>
                    <th className="text-left label py-2">Bend (m)</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.map((leg, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3 text-gray-400 font-mono">{i + 1}</td>
                      {(['length', 'diameter', 'wall_thickness', 'bend_length'] as (keyof LegDefinition)[]).map(f => (
                        <td key={f} className="py-1.5 pr-3">
                          <input
                            type="number" step="0.001"
                            value={leg[f] ?? ''}
                            onChange={e => updateLeg(i, f, e.target.value)}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* ── Feedstock ── */}
          <Section title="Feedstock">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Feedstock Name</label>
              <input value={feedName} onChange={e => setFeedName(e.target.value)} placeholder="e.g. Ethane_Rich_v1" className={inp + ' max-w-xs'} />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left label py-2 pr-3">Component ID</th>
                    <th className="text-left label py-2 pr-3">Name</th>
                    <th className="text-left label py-2 pr-3">Wt Fraction</th>
                    <th className="text-left label py-2 pr-3">In Conversion</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map(c => (
                    <tr key={c._key} className="border-b border-gray-50">
                      <td className="py-1.5 pr-3">
                        <input type="number" min={1} value={c.component_id} onChange={e => updateComp(c._key, 'component_id', e.target.value)}
                          className="w-16 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900" />
                      </td>
                      <td className="py-1.5 pr-3 text-gray-400">{KNOWN_COMPONENTS[c.component_id] ?? '—'}</td>
                      <td className="py-1.5 pr-3">
                        <input type="number" step="0.0001" min={0} max={1} value={c.wt_frac} onChange={e => updateComp(c._key, 'wt_frac', e.target.value)}
                          className="w-24 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900" />
                      </td>
                      <td className="py-1.5 pr-3">
                        <input type="checkbox" checked={c.in_conversion} onChange={e => updateComp(c._key, 'in_conversion', e.target.checked)}
                          className="w-4 h-4 rounded" />
                      </td>
                      <td className="py-1.5">
                        <button onClick={() => removeComp(c._key)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-4">
              <button onClick={addComp} className="btn-ghost text-xs">+ Add component</button>
              <span className={`text-xs ${wtWarning ? 'text-amber-500 font-medium' : 'text-gray-400'}`}>
                Σ wt frac = {totalWt.toFixed(4)}
                {wtWarning && '  ⚠ will be normalised to 1.0'}
              </span>
            </div>
          </Section>
        </>
      )}

      {/* ── Operating Conditions (always shown) ── */}
      <Section title="Operating Conditions">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">COT (°C)</label>
            <input type="number" value={cot} onChange={e => { setCot(e.target.value); setState('idle') }} placeholder="837" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Flow Rate (kg/h)</label>
            <input type="number" value={flow} onChange={e => { setFlow(e.target.value); setState('idle') }} placeholder="1298" className={inp} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Project Name</label>
            <input value={proj} onChange={e => { setProj(e.target.value); setState('idle') }} placeholder="YSB_Run_001" className={inp} />
          </div>
        </div>
      </Section>

      <button onClick={submit} disabled={state === 'loading'} className="btn-primary">
        {state === 'loading' ? 'Submitting…' : 'Submit Fresh Run'}
      </button>
      {state === 'ok'  && <p className="text-sm text-emerald-600">{msg}</p>}
      {state === 'err' && <p className="text-sm text-red-500">{msg}</p>}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
const TABS = ['Hourly Run', 'Fresh Run'] as const
type Tab = typeof TABS[number]

export default function RunPage() {
  const [tab, setTab] = useState<Tab>('Hourly Run')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Run Simulation</h1>
        <p className="text-sm text-gray-400 mt-0.5">Submit a new simulation task to the worker queue</p>
      </div>
      <div className="card">
        <div className="flex gap-6 border-b border-gray-100 mb-6">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`pb-3 text-sm ${tab === t ? 'tab-active' : 'tab-inactive'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'Hourly Run' && <HourlyRunTab />}
        {tab === 'Fresh Run'  && <FreshRunTab />}
      </div>
    </div>
  )
}
