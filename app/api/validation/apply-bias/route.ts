import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { design_case_id, apply } = await req.json()
    if (!design_case_id || typeof apply !== 'boolean') {
      return NextResponse.json({ error: 'design_case_id and apply (boolean) required' }, { status: 400 })
    }
    await pool.query(
      'UPDATE cs_py_int.design_cases SET apply_cot_bias = $1 WHERE id = $2',
      [apply, design_case_id]
    )
    return NextResponse.json({ ok: true, apply_cot_bias: apply })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
