import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const body = await req.json()
    const {
      design_case_id,
      expected_yields,   // { "C2H4": 52.0, "H2": 3.5, ... }
      cot_input,
      flow_input,
      dilution_ratio,
      cit_input,
      cip_input,
      cop_input,
    } = body

    if (!design_case_id || !expected_yields || !cot_input || !flow_input) {
      return NextResponse.json(
        { error: 'design_case_id, expected_yields, cot_input, flow_input required' },
        { status: 400 }
      )
    }

    const dcRes = await client.query(
      'SELECT project_name FROM cs_py_int.design_cases WHERE id = $1',
      [design_case_id]
    )
    if (!dcRes.rows.length) {
      return NextResponse.json({ error: 'Design case not found' }, { status: 404 })
    }

    await client.query('BEGIN')

    // Save expected_yields and mark running
    await client.query(
      `UPDATE cs_py_int.design_cases
       SET expected_yields          = $1,
           design_validation_status = 'running',
           design_validation_result = NULL
       WHERE id = $2`,
      [JSON.stringify(expected_yields), design_case_id]
    )

    // Queue simulation task
    const taskRes = await client.query<{ id: number }>(
      `INSERT INTO cs_py_int.simulation_tasks
         (status, task_type, project_name, design_case_id,
          cot_input, flow_input, dilution_ratio, cit_input, cip_input, cop_input)
       VALUES ('Pending', 'design_validation', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        dcRes.rows[0].project_name,
        design_case_id,
        Number(cot_input),
        Number(flow_input),
        dilution_ratio != null ? Number(dilution_ratio) : null,
        cit_input      != null ? Number(cit_input)      : null,
        cip_input      != null ? Number(cip_input)      : null,
        cop_input      != null ? Number(cop_input)      : null,
      ]
    )

    await client.query('COMMIT')
    return NextResponse.json({ task_id: taskRes.rows[0].id }, { status: 201 })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
