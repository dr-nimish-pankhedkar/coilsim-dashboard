import { NextRequest, NextResponse } from 'next/server'
import { submitHourlyRun, submitFreshRun } from '@/lib/queries'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type } = body

    if (type === 'hourly') {
      const { cot, flow } = body
      if (cot == null || flow == null) return NextResponse.json({ error: 'Missing cot or flow' }, { status: 400 })
      const id = await submitHourlyRun(Number(cot), Number(flow))
      return NextResponse.json({ id })
    }

    if (type === 'fresh') {
      const { coil_id, feed_id, cot, flow, project_name } = body
      if (!coil_id || !feed_id || cot == null || flow == null || !project_name) {
        return NextResponse.json({ error: 'Missing required fields for fresh run' }, { status: 400 })
      }
      const id = await submitFreshRun(Number(coil_id), Number(feed_id), Number(cot), Number(flow), project_name)
      return NextResponse.json({ id })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
