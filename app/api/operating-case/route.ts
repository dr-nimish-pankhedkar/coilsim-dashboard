import { NextResponse } from 'next/server'
import { getOperatingCoilGrid } from '@/lib/queries'

export async function GET() {
  try {
    const grid = await getOperatingCoilGrid()
    return NextResponse.json(grid)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Database error' }, { status: 500 })
  }
}
