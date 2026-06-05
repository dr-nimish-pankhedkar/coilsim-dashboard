import { NextResponse } from 'next/server'
import { getAllYields } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getAllYields())
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
