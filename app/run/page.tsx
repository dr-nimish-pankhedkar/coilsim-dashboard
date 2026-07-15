'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { CoilGeometry, FeedstockDefinition } from '@/lib/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── CoilSim constants ─────────────────────────────────────────────────────────

const COIL_TYPES = [
  { ncoil: 2,  name: 'W-coil',          passes: 4,  desc: 'Most common; 4-pass split coil',     icon: 'W' },
  { ncoil: 3,  name: 'U-coil',          passes: 2,  desc: 'Short residence time, 2-pass',        icon: 'U' },
  { ncoil: 5,  name: 'SRT-I',           passes: 8,  desc: 'Lummus SRT-I, 8-pass',                icon: 'I' },
  { ncoil: 6,  name: 'SRT-II / III',    passes: 8,  desc: 'Lummus SRT-II/III variant',           icon: 'II' },
  { ncoil: 7,  name: 'SRT-IV',          passes: 8,  desc: 'Lummus SRT-IV',                       icon: 'IV' },
  { ncoil: 12, name: 'SRT-VI',          passes: 8,  desc: 'Lummus SRT-VI high-severity',         icon: 'VI' },
  { ncoil: 4,  name: 'Millisecond',     passes: 2,  desc: 'Ultra-short residence time',          icon: 'ms' },
  { ncoil: 8,  name: 'Technip GK-I',   passes: 4,  desc: 'Technip GK series, 4-pass',           icon: 'GK' },
  { ncoil: 9,  name: 'Technip GK-VI',  passes: 4,  desc: 'Technip GK-VI high capacity',         icon: 'GK6'},
  { ncoil: 10, name: 'Linde Pyrocrack',passes: 4,  desc: 'Linde Pyrocrack 1-1/2-4',             icon: 'LC' },
  { ncoil: 13, name: 'SL-2',           passes: 4,  desc: 'Short/Long 2-cell coil',              icon: 'SL' },
  { ncoil: 14, name: 'M-coil',         passes: 4,  desc: 'M-shaped multi-pass coil',            icon: 'M'  },
]

// ── Coil schematic diagrams + info modal ─────────────────────────────────────

const COIL_INFO: Record<number, { detail: string; feedstock: string }> = {
  2:  { detail: 'Most widely deployed cracker coil. Four vertical passes connected by three U-bends — two at the bottom, one at the top. Good balance of yield, selectivity and runlength.',                              feedstock: 'Ethane, propane, naphtha' },
  3:  { detail: 'Simplest geometry: one inlet pass, one outlet pass, single U-bend at the bottom. Very short residence time; preferred for high-ethane feeds where minimal side reactions matter.',                      feedstock: 'Ethane, propane' },
  4:  { detail: 'Ultra-short two-pass coil designed for maximum selectivity. An integral Transfer Line Exchanger (TLE) immediately quenches products, stopping secondary reactions.',                                    feedstock: 'Ethane (high conversion)' },
  5:  { detail: 'Lummus SRT-I: eight passes in a single serpentine stream. High-capacity design for naphtha cracking; balances heat distribution and tube runlength.',                                                  feedstock: 'Naphtha, gas oil' },
  6:  { detail: 'Lummus SRT-II / SRT-III: eight passes split into two independent four-pass streams fed in parallel. Improves heat uniformity and allows separate flow control per stream.',                            feedstock: 'Naphtha, gas oil' },
  7:  { detail: 'Lummus SRT-IV: eight passes with wider tube spacing compared to SRT-I. Higher throughput per furnace; often used for heavier naphtha and AGO feeds.',                                                  feedstock: 'Naphtha, AGO' },
  8:  { detail: 'Technip GK-I: four-pass design with a tapered outlet section. The progressive diameter reduction toward the outlet manages pressure drop and maintains high olefin selectivity.',                      feedstock: 'Naphtha, propane' },
  9:  { detail: 'Technip GK-VI: four-pass coil with a distinctive pigtail (helical loop) at the outlet. The loop promotes mixing and ensures uniform exit temperature before the TLE.',                               feedstock: 'Naphtha, ethane' },
  10: { detail: 'Linde Pyrocrack: parallel U-tube design available in 1-1, 2-2, or 4-2 configurations (inlets–outlets). Short residence time and low pressure drop; favoured for ethane and propane.',                feedstock: 'Ethane, propane, naphtha' },
  12: { detail: 'Lummus SRT-VI: eight-pass high-severity variant with shorter tube length. The reduced residence time pushes ethylene selectivity at higher severity without excessive coke deposition.',               feedstock: 'Naphtha, AGO (high severity)' },
  13: { detail: 'SL-2 Short-Long two-cell coil: two shorter inlet passes feed into two longer outlet passes. The geometry optimises heat flux profile — high flux on the short inlet, moderate on the long outlet.',    feedstock: 'Propane, naphtha' },
  14: { detail: 'M-coil: four-pass M-shaped tube bundle when viewed from above. The symmetric arrangement provides excellent heat distribution across the tube cross-section and reduces hot-spot risk.',               feedstock: 'Naphtha, gas oil' },
}

