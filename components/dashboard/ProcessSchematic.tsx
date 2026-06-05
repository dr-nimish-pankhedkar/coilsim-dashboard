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
      <svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" className="w-full h-auto">
        <defs>
          <marker id="ar" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#d32f2f" />
          </marker>
          <marker id="ab" markerWidth="8" markerHeight="8" refX="0" refY="3" orient="auto">
            <path d="M0,0 L0,6 L9,3 z" fill="#1976d2" />
          </marker>
        </defs>

        {/* Furnace shell */}
        <rect x="60" y="110" width="280" height="240" fill="#fafafa" stroke="#e5e7eb" strokeWidth="2" rx="4" />
        <line x1="60" y1="110" x2="340" y2="110" stroke="#374151" strokeWidth="3" />

        {/* Coil tubes */}
        <rect x="100" y="70" width="12" height="260" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="2" />
        <path d="M 100 330 Q 135 380 170 330" fill="none" stroke="#d97706" strokeWidth="10" strokeLinecap="round" />
        <rect x="163" y="150" width="12" height="180" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="2" />
        <path d="M 170 150 Q 200 100 230 150" fill="none" stroke="#d97706" strokeWidth="10" strokeLinecap="round" />
        <rect x="223" y="150" width="12" height="180" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="2" />
        <path d="M 230 330 Q 265 380 300 330" fill="none" stroke="#d97706" strokeWidth="10" strokeLinecap="round" />
        <rect x="293" y="70" width="12" height="260" fill="#f59e0b" stroke="#d97706" strokeWidth="1" rx="2" />

        {/* Feed arrow */}
        <line x1="107" y1="22" x2="107" y2="62" stroke="#1976d2" strokeWidth="2.5" markerEnd="url(#ab)" />
        <text x="107" y="17" fill="#1976d2" fontSize="13" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">
          {flowStr} kg/h
        </text>
        <text x="107" y="32" fill="#9ca3af" fontSize="9" fontFamily="sans-serif" textAnchor="middle">
          HC FEED (DCS)
        </text>

        {/* COT arrow */}
        <line x1="300" y1="62" x2="300" y2="22" stroke="#d32f2f" strokeWidth="2.5" markerEnd="url(#ar)" />
        <text x="300" y="17" fill="#d32f2f" fontSize="13" fontFamily="sans-serif" fontWeight="600" textAnchor="middle">
          {cotStr} °C
        </text>
        <text x="300" y="32" fill="#9ca3af" fontSize="9" fontFamily="sans-serif" textAnchor="middle">
          COT (DCS)
        </text>
      </svg>
    </div>
  )
}
