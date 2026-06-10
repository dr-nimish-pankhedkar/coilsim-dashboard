'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { CoilGeometry, FeedstockDefinition } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── CoilSim constants ─────────────────────────────────────────────────────────

const COIL_TYPES = [
  { ncoil: 4,  name: 'W-coil',          passes: 4,  desc: 'Most common; 4-pass split coil',     icon: 'W' },
  { ncoil: 3,  name: 'U-coil',          passes: 2,  desc: 'Short residence time, 2-pass',        icon: 'U' },
  { ncoil: 5,  name: 'SRT-I',           passes: 8,  desc: 'Lummus SRT-I, 8-pass',                icon: 'I' },
  { ncoil: 6,  name: 'SRT-II / III',    passes: 8,  desc: 'Lummus SRT-II/III variant',           icon: 'II' },
  { ncoil: 7,  name: 'SRT-IV',          passes: 8,  desc: 'Lummus SRT-IV',                       icon: 'IV' },
  { ncoil: 12, name: 'SRT-VI',          passes: 8,  desc: 'Lummus SRT-VI high-severity',         icon: 'VI' },
  { ncoil: 2,  name: 'Millisecond',     passes: 2,  desc: 'Ultra-short residence time',          icon: 'ms' },
  { ncoil: 8,  name: 'Technip GK-I',   passes: 4,  desc: 'Technip GK series, 4-pass',           icon: 'GK' },
  { ncoil: 9,  name: 'Technip GK-VI',  passes: 4,  desc: 'Technip GK-VI high capacity',         icon: 'GK6'},
  { ncoil: 10, name: 'Linde Pyrocrack',passes: 4,  desc: 'Linde Pyrocrack 1-1/2-4',             icon: 'LC' },
  { ncoil: 13, name: 'SL-2',           passes: 4,  desc: 'Short/Long 2-cell coil',              icon: 'SL' },
  { ncoil: 14, name: 'M-coil',         passes: 4,  desc: 'M-shaped multi-pass coil',            icon: 'M'  },
]

// Severity type values MUST match CoilSim exp.txt shooting_flag integers exactly.
// Confirmed from working model (YSB_Geo_Operating): COT = shooting_flag 2.
// CoilSim reserve value 1 for "specified flux profile / no shooting iteration".
const SEVERITY_OPTIONS = [
  { value: 2,  label: 'COT',                unit: '°C',   placeholder: '845',  desc: 'Coil Outlet Temperature' },
  { value: 3,  label: 'P/E ratio',          unit: '—',    placeholder: '0.42', desc: 'Propylene / Ethylene ratio' },
  { value: 4,  label: 'M/P ratio',          unit: '—',    placeholder: '0.35', desc: 'Methane / Propylene ratio' },
  { value: 5,  label: 'Ethane conv.',       unit: 'frac', placeholder: '0.65', desc: 'Ethane mass conversion fraction' },
  { value: 6,  label: 'Propane conv.',      unit: 'frac', placeholder: '0.92', desc: 'Propane mass conversion fraction' },
  { value: 7,  label: 'n-Butane conv.',     unit: 'frac', placeholder: '0.95', desc: 'n-Butane mass conversion fraction' },
  { value: 8,  label: 'n-Pentane conv.',    unit: 'frac', placeholder: '0.96', desc: 'n-Pentane mass conversion fraction' },
  { value: 9,  label: 'n-Hexane conv.',     unit: 'frac', placeholder: '0.97', desc: 'n-Hexane mass conversion fraction' },
  { value: 10, label: 'Yield max.',         unit: '—',    placeholder: '—',   desc: 'Yield maximization (no target value)' },
  { value: 11, label: 'Ethylene yield',     unit: 'wt%',  placeholder: '50',   desc: 'Ethylene yield wt%' },
  { value: 12, label: 'Methane yield',      unit: 'wt%',  placeholder: '4',    desc: 'Methane yield wt%' },
  { value: 13, label: 'Conversion',         unit: 'frac', placeholder: '0.70', desc: 'Specific component conversion fraction' },
  { value: 14, label: 'Mixture conv.',      unit: 'frac', placeholder: '0.70', desc: 'Mixture conversion fraction' },
]

// Heat flux profile shapes (CoilSim exp.txt row 6: 1=Uniform, 2=Linear, 3=Sinusoidal, 4=Long Flame, 5=Custom)
const FLUX_PROFILES = [
  { value: 1, label: 'Uniform',     desc: 'Constant heat flux along the full coil length' },
  { value: 2, label: 'Linear',      desc: 'Linearly increasing from coil inlet to outlet' },
  { value: 3, label: 'Sinusoidal',  desc: 'Sinusoidal peak near coil mid-section' },
  { value: 4, label: 'Long Flame',  desc: 'High flux near inlet — typical long-flame burners' },
  { value: 5, label: 'Custom',      desc: 'User-defined flux distribution (provide profile file)' },
]

// Piping properties
const TUBE_MATERIALS = [
  '800_800H', '800_800', 'HP_40', 'HK_40', 'Incoloy_825', 'Inconel_600', '304SS', '316SS', 'Custom',
]
const GAS_CONDUCTIVITY_CORRS = ['Modified Eucken', 'Eucken', 'Wassiljewa']
const TUBE_TYPES = ['Smooth circular tube', 'Finned tube', 'Twisted tape insert']

