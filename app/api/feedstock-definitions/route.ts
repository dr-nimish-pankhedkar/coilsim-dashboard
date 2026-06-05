import { NextRequest, NextResponse } from 'next/server'
import { getAllFeedstockDefinitions, insertFeedstockDefinition } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getAllFeedstockDefinitions())
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, components, product_ids } = body
    if (!name || !components?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const id = await insertFeedstockDefinition(name, components, product_ids ?? [])
    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
