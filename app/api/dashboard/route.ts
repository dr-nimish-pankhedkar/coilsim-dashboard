import { NextResponse } from 'next/server'
import { getLatestTask, getProfileForTask, getYieldsForTask } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const task = await getLatestTask()
    if (!task) return NextResponse.json({ task: null, profiles: [], yields: [] })

    const [profiles, yields] = await Promise.all([
      getProfileForTask(task.id),
      getYieldsForTask(task.id),
    ])

    return NextResponse.json({ task, profiles, yields })
  } catch (err) {
    console.error('/api/dashboard error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