const COMPONENTS = [
  { id: 1,   name: 'Hydrogen',         formula: 'H₂',       group: 'Light gases' },
  { id: 2,   name: 'Methane',          formula: 'CH₄',      group: 'Light gases' },
  { id: 4,   name: 'Ethylene',         formula: 'C₂H₄',     group: 'Olefins' },
  { id: 8,   name: 'Propylene',        formula: 'C₃H₆',     group: 'Olefins' },
  { id: 11,  name: '1-Butene',         formula: 'C₄H₈',     group: 'Olefins' },
  { id: 18,  name: '1,3-Butadiene',    formula: 'C₄H₆',     group: 'Olefins' },
  { id: 5,   name: 'Ethane',           formula: 'C₂H₆',     group: 'Paraffins C2–C4' },
  { id: 9,   name: 'Propane',          formula: 'C₃H₈',     group: 'Paraffins C2–C4' },
  { id: 15,  name: 'n-Butane',         formula: 'nC₄H₁₀',   group: 'Paraffins C2–C4' },
  { id: 14,  name: 'Isobutane',        formula: 'iC₄H₁₀',   group: 'Paraffins C2–C4' },
  { id: 29,  name: 'n-Pentane',        formula: 'nC₅H₁₂',   group: 'Paraffins C5' },
  { id: 28,  name: 'Isopentane',       formula: 'iC₅H₁₂',   group: 'Paraffins C5' },
  { id: 27,  name: 'Neopentane',       formula: 'neo-C₅',    group: 'Paraffins C5' },
  { id: 243, name: 'n-Hexane',         formula: 'nC₆H₁₄',   group: 'Paraffins C6+' },
  { id: 244, name: 'n-Heptane',        formula: 'nC₇H₁₆',   group: 'Paraffins C6+' },
  { id: 245, name: 'n-Octane',         formula: 'nC₈H₁₈',   group: 'Paraffins C6+' },
  { id: 246, name: 'n-Nonane',         formula: 'nC₉H₂₀',   group: 'Paraffins C6+' },
  { id: 38,  name: 'Cyclopentane',     formula: 'cC₅H₁₀',   group: 'Naphthenes' },
  { id: 39,  name: 'Cyclohexane',      formula: 'cC₆H₁₂',   group: 'Naphthenes' },
  { id: 66,  name: 'Benzene',          formula: 'C₆H₆',     group: 'Aromatics' },
  { id: 67,  name: 'Toluene',          formula: 'C₇H₈',     group: 'Aromatics' },
]

const COMP_BY_ID: Record<number, typeof COMPONENTS[number]> =
  Object.fromEntries(COMPONENTS.map(c => [c.id, c]))
const COMP_GROUPS = [...new Set(COMPONENTS.map(c => c.group))]

// ── Shared input styles ───────────────────────────────────────────────────────
const inp = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white'
const smallInp = 'w-full border border-gray-200 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900 bg-white'

// ── Leg default ───────────────────────────────────────────────────────────────
interface LegRow { length: number; diameter: number; wall_thickness: number; bend_length: number; adiabatic: boolean }
function defaultLeg(n: number): LegRow {
  // Typical YSB W-coil dimensions
  const diams = [0.060, 0.072, 0.088, 0.105]
  return { length: 14.0, diameter: diams[n % 4] ?? 0.09, wall_thickness: 0.007, bend_length: 0.27, adiabatic: false }
}

interface CompRow { _key: number; component_id: number; wt_frac: number; in_conversion: boolean }

