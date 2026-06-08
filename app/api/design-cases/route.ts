import { NextRequest, NextResponse } from 'next/server'
import { getAllDesignCases, insertDesignCase } from '@/lib/queries'

export async function GET() {
  try {
    const cases = await getAllDesignCases()
    return NextResponse.json(cases)
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, coil_id, feed_id, project_name } = await req.json()
    if (!name || !coil_id || !feed_id || !project_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const id = await insertDesignCase(name, Number(coil_id), Number(feed_id), project_name)
    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
