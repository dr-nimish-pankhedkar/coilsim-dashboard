import { NextResponse } from 'next/server'
import { getAllTasks } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getAllTasks())
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
