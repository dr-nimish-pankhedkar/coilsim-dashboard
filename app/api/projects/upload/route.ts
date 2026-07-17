import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024  // 50 MB

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const name = (formData.get('name') as string | null)?.trim()

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!file.name.endsWith('.zip')) {
      return NextResponse.json({ error: 'Only .zip files are accepted' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: `File too large (max 50 MB, got ${(file.size / 1024 / 1024).toFixed(1)} MB)` }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const client = await pool.connect()
    try {
      const res = await client.query(
        `INSERT INTO cs_py_int.uploaded_projects (name, original_filename, file_data, file_size_bytes)
         VALUES ($1, $2, $3, $4) RETURNING id, name, original_filename, file_size_bytes, created_at`,
        [name, file.name, buffer, file.size]
      )
      return NextResponse.json(res.rows[0], { status: 201 })
    } finally {
      client.release()
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Upload failed' }, { status: 500 })
  }
}
