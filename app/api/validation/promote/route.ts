import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const { design_case_id } = await req.json()
    if (!design_case_id) return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })

    const dcRes = await client.query(
      'SELECT id, name, validation_status, cot_bias_degc FROM cs_py_int.design_cases WHERE id = $1',
      [design_case_id]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Design case not found' }, { status: 404 })
    const dc = dcRes.rows[0]

    if (dc.validation_status !== 'complete') {
      return NextResponse.json(
        { error: `Cannot promote: validation_status is '${dc.validation_status}', must be 'complete'` },
        { status: 400 }
      )
    }

    await client.query('BEGIN')

    // Mark design case as validated
    await client.query(`
      UPDATE cs_py_int.design_cases
      SET validated_at = NOW(), validation_status = 'complete'
      WHERE id = $1
    `, [design_case_id])

    // Set as active model in app_settings
    await client.query(`
      INSERT INTO cs_py_int.app_settings (key, value)
      VALUES ('active_design_case_id', $1::text)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
    `, [design_case_id])

    await client.query('COMMIT')

    return NextResponse.json({
      success:      true,
      name:         dc.name,
      cot_bias:     dc.cot_bias_degc,
      next_review:  new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
