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
    const { name, ncoil, legs, adiabatic_flag,
            perimeter_ratio, tube_material, gas_conductivity_corr, tube_type,
            adiabatic_diameter, adiabatic_wall,
            pre_volume_enabled, pre_volume_length } = body
    if (!name || !ncoil || !legs?.length) {
      return NextResponse.json({ error: 'Missing required fields: name, ncoil, legs' }, { status: 400 })
    }
    const extra: Record<string, unknown> = {}
    if (perimeter_ratio    != null) extra.perimeter_ratio      = Number(perimeter_ratio)
    if (tube_material)               extra.tube_material        = tube_material
    if (gas_conductivity_corr)       extra.gas_conductivity_corr = gas_conductivity_corr
    if (tube_type)                   extra.tube_type            = tube_type
    if (adiabatic_diameter != null)  extra.adiabatic_diameter   = Number(adiabatic_diameter)
    if (adiabatic_wall     != null)  extra.adiabatic_wall_t     = Number(adiabatic_wall)
    if (pre_volume_enabled != null)  extra.pre_volume_enabled   = Boolean(pre_volume_enabled)
    if (pre_volume_length  != null)  extra.pre_volume_length    = Number(pre_volume_length)
    const id = await insertCoilGeometry(
      name, Number(ncoil), legs, adiabatic_flag ?? false,
      Object.keys(extra).length ? extra : undefined
    )
    return NextResponse.json({ id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Database error (coil geometry)' }, { status: 500 })
  }
}
