import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const design_case_id = searchParams.get('design_case_id')
  const recalibration_threshold = parseFloat(searchParams.get('threshold') ?? '2.0')

  if (!design_case_id) {
    return NextResponse.json({ error: 'design_case_id required' }, { status: 400 })
  }

  const client = await pool.connect()
  try {
    const dcRes = await client.query(
      `SELECT cot_bias_degc, validated_at, tuning_params, validation_c2h4_error_pct,
              validation_start_date, validation_end_date
       FROM cs_py_int.design_cases WHERE id = $1`,
      [design_case_id]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const dc = dcRes.rows[0]

    // Monthly C₂H₄ error trend from validation_results (last 6 months)
    const monthlyRes = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', timestamp), 'Mon-YY') AS month,
        AVG(
          CASE WHEN plant_c2h4_kg_hr > 0
            THEN (plant_c2h4_kg_hr - c2h4_kg_hr) / plant_c2h4_kg_hr * 100
          END
        ) AS error_pct
      FROM cs_py_int.validation_results
      WHERE design_case_id = $1 AND run_status = 'success'
        AND timestamp >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY MIN(timestamp)
    `, [design_case_id])

    const monthlyErrors = monthlyRes.rows.map(r => ({
      month:     r.month,
      error_pct: r.error_pct != null ? parseFloat(parseFloat(r.error_pct).toFixed(2)) : null,
    }))

    // Latest error for threshold check
    const latestError = monthlyErrors.length > 0
      ? monthlyErrors[monthlyErrors.length - 1].error_pct
      : null

    const currentTuning = dc.tuning_params ?? {}
    const currentCotBias = dc.cot_bias_degc != null ? parseFloat(dc.cot_bias_degc) : null

    return NextResponse.json({
      previous_calibration: {
        date:     dc.validated_at ?? dc.validation_end_date ?? null,
        cot_bias: currentCotBias,
        params:   currentTuning,
      },
      current_validation: {
        c2h4_error_pct: dc.validation_c2h4_error_pct != null
          ? parseFloat(dc.validation_c2h4_error_pct) : null,
        params: currentTuning,
      },
      monthly_errors:    monthlyErrors,
      exceeds_threshold: latestError != null ? Math.abs(latestError) > recalibration_threshold : false,
      threshold:         recalibration_threshold,
    })
  } finally {
    client.release()
  }
}
