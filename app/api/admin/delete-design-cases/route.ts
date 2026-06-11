import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Only delete dashboard-configured cases (coil_id IS NOT NULL)
    // Leaves .proj-registered cases (coil_id IS NULL) untouched
    //
    // Must nullify design_case_id on tasks first — FK constraint blocks DELETE otherwise.
    // Task history (yields, profiles) is preserved; the design case reference just becomes NULL.
    await pool.query(`
      UPDATE cs_py_int.simulation_tasks
      SET design_case_id = NULL
      WHERE design_case_id IN (
        SELECT id FROM cs_py_int.design_cases WHERE coil_id IS NOT NULL
      )
    `)
    const res = await pool.query(
      `DELETE FROM cs_py_int.design_cases WHERE coil_id IS NOT NULL RETURNING id`
    )
    return NextResponse.json({ deleted: res.rowCount ?? 0 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Database error' }, { status: 500 })
  }
}
