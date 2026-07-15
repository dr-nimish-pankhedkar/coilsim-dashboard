import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json()
  const {
    severity_source,
    severity_tag,
    severity_override,
    cot_tag,
    base_cot,
    cot_to_conv_sensitivity,
  } = body

  if (!['dcs_tag', 'calculated', 'fixed'].includes(severity_source)) {
    return NextResponse.json({ error: 'Invalid severity_source' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { severity_source }
  if (severity_source === 'dcs_tag')    patch.severity_tag = severity_tag ?? null
  if (severity_source === 'calculated') {
    patch.cot_tag              = cot_tag ?? null
    patch.base_cot             = base_cot ?? 840.0
    patch.cot_to_conv_sensitivity = cot_to_conv_sensitivity ?? 0.30
  }
  if (severity_source === 'fixed' && severity_override != null) {
    patch.severity_nominal = severity_override
  }

  const client = await pool.connect()
  try {
    const res = await client.query(
      `UPDATE cs_py_int.design_cases
       SET case_params = COALESCE(case_params, '{}'::jsonb) || $1::jsonb
       WHERE id = $2
       RETURNING case_params`,
      [JSON.stringify(patch), id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ case_params: res.rows[0].case_params })
  } finally {
    client.release()
  }
}
