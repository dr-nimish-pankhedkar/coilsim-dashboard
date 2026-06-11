import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    // Remove related rows first (FK constraints)
    await pool.query('DELETE FROM cs_py_int.yield_history    WHERE task_id = $1', [id])
    await pool.query('DELETE FROM cs_py_int.profile_details  WHERE task_id = $1', [id])
    const res = await pool.query(
      'DELETE FROM cs_py_int.simulation_tasks WHERE id = $1 RETURNING id', [id]
    )
    if (!res.rowCount) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: id })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Database error' }, { status: 500 })
  }
}
