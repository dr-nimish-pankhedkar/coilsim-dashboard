import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const tag = req.nextUrl.searchParams.get('tag')
  if (!tag) return NextResponse.json({ error: 'Missing tag param' }, { status: 400 })

  const client = await pool.connect()
  try {
    const res = await client.query(
      `SELECT value FROM cs_py_int.hourly_data
       WHERE tag_name = $1 ORDER BY timestamp DESC LIMIT 1`,
      [tag]
    )
    if (!res.rows.length) return NextResponse.json({ found: false, latest_value: null })
    return NextResponse.json({ found: true, latest_value: Number(res.rows[0].value) })
  } finally {
    client.release()
  }
}
