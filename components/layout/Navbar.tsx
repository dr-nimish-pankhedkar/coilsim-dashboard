'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import WorkerBadge from './WorkerBadge'

const links = [
  { href: '/', label: 'Dashboard' },
  { href: '/logs', label: 'Logs' },
  { href: '/configuration', label: 'Configuration' },
]

export default function Navbar() {
  const path = usePathname()
  return (
    <header className="border-b border-gray-100 bg-white sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <span className="font-semibold text-sm tracking-tight text-gray-900">
            CoilSim <span className="text-gray-400 font-normal">Digital Twin</span>
          </span>
          <nav className="flex gap-1">
            {links.map(l => (
              <Link
                key={l.href}
                href={l.href}
                className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                  path === l.href
                    ? 'bg-gray-100 text-gray-900 font-medium'
                    : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <WorkerBadge />
      </div>
    </header>
  )
}
