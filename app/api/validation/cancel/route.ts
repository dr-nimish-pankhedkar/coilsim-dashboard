import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { design_case_id } = await req.json()
  if (!design_case_id) {
    return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Cancel all pending simulation tasks for this run
    const cancelled = await client.query(`
      UPDATE cs_py_int.simulation_tasks
      SET status = 'Error', error_message = 'Cancelled by user'
      WHERE design_case_id = $1
        AND task_type = 'validation'
        AND status = 'Pending'
      RETURNING id
    `, [design_case_id])

    // Reset design case back to pending so a new run can start
    await client.query(`
      UPDATE cs_py_int.design_cases
      SET validation_status      = 'pending',
          validation_runs_total  = NULL,
          validation_runs_failed = NULL
      WHERE id = $1
    `, [design_case_id])

    await client.query('COMMIT')

    return NextResponse.json({
      ok: true,
      cancelled_tasks: cancelled.rowCount ?? 0,
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
