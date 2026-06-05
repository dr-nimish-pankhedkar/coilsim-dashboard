'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import WorkerBadge from './WorkerBadge'

const links = [
  {
    href: '/',
    label: 'Dashboard',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5V21h6v-6h6v6h6v-7.5M3 13.5L12 3l9 10.5" />
      </svg>
    ),
  },
  {
    href: '/logs',
    label: 'Logs',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0120 9.414V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    href: '/configuration',
    label: 'Configuration',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const path = usePathname()

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-gray-100 flex flex-col sticky top-0 shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-gray-100">
        <p className="font-semibold text-sm text-gray-900 tracking-tight">CoilSim</p>
        <p className="text-xs text-gray-400 mt-0.5">Digital Twin</p>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 px-2 pb-2">Navigation</p>
        {links.map(l => {
          const active = path === l.href
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <span className={active ? 'text-white' : 'text-gray-400'}>{l.icon}</span>
              {l.label}
            </Link>
          )
        })}
      </nav>

      {/* Worker status at bottom */}
      <div className="px-4 py-4 border-t border-gray-100">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Worker Status</p>
        <WorkerBadge />
      </div>
    </aside>
  )
}
