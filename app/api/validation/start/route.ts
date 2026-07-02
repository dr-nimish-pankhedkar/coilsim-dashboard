import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface FilterBreakdown {
  total_scanned: number
  cot_low: number
  stale_composition: number
  queued: number
}

export async function POST(req: NextRequest) {
  const client = await pool.connect()
  try {
    const body = await req.json()
    const {
      design_case_id,
      start_date,
      end_date,
      mb_filter_pct = 2.0,
      cot_bias_degc = 20.0,
      sample_interval_hrs = 1,
    } = body

    if (!design_case_id || !start_date || !end_date) {
      return NextResponse.json({ error: 'design_case_id, start_date, end_date required' }, { status: 400 })
    }

    // Fetch the design case to get project_name and coil/feed IDs
    const dcRes = await client.query(
      'SELECT * FROM cs_py_int.design_cases WHERE id = $1',
      [design_case_id]
    )
    if (!dcRes.rows.length) {
      return NextResponse.json({ error: 'Design case not found' }, { status: 404 })
    }
    const dc = dcRes.rows[0]

    // Mark design case as running, clear old validation results
    await client.query('BEGIN')
    await client.query(
      `UPDATE cs_py_int.design_cases SET
        validation_status      = 'running',
        validation_start_date  = $1,
        validation_end_date    = $2,
        validation_mb_filter   = $3,
        cot_bias_degc          = $4,
        validation_runs_total  = NULL,
        validation_runs_failed = NULL,
        validation_c2h4_error_pct = NULL,
        validated_at           = NULL
       WHERE id = $5`,
      [start_date, end_date, mb_filter_pct, cot_bias_degc, design_case_id]
    )
    // Remove stale validation results for this design case
    await client.query(
      'DELETE FROM cs_py_int.validation_results WHERE design_case_id = $1',
      [design_case_id]
    )

    // Pull historical DCS data from completed simulation_tasks in the date range.
    // These are tasks the DCS simulator inserted that the worker has already processed.
    // sample_interval_hrs: take one reading per N-hour bucket (earliest in each bucket).
    // Stale composition filter: flag rows where dilution_ratio hasn't changed in >7 days
    // (proxy for a frozen/stale feed composition — real tag-based filter when hourly_data schema confirmed).
    const STALE_COMPOSITION_DAYS = 7
    const histRes = await client.query(`
      WITH bucketed AS (
        SELECT
          id,
          cot_input,
          flow_input,
          dilution_ratio,
          cit_input,
          cip_input,
          cop_input,
          created_at,
          date_trunc('hour', created_at) +
            (FLOOR(EXTRACT(HOUR FROM created_at) / $5) * $5 || ' hours')::interval AS bucket
        FROM cs_py_int.simulation_tasks
        WHERE status = 'Completed'
          AND task_type != 'validation'
          AND cot_input IS NOT NULL
          AND created_at >= $1::timestamptz
          AND created_at < ($2::date + 1)::timestamptz
      ),
      deduped AS (
        SELECT DISTINCT ON (bucket) *
        FROM bucketed
        ORDER BY bucket, id ASC
      ),
      with_prev AS (
        SELECT *,
          LAG(dilution_ratio) OVER (ORDER BY created_at) AS prev_dil,
          LAG(created_at)     OVER (ORDER BY created_at) AS prev_ts
        FROM deduped
      )
      SELECT *,
        -- stale = dilution_ratio unchanged for > STALE_COMPOSITION_DAYS days
        CASE
          WHEN prev_dil IS NOT NULL
            AND ABS(dilution_ratio::numeric - prev_dil::numeric) < 0.0001
            AND (created_at - prev_ts) > ($6 || ' days')::interval
          THEN true ELSE false
        END AS composition_stale
      FROM with_prev
      ORDER BY created_at
    `, [start_date, end_date, mb_filter_pct, cot_bias_degc, sample_interval_hrs, STALE_COMPOSITION_DAYS])

    const rows = histRes.rows
    const breakdown: FilterBreakdown = {
      total_scanned: rows.length,
      cot_low: 0,
      stale_composition: 0,
      queued: 0,
    }

    // Queue validation runs for each surviving data point
    for (const row of rows) {
      const cotDcs = parseFloat(row.cot_input)

      // Phase 1 filter: COT < 780 → plugged tube indicator
      if (cotDcs < 780) {
        breakdown.cot_low++
        continue
      }

      // Phase 2 filter: stale composition
      if (row.composition_stale) {
        breakdown.stale_composition++
        continue
      }

      const cotCoilsim = cotDcs + parseFloat(cot_bias_degc)
      const flow = parseFloat(row.flow_input) || 1300
      const dil  = parseFloat(row.dilution_ratio) || 0.35
      const cit  = parseFloat(row.cit_input) || 668
      const cip  = parseFloat(row.cip_input) || 2.59
      const cop  = parseFloat(row.cop_input) || 2.053

      // 1. Pre-insert validation_results shell row
      const vrRes = await client.query(`
        INSERT INTO cs_py_int.validation_results
          (design_case_id, timestamp, furnace_id, pass_id,
           hc_flow_kg_hr, shc_ratio, cit_degc, cot_dcs_degc, cot_coilsim_degc, cop_atm,
           run_status)
        VALUES ($1, $2, 'furnace_1', 'pass_1', $3, $4, $5, $6, $7, $8, 'pending')
        RETURNING id
      `, [design_case_id, row.created_at, flow, dil, cit, cotDcs, cotCoilsim, cop])
      const validationResultId = vrRes.rows[0].id

      // 2. Queue simulation task
      await client.query(`
        INSERT INTO cs_py_int.simulation_tasks
          (status, task_type, project_name, design_case_id,
           coil_id, feed_id,
           cot_input, flow_input, dilution_ratio, cit_input, cip_input, cop_input,
           severity_type, flux_profile,
           validation_result_id)
        VALUES
          ('Pending', 'validation', $1, $2,
           $3, $4,
           $5, $6, $7, $8, $9, $10,
           2, 4,
           $11)
      `, [
        dc.project_name, design_case_id,
        dc.coil_id, dc.feed_id,
        cotCoilsim, flow, dil, cit, cip, cop,
        validationResultId,
      ])

      breakdown.queued++
    }

    // Store total queued count on the design case
    await client.query(
      'UPDATE cs_py_int.design_cases SET validation_runs_total = $1 WHERE id = $2',
      [breakdown.queued, design_case_id]
    )

    await client.query('COMMIT')

    return NextResponse.json({
      queued_count:     breakdown.queued,
      filtered_count:   breakdown.total_scanned - breakdown.queued,
      filter_breakdown: {
        total_scanned:     breakdown.total_scanned,
        cot_low:           breakdown.cot_low,
        mass_balance:      0,   // requires plant mass balance tags (not yet configured)
        composition_stale: breakdown.stale_composition,
        queued:            breakdown.queued,
      },
    })
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  } finally {
    client.release()
  }
}
