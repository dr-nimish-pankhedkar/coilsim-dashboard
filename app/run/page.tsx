'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { CoilGeometry, FeedstockDefinition } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── CoilSim constants (from manual Chapter 3) ────────────────────────────────
const COIL_TYPES: Record<number, string> = {
  2:  'Millisecond',
  3:  'U-coil',
  4:  'W-coil',
  5:  'SRT-I',
  6:  'SRT-II / SRT-III',
  7:  'SRT-IV',
  8:  'Technip GK-I',
  9:  'Technip GK-VI',
  10: 'Linde Pyrocrack',
  12: 'SRT-VI',
  13: 'SL-2',
  14: 'M-coil',
}

const SEVERITY_OPTIONS = [
  { value: 1,  label: 'COT — Coil Outlet Temperature (°C)' },
  { value: 2,  label: 'P/E — Propylene / Ethylene ratio' },
  { value: 3,  label: 'M/P — Methane / Propylene ratio' },
  { value: 4,  label: 'Ethane conversion' },
  { value: 5,  label: 'Propane conversion' },
  { value: 6,  label: 'n-Butane conversion' },
  { value: 10, label: 'Ethylene production (kg/h)' },
]

const FLUX_PROFILES = [
  { value: 1, label: 'Linear' },
  { value: 2, label: 'Sinusoidal' },
  { value: 3, label: 'Uniform' },
  { value: 5, label: 'Long flame' },
]

// Component list from thermochemistry.i (Table 4.1, manual p.132)
// { id, name, formula, group }
const COMPONENTS = [
  // Light gases
  { id: 1,   name: 'Hydrogen',        formula: 'H₂',         group: 'Light gases' },
  { id: 2,   name: 'Methane',         formula: 'CH₄',        group: 'Light gases' },
  // Olefins
  { id: 4,   name: 'Ethylene',        formula: 'C₂H₄',       group: 'Olefins' },
  { id: 8,   name: 'Propylene',       formula: 'C₃H₆',       group: 'Olefins' },
  { id: 11,  name: '1-Butene',        formula: 'C₄H₈',       group: 'Olefins' },
  { id: 18,  name: '1,3-Butadiene',   formula: 'C₄H₆',       group: 'Olefins' },
  // Paraffins C2-C4
  { id: 5,   name: 'Ethane',          formula: 'C₂H₆',       group: 'Paraffins C2–C4' },
  { id: 9,   name: 'Propane',         formula: 'C₃H₈',       group: 'Paraffins C2–C4' },
  { id: 15,  name: 'n-Butane',        formula: 'nC₄H₁₀',     group: 'Paraffins C2–C4' },
  { id: 14,  name: 'Isobutane',       formula: 'iC₄H₁₀',     group: 'Paraffins C2–C4' },
  // Paraffins C5
  { id: 29,  name: 'n-Pentane',       formula: 'nC₅H₁₂',     group: 'Paraffins C5' },
  { id: 28,  name: 'Isopentane',      formula: 'iC₅H₁₂',     group: 'Paraffins C5' },
  { id: 27,  name: 'Neopentane',      formula: 'neo-C₅H₁₂',  group: 'Paraffins C5' },
  // Paraffins C6+
  { id: 243, name: 'n-Hexane',        formula: 'nC₆H₁₄',     group: 'Paraffins C6+' },
  { id: 74,  name: '2-Methylpentane', formula: 'iC₆H₁₄',     group: 'Paraffins C6+' },
  { id: 244, name: 'n-Heptane',       formula: 'nC₇H₁₆',     group: 'Paraffins C6+' },
  { id: 245, name: 'n-Octane',        formula: 'nC₈H₁₈',     group: 'Paraffins C6+' },
  { id: 246, name: 'n-Nonane',        formula: 'nC₉H₂₀',     group: 'Paraffins C6+' },
  // Naphthenes
  { id: 38,  name: 'Cyclopentane',    formula: 'cC₅H₁₀',     group: 'Naphthenes' },
  { id: 39,  name: 'Cyclohexane',     formula: 'cC₆H₁₂',     group: 'Naphthenes' },
  { id: 40,  name: 'Methylcyclohexane', formula: 'MCC₆',     group: 'Naphthenes' },
  // Aromatics
  { id: 66,  name: 'Benzene',         formula: 'C₆H₆',       group: 'Aromatics' },
  { id: 67,  name: 'Toluene',         formula: 'C₇H₈',       group: 'Aromatics' },
  { id: 68,  name: 'Ethylbenzene',    formula: 'C₈H₁₀',      group: 'Aromatics' },
  { id: 69,  name: 'o-Xylene',        formula: 'oC₈H₁₀',     group: 'Aromatics' },
]

