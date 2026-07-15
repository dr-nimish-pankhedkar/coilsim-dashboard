import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  const client = await pool.connect()
  try {
    const res = await client.query(
      `SELECT id, name, original_filename, file_size_bytes, created_at, deployed_at, deploy_error
       FROM cs_py_int.uploaded_projects ORDER BY id DESC`
    )
    return NextResponse.json(res.rows)
  } finally {
    client.release()
  }
}
