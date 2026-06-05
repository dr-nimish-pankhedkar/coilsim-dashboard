import { NextResponse } from 'next/server'
import { getHeartbeat } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const hb = await getHeartbeat()
    return NextResponse.json(hb ?? { last_pulse: null })
  } catch {
    return NextResponse.json({ last_pulse: null })
  }
}
