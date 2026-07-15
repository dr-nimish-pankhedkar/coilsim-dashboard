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
      `SELECT verification_status, verified_at, verification_error,
              severity_type_parsed, severity_nominal, case_params
       FROM cs_py_int.design_cases WHERE id = $1`,
      [id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const row = res.rows[0]
    return NextResponse.json({
      verification_status: row.verification_status ?? 'pending',
      verified_at:         row.verified_at,
      verification_error:  row.verification_error,
      severity_type:       row.severity_type_parsed,
      severity_nominal:    row.severity_nominal ? Number(row.severity_nominal) : null,
      case_params:         row.case_params ?? {},
    })
  } finally {
    client.release()
  }
}

// POST — retry verification: re-queue a verification task
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const client = await pool.connect()
  try {
    // Reset status to pending
    await client.query(
      `UPDATE cs_py_int.design_cases
       SET verification_status = 'pending', verified_at = NULL, verification_error = NULL
       WHERE id = $1`,
      [id]
    )
    // Insert a new verification task
    const taskRes = await client.query(
      `INSERT INTO cs_py_int.simulation_tasks (task_type, design_case_id, status, created_at)
       VALUES ('verification', $1, 'Pending', NOW()) RETURNING id`,
      [id]
    )
    const taskId = taskRes.rows[0].id
    return NextResponse.json({ task_id: taskId })
  } finally {
    client.release()
  }
}
