import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024  // 50 MB

const REQUIRED_FILES = [
  'exp.txt',
  'reactor.txt',
  'feed.txt',
  'units.txt',
  'FurnaceInput.txt',
  'profileshape.i',
  'corrections.txt',
]

const RECOMMENDED_FILES = [
  'nafta.i',
  'cokesprofiel.txt',
  'burnerflux.da',
]

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

    // ── Validate ZIP contents before saving ───────────────────────────────────
    const zip = await JSZip.loadAsync(buffer)

    // Collect filenames, stripping top-level folder prefix
    const zipEntries = Object.values(zip.files)
    const fileMap: Record<string, JSZip.JSZipObject> = {}
    for (const entry of zipEntries) {
      if (entry.dir) continue
      const parts = entry.name.split('/')
      const filename = parts.length > 1 ? parts[1] : parts[0]
      if (filename) fileMap[filename] = entry
    }
    const zipFiles = Object.keys(fileMap)

    // Check .proj file present
    const projFiles = zipFiles.filter(f => f.endsWith('.proj'))
    if (projFiles.length === 0) {
      return NextResponse.json({
        error: 'No .proj file found inside ZIP',
        found_files: zipFiles,
      }, { status: 400 })
    }

    // Check required files (present and non-empty)
    const missingRequired: string[] = []
    for (const fname of REQUIRED_FILES) {
      if (!fileMap[fname]) {
        missingRequired.push(fname)
      } else {
        const entry = fileMap[fname] as any
        const size = entry._data?.uncompressedSize ?? entry._data?.compressedSize ?? -1
        if (size === 0) {
          missingRequired.push(`${fname} (empty file)`)
        }
      }
    }

    const missingRecommended = RECOMMENDED_FILES.filter(f => !fileMap[f])

    if (missingRequired.length > 0) {
      return NextResponse.json({
        error: 'Missing required files',
        missing_required: missingRequired,
        missing_recommended: missingRecommended,
        found_files: zipFiles,
      }, { status: 400 })
    }
    // ─────────────────────────────────────────────────────────────────────────

    const client = await pool.connect()
    try {
      const res = await client.query(
        `INSERT INTO cs_py_int.uploaded_projects (name, original_filename, file_data, file_size_bytes)
         VALUES ($1, $2, $3, $4) RETURNING id, name, original_filename, file_size_bytes, created_at`,
        [name, file.name, buffer, file.size]
      )
      return NextResponse.json({
        ...res.rows[0],
        missing_recommended: missingRecommended,
      }, { status: 201 })
    } finally {
      client.release()
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Upload failed' }, { status: 500 })
  }
}