// Build fast lookup maps
const COMP_BY_ID: Record<number, typeof COMPONENTS[number]> = Object.fromEntries(COMPONENTS.map(c => [c.id, c]))
const COMP_GROUPS = [...new Set(COMPONENTS.map(c => c.group))]

// ── Shared UI styles ─────────────────────────────────────────────────────────
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent bg-white'
const smallInp = 'w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900 bg-white'

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs text-gray-500 mb-1">{children}</label>
}

// ── Leg row type ─────────────────────────────────────────────────────────────
interface LegRow {
  length: number; diameter: number; wall_thickness: number
  bend_length: number; adiabatic: boolean
}

function defaultLeg(): LegRow {
  return { length: 14.0, diameter: 0.09, wall_thickness: 0.007, bend_length: 0.27, adiabatic: false }
}

// ── Comp row type ─────────────────────────────────────────────────────────────
interface CompRow { _key: number; component_id: number; wt_frac: number; in_conversion: boolean }

// ═══════════════════════════════════════════════════════════════════════════════
// Hourly Run
// ═══════════════════════════════════════════════════════════════════════════════
function HourlyRunTab() {
  const [cot,    setCot]    = useState('')
  const [flow,   setFlow]   = useState('')
  const [dilut,  setDilut]  = useState('0.35')
  const [cit,    setCit]    = useState('600')
  const [cip,    setCip]    = useState('1.8')
  const [sevType, setSevType] = useState(1)
  const [profile, setProfile] = useState(3)
  const [state,  setState]  = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [msg,    setMsg]    = useState('')

  async function submit() {
    if (!cot || !flow) { setMsg('COT and Flow rate are required.'); setState('err'); return }
    setState('loading')
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'hourly',
        cot: Number(cot), flow: Number(flow),
        dilution: Number(dilut), cit: Number(cit), cip: Number(cip),
        severity_type: sevType, flux_profile: profile,
      }),
    })
    const json = await res.json()
    if (!res.ok) { setState('err'); setMsg(json.error ?? 'Failed'); return }
    setState('ok'); setMsg(`Task #${json.id} queued successfully.`); setCot(''); setFlow('')
  }

  return (
    <div className="space-y-6 max-w-lg">
      <p className="text-sm text-gray-500">
        Uses existing geometry and feedstock in exp.txt. Only operating conditions are patched before running.
      </p>

      <Section title="Severity Target" hint="Defines what CoilSim shoots to match (exp.txt shooting flag)">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Severity type</Label>
            <select value={sevType} onChange={e => setSevType(Number(e.target.value))} className={inp}>
              {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Target value</Label>
            <input type="number" value={cot} onChange={e => { setCot(e.target.value); setState('idle') }}
              placeholder={sevType === 1 ? '837 °C' : sevType <= 3 ? '0.42' : '0.65 (fraction)'}
              className={inp} />
          </div>
        </div>
      </Section>

      <Section title="Flow Conditions" hint="Per inlet tube — divide by 2 for split coils">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>HC Flow rate (kg/h per tube)</Label>
            <input type="number" value={flow} onChange={e => { setFlow(e.target.value); setState('idle') }}
              placeholder="1298" className={inp} />
          </div>
          <div>
            <Label>Steam dilution (kg/kg HC)</Label>
            <input type="number" step="0.01" value={dilut} onChange={e => setDilut(e.target.value)}
              placeholder="0.35" className={inp} />
            <p className="text-[10px] text-gray-400 mt-0.5">Typical: Ethane 0.3–0.5 · Naphtha 0.5–0.8</p>
          </div>
        </div>
      </Section>

      <Section title="Inlet Conditions">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>CIT — Coil Inlet Temp (°C)</Label>
            <input type="number" value={cit} onChange={e => setCit(e.target.value)} placeholder="600" className={inp} />
          </div>
          <div>
            <Label>CIP — Coil Inlet Pressure (atm)</Label>
            <input type="number" step="0.1" value={cip} onChange={e => setCip(e.target.value)} placeholder="1.8" className={inp} />
          </div>
          <div>
            <Label>Heat flux profile</Label>
            <select value={profile} onChange={e => setProfile(Number(e.target.value))} className={inp}>
              {FLUX_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>
      </Section>

      <button onClick={submit} disabled={state === 'loading'} className="btn-primary">
        {state === 'loading' ? 'Submitting…' : 'Queue Hourly Run →'}
      </button>
      {state === 'ok'  && <p className="text-sm text-emerald-600 font-medium">{msg}</p>}
      {state === 'err' && <p className="text-sm text-red-500">{msg}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fresh Run
// ═══════════════════════════════════════════════════════════════════════════════
function FreshRunTab() {
  const { data: coils } = useSWR<CoilGeometry[]>('/api/coil-geometries', fetcher)
  const { data: feeds } = useSWR<FeedstockDefinition[]>('/api/feedstock-definitions', fetcher)

  const [mode, setMode] = useState<'new'|'saved'>('new')

  // ── Saved mode ────────────────────────────────────────────────────────────
  const [savedCoilId, setSavedCoilId] = useState('')
  const [savedFeedId, setSavedFeedId] = useState('')

  // ── Coil geometry ─────────────────────────────────────────────────────────
  const [coilName,   setCoilName]   = useState('')
  const [ncoil,      setNcoil]      = useState(4)
  const [passes,     setPasses]     = useState(4)
  const [legs, setLegs] = useState<LegRow[]>(Array.from({ length: 4 }, defaultLeg))
  // Adiabatic volume
  const [hasAdvol,   setHasAdvol]   = useState(false)
  const [adVol,      setAdVol]      = useState('1.0')
  const [adDia,      setAdDia]      = useState('0.12')
  const [adWall,     setAdWall]     = useState('0.007')

  function handlePassesChange(n: number) {
    const count = Math.max(1, Math.min(20, n))
    setPasses(count)
    setLegs(prev =>
      count > prev.length
        ? [...prev, ...Array.from({ length: count - prev.length }, defaultLeg)]
        : prev.slice(0, count)
    )
  }

  function updateLeg(i: number, field: keyof LegRow, val: string | boolean) {
    setLegs(prev => prev.map((l, idx) =>
      idx === i ? { ...l, [field]: typeof val === 'boolean' ? val : Number(val) } : l
    ))
  }

  // ── Feedstock ─────────────────────────────────────────────────────────────
  const [feedName, setFeedName] = useState('')
  const [nextKey,  setNextKey]  = useState(2)
  const [comps, setComps] = useState<CompRow[]>([
    { _key: 0, component_id: 5,  wt_frac: 0.9646, in_conversion: true  },
    { _key: 1, component_id: 9,  wt_frac: 0.0208, in_conversion: false },
  ])
  const [productIds, setProductIds] = useState('4 5 8 9 2 1')

  const totalWt = comps.reduce((s, c) => s + (c.wt_frac || 0), 0)
  const wtWarn  = Math.abs(totalWt - 1) > 0.001

  function addComp() {
    setComps(prev => [...prev, { _key: nextKey, component_id: COMPONENTS[0].id, wt_frac: 0, in_conversion: false }])
    setNextKey(k => k + 1)
  }
  function removeComp(key: number) { setComps(prev => prev.filter(c => c._key !== key)) }
  function updateComp(key: number, field: string, val: string | boolean) {
    setComps(prev => prev.map(c => c._key !== key ? c : {
      ...c,
      [field]: field === 'in_conversion' ? val
             : field === 'component_id'  ? Number(val)
             : parseFloat(val as string) || 0,
    }))
  }

  // ── Operating conditions ──────────────────────────────────────────────────
  const [sevType, setSevType] = useState(1)
  const [cot,     setCot]     = useState('')
  const [flow,    setFlow]    = useState('')
  const [dilut,   setDilut]   = useState('0.35')
  const [cit,     setCit]     = useState('600')
  const [cip,     setCip]     = useState('1.8')
  const [profile, setProfile] = useState(3)
  const [proj,    setProj]    = useState('')

  // ── Submit ────────────────────────────────────────────────────────────────
  const [state, setState] = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [msg,   setMsg]   = useState('')

  async function submit() {
    setState('loading'); setMsg('')
    try {
      let coil_id: number, feed_id: number

      if (mode === 'saved') {
        if (!savedCoilId || !savedFeedId) { setState('err'); setMsg('Select both a saved coil and feedstock.'); return }
        coil_id = Number(savedCoilId); feed_id = Number(savedFeedId)
      } else {
        if (!coilName.trim()) { setState('err'); setMsg('Enter a geometry name.'); return }
        if (!feedName.trim()) { setState('err'); setMsg('Enter a feedstock name.'); return }

        const normComps = comps.map(({ _key, ...c }) => ({
          ...c, wt_frac: c.wt_frac / (totalWt || 1),
        }))

        const parsedProductIds = productIds.trim().split(/\s+/).map(Number).filter(Boolean)

        const legsPayload = legs.map(l => ({
          length: l.length, diameter: l.diameter,
          wall_thickness: l.wall_thickness, bend_length: l.bend_length,
        }))

        const advolPayload = hasAdvol
          ? { adiabatic_volume: Number(adVol), adiabatic_diameter: Number(adDia), adiabatic_wall: Number(adWall) }
          : {}

        const [coilRes, feedRes] = await Promise.all([
          fetch('/api/coil-geometries', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: coilName, ncoil, legs: legsPayload, adiabatic_flag: hasAdvol, ...advolPayload }),
          }),
          fetch('/api/feedstock-definitions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: feedName, components: normComps, product_ids: parsedProductIds }),
          }),
        ])

        if (!coilRes.ok || !feedRes.ok) { setState('err'); setMsg('Failed to save geometry or feedstock to DB.'); return }
        coil_id = (await coilRes.json()).id
        feed_id = (await feedRes.json()).id
      }

      if (!cot || !flow || !proj.trim()) {
        setState('err'); setMsg('COT / Flow rate / Project name are all required.'); return
      }

      const runRes = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'fresh', coil_id, feed_id,
          cot: Number(cot), flow: Number(flow),
          dilution: Number(dilut), cit: Number(cit), cip: Number(cip),
          severity_type: sevType, flux_profile: profile,
          project_name: proj.trim(),
        }),
      })
      const json = await runRes.json()
      if (!runRes.ok) { setState('err'); setMsg(json.error ?? 'Failed'); return }
      setState('ok'); setMsg(`Fresh run task #${json.id} queued — project: ${proj}`)
    } catch {
      setState('err'); setMsg('Network error')
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 max-w-3xl">

      {/* Mode toggle */}
      <div className="flex gap-2">
        {(['new', 'saved'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={`text-sm px-4 py-1.5 rounded-full border transition-colors ${
              mode === m ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'
            }`}>
            {m === 'new' ? '+ Define new geometry & feedstock' : '📁 Use saved configuration'}
          </button>
        ))}
      </div>

      {/* ── SAVED MODE ─────────────────────────────────────────────────────── */}
      {mode === 'saved' && (
        <Section title="Saved Configurations">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Coil Geometry</Label>
              <select value={savedCoilId} onChange={e => setSavedCoilId(e.target.value)} className={inp}>
                <option value="">— select —</option>
                {(coils ?? []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}  ({COIL_TYPES[c.ncoil] ?? `ncoil=${c.ncoil}`}, {c.legs?.length ?? '?'} legs)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Feedstock Definition</Label>
              <select value={savedFeedId} onChange={e => setSavedFeedId(e.target.value)} className={inp}>
                <option value="">— select —</option>
                {(feeds ?? []).map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name}  ({f.components?.length ?? '?'} components)
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
      )}

      {/* ── NEW MODE ───────────────────────────────────────────────────────── */}
      {mode === 'new' && (
        <>
          {/* ── 1. Coil Geometry ───────────────────────────────────────────── */}
          <Section title="1 · Coil Geometry" hint="reactor.txt — defines tube dimensions and coil type">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Label>Geometry name (used as folder name)</Label>
                <input value={coilName} onChange={e => setCoilName(e.target.value)}
                  placeholder="YSB_Geo_v1" className={inp} />
              </div>
              <div>
                <Label>Coil type (ncoil)</Label>
                <select value={ncoil} onChange={e => setNcoil(Number(e.target.value))} className={inp}>
                  {Object.entries(COIL_TYPES).map(([k, v]) => (
                    <option key={k} value={k}>{v} (ncoil={k})</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Number of passes */}
            <div className="flex items-center gap-3">
              <div>
                <Label>Number of passes (legs)</Label>
                <input type="number" min={1} max={20} value={passes}
                  onChange={e => handlePassesChange(Number(e.target.value))}
                  className={inp + ' max-w-[100px]'} />
              </div>
              <p className="text-xs text-gray-400 mt-4">
                U-coil → 2 legs · W-coil → 4 legs · SRT-I → 8 legs
              </p>
            </div>

            {/* Leg table */}
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 label w-8">#</th>
                    <th className="text-left px-3 py-2 label">Length (m)</th>
                    <th className="text-left px-3 py-2 label">Int. Dia. (m)</th>
                    <th className="text-left px-3 py-2 label">Wall (m)</th>
                    <th className="text-left px-3 py-2 label">Bend L. (m)</th>
                    <th className="text-left px-3 py-2 label">Adiabatic</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.map((leg, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 text-gray-400 font-mono">{i + 1}</td>
                      {(['length', 'diameter', 'wall_thickness', 'bend_length'] as const).map(f => (
                        <td key={f} className="px-2 py-1.5">
                          <input type="number" step="0.001" value={leg[f]}
                            onChange={e => updateLeg(i, f, e.target.value)}
                            className={smallInp} />
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={leg.adiabatic}
                          onChange={e => updateLeg(i, 'adiabatic', e.target.checked)}
                          className="w-4 h-4 rounded accent-gray-900" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Adiabatic volume */}
            <div className="flex items-start gap-3 pt-1">
              <input type="checkbox" checked={hasAdvol} onChange={e => setHasAdvol(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-gray-900" />
              <div className="flex-1">
                <p className="text-xs font-medium text-gray-700">Adiabatic volume (transfer line)</p>
                {hasAdvol && (
                  <div className="grid grid-cols-3 gap-3 mt-2">
                    <div>
                      <Label>Volume (×10⁻³ m³)</Label>
                      <input type="number" step="0.1" value={adVol} onChange={e => setAdVol(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <Label>Diameter (m)</Label>
                      <input type="number" step="0.001" value={adDia} onChange={e => setAdDia(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <Label>Wall thickness (m)</Label>
                      <input type="number" step="0.001" value={adWall} onChange={e => setAdWall(e.target.value)} className={inp} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* ── 2. Feedstock ───────────────────────────────────────────────── */}
          <Section title="2 · Feedstock Definition" hint="nafta.i — molecular composition by weight fraction">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Feedstock name</Label>
                <input value={feedName} onChange={e => setFeedName(e.target.value)}
                  placeholder="Ethane_Rich_v1" className={inp} />
              </div>
              <div>
                <Label>Product IDs (space-separated, from thermochemistry.i)</Label>
                <input value={productIds} onChange={e => setProductIds(e.target.value)}
                  placeholder="4 5 8 9 2 1" className={inp} />
                <p className="text-[10px] text-gray-400 mt-0.5">Common: C₂H₄=4, C₂H₆=5, C₃H₆=8, C₃H₈=9, CH₄=2, H₂=1</p>
              </div>
            </div>

            {/* Component rows */}
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 label w-2/5">Component</th>
                    <th className="text-left px-3 py-2 label w-16">ID</th>
                    <th className="text-left px-3 py-2 label">Weight fraction</th>
                    <th className="text-left px-3 py-2 label">In conversion</th>
                    <th className="px-2 py-2 w-6"></th>
                  </tr>
                </thead>
                <tbody>
                  {comps.map(c => {
                    const info = COMP_BY_ID[c.component_id]
                    return (
                      <tr key={c._key} className="border-t border-gray-50">
                        {/* Name dropdown grouped by chemical family */}
                        <td className="px-2 py-1.5">
                          <select
                            value={c.component_id}
                            onChange={e => updateComp(c._key, 'component_id', e.target.value)}
                            className={smallInp}
                          >
                            {COMP_GROUPS.map(group => (
                              <optgroup key={group} label={group}>
                                {COMPONENTS.filter(x => x.group === group).map(x => (
                                  <option key={x.id} value={x.id}>
                                    {x.name} ({x.formula})
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        {/* Auto-mapped ID (read-only) */}
                        <td className="px-3 py-1.5 font-mono text-gray-400 text-center">
                          {c.component_id}
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" step="0.0001" min={0} max={1} value={c.wt_frac}
                            onChange={e => updateComp(c._key, 'wt_frac', e.target.value)}
                            className={smallInp + ' w-24'} />
                        </td>
                        <td className="px-4 py-1.5">
                          <input type="checkbox" checked={c.in_conversion}
                            onChange={e => updateComp(c._key, 'in_conversion', e.target.checked)}
                            className="w-4 h-4 rounded accent-gray-900" />
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => removeComp(c._key)}
                            className="text-gray-300 hover:text-red-400 text-base leading-none">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Wt fraction total */}
            <div className="flex items-center gap-4">
              <button onClick={addComp} className="btn-ghost text-xs">+ Add component</button>
              <span className={`text-xs font-medium ${wtWarn ? 'text-amber-500' : 'text-emerald-600'}`}>
                Σ = {totalWt.toFixed(4)}
                {wtWarn
                  ? '  ⚠ ≠ 1.0 — will be normalised automatically'
                  : '  ✓'}
              </span>
            </div>
          </Section>
        </>
      )}

      {/* ── 3. Operating Conditions (always shown) ────────────────────────── */}
      <Section title="3 · Operating Conditions" hint="exp.txt — severity target, flow, steam, inlet conditions">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Severity type (shooting flag)</Label>
            <select value={sevType} onChange={e => setSevType(Number(e.target.value))} className={inp}>
              {SEVERITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Target value</Label>
            <input type="number" value={cot} onChange={e => { setCot(e.target.value); setState('idle') }}
              placeholder={sevType === 1 ? '837 °C' : sevType <= 3 ? '0.42' : '0.65'}
              className={inp} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>HC Flow rate (kg/h per tube)</Label>
            <input type="number" value={flow} onChange={e => { setFlow(e.target.value); setState('idle') }}
              placeholder="1298" className={inp} />
            <p className="text-[10px] text-gray-400 mt-0.5">Halve for split coils</p>
          </div>
          <div>
            <Label>Steam dilution (kg/kg HC)</Label>
            <input type="number" step="0.01" value={dilut} onChange={e => setDilut(e.target.value)}
              placeholder="0.35" className={inp} />
          </div>
          <div>
            <Label>Heat flux profile</Label>
            <select value={profile} onChange={e => setProfile(Number(e.target.value))} className={inp}>
              {FLUX_PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>CIT — Coil Inlet Temp (°C)</Label>
            <input type="number" value={cit} onChange={e => setCit(e.target.value)} placeholder="600" className={inp} />
          </div>
          <div>
            <Label>CIP — Coil Inlet Pressure (atm)</Label>
            <input type="number" step="0.1" value={cip} onChange={e => setCip(e.target.value)} placeholder="1.8" className={inp} />
          </div>
          <div>
            <Label>Project name (folder name)</Label>
            <input value={proj} onChange={e => { setProj(e.target.value); setState('idle') }}
              placeholder="YSB_Run_001" className={inp} />
          </div>
        </div>
      </Section>

      <button onClick={submit} disabled={state === 'loading'} className="btn-primary">
        {state === 'loading' ? 'Submitting…' : 'Submit Fresh Run →'}
      </button>
      {state === 'ok'  && <p className="text-sm text-emerald-600 font-medium">{msg}</p>}
      {state === 'err' && <p className="text-sm text-red-500">{msg}</p>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = ['Hourly Run', 'Fresh Run'] as const
type Tab = typeof TABS[number]

export default function RunPage() {
  const [tab, setTab] = useState<Tab>('Hourly Run')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Run Simulation</h1>
        <p className="text-sm text-gray-400 mt-0.5">Submit a task to the CoilSim worker queue</p>
      </div>
      <div className="card">
        <div className="flex gap-6 border-b border-gray-100 mb-6">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`pb-3 text-sm ${tab === t ? 'tab-active' : 'tab-inactive'}`}>
              {t === 'Hourly Run'
                ? '⏱ Hourly Run — patch exp.txt only'
                : '🔬 Fresh Run — full geometry + feedstock'}
            </button>
          ))}
        </div>
        {tab === 'Hourly Run' && <HourlyRunTab />}
        {tab === 'Fresh Run'  && <FreshRunTab />}
      </div>
    </div>
  )
}
