import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Sidebar from '@/components/layout/Sidebar'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'CoilSim Digital Twin',
  description: 'Real-time cracking furnace simulation dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-gray-50 flex">
        <Sidebar />
        <main className="flex-1 min-w-0 p-8">{children}</main>
      </body>
    </html>
  )
}
