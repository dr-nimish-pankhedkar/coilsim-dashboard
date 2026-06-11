import { NextResponse } from 'next/server'
import { getHeartbeat } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const hb = await getHeartbeat()
    if (!hb) return NextResponse.json({ alive: false, worker_name: null, last_pulse: null, status_message: null, current_task_id: null })

    // Append 'Z' so the string is always parsed as UTC regardless of DB timezone config
    // PostgreSQL returns "YYYY-MM-DD HH:MM:SS" (space, no TZ). Replace space with T
    // then append Z so JS gets a valid ISO 8601 UTC string to parse.
    const pulseStr = hb.last_pulse.includes('+') || hb.last_pulse.endsWith('Z')
      ? hb.last_pulse
      : hb.last_pulse.replace(' ', 'T') + 'Z'
    const ageMs = Date.now() - new Date(pulseStr).getTime()
    const alive = ageMs < 2 * 60 * 1000  // dead if pulse older than 2 min

    return NextResponse.json({ ...hb, alive, age_seconds: Math.round(ageMs / 1000) })
  } catch {
    return NextResponse.json({ alive: false, worker_name: null, last_pulse: null, status_message: null, current_task_id: null })
  }
}
