import { NextResponse } from 'next/server'
import { getLatestTask, getLatestCompletedTask, getProfileForTask, getYieldsForTask } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Latest task (any status) for schematic/KPI display
    const task = await getLatestTask()
    if (!task) return NextResponse.json({ task: null, profiles: [], yields: [] })

    // Profiles and yields come from the latest *completed* run
    const completedTask = await getLatestCompletedTask()
    const [profiles, yields] = completedTask
      ? await Promise.all([
          getProfileForTask(completedTask.id),
          getYieldsForTask(completedTask.id),
        ])
      : [[], []]

    return NextResponse.json({ task, profiles, yields })
  } catch (err) {
    console.error('/api/dashboard error:', err)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
