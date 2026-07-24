import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { design_case_id: string } }
) {
  const id = Number(params.design_case_id)
  if (!id) return NextResponse.json({ error: 'Invalid design_case_id' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(
      `SELECT design_validation_status, design_validation_result, expected_yields,
              design_cot_bias_degc, severity_type_parsed, severity_nominal, case_params
       FROM cs_py_int.design_cases WHERE id = $1`,
      [id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(res.rows[0])
  } finally {
    client.release()
  }
}
