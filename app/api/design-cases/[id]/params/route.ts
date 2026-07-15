import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(
      `SELECT case_params FROM cs_py_int.design_cases WHERE id = $1`, [id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(res.rows[0].case_params ?? {})
  } finally {
    client.release()
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json()
  const { severity_type, active_inputs, kpi_outputs } = body

  const client = await pool.connect()
  try {
    const res = await client.query(
      `UPDATE cs_py_int.design_cases
       SET case_params = $1
       WHERE id = $2
       RETURNING id, case_params`,
      [JSON.stringify({ severity_type, active_inputs, kpi_outputs }), id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(res.rows[0])
  } finally {
    client.release()
  }
}
