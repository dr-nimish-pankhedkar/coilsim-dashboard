import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = parseInt(params.id)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(
      `DELETE FROM cs_py_int.uploaded_projects WHERE id = $1 RETURNING id`, [id]
    )
    if (!res.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ deleted: id })
  } finally {
    client.release()
  }
}
