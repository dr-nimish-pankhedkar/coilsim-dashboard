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
    const { name, ncoil, legs, adiabatic_flag, reactor_txt, generic_data,
            perimeter_ratio, tube_material, gas_conductivity_corr, tube_type,
            adiabatic_diameter, adiabatic_wall,
            pre_volume_enabled, pre_volume_length } = body

    const isNewCoilGeo    = generic_data?.junctions?.length > 0
    const isGenericCoil   = generic_data?._generic_coil === true && generic_data?.passes?.length > 0
    const isGenericUpload = typeof reactor_txt === 'string' && reactor_txt.length > 0
    const isGeneric       = isNewCoilGeo || isGenericCoil || isGenericUpload

    if (!name || !ncoil || (!isGeneric && !legs?.length)) {
      return NextResponse.json(
        { error: 'Missing required fields: name, ncoil, and either legs (standard) or generic_data (new coil geometry / generic coil)' },
        { status: 400 }
      )
    }

    let extra: Record<string, unknown> = {}
    if (isNewCoilGeo) {
      // New coil geometry — junction-based (ncoil=1)
      extra = {
        _generic:           true,
        junctions:          generic_data.junctions,
        correction_flags:   generic_data.correction_flags ?? [0, 1, 0, 0],
        entering_angle:     Number(generic_data.entering_angle ?? Math.PI),
        gas_corr_code:      Number(generic_data.gas_corr_code ?? 1),
        adiabatic_volume:   generic_data.adiabatic_volume  ?? null,
        adiabatic_diameter: generic_data.adiabatic_diameter ?? null,
        adiabatic_wall:     generic_data.adiabatic_wall     ?? null,
      }
    } else if (isGenericCoil) {
      // Generic coil — per-pass with parallel tubes
      extra = {
        _generic_coil:      true,
        coil_config:        generic_data.coil_config   ?? 'Single pass',
        joining:            Number(generic_data.joining ?? 1),
        passes:             generic_data.passes,
        connections:        generic_data.connections   ?? [],
        adiabatic_volume:   generic_data.adiabatic_volume   ?? null,
        adiabatic_diameter: generic_data.adiabatic_diameter ?? null,
      }
    } else {
      if (perimeter_ratio    != null) extra.perimeter_ratio      = Number(perimeter_ratio)
      if (tube_material)               extra.tube_material        = tube_material
      if (gas_conductivity_corr)       extra.gas_conductivity_corr = gas_conductivity_corr
      if (tube_type)                   extra.tube_type            = tube_type
      if (adiabatic_diameter != null)  extra.adiabatic_diameter   = Number(adiabatic_diameter)
      if (adiabatic_wall     != null)  extra.adiabatic_wall_t     = Number(adiabatic_wall)
      if (pre_volume_enabled != null)  extra.pre_volume_enabled   = Boolean(pre_volume_enabled)
      if (pre_volume_length  != null)  extra.pre_volume_length    = Number(pre_volume_length)
    }

    const id = await insertCoilGeometry(
      name, Number(ncoil), legs ?? [], adiabatic_flag ?? false,
      Object.keys(extra).length ? extra : undefined,
      isGenericUpload ? reactor_txt : null,
    )
    return NextResponse.json({ id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Database error (coil geometry)' }, { status: 500 })
  }
}