// ── Step progress bar ─────────────────────────────────────────────────────────
const STEPS = ['Project', 'Coil Type', 'Geometry', 'Feedstock', 'Conditions', 'Run Length', 'Review']

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const done    = i < current
        const active  = i === current
        return (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                done   ? 'bg-gray-900 text-white' :
                active ? 'bg-gray-900 text-white ring-4 ring-gray-100' :
                         'bg-gray-100 text-gray-400'
              }`}>
                {done ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : i + 1}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 mb-4 transition-colors ${done ? 'bg-gray-900' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Nav buttons ───────────────────────────────────────────────────────────────
function Nav({ step, total, onBack, onNext, nextLabel = 'Continue →', disabled = false }: {
  step: number; total: number; onBack: () => void; onNext: () => void
  nextLabel?: string; disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-100">
      <button onClick={onBack} disabled={step === 0}
        className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-0 transition-colors flex items-center gap-1">
        ← Back
      </button>
      <button onClick={onNext} disabled={disabled}
        className="btn-primary disabled:opacity-40">
        {nextLabel}
      </button>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Design Case Wizard
// ══════════════════════════════════════════════════════════════════════════════
function DesignCaseWizard() {
  const { data: savedCoils } = useSWR<CoilGeometry[]>('/api/coil-geometries', fetcher)
  const { data: savedFeeds } = useSWR<FeedstockDefinition[]>('/api/feedstock-definitions', fetcher)

  const [step, setStep] = useState(0)

  // ── Step 0: Project ──────────────────────────────────────────────────────
  const [dcName,   setDcName]   = useState('')
  const [projName, setProjName] = useState('')
  const [useMode,  setUseMode]  = useState<'new'|'saved'>('new')

  // ── Step 1: Coil type ────────────────────────────────────────────────────
  const [selectedCoilType, setSelectedCoilType] = useState(COIL_TYPES[0])

  // ── Step 2: Geometry ─────────────────────────────────────────────────────
  const [savedCoilId, setSavedCoilId] = useState('')
  const [coilName, setCoilName] = useState('')
  const [passes, setPasses] = useState(COIL_TYPES[0].passes)
  const [legs, setLegs] = useState<LegRow[]>(
    Array.from({ length: COIL_TYPES[0].passes }, (_, i) => defaultLeg(i))
  )
  const [hasAdvol, setHasAdvol] = useState(false)
  const [adVol,  setAdVol]  = useState('1.0')
  const [adDia,  setAdDia]  = useState('0.12')
  const [adWall, setAdWall] = useState('0.007')
  // Piping properties
  const [perimRatio,   setPerimRatio]   = useState('1')
  const [tubeMaterial, setTubeMaterial] = useState(TUBE_MATERIALS[0])
  const [gasCorrCorr,  setGasCorrCorr]  = useState(GAS_CONDUCTIVITY_CORRS[0])
  const [tubeType,     setTubeType]     = useState(TUBE_TYPES[0])

  function handleCoilTypeSelect(ct: typeof COIL_TYPES[number]) {
    setSelectedCoilType(ct)
    setPasses(ct.passes)
    setLegs(Array.from({ length: ct.passes }, (_, i) => defaultLeg(i)))
  }

  function handlePassesChange(n: number) {
    const count = Math.max(1, Math.min(20, n))
    setPasses(count)
    setLegs(prev =>
      count > prev.length
        ? [...prev, ...Array.from({ length: count - prev.length }, (_, i) => defaultLeg(prev.length + i))]
        : prev.slice(0, count)
    )
  }

  function updateLeg(i: number, field: keyof LegRow, val: string | boolean) {
    setLegs(prev => prev.map((l, idx) =>
      idx === i ? { ...l, [field]: typeof val === 'boolean' ? val : Number(val) } : l
    ))
  }

  // ── Step 3: Feedstock ────────────────────────────────────────────────────
  const [savedFeedId, setSavedFeedId] = useState('')
  const [feedName,   setFeedName]   = useState('')
  const [nextKey,    setNextKey]    = useState(3)
  const [comps, setComps] = useState<CompRow[]>([
    { _key: 0, component_id: 5,  wt_frac: 0.9646, in_conversion: true  },
    { _key: 1, component_id: 9,  wt_frac: 0.0208, in_conversion: false },
    { _key: 2, component_id: 2,  wt_frac: 0.0146, in_conversion: false },
  ])
  const [productIds, setProductIds] = useState('4 5 8 9 2 1')

  const totalWt  = comps.reduce((s, c) => s + (c.wt_frac || 0), 0)
  const wtWarn   = Math.abs(totalWt - 1) > 0.001

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

  // ── Step 4: Conditions ───────────────────────────────────────────────────
  const [sevType,      setSevType]     = useState(2)   // 2 = COT (matches CoilSim shooting_flag)
  const [cotVal,       setCotVal]      = useState('837')
  const [sevLoc,       setSevLoc]      = useState<'reactor_end'|'adiabatic_pct'|'tle_end'>('adiabatic_pct')
  const [sevLocPct,    setSevLocPct]   = useState('60')
  const [pressSev,     setPressSev]    = useState<'cop'|'eth_eth'>('cop')
  const [pressLoc,     setPressLoc]    = useState<'reactor_end'|'adiabatic_pct'|'tle_end'>('adiabatic_pct')
  const [pressLocPct,  setPressLocPct] = useState('100')
  const [cop,          setCop]         = useState('2.053')
  const [flow,         setFlow]        = useState('1298')
  const [dilut,        setDilut]       = useState('0.35')
  const [cit,          setCit]         = useState('668')
  const [cip,          setCip]         = useState('2.59')
  const [hfInputType,  setHfInputType] = useState<'net'|'incident'>('net')
  const [profile,      setProfile]     = useState(1)

  // Custom flux profile table: list of {z, q} points
  interface FluxRow { _key: number; z: string; q: string }
  const [fluxRows, setFluxRows] = useState<FluxRow[]>([
    { _key: 0, z: '0',  q: '0' },
    { _key: 1, z: '14', q: '20' },
    { _key: 2, z: '28', q: '18' },
    { _key: 3, z: '42', q: '15' },
    { _key: 4, z: '56', q: '0' },
  ])
  const [fluxKey, setFluxKey] = useState(5)

  function addFluxRow() {
    setFluxRows(r => [...r, { _key: fluxKey, z: '', q: '' }])
    setFluxKey(k => k + 1)
  }
  function removeFluxRow(key: number) { setFluxRows(r => r.filter(x => x._key !== key)) }
  function updateFluxRow(key: number, field: 'z'|'q', val: string) {
    setFluxRows(r => r.map(x => x._key !== key ? x : { ...x, [field]: val }))
  }
  function parseFluxFile(text: string) {
    const rows: FluxRow[] = []
    let k = fluxKey
    for (const line of text.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
        rows.push({ _key: k++, z: parts[0], q: parts[1] })
      }
    }
    if (rows.length > 0) { setFluxRows(rows); setFluxKey(k) }
  }

  // ── Step 5: Run Length ───────────────────────────────────────────────────
  const [runLengthSim,   setRunLengthSim]   = useState(false)
  const [cokeModel,      setCokeModel]      = useState<'Plehiers'|'Reyniers'>('Plehiers')
  const [cokeConduction, setCokeConduction] = useState('0.0045')
  const [cokeDensity,    setCokeDensity]    = useState('1600.0')

  // ── Submit ───────────────────────────────────────────────────────────────
  const [submitState, setSubmitState] = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [submitMsg,   setSubmitMsg]   = useState('')

  async function submit() {
    setSubmitState('loading'); setSubmitMsg('')
    try {
      let coil_id: number, feed_id: number

      if (useMode === 'saved') {
        if (!savedCoilId || !savedFeedId) {
          setSubmitState('err'); setSubmitMsg('Select both a saved coil and feedstock.'); return
        }
        coil_id = Number(savedCoilId); feed_id = Number(savedFeedId)
      } else {
        const normComps = comps.map(({ _key, ...c }) => ({
          ...c, wt_frac: wtWarn ? c.wt_frac / totalWt : c.wt_frac,
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
            body: JSON.stringify({
              name: coilName || `${selectedCoilType.name}_${projName}`,
              ncoil: selectedCoilType.ncoil, legs: legsPayload,
              adiabatic_flag: hasAdvol, ...advolPayload,
              perimeter_ratio: Number(perimRatio),
              tube_material: tubeMaterial,
              gas_conductivity_corr: gasCorrCorr,
              tube_type: tubeType,
            }),
          }),
          fetch('/api/feedstock-definitions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: feedName || `Feed_${projName}`, components: normComps, product_ids: parsedProductIds }),
          }),
        ])
        const [coilJson, feedJson] = await Promise.all([coilRes.json(), feedRes.json()])
        if (!coilRes.ok) { setSubmitState('err'); setSubmitMsg(`Coil geometry error: ${coilJson.error ?? 'unknown'}`); return }
        if (!feedRes.ok) { setSubmitState('err'); setSubmitMsg(`Feedstock error: ${feedJson.error ?? 'unknown'}`); return }
        coil_id = coilJson.id
        feed_id = feedJson.id
      }

      const runRes = await fetch('/api/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'design_case', coil_id, feed_id,
          cot: Number(cotVal), flow: Number(flow),
          dilution: Number(dilut), cit: Number(cit), cip: Number(cip),
          cop: Number(cop),
          severity_type: sevType, flux_profile: profile,
          custom_flux_points: profile === 5
            ? fluxRows.map(r => ({ z: parseFloat(r.z), q: parseFloat(r.q) })).filter(p => !isNaN(p.z) && !isNaN(p.q))
            : undefined,
          sev_location: sevLoc,
          sev_location_pct: sevLoc === 'adiabatic_pct' ? Number(sevLocPct) : null,
          pressure_sev_type: pressSev,
          pressure_location: pressLoc,
          pressure_location_pct: pressLoc === 'adiabatic_pct' ? Number(pressLocPct) : null,
          heat_flux_input_type: hfInputType,
          run_length_sim: runLengthSim ? 1 : 0,
          coke_model: cokeModel,
          coke_conduction: Number(cokeConduction),
          coke_density: Number(cokeDensity),
          project_name: projName,
          design_case_name: dcName || projName,
        }),
      })
      const json = await runRes.json()
      if (!runRes.ok) { setSubmitState('err'); setSubmitMsg(json.error ?? 'Failed'); return }
      setSubmitState('ok')
      setSubmitMsg(`Task #${json.id} queued. Worker will pick it up shortly.`)
    } catch {
      setSubmitState('err'); setSubmitMsg('Network error — check connection.')
    }
  }

  // ── Step validation ──────────────────────────────────────────────────────
  function canProceed() {
    if (step === 0) return projName.trim().length > 0
    if (step === 2 && useMode === 'new') return legs.length > 0
    if (step === 3 && useMode === 'new') return comps.length > 0 && feedName.trim().length > 0
    if (step === 4) return cotVal.trim().length > 0 && flow.trim().length > 0
    // step 5 (Run Length) — always valid
    return true
  }

  function next() { if (step < STEPS.length - 1) setStep(s => s + 1) }
  function back() {
    if (step > 0) {
      setStep(s => s - 1)
      // Reset submit state so the review page shows the Submit button again
      setSubmitState('idle')
      setSubmitMsg('')
    }
  }

  const sev = SEVERITY_OPTIONS.find(o => o.value === sevType) ?? SEVERITY_OPTIONS[0]
  const sevNeedsTarget = sevType !== 9  // Yield maximization has no target value

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl">
      <StepBar current={step} />

      {/* ── STEP 0: Project ──────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Project Setup</h2>
            <p className="text-sm text-gray-400 mt-1">Name this simulation run. These become the folder and reference name used throughout the system.</p>
          </div>

          <div className="card space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Project folder name <span className="text-red-400">*</span></label>
              <input value={projName} onChange={e => setProjName(e.target.value)}
                placeholder="YSB_Ethane_Run_001" className={inp} />
              <p className="text-[11px] text-gray-400 mt-1">Used as the CoilSim working directory name. No spaces — use underscores.</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Design case label</label>
              <input value={dcName} onChange={e => setDcName(e.target.value)}
                placeholder="Ethane cracking baseline — 837°C COT" className={inp} />
              <p className="text-[11px] text-gray-400 mt-1">Human-readable description saved in the Design Cases library.</p>
            </div>
          </div>

          {/* Saved vs New */}
          <div className="card space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Configuration source</p>
            <div className="grid grid-cols-2 gap-3">
              {(['new', 'saved'] as const).map(m => (
                <button key={m} onClick={() => setUseMode(m)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    useMode === m ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400 text-gray-700'
                  }`}>
                  <p className="text-sm font-semibold">{m === 'new' ? '✏️  Define new' : '📁  Use saved'}</p>
                  <p className={`text-xs mt-1 ${useMode === m ? 'text-gray-300' : 'text-gray-400'}`}>
                    {m === 'new'
                      ? 'Enter geometry and feedstock from scratch'
                      : 'Pick from previously saved configurations'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {useMode === 'saved' && (
            <div className="card space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Saved Configurations</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Coil geometry</label>
                  <select value={savedCoilId} onChange={e => setSavedCoilId(e.target.value)} className={inp}>
                    <option value="">— select —</option>
                    {(savedCoils ?? []).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Feedstock definition</label>
                  <select value={savedFeedId} onChange={e => setSavedFeedId(e.target.value)} className={inp}>
                    <option value="">— select —</option>
                    {(savedFeeds ?? []).map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
        </div>
      )}

      {/* ── STEP 1: Coil Type ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Coil Type</h2>
            <p className="text-sm text-gray-400 mt-1">Select the furnace coil configuration. This sets the <code className="text-xs font-mono bg-gray-100 px-1 rounded">ncoil</code> parameter and pre-fills the number of passes.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {COIL_TYPES.map(ct => (
              <button key={ct.ncoil} onClick={() => handleCoilTypeSelect(ct)}
                className={`rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                  selectedCoilType.ncoil === ct.ncoil
                    ? 'border-gray-900 bg-gray-900 text-white shadow'
                    : 'border-gray-200 hover:border-gray-400 text-gray-700'
                }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-lg font-black font-mono ${selectedCoilType.ncoil === ct.ncoil ? 'text-white' : 'text-gray-300'}`}>
                    {ct.icon}
                  </span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    selectedCoilType.ncoil === ct.ncoil ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'
                  }`}>n={ct.ncoil}</span>
                </div>
                <p className="text-sm font-semibold">{ct.name}</p>
                <p className={`text-xs mt-0.5 ${selectedCoilType.ncoil === ct.ncoil ? 'text-gray-300' : 'text-gray-400'}`}>
                  {ct.desc}
                </p>
                <p className={`text-xs mt-1 font-medium ${selectedCoilType.ncoil === ct.ncoil ? 'text-gray-200' : 'text-gray-400'}`}>
                  {ct.passes} passes
                </p>
              </button>
            ))}
          </div>
          <Nav step={step} total={STEPS.length} onBack={back} onNext={next} />
        </div>
      )}

      {/* ── STEP 2: Geometry ──────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Coil Geometry</h2>
            <p className="text-sm text-gray-400 mt-1">
              Define tube dimensions for each pass. Pre-filled with typical values for a <strong>{selectedCoilType.name}</strong>.
            </p>
          </div>

          {useMode === 'saved' ? (
            <div className="card">
              <p className="text-sm text-gray-500">Using saved geometry — no edits required.</p>
            </div>
          ) : (
            <>
              <div className="card space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Geometry label</label>
                    <input value={coilName}
                      onChange={e => setCoilName(e.target.value)}
                      placeholder={`${selectedCoilType.name}_${projName || 'geo'}`}
                      className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Number of passes</label>
                    <input type="number" min={1} max={20} value={passes}
                      onChange={e => handlePassesChange(Number(e.target.value))}
                      className={inp} />
                  </div>
                </div>
              </div>

              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Pass / Leg Dimensions</p>
                  <p className="text-xs text-gray-400 mt-0.5">Internal diameter and wall thickness define the flow area. Bend length is the return bend.</p>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/50">
                    <tr>
                      {['Pass', 'Length (m)', 'Int. Dia (m)', 'Wall (m)', 'Bend L (m)', 'Adiabatic'].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {legs.map((leg, i) => (
                      <tr key={i} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-3 py-2 font-mono text-gray-400 font-semibold">{i + 1}</td>
                        {(['length', 'diameter', 'wall_thickness', 'bend_length'] as const).map(f => (
                          <td key={f} className="px-2 py-1.5">
                            <input type="number" step="0.001" value={leg[f]}
                              onChange={e => updateLeg(i, f, e.target.value)}
                              className={smallInp} />
                          </td>
                        ))}
                        <td className="px-4 py-1.5">
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
              <div className="card">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={hasAdvol} onChange={e => setHasAdvol(e.target.checked)}
                    className="w-4 h-4 rounded accent-gray-900" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Include adiabatic transfer line volume</p>
                    <p className="text-xs text-gray-400">The section after the coil outlet before the TLE quench</p>
                  </div>
                </label>
                {hasAdvol && (
                  <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
                    {[['Volume (×10⁻³ m³)', adVol, setAdVol], ['Diameter (m)', adDia, setAdDia], ['Wall (m)', adWall, setAdWall]].map(([lbl, val, set]) => (
                      <div key={lbl as string}>
                        <label className="block text-xs text-gray-500 mb-1">{lbl as string}</label>
                        <input type="number" step="0.001" value={val as string}
                          onChange={e => (set as Function)(e.target.value)} className={inp} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Piping properties */}
              <div className="card space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Piping Properties</p>
                  <p className="text-xs text-gray-400 mt-0.5">Written to <code className="font-mono bg-gray-100 px-1 rounded">reactor.txt</code> piping section</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Perimeter ratio</label>
                    <input type="number" step="0.01" min="0.1" max="10" value={perimRatio}
                      onChange={e => setPerimRatio(e.target.value)} className={inp} />
                    <p className="text-[10px] text-gray-400 mt-0.5">Heated / total perimeter (default 1 = fully heated)</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tube material</label>
                    <select value={tubeMaterial} onChange={e => setTubeMaterial(e.target.value)} className={inp}>
                      {TUBE_MATERIALS.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Gas conductivity correlation</label>
                    <select value={gasCorrCorr} onChange={e => setGasCorrCorr(e.target.value)} className={inp}>
                      {GAS_CONDUCTIVITY_CORRS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tube type</label>
                    <select value={tubeType} onChange={e => setTubeType(e.target.value)} className={inp}>
                      {TUBE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}

          <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
        </div>
      )}

      {/* ── STEP 3: Feedstock ─────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Feedstock Composition</h2>
            <p className="text-sm text-gray-400 mt-1">
              Define the feed molecular composition by weight fraction.
              Pre-filled with a typical ethane-rich feed.
            </p>
          </div>

          {useMode === 'saved' ? (
            <div className="card">
              <p className="text-sm text-gray-500">Using saved feedstock — no edits required.</p>
            </div>
          ) : (
            <>
              <div className="card space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Feedstock label</label>
                    <input value={feedName} onChange={e => setFeedName(e.target.value)}
                      placeholder={`Ethane_${projName || 'feed'}`} className={inp} />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Product IDs (thermochemistry.i NLA)</label>
                    <input value={productIds} onChange={e => setProductIds(e.target.value)} className={inp} />
                    <p className="text-[10px] text-gray-400 mt-0.5">C₂H₄=4, C₂H₆=5, C₃H₆=8, C₃H₈=9, CH₄=2, H₂=1</p>
                  </div>
                </div>
              </div>

              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Components</p>
                    <p className="text-xs text-gray-400 mt-0.5">Select by name — ID maps automatically from thermochemistry.i</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    wtWarn ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    Σ = {totalWt.toFixed(4)} {wtWarn ? '⚠ ≠ 1' : '✓'}
                  </span>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/50">
                    <tr>
                      {['Component', 'ID', 'Weight fraction', 'In conversion', ''].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comps.map(c => (
                      <tr key={c._key} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-2 py-2">
                          <select value={c.component_id}
                            onChange={e => updateComp(c._key, 'component_id', e.target.value)}
                            className={smallInp}>
                            {COMP_GROUPS.map(group => (
                              <optgroup key={group} label={group}>
                                {COMPONENTS.filter(x => x.group === group).map(x => (
                                  <option key={x.id} value={x.id}>{x.name} ({x.formula})</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 font-mono text-gray-400 text-center">{c.component_id}</td>
                        <td className="px-2 py-2">
                          <input type="number" step="0.0001" min={0} max={1} value={c.wt_frac}
                            onChange={e => updateComp(c._key, 'wt_frac', e.target.value)}
                            className={smallInp + ' w-24'} />
                        </td>
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={c.in_conversion}
                            onChange={e => updateComp(c._key, 'in_conversion', e.target.checked)}
                            className="w-4 h-4 rounded accent-gray-900" />
                        </td>
                        <td className="px-2 py-2">
                          <button onClick={() => removeComp(c._key)}
                            className="text-gray-300 hover:text-red-400 text-base leading-none">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50/50 border-t border-gray-100">
                  <button onClick={addComp} className="text-xs text-gray-500 hover:text-gray-900 font-medium">
                    + Add component
                  </button>
                  {wtWarn && (
                    <span className="text-xs text-amber-600 ml-4">Weight fractions will be normalised on submit.</span>
                  )}
                </div>
              </div>
            </>
          )}

          <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
        </div>
      )}

      {/* ── STEP 4: Conditions ───────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Operating Conditions</h2>
            <p className="text-sm text-gray-400 mt-1">
              Severity, flow, steam, inlet conditions and heat flux profile — all written to{' '}
              <code className="text-xs font-mono bg-gray-100 px-1 rounded">exp.txt</code>.
            </p>
          </div>

          {/* Temperature severity */}
          <div className="card space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Temperature-Related Severity</p>
              <p className="text-xs text-gray-400 mt-0.5">CoilSim shooting method — iterates until this target is matched</p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {SEVERITY_OPTIONS.map(o => (
                <button key={o.value} onClick={() => setSevType(o.value)}
                  className={`rounded-lg border px-2 py-2 text-xs text-center transition-all ${
                    sevType === o.value
                      ? 'border-gray-900 bg-gray-900 text-white font-semibold'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400'
                  }`}>
                  {o.label}
                </button>
              ))}
            </div>
            {sevNeedsTarget && (
              <div className="max-w-xs">
                <label className="block text-xs text-gray-500 mb-1">{sev.desc} ({sev.unit})</label>
                <input type="number" value={cotVal} onChange={e => setCotVal(e.target.value)}
                  placeholder={sev.placeholder} className={inp} />
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-2">Measurement location</p>
              <div className="flex flex-col gap-2">
                {(['reactor_end', 'adiabatic_pct', 'tle_end'] as const).map(loc => (
                  <label key={loc} className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="sevLoc" value={loc} checked={sevLoc === loc}
                      onChange={() => setSevLoc(loc)} className="accent-gray-900" />
                    <span className="text-sm text-gray-700">
                      {loc === 'reactor_end' && 'At end of reactor'}
                      {loc === 'adiabatic_pct' && (
                        <span className="flex items-center gap-2">
                          At <input type="number" min={0} max={100} value={sevLocPct}
                            onClick={() => setSevLoc('adiabatic_pct')}
                            onChange={e => { setSevLoc('adiabatic_pct'); setSevLocPct(e.target.value) }}
                            className="w-16 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900" />
                          % of adiabatic volume
                        </span>
                      )}
                      {loc === 'tle_end' && 'At end of TLE'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Pressure severity */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Pressure-Related Severity</p>
            <div className="flex gap-6">
              {([['cop', 'Coil outlet pressure (COP)'], ['eth_eth', 'Ethylene / ethane ratio']] as const).map(([v, lbl]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="radio" name="pressSev" value={v} checked={pressSev === v}
                    onChange={() => setPressSev(v)} className="accent-gray-900" />
                  {lbl}
                </label>
              ))}
            </div>
            {pressSev === 'cop' && (
              <div className="max-w-xs">
                <label className="block text-xs text-gray-500 mb-1">COP — Coil Outlet Pressure (atm)</label>
                <input type="number" step="0.001" value={cop} onChange={e => setCop(e.target.value)} className={inp} />
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500 mb-2">Measurement location</p>
              <div className="flex flex-col gap-2">
                {(['reactor_end', 'adiabatic_pct', 'tle_end'] as const).map(loc => (
                  <label key={loc} className="flex items-center gap-3 cursor-pointer">
                    <input type="radio" name="pressLoc" value={loc} checked={pressLoc === loc}
                      onChange={() => setPressLoc(loc)} className="accent-gray-900" />
                    <span className="text-sm text-gray-700">
                      {loc === 'reactor_end' && 'At end of reactor'}
                      {loc === 'adiabatic_pct' && (
                        <span className="flex items-center gap-2">
                          At <input type="number" min={0} max={100} value={pressLocPct}
                            onClick={() => setPressLoc('adiabatic_pct')}
                            onChange={e => { setPressLoc('adiabatic_pct'); setPressLocPct(e.target.value) }}
                            className="w-16 border border-gray-200 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900" />
                          % of adiabatic volume
                        </span>
                      )}
                      {loc === 'tle_end' && 'At end of TLE'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Heat flux profile */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Heat Flux Profile</p>
            <div className="flex flex-col gap-2">
              {([['net', 'Input net heat flux profile along reactor'], ['incident', 'Input incident heat flux profile in radiant box']] as const).map(([v, lbl]) => (
                <label key={v} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="radio" name="hfType" value={v} checked={hfInputType === v}
                    onChange={() => setHfInputType(v)} className="accent-gray-900" />
                  {lbl}
                </label>
              ))}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">Profile shape</p>
              <div className="grid grid-cols-5 gap-2">
                {FLUX_PROFILES.map(p => (
                  <button key={p.value} onClick={() => setProfile(p.value)}
                    className={`rounded-lg border px-3 py-2 text-xs text-center transition-all ${
                      profile === p.value
                        ? 'border-gray-900 bg-gray-900 text-white font-semibold'
                        : 'border-gray-200 text-gray-600 hover:border-gray-400'
                    }`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">{FLUX_PROFILES.find(p => p.value === profile)?.desc}</p>
            </div>

            {/* Custom flux editor — only shown when Custom is selected */}
            {profile === 5 && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Custom Flux Profile</p>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 hover:text-gray-800 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Import flux.txt
                    <input type="file" accept=".txt,.csv" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        file.text().then(parseFluxFile)
                        e.target.value = ''
                      }} />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Table */}
                  <div className="space-y-1">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-1">
                      <span>Axial pos (m)</span>
                      <span>Flux (kW/m²)</span>
                      <span />
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                      {fluxRows.map(row => (
                        <div key={row._key} className="grid grid-cols-[1fr_1fr_auto] gap-1 items-center">
                          <input type="number" step="0.01" value={row.z}
                            onChange={e => updateFluxRow(row._key, 'z', e.target.value)}
                            placeholder="0.0" className={smallInp} />
                          <input type="number" step="0.1" value={row.q}
                            onChange={e => updateFluxRow(row._key, 'q', e.target.value)}
                            placeholder="20.0" className={smallInp} />
                          <button onClick={() => removeFluxRow(row._key)}
                            className="text-gray-300 hover:text-red-400 text-base leading-none px-1">×</button>
                        </div>
                      ))}
                    </div>
                    <button onClick={addFluxRow}
                      className="text-xs text-gray-400 hover:text-gray-700 mt-1 flex items-center gap-1">
                      <span className="text-base leading-none">+</span> Add point
                    </button>
                  </div>

                  {/* Live chart preview */}
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Preview</p>
                    <div className="flex-1 min-h-[160px] bg-white rounded-lg border border-gray-100 p-2">
                      {(() => {
                        const pts = fluxRows
                          .map(r => ({ z: parseFloat(r.z), q: parseFloat(r.q) }))
                          .filter(p => !isNaN(p.z) && !isNaN(p.q))
                          .sort((a, b) => a.z - b.z)
                        if (pts.length < 2) return (
                          <p className="text-[10px] text-gray-300 text-center mt-8">Add at least 2 points</p>
                        )
                        const maxZ = Math.max(...pts.map(p => p.z))
                        const maxQ = Math.max(...pts.map(p => p.q)) || 1
                        const W = 200, H = 140, pad = 20
                        const cx = (z: number) => pad + (z / maxZ) * (W - pad * 2)
                        const cy = (q: number) => H - pad - (q / maxQ) * (H - pad * 2)
                        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${cx(p.z).toFixed(1)},${cy(p.q).toFixed(1)}`).join(' ')
                        return (
                          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full">
                            <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="#e5e7eb" strokeWidth="1"/>
                            <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="#e5e7eb" strokeWidth="1"/>
                            <path d={d} fill="none" stroke="#6366f1" strokeWidth="1.5" strokeLinejoin="round"/>
                            {pts.map((p, i) => (
                              <circle key={i} cx={cx(p.z)} cy={cy(p.q)} r="2.5" fill="#6366f1"/>
                            ))}
                            <text x={pad} y={H - 4} fontSize="8" fill="#9ca3af">{pts[0].z.toFixed(0)} m</text>
                            <text x={W - pad} y={H - 4} fontSize="8" fill="#9ca3af" textAnchor="end">{maxZ.toFixed(0)} m</text>
                            <text x={pad - 2} y={pad + 4} fontSize="8" fill="#9ca3af" textAnchor="end">{maxQ.toFixed(0)}</text>
                          </svg>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Flow, steam & inlet */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Flow, Steam & Inlet Conditions</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Hydrocarbon flow (kg/h)</label>
                <input type="number" value={flow} onChange={e => setFlow(e.target.value)} placeholder="1298" className={inp} />
                <p className="text-[10px] text-gray-400 mt-0.5">Per inlet tube for split coils</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Steam dilution (wt/wt)</label>
                <input type="number" step="0.01" value={dilut} onChange={e => setDilut(e.target.value)} className={inp} />
                <p className="text-[10px] text-gray-400 mt-0.5">Ethane 0.3–0.5 · Naphtha 0.5–0.8</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">CIT — Coil Inlet Temp (°C)</label>
                <input type="number" value={cit} onChange={e => setCit(e.target.value)} className={inp} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">CIP — Coil Inlet Pressure estimate (atm)</label>
                <input type="number" step="0.01" value={cip} onChange={e => setCip(e.target.value)} className={inp} />
              </div>
            </div>
          </div>

          <Nav step={step} total={STEPS.length} onBack={back} onNext={next}
            nextLabel="Run Length →" disabled={!canProceed()} />
        </div>
      )}

      {/* ── STEP 5: Run Length ────────────────────────────────────────────── */}
      {step === 5 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Run Length & Coking</h2>
            <p className="text-sm text-gray-400 mt-1">
              Configure coke deposition model and run-length simulation parameters.
            </p>
          </div>

          {/* Run length simulation toggle */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Run Length Simulation</p>
            <div className="flex gap-6">
              {([true, false] as const).map(v => (
                <label key={String(v)} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="radio" name="runLen" checked={runLengthSim === v}
                    onChange={() => setRunLengthSim(v)} className="accent-gray-900" />
                  {v ? 'Yes — simulate coke deposition over time' : 'No — clean-tube run only'}
                </label>
              ))}
            </div>
            {runLengthSim && (
              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
                The worker will iterate the coke deposition model over multiple run-length increments. Ensure a coke profile file is available or the bisection tuner will generate one.
              </div>
            )}
          </div>

          {/* Coking model */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Coke Deposition Model</p>
            <div className="flex gap-6">
              {(['Plehiers', 'Reyniers'] as const).map(m => (
                <label key={m} className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                  <input type="radio" name="cokeModel" checked={cokeModel === m}
                    onChange={() => setCokeModel(m)} className="accent-gray-900" />
                  <span>
                    <span className="font-medium">{m}</span>
                    <span className="text-gray-400 ml-2">
                      {m === 'Plehiers' ? '(default — radical coking mechanism)' : '(Reyniers — surface reaction model)'}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Coke thermal properties */}
          <div className="card space-y-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Coke Thermal Properties</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Conduction coefficient [kcal/(K·m·s)]</label>
                <input type="number" step="0.0001" value={cokeConduction}
                  onChange={e => setCokeConduction(e.target.value)} className={inp} />
                <p className="text-[10px] text-gray-400 mt-0.5">Default: 0.0045</p>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Coke density [kg/m³]</label>
                <input type="number" step="10" value={cokeDensity}
                  onChange={e => setCokeDensity(e.target.value)} className={inp} />
                <p className="text-[10px] text-gray-400 mt-0.5">Default: 1600 kg/m³</p>
              </div>
            </div>
          </div>

          <Nav step={step} total={STEPS.length} onBack={back} onNext={next} nextLabel="Review →" />
        </div>
      )}

      {/* ── STEP 6: Review & Submit ───────────────────────────────────────── */}
      {step === 6 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Review & Submit</h2>
            <p className="text-sm text-gray-400 mt-1">Confirm all inputs before queuing the simulation.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Project */}
            <div className="card space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Project</p>
              <p className="text-sm font-medium text-gray-900">{projName || '—'}</p>
              {dcName && <p className="text-xs text-gray-500">{dcName}</p>}
            </div>

            {/* Coil */}
            <div className="card space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Coil</p>
              <p className="text-sm font-medium text-gray-900">
                {useMode === 'saved'
                  ? savedCoils?.find(c => c.id === Number(savedCoilId))?.name ?? '—'
                  : (coilName || `${selectedCoilType.name}_${projName}`)}
              </p>
              <p className="text-xs text-gray-500">
                {selectedCoilType.name} · ncoil={selectedCoilType.ncoil} · {passes} passes
              </p>
            </div>

            {/* Feedstock */}
            <div className="card space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Feedstock</p>
              <p className="text-sm font-medium text-gray-900">
                {useMode === 'saved'
                  ? savedFeeds?.find(f => f.id === Number(savedFeedId))?.name ?? '—'
                  : (feedName || `Feed_${projName}`)}
              </p>
              {useMode === 'new' && (
                <p className="text-xs text-gray-500">{comps.length} components</p>
              )}
            </div>

            {/* Conditions */}
            <div className="card space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Conditions</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {([
                  [sev.label,  sevNeedsTarget ? `${cotVal} ${sev.unit}` : 'maximise'],
                  ['Flow',     `${flow} kg/h`],
                  ['Dilution', `${dilut} wt/wt`],
                  ['CIT',      `${cit} °C`],
                  ['CIP',      `${cip} atm`],
                  ['COP',      `${cop} atm`],
                  ['Sev. loc', sevLoc === 'adiabatic_pct' ? `${sevLocPct}% adv` : sevLoc.replace('_', ' ')],
                  ['Profile',  FLUX_PROFILES.find(p => p.value === profile)?.label ?? '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-400">{k}</span>
                    <span className="font-medium text-gray-700">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Piping & Run Length */}
            <div className="card space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Piping & Coking</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {([
                  ['Material',   tubeMaterial.replace(/_/g, ' ')],
                  ['Tube type',  tubeType],
                  ['Perim. ratio', perimRatio],
                  ['Gas cond.',  gasCorrCorr],
                  ['Coke model', cokeModel],
                  ['Run length', runLengthSim ? 'Yes' : 'No'],
                  ['Coke cond.', `${cokeConduction} kcal/Kms`],
                  ['Coke dens.', `${cokeDensity} kg/m³`],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-gray-400">{k}</span>
                    <span className="font-medium text-gray-700">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(submitState === 'idle' || submitState === 'err') && (
            <div className="space-y-3">
              {submitState === 'err' && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  {submitMsg}
                </div>
              )}
              <button onClick={submit} className="btn-primary w-full text-base py-3">
                {submitState === 'err' ? '↺  Retry Submission' : '🚀  Submit Design Case Simulation'}
              </button>
            </div>
          )}
          {submitState === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
              <span className="animate-spin">⏳</span> Submitting…
            </div>
          )}

          {submitState === 'ok' && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <div className="flex items-start gap-3">
                <span className="text-emerald-500 text-xl">✓</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-800">{submitMsg}</p>
                  <p className="text-xs text-emerald-600 mt-1">
                    Design case saved. Select it as the active model on the dashboard to use it for hourly runs.
                  </p>
                </div>
              </div>
            </div>
          )}

          {submitState !== 'ok' && submitState !== 'loading' && (
            <button onClick={back} className="text-sm text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1">
              ← Back to Run Length
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DesignCasePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Design Case</h1>
        <p className="text-sm text-gray-400 mt-0.5">
          Define furnace geometry, feedstock and baseline operating conditions
        </p>
      </div>
      <div className="card">
        <DesignCaseWizard />
      </div>
    </div>
  )
}
