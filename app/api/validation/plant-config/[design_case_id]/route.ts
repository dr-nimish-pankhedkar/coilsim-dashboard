import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

type Ctx = { params: { design_case_id: string } }

const VRD_COLUMNS = [
  'plant_c2h4_mt_hr', 'plant_h2_ch4_mt_hr',
  'plant_c2h6_mt_hr', 'plant_c3plus_mt_hr',
  'mass_balance_error_pct', 'recycle_ethane_mt_hr',
  'feed_from_aramco_mt_hr', 'total_hc_flow_mt_hr',
  'aramco_feed_normalized_ethane_pct',
  'fur1_cot','fur2_cot','fur3_cot','fur4_cot','fur5_cot',
  'fur6_cot','fur7_cot','fur8_cot','fur9_cot',
]

// Validate a single tag against hourly_data, then validation_reference_data
async function checkTag(client: any, tagName: string) {
  try {
    // 1. Check hourly_data first
    const r = await client.query(
      `SELECT value, timestamp FROM cs_py_int.hourly_data
       WHERE tag_name = $1 ORDER BY timestamp DESC LIMIT 1`,
      [tagName]
    )
    if (r.rows.length) {
      const row = r.rows[0]
      return {
        tag_name:     tagName,
        exists:       true,
        sample_value: row.value != null ? parseFloat(row.value) : null,
        last_seen:    row.timestamp ? new Date(row.timestamp).toISOString() : null,
      }
    }

    // 2. Fall back to validation_reference_data for known VRD columns
    if (VRD_COLUMNS.includes(tagName)) {
      const vr = await client.query(
        `SELECT "${tagName}" as value, timestamp
         FROM cs_py_int.validation_reference_data
         WHERE "${tagName}" IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`
      )
      if (vr.rows.length) {
        const row = vr.rows[0]
        return {
          tag_name:     tagName,
          exists:       true,
          sample_value: row.value != null ? parseFloat(row.value) : null,
          last_seen:    row.timestamp ? new Date(row.timestamp).toISOString() : null,
          source:       'validation_reference_data',
        }
      }
    }

    return { tag_name: tagName, exists: false, sample_value: null, last_seen: null }
  } catch {
    return { tag_name: tagName, exists: false, sample_value: null, last_seen: null }
  }
}

// GET /api/validation/plant-config/[design_case_id]
// ?check_tag=TAG_NAME — lightweight single-tag check (used by UI on blur)
export async function GET(req: NextRequest, { params }: Ctx) {
  const dcId = parseInt(params.design_case_id, 10)
  if (isNaN(dcId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const checkTagParam = req.nextUrl.searchParams.get('check_tag')
  const client = await pool.connect()
  try {
    // Lightweight single-tag check
    if (checkTagParam) {
      const result = await checkTag(client, checkTagParam)
      return NextResponse.json(result)
    }

    // Full config load
    const dcRes = await client.query(
      `SELECT plant_data_mode, fuel_gas_flow_tag, fuel_gas_lhv_kj_kg
       FROM cs_py_int.design_cases WHERE id = $1`,
      [dcId]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const dc = dcRes.rows[0]

    // Saved tags
    const tagsRes = await client.query(
      `SELECT furnace_id, pass_id, tag_name, tag_unit
       FROM cs_py_int.plant_yield_tags WHERE design_case_id = $1
       ORDER BY COALESCE(furnace_id,''), COALESCE(pass_id,'')`,
      [dcId]
    )

    // Available furnaces & passes from DCS history (simulation_tasks, hourly task type)
    const furnaceRes = await client.query(`
      SELECT DISTINCT furnace_id FROM cs_py_int.simulation_tasks
      WHERE task_type != 'validation' AND furnace_id IS NOT NULL
      ORDER BY furnace_id
      LIMIT 40
    `).catch(() => ({ rows: [] as any[] }))

    const passRes = await client.query(`
      SELECT DISTINCT furnace_id, pass_id FROM cs_py_int.simulation_tasks
      WHERE task_type != 'validation' AND furnace_id IS NOT NULL AND pass_id IS NOT NULL
      ORDER BY furnace_id, pass_id
      LIMIT 40
    `).catch(() => ({ rows: [] as any[] }))

    // Validate each saved tag
    const tagValidation = await Promise.all(
      tagsRes.rows.map((t: any) => checkTag(client, t.tag_name))
    )

    return NextResponse.json({
      plant_data_mode:    dc.plant_data_mode,
      fuel_gas_flow_tag:  dc.fuel_gas_flow_tag,
      fuel_gas_lhv_kj_kg: parseFloat(dc.fuel_gas_lhv_kj_kg) || 47000,
      tags:               tagsRes.rows,
      furnaces:           furnaceRes.rows.map((r: any) => r.furnace_id),
      passes:             passRes.rows.map((r: any) => ({ furnace_id: r.furnace_id, pass_id: r.pass_id })),
      tag_validation:     tagValidation,
    })
  } finally {
    client.release()
  }
}

// POST /api/validation/plant-config/[design_case_id]
export async function POST(req: NextRequest, { params }: Ctx) {
  const dcId = parseInt(params.design_case_id, 10)
  if (isNaN(dcId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = await req.json()
  const { plant_data_mode, tags, fuel_gas_flow_tag, fuel_gas_lhv_kj_kg } = body

  if (!plant_data_mode) return NextResponse.json({ error: 'plant_data_mode required' }, { status: 400 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Update design case columns
    await client.query(
      `UPDATE cs_py_int.design_cases SET
         plant_data_mode    = $1,
         fuel_gas_flow_tag  = $2,
         fuel_gas_lhv_kj_kg = $3
       WHERE id = $4`,
      [plant_data_mode, fuel_gas_flow_tag || null, fuel_gas_lhv_kj_kg || 47000, dcId]
    )

    // Delete existing tags and re-insert (clean replace)
    await client.query(
      'DELETE FROM cs_py_int.plant_yield_tags WHERE design_case_id = $1',
      [dcId]
    )

    for (const tag of (tags ?? [])) {
      if (!tag.tag_name?.trim()) continue
      await client.query(
        `INSERT INTO cs_py_int.plant_yield_tags
           (design_case_id, mode, furnace_id, pass_id, tag_name, tag_unit)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (design_case_id, COALESCE(furnace_id,''), COALESCE(pass_id,''))
         DO UPDATE SET tag_name = EXCLUDED.tag_name, tag_unit = EXCLUDED.tag_unit, updated_at = NOW()`,
        [dcId, plant_data_mode, tag.furnace_id || null, tag.pass_id || null, tag.tag_name.trim(), tag.tag_unit || 'wt%']
      )
    }

    await client.query('COMMIT')

    // Return same shape as GET with updated tag validation
    const tagsRes = await client.query(
      `SELECT furnace_id, pass_id, tag_name, tag_unit
       FROM cs_py_int.plant_yield_tags WHERE design_case_id = $1
       ORDER BY COALESCE(furnace_id,''), COALESCE(pass_id,'')`,
      [dcId]
    )
    const tagValidation = await Promise.all(
      tagsRes.rows.map((t: any) => checkTag(client, t.tag_name))
    )

    return NextResponse.json({
      plant_data_mode,
      fuel_gas_flow_tag:  fuel_gas_flow_tag || null,
      fuel_gas_lhv_kj_kg: fuel_gas_lhv_kj_kg || 47000,
      tags:               tagsRes.rows,
      tag_validation:     tagValidation,
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
