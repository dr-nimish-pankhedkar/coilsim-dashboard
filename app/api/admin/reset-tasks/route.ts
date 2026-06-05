import { NextRequest, NextResponse } from 'next/server'
import { resetStuckTasks } from '@/lib/queries'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const count = await resetStuckTasks()
    return NextResponse.json({ reset: count })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