function CoilSchematic({ ncoil }: { ncoil: number }) {
  const t: React.SVGProps<SVGPathElement> = {
    fill: 'none', stroke: '#1e293b', strokeWidth: 3.5,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  const lbl = (x: number, y: number, text: string) => (
    <text key={text + x} x={x} y={y} fontSize={7.5} fill="#94a3b8"
      fontFamily="ui-monospace,monospace" textAnchor="middle">{text}</text>
  )

  switch (ncoil) {
    case 2: return (   // W-coil 4-pass
      <svg viewBox="0 0 112 130" className="w-full">
        {lbl(20, 8, 'IN')}{lbl(92, 8, 'OUT')}
        <path d="M20,12 V112 A12,12 0 0 0 44,112 V12 A12,12 0 0 1 68,12 V112 A12,12 0 0 0 92,112 V12" {...t}/>
      </svg>
    )
    case 3: return (   // U-coil 2-pass
      <svg viewBox="0 0 112 130" className="w-full">
        {lbl(30, 8, 'IN')}{lbl(82, 8, 'OUT')}
        <path d="M30,12 V112 A26,26 0 0 0 82,112 V12" {...t}/>
      </svg>
    )
    case 4: return (   // Millisecond 2-pass + TLE
      <svg viewBox="0 0 112 140" className="w-full">
        {lbl(30, 8, 'IN')}{lbl(82, 8, 'OUT')}
        <path d="M30,12 V58 A26,26 0 0 0 82,58 V12" {...t}/>
        <rect x="18" y="65" width="76" height="22" rx="3" fill="#fef3c7" stroke="#d97706" strokeWidth={1.5}/>
        <text x="56" y="80" fontSize={9} fill="#92400e" fontFamily="ui-sans-serif,sans-serif" fontWeight="600" textAnchor="middle">TLE</text>
        {lbl(56, 102, 'Transfer Line Exchanger')}
      </svg>
    )
    case 5: return (   // SRT-I 8-pass single stream
      <svg viewBox="0 0 108 130" className="w-full">
        {lbl(8, 8, 'IN')}{lbl(100, 8, 'OUT')}
        <path d="M8,12 V112 A6.5,6.5 0 0 0 21,112 V12 A6.5,6.5 0 0 1 34,12 V112 A6.5,6.5 0 0 0 47,112 V12 A6.5,6.5 0 0 1 60,12 V112 A6.5,6.5 0 0 0 73,112 V12 A6.5,6.5 0 0 1 86,12 V112 A6.5,6.5 0 0 0 99,112 V12" {...t} strokeWidth={3}/>
      </svg>
    )
    case 6: return (   // SRT-II/III 8-pass dual stream
      <svg viewBox="0 0 116 135" className="w-full">
        {lbl(8, 8, 'IN1')}{lbl(68, 8, 'IN2')}{lbl(108, 8, 'OUT')}
        <path d="M8,12 V112 A6.5,6.5 0 0 0 21,112 V12 A6.5,6.5 0 0 1 34,12 V112 A6.5,6.5 0 0 0 47,112 V12" {...t} strokeWidth={3}/>
        <path d="M68,12 V112 A6.5,6.5 0 0 0 81,112 V12 A6.5,6.5 0 0 1 94,12 V112 A6.5,6.5 0 0 0 107,112 V12" {...t} strokeWidth={3}/>
        <line x1="57" y1="15" x2="57" y2="118" stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 3"/>
        {lbl(57, 130, 'parallel streams')}
      </svg>
    )
    case 7: return (   // SRT-IV 8-pass wider spacing
      <svg viewBox="0 0 126 130" className="w-full">
        {lbl(10, 8, 'IN')}{lbl(116, 8, 'OUT')}
        <path d="M10,12 V112 A8,8 0 0 0 26,112 V12 A8,8 0 0 1 42,12 V112 A8,8 0 0 0 58,112 V12 A8,8 0 0 1 74,12 V112 A8,8 0 0 0 90,112 V12 A8,8 0 0 1 106,12 V112 A8,8 0 0 0 122,112 V12" {...t} strokeWidth={3}/>
      </svg>
    )
    case 8: return (   // Technip GK-I 4-pass tapered outlet
      <svg viewBox="0 0 115 130" className="w-full">
        {lbl(20, 8, 'IN')}{lbl(92, 8, 'OUT')}
        <path d="M20,12 V112 A12,12 0 0 0 44,112 V12 A12,12 0 0 1 68,12 V112 A12,12 0 0 0 92,112 V12" {...t}/>
        <path d="M92,12 L100,5 L110,9" fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round"/>
      </svg>
    )
    case 9: return (   // Technip GK-VI 4-pass with pigtail
      <svg viewBox="0 0 122 145" className="w-full">
        {lbl(20, 8, 'IN')}{lbl(92, 8, 'OUT')}
        <path d="M20,12 V112 A12,12 0 0 0 44,112 V12 A12,12 0 0 1 68,12 V112 A12,12 0 0 0 92,112 V12" {...t}/>
        <path d="M92,12 Q112,12 112,30 Q112,48 92,48 Q74,48 74,30 Q74,18 84,13" fill="none" stroke="#1e293b" strokeWidth={2.5} strokeLinecap="round"/>
      </svg>
    )
    case 10: return (  // Linde Pyrocrack 2-2 parallel U-tubes
      <svg viewBox="0 0 116 140" className="w-full">
        {lbl(22, 8, 'IN')}{lbl(50, 8, 'IN')}{lbl(66, 8, 'OUT')}{lbl(94, 8, 'OUT')}
        <path d="M22,12 V112 A14,14 0 0 0 50,112 V12" {...t}/>
        <path d="M66,12 V112 A14,14 0 0 0 94,112 V12" {...t}/>
        {lbl(58, 132, '2-2 configuration')}
      </svg>
    )
    case 12: return (  // SRT-VI 8-pass shorter = high severity
      <svg viewBox="0 0 108 115" className="w-full">
        {lbl(8, 8, 'IN')}{lbl(100, 8, 'OUT')}
        <path d="M8,12 V82 A6.5,6.5 0 0 0 21,82 V12 A6.5,6.5 0 0 1 34,12 V82 A6.5,6.5 0 0 0 47,82 V12 A6.5,6.5 0 0 1 60,12 V82 A6.5,6.5 0 0 0 73,82 V12 A6.5,6.5 0 0 1 86,12 V82 A6.5,6.5 0 0 0 99,82 V12" {...t} strokeWidth={3}/>
        {lbl(54, 100, 'shorter tubes → higher severity')}
      </svg>
    )
    case 13: return (  // SL-2 Short-Long 2-cell
      <svg viewBox="0 0 112 135" className="w-full">
        {lbl(20, 8, 'IN')}{lbl(92, 8, 'OUT')}
        <text x="32" y="52" fontSize={7} fill="#94a3b8" fontFamily="ui-monospace,monospace" textAnchor="middle">short</text>
        <text x="80" y="8" fontSize={7} fill="#94a3b8" fontFamily="ui-monospace,monospace" textAnchor="middle">long</text>
        <path d="M20,56 V112 A12,12 0 0 0 44,112 V56" {...t}/>
        <path d="M44,56 A12,12 0 0 1 68,56" fill="none" stroke="#1e293b" strokeWidth={2} strokeLinecap="round"/>
        <path d="M68,12 V112 A12,12 0 0 0 92,112 V12" {...t}/>
      </svg>
    )
    case 14: return (  // M-coil 4-pass M-shaped
      <svg viewBox="0 0 112 130" className="w-full">
        {lbl(20, 8, 'IN')}{lbl(92, 8, 'OUT')}
        <text x="56" y="68" fontSize={28} fill="#f1f5f9" fontFamily="ui-sans-serif,sans-serif" fontWeight="800" textAnchor="middle">M</text>
        <path d="M20,12 V112 A12,12 0 0 0 44,112 V12 A12,12 0 0 1 68,12 V112 A12,12 0 0 0 92,112 V12" {...t}/>
      </svg>
    )
    default: return (
      <svg viewBox="0 0 112 130" className="w-full">
        <text x="56" y="68" fontSize={11} fill="#94a3b8" textAnchor="middle" fontFamily="ui-sans-serif,sans-serif">No diagram</text>
      </svg>
    )
  }
}

function CoilInfoModal({ coil, onClose }: { coil: typeof COIL_TYPES[0]; onClose: () => void }) {
  const info = COIL_INFO[coil.ncoil]
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,20,30,0.52)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-900">{coil.name}</p>
            <p className="text-xs text-gray-400 mt-0.5">{coil.passes} passes · ncoil = {coil.ncoil}</p>
          </div>
          <button onClick={onClose} className="text-gray-300 hover:text-gray-600 text-xl leading-none transition-colors">×</button>
        </div>
        <div className="px-8 py-5 bg-gray-50 border-b border-gray-100 flex items-center justify-center">
          <CoilSchematic ncoil={coil.ncoil} />
        </div>
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-gray-600 leading-relaxed">{info?.detail ?? 'No additional information.'}</p>
          {info?.feedstock && (
            <p className="text-xs text-gray-400 mt-1">
              <span className="font-medium text-gray-500">Typical feedstock: </span>{info.feedstock}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

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

// Piping properties — standard (per-leg) coil
const TUBE_MATERIALS = [
  '800_800H', '800_800', 'HP_40', 'HK_40', 'Incoloy_825', 'Inconel_600', '304SS', '316SS', 'Custom',
]
const GAS_CONDUCTIVITY_CORRS = ['Modified Eucken', 'Eucken', 'Wassiljewa']
const TUBE_TYPES = ['Smooth circular tube', 'Finned tube', 'Twisted tape insert']

// New coil geometry (junction-based) — tube material dropdown matches CoilSim names
const JUNCTION_TUBE_MATERIALS = [
  { label: 'Incoloy 800H (800/800H)',   code: 14 },
  { label: 'Incoloy 800 (800/800)',     code: 13 },
  { label: 'HP-40',                      code:  6 },
  { label: 'HK-40',                      code:  5 },
  { label: 'Incoloy 825',               code: 15 },
  { label: 'Inconel 600',               code: 16 },
  { label: '304 Stainless Steel',       code:  3 },
  { label: '316 Stainless Steel',       code:  4 },
  { label: 'Manaurite / Custom (19)',   code: 19 },
  { label: 'Custom — enter code',       code:  0 },
]
const JUNCTION_TUBE_TYPES = [
  { label: 'Smooth circular tube', code: 1 },
  { label: 'Finned tube',          code: 2 },
  { label: 'Rifled fin',           code: 3 },
]

// Generic coil coil-configuration options (CoilSim "Coil configuration" dropdown)
const GENERIC_COIL_CONFIGS = [
  'Single pass', 'U-tube (2 pass)', 'Serpentine (multi-pass)', 'Custom',
]

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
// Per-junction editable row for New coil geometry editor (matches CoilSim "New coil geometry" form)
interface JuncRow {
  _key: number
  z: string;        od_mm: string;   wall_mm: string
  angle: string;    radius: string
  mass_flow: string; tube_material_code: number; tube_type_code: number
  fin_dist: string; pitch: string; perim_ratio: string
  adiabatic: boolean
}
// Generic coil per-pass row (matches CoilSim "Generic coil" form)
interface GenericPassRow {
  _key: number
  tube_length: string; int_dia: string; wall_mm: string; n_parallel: string
}
interface GenericConnRow {
  _key: number; from_pass: string; to_pass: string; cl_spacing: string
}
// Parsed preview from uploaded reactor.txt (not directly editable, populates the table)
interface GenericJunction { i: number; z: number; od_mm: number; wall_mm: number; angle: number; radius: number; adiabatic: boolean }
function defaultLeg(n: number): LegRow {
  // Default dimensions from YSB_Geo_Operating (ncoil=2, 4-pass W-coil).
  // Leg 1 length is the heated section only — pre-volume (0.985 m) is separate.
  const lengths = [13.685, 13.250, 13.250, 13.695]
  const diams   = [0.090,  0.090,  0.100,  0.100]
  const bends   = [0.370,  0.510,  0.531,  0.370]
  return {
    length: lengths[n] ?? 14.0,
    diameter: diams[n] ?? 0.09,
    wall_thickness: 0.007,
    bend_length: bends[n] ?? 0.37,
    adiabatic: n === 3,   // last leg is adiabatic
  }
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
  const { data: uploadedProjects, mutate: mutateUploaded } = useSWR<{id:number;name:string;original_filename:string;file_size_bytes:number;created_at:string}[]>('/api/projects/uploaded', fetcher)

  const [step, setStep] = useState(0)

  // ── Step 0: Project ──────────────────────────────────────────────────────
  const [dcName,   setDcName]   = useState('')
  const [projName, setProjName] = useState('')
  const [useMode,  setUseMode]  = useState<'new'|'saved'|'upload'>('new')

  // ── Upload .proj mode ────────────────────────────────────────────────────
  const [uploadedProjId,   setUploadedProjId]   = useState<number | null>(null)
  const [uploadedProjName, setUploadedProjName] = useState('')
  const [uploadDragging,   setUploadDragging]   = useState(false)
  const [uploadError,      setUploadError]      = useState<string | null>(null)
  const [uploadUploading,  setUploadUploading]  = useState(false)

  // ── Step 1: Geometry selection ──────────────────────────────────────────
  const [geomSelection, setGeomSelection] = useState<'new'|'standard'|'import'|'generic' | null>(null)
  const [importGeomSubStep, setImportGeomSubStep] = useState<'coil_list'|'legs'>('coil_list')

  // ── Step 1: Coil type (legacy name kept for state) ───────────────────────
  const [selectedCoilType, setSelectedCoilType] = useState(COIL_TYPES[0])

  // ── Step 2: Geometry ─────────────────────────────────────────────────────
  const [savedCoilId, setSavedCoilId] = useState('')
  const [coilName, setCoilName] = useState('')
  const [passes, setPasses] = useState(COIL_TYPES[0].passes)
  const [legs, setLegs] = useState<LegRow[]>(
    Array.from({ length: COIL_TYPES[0].passes }, (_, i) => defaultLeg(i))
  )
  const [hasPrevol, setHasPrevol] = useState(true)
  const [preVolLength, setPreVolLength] = useState('0.985')
  const [hasAdvol, setHasAdvol] = useState(true)
  const [adVol,  setAdVol]  = useState('1.0')
  const [adDia,  setAdDia]  = useState('0.1')
  const [adWall, setAdWall] = useState('0.008')
  // Piping properties
  const [perimRatio,   setPerimRatio]   = useState('0.985')
  const [tubeMaterial, setTubeMaterial] = useState(TUBE_MATERIALS[0])
  const [gasCorrCorr,  setGasCorrCorr]  = useState(GAS_CONDUCTIVITY_CORRS[0])
  const [tubeType,     setTubeType]     = useState(TUBE_TYPES[0])
  // Generic coil mode (ncoil=1): junction table editor
  const [genericMode,       setGenericMode]       = useState(false)
  const [reactorTxtContent, setReactorTxtContent] = useState<string | null>(null)
  const [reactorTxtName,    setReactorTxtName]    = useState('')
  const [parsedJunctions,   setParsedJunctions]   = useState<GenericJunction[]>([])

  function defaultJuncRows(): JuncRow[] {
    return [
      { _key: 0, z: '0.000',  od_mm: '39.6', wall_mm: '8.5', angle: '0.0000', radius: '0.0000', mass_flow: '1.0', tube_material_code: 14, tube_type_code: 1, fin_dist: '0.0', pitch: '0.0', perim_ratio: '0.0', adiabatic: false },
      { _key: 1, z: '10.000', od_mm: '39.6', wall_mm: '8.5', angle: '3.1416', radius: '0.5000', mass_flow: '1.0', tube_material_code: 14, tube_type_code: 1, fin_dist: '0.0', pitch: '0.0', perim_ratio: '0.0', adiabatic: false },
      { _key: 2, z: '10.500', od_mm: '39.6', wall_mm: '8.5', angle: '0.0000', radius: '0.0000', mass_flow: '1.0', tube_material_code: 14, tube_type_code: 1, fin_dist: '0.0', pitch: '0.0', perim_ratio: '0.0', adiabatic: false },
    ]
  }
  const [juncRows,    setJuncRows]    = useState<JuncRow[]>(defaultJuncRows)
  const [juncKey,     setJuncKey]     = useState(3)
  const [corrFlags,   setCorrFlags]   = useState('0 1 0 0')
  const [enterAngle,  setEnterAngle]  = useState('3.14159')
  const [genericGas,  setGenericGas]  = useState(GAS_CONDUCTIVITY_CORRS[0])
  const [genericMat,  setGenericMat]  = useState('14')
  // New coil geometry adiabatic volume
  const [juncHasAdvol,  setJuncHasAdvol]  = useState(false)
  const [juncAdVol,     setJuncAdVol]     = useState('1.0')
  const [juncAdDia,     setJuncAdDia]     = useState('0.1')
  const [juncAdWall,    setJuncAdWall]    = useState('0.008')

  function addJunc() {
    const last = juncRows[juncRows.length - 1]
    setJuncRows(r => [...r, {
      _key: juncKey,
      z: last ? String((parseFloat(last.z) + 1).toFixed(3)) : '0.0',
      od_mm: last?.od_mm ?? '39.6', wall_mm: last?.wall_mm ?? '8.5',
      angle: '0.0000', radius: '0.0000',
      mass_flow: last?.mass_flow ?? '1.0',
      tube_material_code: last?.tube_material_code ?? 14,
      tube_type_code: last?.tube_type_code ?? 1,
      fin_dist: last?.fin_dist ?? '0.0',
      pitch: last?.pitch ?? '0.0',
      perim_ratio: last?.perim_ratio ?? '0.0',
      adiabatic: false,
    }])
    setJuncKey(k => k + 1)
  }
  function removeJunc(key: number) { setJuncRows(r => r.filter(j => j._key !== key)) }
  function updateJunc(key: number, field: keyof JuncRow, val: string | number | boolean) {
    setJuncRows(r => r.map(j => j._key !== key ? j : { ...j, [field]: val }))
  }

  // ── Generic coil state (per-pass, CoilSim "Generic coil" form) ────────────
  const [gcMode,        setGcMode]        = useState(false)  // true = Generic coil (not New coil geometry)
  const [gcConfig,      setGcConfig]      = useState(GENERIC_COIL_CONFIGS[0])
  const [gcPassRows,    setGcPassRows]    = useState<GenericPassRow[]>([
    { _key: 0, tube_length: '14.0', int_dia: '0.090', wall_mm: '7.0', n_parallel: '1' },
  ])
  const [gcConnRows,    setGcConnRows]    = useState<GenericConnRow[]>([])
  const [gcPassKey,     setGcPassKey]     = useState(1)
  const [gcConnKey,     setGcConnKey]     = useState(0)
  const [gcHasAdvol,    setGcHasAdvol]    = useState(false)
  const [gcAdVolume,    setGcAdVolume]    = useState('1.0')
  const [gcAdDia,       setGcAdDia]       = useState('0.1')
  const [gcJoining,     setGcJoining]     = useState('1')

  function addGcPass() {
    const last = gcPassRows[gcPassRows.length - 1]
    setGcPassRows(r => [...r, { _key: gcPassKey, tube_length: last?.tube_length ?? '14.0', int_dia: last?.int_dia ?? '0.090', wall_mm: last?.wall_mm ?? '7.0', n_parallel: last?.n_parallel ?? '1' }])
    setGcPassKey(k => k + 1)
  }
  function removeGcPass(key: number) { setGcPassRows(r => r.filter(p => p._key !== key)) }
  function updateGcPass(key: number, field: keyof GenericPassRow, val: string) {
    setGcPassRows(r => r.map(p => p._key !== key ? p : { ...p, [field]: val }))
  }
  function addGcConn() {
    setGcConnRows(r => [...r, { _key: gcConnKey, from_pass: '1', to_pass: '2', cl_spacing: '0.3' }])
    setGcConnKey(k => k + 1)
  }
  function removeGcConn(key: number) { setGcConnRows(r => r.filter(c => c._key !== key)) }
  function updateGcConn(key: number, field: keyof GenericConnRow, val: string) {
    setGcConnRows(r => r.map(c => c._key !== key ? c : { ...c, [field]: val }))
  }

  function handleCoilTypeSelect(ct: typeof COIL_TYPES[number]) {
    setSelectedCoilType(ct)
    setGenericMode(false)
    setGcMode(false)
    setPasses(ct.passes)
    setLegs(Array.from({ length: ct.passes }, (_, i) => defaultLeg(i)))
    setImportGeomSubStep('legs')  // switch to legs sub-step, do NOT auto-advance
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

  interface ParsedReactor {
    juncRows: JuncRow[]
    matCode: string; corrFlags: string; enterAngle: string; gasCorr: string
  }

  function parseReactorTxt(content: string): ParsedReactor | null {
    // Tokenize the entire file — 9-per-line grouping is cosmetic only
    const tokens = content.trim().split(/\s+/).filter(Boolean)
    let ti = 0
    const nextInt   = () => { const v = parseInt(tokens[ti++] ?? '0', 10); return isNaN(v) ? 0 : v }
    const nextFloat = () => { const v = parseFloat(tokens[ti++] ?? '0');   return isNaN(v) ? 0 : v }
    const readBlock = (n: number) => Array.from({ length: n }, nextFloat)

    const t0 = nextInt()
    if (t0 !== 1) return null   // must be ncoil=1 or the CoilSim prefix flag
    const t1 = nextInt()
    // Real CoilSim ncoil=1 files have an extra leading "1" before ncoil:
    //   Format A (CoilSim): 1 \n 1 \n N \n ...  (prefix, ncoil, junctions)
    //   Format B (worker):  1 \n N \n ...         (ncoil, junctions)
    // Detect by checking if t1 is also 1 (both tokens are 1 → Format A)
    let n: number
    if (t1 === 1) {
      n = nextInt()   // Format A: skip prefix + ncoil, read actual N
    } else {
      n = t1          // Format B: t0=ncoil, t1=N
    }
    if (n < 2 || n > 500) return null

    // Blocks 1–7
    const wallArr  = readBlock(n)   // wall thickness (m) → ×1000 = mm
    const circArr  = readBlock(n)   // circumference = π×OD (m) → /π×1000 = od_mm
    const pitchArr = readBlock(n)   // pitch (m) direct
    const axialArr = readBlock(n)   // axial position (m) direct
    const angleArr = readBlock(n)   // angle bend (rad) direct
    const radArr   = readBlock(n)   // radius bend (m) direct
    const flagArr  = readBlock(n)   // junction flags (0 or 4)

    // Single globals
    const matCode  = nextInt()
    const cf0 = nextInt(), cf1 = nextInt(), cf2 = nextInt(), cf3 = nextInt()

    // Blocks 8–11
    const typeArr    = readBlock(n)  // tube type integer
    const mflowArr   = readBlock(n)  // mass flow factor
    const findistArr = readBlock(n)  // fin distance (m) direct
    const perimArr   = readBlock(n)  // perimeter ratio direct

    // Trailing singles
    const enteringAngle = nextFloat()
    const gasCorrCode   = nextInt()

    let k = juncKey
    const juncRows: JuncRow[] = Array.from({ length: n }, (_, i) => ({
      _key:               k++,
      z:                  axialArr[i].toFixed(4),
      od_mm:              ((circArr[i] / Math.PI) * 1000).toFixed(2),
      wall_mm:            (wallArr[i] * 1000).toFixed(2),
      angle:              angleArr[i].toFixed(4),
      radius:             radArr[i].toFixed(4),
      mass_flow:          mflowArr[i].toFixed(3),
      tube_material_code: matCode,
      tube_type_code:     Math.round(typeArr[i]) || 1,
      fin_dist:           findistArr[i].toFixed(4),
      pitch:              pitchArr[i].toFixed(4),
      perim_ratio:        perimArr[i].toFixed(4),
      adiabatic:          Math.round(flagArr[i]) === 4,
    }))

    // gas_corr_code: 1=Modified Eucken, 0=Eucken, 2=Wassiljewa
    const GAS_CORR_MAP: Record<number, string> = {
      1: GAS_CONDUCTIVITY_CORRS[0],  // Modified Eucken
      0: GAS_CONDUCTIVITY_CORRS[1],  // Eucken
      2: GAS_CONDUCTIVITY_CORRS[2],  // Wassiljewa
    }
    return {
      juncRows,
      matCode:    String(matCode),
      corrFlags:  `${cf0} ${cf1} ${cf2} ${cf3}`,
      enterAngle: String(enteringAngle),
      gasCorr:    GAS_CORR_MAP[gasCorrCode] ?? GAS_CONDUCTIVITY_CORRS[0],
    }
  }

  function handleReactorTxtUpload(file: File) {
    file.text().then(text => {
      setReactorTxtContent(text)
      setReactorTxtName(file.name)
      const parsed = parseReactorTxt(text)
      if (parsed) {
        setJuncRows(parsed.juncRows)
        setJuncKey(k => k + parsed.juncRows.length)
        setGenericMat(parsed.matCode)
        setCorrFlags(parsed.corrFlags)
        setEnterAngle(parsed.enterAngle)
        setGenericGas(parsed.gasCorr)
        setParsedJunctions([])  // not used when editor is populated
      }
    })
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
  const [showCoilInfo, setShowCoilInfo] = useState<number | null>(null)

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

  // profileshape.i upload (written to burnerflux.da by worker for profile=5)
  const [profileshapeContent, setProfileshapeContent] = useState<string | null>(null)
  const [profileshapeName,    setProfileshapeName]    = useState<string>('')

  function handleProfileshapeUpload(file: File) {
    file.text().then(text => {
      const values = text.split('\n').map(l => l.trim()).filter(l => l !== '' && !isNaN(Number(l)))
      if (values.length === 0) return
      setProfileshapeContent(text)
      setProfileshapeName(file.name)
      // Populate axial pos vs flux rows: equally-spaced sections (index as axial pos)
      const n = values.length
      let k = fluxKey
      const rows: FluxRow[] = values.map((v, i) => ({
        _key: k++,
        z: String(i),
        q: String(parseFloat(v)),
      }))
      setFluxRows(rows)
      setFluxKey(k)
    })
  }

  // ── Step 5: Run Length ───────────────────────────────────────────────────
  const [runLengthSim,   setRunLengthSim]   = useState(false)
  const [cokeModel,      setCokeModel]      = useState<'Plehiers'|'Reyniers'>('Plehiers')
  const [cokeConduction, setCokeConduction] = useState('0.0045')
  const [cokeDensity,    setCokeDensity]    = useState('1600.0')

  // ── Submit ───────────────────────────────────────────────────────────────
  const [submitState, setSubmitState] = useState<'idle'|'loading'|'ok'|'err'>('idle')
  const [submitMsg,   setSubmitMsg]   = useState('')

  async function handleProjFileUpload(file: File) {
    if (!file.name.endsWith('.proj')) { setUploadError('Only .proj files accepted'); return }
    setUploadUploading(true); setUploadError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('name', uploadedProjName.trim() || file.name.replace('.proj', ''))
      const res = await fetch('/api/projects/upload', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setUploadError(data.error ?? 'Upload failed'); return }
      setUploadedProjId(data.id)
      setUploadedProjName(data.name)
      mutateUploaded()
    } catch {
      setUploadError('Network error during upload')
    } finally {
      setUploadUploading(false)
    }
  }

  async function submit() {
    setSubmitState('loading'); setSubmitMsg('')
    try {
      // ── Upload .proj mode ─────────────────────────────────────────────────
      if (useMode === 'upload') {
        if (!uploadedProjId || !projName.trim()) {
          setSubmitState('err'); setSubmitMsg('Select an uploaded project and enter a project folder name.'); return
        }
        const runRes = await fetch('/api/run', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'uploaded_proj',
            uploaded_proj_id: uploadedProjId,
            project_name: projName,
            design_case_name: dcName || projName,
            cot: Number(cotVal), flow: Number(flow),
            dilution: Number(dilut), cit: Number(cit), cip: Number(cip), cop: Number(cop),
            severity_type: sevType, flux_profile: profile,
            run_length_sim: runLengthSim ? 1 : 0,
            coke_model: cokeModel,
            coke_conduction: Number(cokeConduction),
            coke_density: Number(cokeDensity),
          }),
        })
        const json = await runRes.json()
        if (!runRes.ok) { setSubmitState('err'); setSubmitMsg(json.error ?? 'Failed'); return }
        setSubmitState('ok')
        setSubmitMsg(`Task #${json.id} queued. Worker will pick it up shortly.`)
        return
      }

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
        const prevolPayload = hasPrevol
          ? { pre_volume_enabled: true, pre_volume_length: Number(preVolLength) }
          : { pre_volume_enabled: false }

        const coilBody = geomSelection === 'generic'
          ? {
              /* Generic coil — per-pass with parallel tubes */
              name: coilName || `GenericCoil_${projName}`,
              ncoil: 99, legs: [], adiabatic_flag: gcHasAdvol,
              generic_data: {
                _generic_coil: true,
                coil_config:   gcConfig,
                joining:       parseInt(gcJoining) || 1,
                passes: gcPassRows.map((p, i) => ({
                  pass_id:     i + 1,
                  tube_length: parseFloat(p.tube_length) || 0,
                  int_dia:     parseFloat(p.int_dia)     || 0,
                  wall_mm:     parseFloat(p.wall_mm)     || 0,
                  n_parallel:  parseInt(p.n_parallel)    || 1,
                })),
                connections: gcConnRows.map(c => ({
                  from_pass:  parseInt(c.from_pass)   || 1,
                  to_pass:    parseInt(c.to_pass)      || 2,
                  cl_spacing: parseFloat(c.cl_spacing) || 0,
                })),
                adiabatic_volume:   gcHasAdvol ? parseFloat(gcAdVolume) : null,
                adiabatic_diameter: gcHasAdvol ? parseFloat(gcAdDia)    : null,
              },
            }
          : geomSelection === 'new'
          ? {
              /* New coil geometry — junction-based (ncoil=1) */
              name: coilName || `NewCoilGeo_${projName}`,
              ncoil: 1, legs: [], adiabatic_flag: juncHasAdvol,
              generic_data: {
                junctions: juncRows.map(j => ({
                  z:                 parseFloat(j.z)        || 0,
                  od_mm:             parseFloat(j.od_mm)    || 0,
                  wall_mm:           parseFloat(j.wall_mm)  || 0,
                  angle:             parseFloat(j.angle)    || 0,
                  radius:            parseFloat(j.radius)   || 0,
                  tube_type:         j.tube_type_code,
                  tube_material_code: j.tube_material_code,
                  mass_flow:         parseFloat(j.mass_flow)    || 1.0,
                  fin_dist:          parseFloat(j.fin_dist)     || 0.0,
                  pitch:             parseFloat(j.pitch)        || 0.0,
                  perim_ratio:       parseFloat(j.perim_ratio)  || 0.0,
                  adiabatic:         j.adiabatic,
                })),
                correction_flags: corrFlags.trim().split(/\s+/).map(Number),
                entering_angle:   parseFloat(enterAngle) || Math.PI,
                gas_corr_code:    GAS_CONDUCTIVITY_CORRS.indexOf(genericGas) + 1 || 1,
                adiabatic_volume:   juncHasAdvol ? parseFloat(juncAdVol)  : null,
                adiabatic_diameter: juncHasAdvol ? parseFloat(juncAdDia)  : null,
                adiabatic_wall:     juncHasAdvol ? parseFloat(juncAdWall) : null,
              },
            }
          : geomSelection === 'import'
          ? {
              /* Import coil geometry — reactor_txt stored verbatim */
              name: coilName || `ImportedCoil_${projName}`,
              ncoil: 0, legs: [], adiabatic_flag: false,
              reactor_txt: reactorTxtContent,
            }
          : {
              /* Standard named coil — legs-based */
              name: coilName || `${selectedCoilType.name}_${projName}`,
              ncoil: selectedCoilType.ncoil, legs: legsPayload,
              adiabatic_flag: hasAdvol, ...advolPayload, ...prevolPayload,
              perimeter_ratio: Number(perimRatio),
              tube_material: tubeMaterial,
              gas_conductivity_corr: gasCorrCorr,
              tube_type: tubeType,
            }

        const [coilRes, feedRes] = await Promise.all([
          fetch('/api/coil-geometries', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(coilBody),
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
          profileshape_i: profile === 5 && profileshapeContent ? profileshapeContent : undefined,
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
    if (step === 0 && useMode === 'upload') return projName.trim().length > 0 && uploadedProjId !== null
    if (step === 0) return projName.trim().length > 0
    if (step === 1) return geomSelection !== null  // auto-advances on card click, but kept for safety
    if (step === 2 && useMode === 'new') {
      if (geomSelection === 'standard' && importGeomSubStep === 'coil_list') return true
      if (geomSelection === 'standard' && importGeomSubStep === 'legs') return legs.length > 0
      if (geomSelection === 'new') return juncRows.length > 0
      if (geomSelection === 'import') return reactorTxtContent !== null
      if (geomSelection === 'generic') return gcPassRows.length > 0
      return true
    }
    if (step === 3 && useMode === 'new') return comps.length > 0 && feedName.trim().length > 0
    if (step === 4) return cotVal.trim().length > 0 && flow.trim().length > 0
    // step 5 (Run Length) — always valid
    return true
  }

  function next() {
    // Upload mode: skip geometry/feedstock steps
    if (useMode === 'upload' && step === 0) { setStep(4); return }
    if (step < STEPS.length - 1) setStep(s => s + 1)
  }
  function back() {
    // Reset submit state so the review page shows the Submit button again
    setSubmitState('idle')
    setSubmitMsg('')
    // Upload mode: skip back over geometry/feedstock steps
    if (useMode === 'upload' && step === 4) { setStep(0); return }
    if (step === 2 && geomSelection === 'standard' && importGeomSubStep === 'legs') {
      // Back within standard sub-step: go to coil_list, don't decrement step
      setImportGeomSubStep('coil_list')
      return
    }
    if (step > 0) setStep(s => s - 1)
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

          {/* Configuration source */}
          <div className="card space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Configuration source</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { m: 'new',    icon: '✏️', label: 'Define new',     desc: 'Enter geometry and feedstock from scratch' },
                { m: 'saved',  icon: '📁', label: 'Use saved',      desc: 'Pick from previously saved configurations' },
                { m: 'upload', icon: '☁️', label: 'Upload .proj',   desc: 'Use a client-supplied CoilSim project file' },
              ] as const).map(({ m, icon, label, desc }) => (
                <button key={m} onClick={() => setUseMode(m)}
                  className={`rounded-xl border p-4 text-left transition-all ${
                    useMode === m ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400 text-gray-700'
                  }`}>
                  <p className="text-sm font-semibold">{icon}  {label}</p>
                  <p className={`text-xs mt-1 ${useMode === m ? 'text-gray-300' : 'text-gray-400'}`}>{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {useMode === 'upload' && (
            <div className="card space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Upload .proj file</p>

              {/* Previously uploaded projects */}
              {(uploadedProjects ?? []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500">Previously uploaded — select one or upload new:</p>
                  {(uploadedProjects ?? []).map(up => (
                    <div key={up.id}
                      onClick={() => { setUploadedProjId(up.id); setUploadedProjName(up.name) }}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        uploadedProjId === up.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400'
                      }`}>
                      <span className="text-lg">📄</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{up.name}</div>
                        <div className="text-[10px] text-gray-400">{up.original_filename} · {(up.file_size_bytes / 1024).toFixed(1)} KB · {new Date(up.created_at).toLocaleDateString()}</div>
                      </div>
                      {uploadedProjId === up.id && <span className="text-blue-500 text-xs font-semibold">Selected</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Drag-drop upload */}
              <div>
                <div className="text-xs text-gray-500 mb-2">{(uploadedProjects ?? []).length > 0 ? 'Or upload a new file:' : 'Drag & drop a .proj file or click to browse:'}</div>
                <div
                  onDragOver={e => { e.preventDefault(); setUploadDragging(true) }}
                  onDragLeave={() => setUploadDragging(false)}
                  onDrop={e => { e.preventDefault(); setUploadDragging(false); const f = e.dataTransfer.files[0]; if (f) handleProjFileUpload(f) }}
                  className={`relative border-2 border-dashed rounded-xl p-6 text-center transition-colors ${uploadDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-400'}`}
                >
                  <input type="file" accept=".proj" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleProjFileUpload(f) }} />
                  {uploadUploading ? (
                    <p className="text-sm text-blue-500">Uploading…</p>
                  ) : (
                    <>
                      <p className="text-2xl mb-1">☁️</p>
                      <p className="text-sm text-gray-500">Drop .proj file here or click to browse</p>
                      <p className="text-[10px] text-gray-400 mt-1">Max 50 MB</p>
                    </>
                  )}
                </div>
                {uploadError && <p className="text-xs text-red-500 mt-1">{uploadError}</p>}
                {uploadedProjId && !uploadUploading && (
                  <p className="text-xs text-green-600 mt-1">✓ Using: {uploadedProjName}</p>
                )}
              </div>

              <p className="text-[11px] text-gray-400">
                The .proj file will be stored on the server. Geometry and feedstock settings come from the project file — you&apos;ll set COT, flow, and SHC in the next step.
              </p>
            </div>
          )}

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

      {/* ── STEP 1: Geometry Selection ────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Geometry</h2>
            <p className="text-sm text-gray-400 mt-1">Select how to define the furnace coil geometry, mirroring CoilSim's geometry dialog.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">

            {/* Card 1 — New coil geometry */}
            <button
              onClick={() => { setGeomSelection('new'); setGenericMode(true); setGcMode(false); setTimeout(() => setStep(s => s + 1), 80) }}
              className={`rounded-xl border p-5 text-left transition-all hover:shadow-sm relative ${
                geomSelection === 'new'
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow'
                  : 'border-dashed border-indigo-200 hover:border-indigo-400 text-gray-700'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-semibold">New coil geometry</p>
                <div className="flex gap-1">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'new' ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-500'}`}>NC</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'new' ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-500'}`}>n=1</span>
                </div>
              </div>
              <p className={`text-xs leading-relaxed ${geomSelection === 'new' ? 'text-indigo-100' : 'text-gray-400'}`}>
                Junction-by-junction definition · Up to 200 junctions
              </p>
            </button>

            {/* Card 2 — Standardized industrial coils */}
            <button
              onClick={() => { setGeomSelection('standard'); setGenericMode(false); setGcMode(false); setImportGeomSubStep('coil_list'); setTimeout(() => setStep(s => s + 1), 80) }}
              className={`rounded-xl border p-5 text-left transition-all hover:shadow-sm ${
                geomSelection === 'standard'
                  ? 'border-gray-900 bg-gray-900 text-white shadow'
                  : 'border-gray-200 hover:border-gray-400 text-gray-700'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-semibold">Standardized industrial coils</p>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'standard' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>STD</span>
              </div>
              <p className={`text-xs leading-relaxed ${geomSelection === 'standard' ? 'text-gray-300' : 'text-gray-400'}`}>
                Named industrial coil geometries · W-coil, U-coil, SRT variants, Millisecond, Technip, Linde, SL-2, M-coil
              </p>
            </button>

            {/* Card 3 — Import coil geometry */}
            <button
              onClick={() => { setGeomSelection('import'); setGenericMode(false); setGcMode(false); setTimeout(() => setStep(s => s + 1), 80) }}
              className={`rounded-xl border p-5 text-left transition-all hover:shadow-sm ${
                geomSelection === 'import'
                  ? 'border-amber-500 bg-amber-500 text-white shadow'
                  : 'border-dashed border-amber-200 hover:border-amber-400 text-gray-700'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-semibold">Import coil geometry</p>
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'import' ? 'bg-white/20 text-white' : 'bg-amber-50 text-amber-500'}`}>IMP</span>
              </div>
              <p className={`text-xs leading-relaxed ${geomSelection === 'import' ? 'text-amber-100' : 'text-gray-400'}`}>
                Upload an existing reactor.txt file · Stored verbatim, no editing required
              </p>
            </button>

            {/* Card 4 — Generic coil */}
            <button
              onClick={() => { setGeomSelection('generic'); setGenericMode(true); setGcMode(true); setTimeout(() => setStep(s => s + 1), 80) }}
              className={`rounded-xl border p-5 text-left transition-all hover:shadow-sm ${
                geomSelection === 'generic'
                  ? 'border-violet-600 bg-violet-600 text-white shadow'
                  : 'border-dashed border-violet-200 hover:border-violet-400 text-gray-700'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <p className="text-sm font-semibold">Generic coil</p>
                <div className="flex gap-1">
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'generic' ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-500'}`}>GC</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${geomSelection === 'generic' ? 'bg-white/20 text-white' : 'bg-violet-50 text-violet-500'}`}>gen</span>
                </div>
              </div>
              <p className={`text-xs leading-relaxed ${geomSelection === 'generic' ? 'text-violet-100' : 'text-gray-400'}`}>
                Per-pass with parallel tubes · Coil configuration + centreline spacing
              </p>
            </button>

          </div>
          {/* Back only — Continue is replaced by card click auto-advance */}
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-gray-100">
            <button onClick={back}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors flex items-center gap-1">
              ← Back
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Geometry ──────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">

          {useMode === 'saved' ? (
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Coil Geometry</h2>
              </div>
              <div className="card">
                <p className="text-sm text-gray-500">Using saved geometry — no edits required.</p>
              </div>
              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
            </>
          ) : geomSelection === 'standard' && importGeomSubStep === 'coil_list' ? (

            /* ── Standard: coil list ──────────────────────────────────── */
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Standardized Industrial Coils</h2>
                <p className="text-sm text-gray-400 mt-1">Select a named industrial coil geometry. This sets ncoil and pre-fills the pass dimensions.</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {COIL_TYPES.map(ct => (
                  <button key={ct.ncoil}
                    onClick={() => handleCoilTypeSelect(ct)}
                    className={`rounded-xl border p-4 text-left transition-all hover:shadow-sm ${
                      selectedCoilType.ncoil === ct.ncoil
                        ? 'border-gray-900 bg-gray-900 text-white shadow'
                        : 'border-gray-200 hover:border-gray-400 text-gray-700'
                    }`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-lg font-black font-mono ${selectedCoilType.ncoil === ct.ncoil ? 'text-white' : 'text-gray-300'}`}>
                        {ct.icon}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${selectedCoilType.ncoil === ct.ncoil ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>
                          n={ct.ncoil}
                        </span>
                        <button
                          onClick={e => { e.stopPropagation(); setShowCoilInfo(ct.ncoil) }}
                          className={`text-xs w-5 h-5 flex items-center justify-center rounded-full font-bold transition-colors ${
                            selectedCoilType.ncoil === ct.ncoil
                              ? 'bg-white/20 text-white hover:bg-white/35'
                              : 'bg-blue-50 text-blue-500 hover:bg-blue-100'
                          }`}
                          aria-label={`View ${ct.name} diagram`}
                        >i</button>
                      </div>
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
              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} nextLabel="Configure Geometry →" disabled={!canProceed()} />
            </>

          ) : geomSelection === 'standard' && importGeomSubStep === 'legs' ? (

            /* ── Standard: legs form ──────────────────────────────────── */
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Coil Geometry — {selectedCoilType.name}</h2>
                <p className="text-sm text-gray-400 mt-1">Pre-filled for {selectedCoilType.name}. Adjust dimensions as needed.</p>
              </div>

              {/* Geometry label */}
              <div className="card">
                <label className="block text-xs text-gray-500 mb-1">Geometry label</label>
                <input value={coilName}
                  onChange={e => setCoilName(e.target.value)}
                  placeholder={`${selectedCoilType.name}_${projName || 'geo'}`}
                  className={inp} />
              </div>

              <div className="card space-y-4">
                <div className="grid grid-cols-2 gap-3">
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

              {/* Pre-volume + Adiabatic volume */}
              <div className="grid grid-cols-2 gap-4">
                <div className="card">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={hasPrevol} onChange={e => setHasPrevol(e.target.checked)}
                      className="w-4 h-4 rounded accent-gray-900" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Adiabatic pre-volume</p>
                      <p className="text-xs text-gray-400">Unheated inlet section at the start of leg 1</p>
                    </div>
                  </label>
                  {hasPrevol && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <label className="block text-xs text-gray-500 mb-1">Length (m)</label>
                      <input type="number" step="0.001" value={preVolLength}
                        onChange={e => setPreVolLength(e.target.value)} className={inp} />
                    </div>
                  )}
                </div>
                <div className="card">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input type="checkbox" checked={hasAdvol} onChange={e => setHasAdvol(e.target.checked)}
                      className="w-4 h-4 rounded accent-gray-900" />
                    <div>
                      <p className="text-sm font-medium text-gray-700">Adiabatic volume</p>
                      <p className="text-xs text-gray-400">Transfer line volume after coil outlet before TLE quench</p>
                    </div>
                  </label>
                  {hasAdvol && (
                    <div className="grid grid-cols-1 gap-3 mt-4 pt-4 border-t border-gray-100">
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

              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
            </>

          ) : geomSelection === 'new' ? (

            /* ── New coil geometry (junction-based, ncoil=1) ─────────── */
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">New Coil Geometry</h2>
                <p className="text-sm text-gray-400 mt-1">Define junction-by-junction geometry. Enter each junction's dimensions, bend angles, and tube properties.</p>
              </div>

              {/* Geometry label */}
              <div className="card">
                <label className="block text-xs text-gray-500 mb-1">Geometry label</label>
                <input value={coilName}
                  onChange={e => setCoilName(e.target.value)}
                  placeholder={`NewCoilGeo_${projName || 'geo'}`}
                  className={inp} />
              </div>

              {/* Import from file shortcut */}
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500 flex-1">
                  Have an existing <code className="font-mono bg-white px-1 rounded border border-gray-200">reactor.txt</code>? Upload it to pre-fill the table.
                </p>
                <label className="cursor-pointer shrink-0">
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                    Import from file
                  </span>
                  <input type="file" accept=".txt" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleReactorTxtUpload(f) }} />
                </label>
                {reactorTxtName && <span className="text-xs text-emerald-600 font-medium shrink-0">{reactorTxtName}</span>}
              </div>

              {/* Junction table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Junctions (max 200)</p>
                    <p className="text-xs text-gray-400 mt-0.5">Angle bend: 0 = straight, π ≈ 3.1416 = U-bend. OD = outer diameter (mm).</p>
                  </div>
                  <button onClick={addJunc}
                    className="text-xs font-medium text-gray-700 border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors shrink-0">
                    + Add junction
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-xs" style={{ minWidth: '1100px' }}>
                    <thead className="bg-gray-50/80">
                      <tr>
                        {[
                          '#', 'Axial position (m)', 'OD (mm)', 'Angle bend (rad)', 'Radius bend (m)',
                          'Mass flow factor', 'Wall thickness (mm)', 'Tube Material', 'Tube Type',
                          'Fin distance (m)', 'Pitch (m)', 'Perim. ratio', 'Adiabatic', '',
                        ].map(h => (
                          <th key={h} className="text-left px-2 py-2 text-gray-400 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {juncRows.map((j, idx) => (
                        <tr key={j._key} className={`border-t border-gray-50 ${j.adiabatic ? 'bg-amber-50/60' : 'hover:bg-gray-50/40'}`}>
                          <td className="px-2 py-1 font-mono text-gray-400 text-[11px]">{idx + 1}</td>
                          {(['z', 'od_mm', 'angle', 'radius', 'mass_flow', 'wall_mm'] as const).map(f => (
                            <td key={f} className="px-1 py-1">
                              <input type="number" step="any" value={j[f]}
                                onChange={e => updateJunc(j._key, f, e.target.value)}
                                className="w-20 border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white" />
                            </td>
                          ))}
                          <td className="px-1 py-1">
                            <select value={j.tube_material_code}
                              onChange={e => updateJunc(j._key, 'tube_material_code', Number(e.target.value))}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ minWidth: 160 }}>
                              {JUNCTION_TUBE_MATERIALS.map(m => (
                                <option key={m.code} value={m.code}>{m.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1 py-1">
                            <select value={j.tube_type_code}
                              onChange={e => updateJunc(j._key, 'tube_type_code', Number(e.target.value))}
                              className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500" style={{ minWidth: 120 }}>
                              {JUNCTION_TUBE_TYPES.map(t => (
                                <option key={t.code} value={t.code}>{t.label}</option>
                              ))}
                            </select>
                          </td>
                          {(['fin_dist', 'pitch', 'perim_ratio'] as const).map(f => (
                            <td key={f} className="px-1 py-1">
                              <input type="number" step="any" value={j[f]}
                                onChange={e => updateJunc(j._key, f, e.target.value)}
                                className="w-16 border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white" />
                            </td>
                          ))}
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" checked={j.adiabatic}
                              onChange={e => updateJunc(j._key, 'adiabatic', e.target.checked)}
                              className="w-3.5 h-3.5 accent-amber-600" />
                          </td>
                          <td className="px-2 py-1">
                            <button onClick={() => removeJunc(j._key)}
                              className="text-gray-300 hover:text-red-500 text-[11px]">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/50 text-[11px] text-gray-400">
                  {juncRows.length} / 200 junctions
                </div>
              </div>

              {/* Global settings */}
              <div className="card space-y-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Global Settings</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Gas Conductivity Correlation</label>
                    <select value={genericGas} onChange={e => setGenericGas(e.target.value)} className={inp}>
                      {GAS_CONDUCTIVITY_CORRS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Entering Angle (rad)</label>
                    <input type="number" step="any" value={enterAngle}
                      onChange={e => setEnterAngle(e.target.value)} className={inp} />
                    <p className="text-[10px] text-gray-400 mt-0.5">π ≈ 3.14159 for axial entry</p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Correction flags (4 integers, space-separated)</label>
                    <input value={corrFlags} onChange={e => setCorrFlags(e.target.value)}
                      placeholder="0 1 0 0" className={inp} />
                    <p className="text-[10px] text-gray-400 mt-0.5">e.g. <code className="font-mono">0 1 1 1</code> for UTDFUR/rifled fin coils</p>
                  </div>
                </div>
              </div>

              {/* Adiabatic volume */}
              <div className="card">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={juncHasAdvol} onChange={e => setJuncHasAdvol(e.target.checked)}
                    className="w-4 h-4 rounded accent-gray-900" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Adiabatic volume</p>
                    <p className="text-xs text-gray-400">Transfer line volume after coil outlet before TLE quench</p>
                  </div>
                </label>
                {juncHasAdvol && (
                  <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-gray-100">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Volume (×10⁻³ m³)</label>
                      <input type="number" step="any" value={juncAdVol}
                        onChange={e => setJuncAdVol(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Diameter (m)</label>
                      <input type="number" step="any" value={juncAdDia}
                        onChange={e => setJuncAdDia(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Wall thickness (m)</label>
                      <input type="number" step="any" value={juncAdWall}
                        onChange={e => setJuncAdWall(e.target.value)} className={inp} />
                    </div>
                  </div>
                )}
              </div>

              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
            </>

          ) : geomSelection === 'import' ? (

            /* ── Import coil geometry ─────────────────────────────────── */
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Import Coil Geometry</h2>
                <p className="text-sm text-gray-400 mt-1">Upload a reactor.txt file. The raw file content will be stored and passed directly to CoilSim.</p>
              </div>

              {/* Geometry label */}
              <div className="card">
                <label className="block text-xs text-gray-500 mb-1">Geometry label</label>
                <input value={coilName}
                  onChange={e => setCoilName(e.target.value)}
                  placeholder={`ImportedCoil_${projName || 'geo'}`}
                  className={inp} />
              </div>

              {/* Upload area */}
              <div className="card space-y-4">
                <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-amber-200 bg-amber-50/40 px-6 py-10 cursor-pointer hover:border-amber-400 transition-colors">
                  <svg className="w-8 h-8 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <div className="text-center">
                    <p className="text-sm font-medium text-gray-700">Drop reactor.txt here or click to browse</p>
                    <p className="text-xs text-gray-400 mt-1">Accepts .txt files only</p>
                  </div>
                  <input type="file" accept=".txt" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { f.text().then(text => { setReactorTxtContent(text); setReactorTxtName(f.name) }) } }} />
                </label>
                {reactorTxtContent && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs text-emerald-700 font-medium">{reactorTxtName}</span>
                      <span className="text-xs text-emerald-500">
                        ({reactorTxtContent.split('\n').length} lines)
                      </span>
                    </div>
                    <button
                      onClick={() => { setReactorTxtContent(null); setReactorTxtName('') }}
                      className="text-emerald-400 hover:text-emerald-600 text-base leading-none"
                      title="Remove">×</button>
                  </div>
                )}
                <p className="text-[11px] text-gray-400">This file will be written verbatim to reactor.txt by the worker.</p>
              </div>

              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
            </>

          ) : geomSelection === 'generic' ? (

            /* ── Generic coil (per-pass, parallel tubes) ─────────────── */
            <>
              <div>
                <h2 className="text-base font-semibold text-gray-900">Generic Coil</h2>
                <p className="text-sm text-gray-400 mt-1">Per-pass geometry with parallel tubes. Define each pass and optional centreline spacing.</p>
              </div>

              {/* Geometry label */}
              <div className="card">
                <label className="block text-xs text-gray-500 mb-1">Geometry label</label>
                <input value={coilName}
                  onChange={e => setCoilName(e.target.value)}
                  placeholder={`GenericCoil_${projName || 'geo'}`}
                  className={inp} />
              </div>

              {/* Coil configuration */}
              <div className="card space-y-3">
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Coil configuration</label>
                    <select value={gcConfig} onChange={e => setGcConfig(e.target.value)} className={inp}>
                      {GENERIC_COIL_CONFIGS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Number of joining coil assemblies</label>
                    <input type="number" min={1} value={gcJoining}
                      onChange={e => setGcJoining(e.target.value)} className={inp} />
                  </div>
                </div>
              </div>

              {/* Pass table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Passes</p>
                    <p className="text-xs text-gray-400 mt-0.5">One row per pass. Diameter is tube internal diameter.</p>
                  </div>
                  <button onClick={addGcPass}
                    className="text-xs font-medium text-gray-700 border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
                    + Add pass
                  </button>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50/80">
                    <tr>
                      {['Pass ID', 'Straight heated tube length (m)', 'Tube internal diameter (m)', 'Tube wall thickness (m)', 'No. parallel tubes', ''].map(h => (
                        <th key={h} className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide text-[10px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {gcPassRows.map((p, idx) => (
                      <tr key={p._key} className="border-t border-gray-50 hover:bg-gray-50/50">
                        <td className="px-3 py-1.5 font-mono text-gray-400 text-[11px]">{idx + 1}</td>
                        {(['tube_length', 'int_dia', 'wall_mm', 'n_parallel'] as const).map(f => (
                          <td key={f} className="px-2 py-1">
                            <input type="number" step="any" value={p[f]}
                              onChange={e => updateGcPass(p._key, f, e.target.value)}
                              className="w-28 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900 bg-white" />
                          </td>
                        ))}
                        <td className="px-2 py-1">
                          <button onClick={() => removeGcPass(p._key)} className="text-gray-300 hover:text-red-500 text-[11px]">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Connections */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Centreline Spacing Between Passes</p>
                  <button onClick={addGcConn}
                    className="text-xs font-medium text-gray-700 border border-gray-200 bg-white rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
                    + Add
                  </button>
                </div>
                {gcConnRows.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-gray-400">No connections defined — optional.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50/80">
                      <tr>
                        {['From pass', 'To pass', 'Centreline spacing (m)', ''].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-gray-400 font-semibold uppercase tracking-wide text-[10px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gcConnRows.map(c => (
                        <tr key={c._key} className="border-t border-gray-50">
                          {(['from_pass', 'to_pass', 'cl_spacing'] as const).map(f => (
                            <td key={f} className="px-2 py-1">
                              <input type="number" step="any" value={c[f]}
                                onChange={e => updateGcConn(c._key, f, e.target.value)}
                                className="w-24 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-gray-900 bg-white" />
                            </td>
                          ))}
                          <td className="px-2 py-1">
                            <button onClick={() => removeGcConn(c._key)} className="text-gray-300 hover:text-red-500 text-[11px]">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Adiabatic volume */}
              <div className="card space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input type="checkbox" checked={gcHasAdvol} onChange={e => setGcHasAdvol(e.target.checked)}
                    className="w-4 h-4 rounded accent-gray-900" />
                  <div>
                    <p className="text-sm font-medium text-gray-700">Adiabatic volume</p>
                    <p className="text-xs text-gray-400">Transfer line volume after coil outlet</p>
                  </div>
                </label>
                {gcHasAdvol && (
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Internal volume (×10⁻³ m³)</label>
                      <input type="number" step="any" value={gcAdVolume}
                        onChange={e => setGcAdVolume(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Internal equivalent diameter (m)</label>
                      <input type="number" step="any" value={gcAdDia}
                        onChange={e => setGcAdDia(e.target.value)} className={inp} />
                    </div>
                  </div>
                )}
              </div>

              <Nav step={step} total={STEPS.length} onBack={back} onNext={next} disabled={!canProceed()} />
            </>

          ) : (
            /* fallback — shouldn't reach here */
            <div className="card">
              <p className="text-sm text-gray-500">No geometry type selected. Go back to Step 1.</p>
            </div>
          )}

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

                  {/* profileshape.i upload */}
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-500 hover:text-gray-800 transition-colors">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    Upload profileshape.i
                    <input type="file" accept=".i,.txt,.da" className="hidden"
                      onChange={e => {
                        const file = e.target.files?.[0]
                        if (file) handleProfileshapeUpload(file)
                        e.target.value = ''
                      }} />
                  </label>
                </div>

                {/* Confirmation badge when file is loaded */}
                {profileshapeContent && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-xs text-emerald-700 font-medium">{profileshapeName}</span>
                      <span className="text-xs text-emerald-500">
                        ({profileshapeContent.split('\n').filter(l => l.trim() !== '' && !isNaN(Number(l.trim()))).length} values)
                      </span>
                    </div>
                    <button
                      onClick={() => { setProfileshapeContent(null); setProfileshapeName('') }}
                      className="text-emerald-400 hover:text-emerald-600 text-base leading-none"
                      title="Remove"
                    >×</button>
                  </div>
                )}
                {profileshapeContent && (
                  <p className="text-[10px] text-emerald-600">
                    This file will be written to <code className="font-mono">burnerflux.da</code> by the worker — CoilSim will use it as the custom heat flux distribution.
                  </p>
                )}

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
                  : (coilName || (
                      geomSelection === 'new' ? `NewCoilGeo_${projName}` :
                      geomSelection === 'import' ? `ImportedCoil_${projName}` :
                      geomSelection === 'generic' ? `GenericCoil_${projName}` :
                      `${selectedCoilType.name}_${projName}`
                    ))}
              </p>
              <p className="text-xs text-gray-500">
                {geomSelection === 'standard'
                  ? `${selectedCoilType.name} · ncoil=${selectedCoilType.ncoil} · ${passes} passes`
                  : geomSelection === 'new'
                  ? `New coil geometry · ${juncRows.length} junctions`
                  : geomSelection === 'import'
                  ? `Imported geometry · ${reactorTxtName || '—'}`
                  : geomSelection === 'generic'
                  ? `Generic coil · ${gcPassRows.length} passes`
                  : '—'}
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

      {/* Coil diagram modal */}
      {showCoilInfo !== null && (() => {
        const coil = COIL_TYPES.find(c => c.ncoil === showCoilInfo)
        return coil ? <CoilInfoModal coil={coil} onClose={() => setShowCoilInfo(null)} /> : null
      })()}
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
