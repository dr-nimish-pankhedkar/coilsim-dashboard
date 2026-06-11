import { NextResponse } from 'next/server'
import { getHeartbeat } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const hb = await getHeartbeat()
    if (!hb) return NextResponse.json({ alive: false, worker_name: null, last_pulse: null, status_message: null, current_task_id: null })

    // pg returns timestamp columns as Date objects — use directly
    const pulse = new Date(hb.last_pulse as any)
    const ageMs = Date.now() - pulse.getTime()
    const alive = ageMs < 2 * 60 * 1000  // dead if pulse older than 2 min

    return NextResponse.json({ ...hb, alive, age_seconds: Math.round(ageMs / 1000) })
  } catch {
    return NextResponse.json({ alive: false, worker_name: null, last_pulse: null, status_message: null, current_task_id: null })
  }
}
