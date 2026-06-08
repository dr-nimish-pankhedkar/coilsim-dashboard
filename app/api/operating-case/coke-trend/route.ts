import { NextRequest, NextResponse } from 'next/server'
import { getCokeTrend } from '@/lib/queries'

export async function GET(req: NextRequest) {
  const coil = req.nextUrl.searchParams.get('coil')
  if (!coil) return NextResponse.json({ error: 'Missing coil param' }, { status: 400 })
  try {
    const rows = await getCokeTrend(Number(coil))
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
