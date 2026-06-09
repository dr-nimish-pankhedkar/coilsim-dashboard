import { NextRequest, NextResponse } from 'next/server'
import { submitHourlyRun, submitDesignCaseRun, RunParams } from '@/lib/queries'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type } = body

    const runParams: RunParams = {
      cot:                  Number(body.cot),
      flow:                 Number(body.flow),
      dilution:             body.dilution             != null ? Number(body.dilution)             : undefined,
      cit:                  body.cit                  != null ? Number(body.cit)                  : undefined,
      cip:                  body.cip                  != null ? Number(body.cip)                  : undefined,
      cop:                  body.cop                  != null ? Number(body.cop)                  : undefined,
      severity_type:        body.severity_type        != null ? Number(body.severity_type)        : undefined,
      sev_location:         body.sev_location         ?? undefined,
      sev_location_pct:     body.sev_location_pct     != null ? Number(body.sev_location_pct)     : undefined,
      pressure_sev_type:    body.pressure_sev_type    ?? undefined,
      pressure_location:    body.pressure_location    ?? undefined,
      pressure_location_pct: body.pressure_location_pct != null ? Number(body.pressure_location_pct) : undefined,
      heat_flux_input_type: body.heat_flux_input_type ?? undefined,
      flux_profile:         body.flux_profile         != null ? Number(body.flux_profile)         : undefined,
      run_length_sim:       body.run_length_sim        != null ? Number(body.run_length_sim)       : undefined,
      coke_model:           body.coke_model            ?? undefined,
      coke_conduction:      body.coke_conduction       != null ? Number(body.coke_conduction)      : undefined,
      coke_density:         body.coke_density          != null ? Number(body.coke_density)         : undefined,
    }

    if (!runParams.cot || !runParams.flow) {
      return NextResponse.json({ error: 'Missing cot or flow' }, { status: 400 })
    }

    if (type === 'hourly') {
      const id = await submitHourlyRun(runParams)
      return NextResponse.json({ id })
    }

    if (type === 'design_case' || type === 'fresh') {
      const { coil_id, feed_id, project_name } = body
      if (!coil_id || !feed_id || !project_name) {
        return NextResponse.json({ error: 'Missing coil_id, feed_id, or project_name' }, { status: 400 })
      }
      const id = await submitDesignCaseRun(Number(coil_id), Number(feed_id), project_name, runParams)
      return NextResponse.json({ id })
    }

    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err: any) {
    // If the extra columns don't exist yet, give a clear message
    const msg = err?.message ?? 'Database error'
    const isColumn = msg.includes('column') && msg.includes('does not exist')
    return NextResponse.json(
      { error: isColumn ? 'DB schema needs migration — run the ALTER TABLE script' : msg },
      { status: 500 }
    )
  }
}
