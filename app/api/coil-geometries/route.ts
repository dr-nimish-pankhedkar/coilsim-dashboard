import { NextRequest, NextResponse } from 'next/server'
import { getAllCoilGeometries, insertCoilGeometry } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getAllCoilGeometries())
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, ncoil, legs, adiabatic_flag } = body
    if (!name || !ncoil || !legs?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const id = await insertCoilGeometry(name, ncoil, legs, adiabatic_flag ?? false)
    return NextResponse.json({ id })
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
