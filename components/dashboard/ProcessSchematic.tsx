interface Props {
  cot: number | null
  flow: number | null
}

export default function ProcessSchematic({ cot, flow }: Props) {
  const cotStr = cot != null ? cot.toFixed(1) : '—'
  const flowStr = flow != null ? flow.toFixed(0) : '—'

  return (
    <div className="card h-full">
      <p className="label mb-4">Process Schematic</p>
      <svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
        <defs>
          <marker id="arrow-blue" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#1976d2" />
          </marker>
          <marker id="arrow-red" markerWidth="8" markerHeight="8" refX="4" refY="3" orient="auto">
            <path d="M0,0 L0,6 L8,3 z" fill="#d32f2f" />
          </marker>
        </defs>

        {/* ── Feed label box (left) ── */}
        <rect x="4" y="6" width="118" height="52" rx="6" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="1" />
        <text x="63" y="24" fill="#1976d2" fontSize="15" fontFamily="sans-serif" fontWeight="700" textAnchor="middle">
          {flowStr} kg/h
        </text>
        <text x="63" y="40" fill="#6b7280" fontSize="10" fontFamily="sans-serif" textAnchor="middle">HC FEED</text>
        <text x="63" y="52" fill="#9ca3af" fontSize="9" fontFamily="sans-serif" textAnchor="middle">(DCS)</text>

        {/* Feed arrow — label box → tube top */}
        <line x1="107" y1="58" x2="107" y2="100" stroke="#1976d2" strokeWidth="2" markerEnd="url(#arrow-blue)" />

        {/* ── COT label box (right) ── */}
        <rect x="298" y="6" width="118" height="52" rx="6" fill="#fff5f5" stroke="#fecaca" strokeWidth="1" />
        <text x="357" y="24" fill="#d32f2f" fontSize="15" fontFamily="sans-serif" fontWeight="700" textAnchor="middle">
          {cotStr} °C
        </text>
        <text x="357" y="40" fill="#6b7280" fontSize="10" fontFamily="sans-serif" textAnchor="middle">COT</text>
        <text x="357" y="52" fill="#9ca3af" fontSize="9" fontFamily="sans-serif" textAnchor="middle">(DCS)</text>

        {/* COT arrow — tube top → label box */}
        <line x1="300" y1="100" x2="300" y2="58" stroke="#d32f2f" strokeWidth="2" markerEnd="url(#arrow-red)" />

        {/* ── Furnace shell ── */}
        <rect x="60" y="108" width="300" height="260" fill="#fafafa" stroke="#e5e7eb" strokeWidth="2" rx="4" />
        <line x1="60" y1="108" x2="360" y2="108" stroke="#374151" strokeWidth="3" />

        {/* ── Coil tubes ── */}
        <rect x="100" y="68" width="14" height="280" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="3" />
        <path d="M 100 348 Q 140 400 180 348" fill="none" stroke="#d97706" strokeWidth="12" strokeLinecap="round" />
        <rect x="173" y="158" width="14" height="190" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="3" />
        <path d="M 180 158 Q 210 106 240 158" fill="none" stroke="#d97706" strokeWidth="12" strokeLinecap="round" />
        <rect x="233" y="158" width="14" height="190" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="3" />
        <path d="M 240 348 Q 270 400 300 348" fill="none" stroke="#d97706" strokeWidth="12" strokeLinecap="round" />
        <rect x="293" y="68" width="14" height="280" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="3" />
      </svg>
    </div>
  )
}
