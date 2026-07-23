import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const client = await pool.connect()
  try {
    const res = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'cs_py_int'
        AND table_name   = 'validation_reference_data'
        AND data_type IN (
          'numeric', 'double precision', 'real',
          'integer', 'bigint', 'smallint'
        )
      ORDER BY ordinal_position
    `)
    return NextResponse.json(res.rows.map((r: { column_name: string }) => r.column_name))
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
