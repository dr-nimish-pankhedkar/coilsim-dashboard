import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { design_case_id: string } }
) {
  const dcId = parseInt(params.design_case_id, 10)
  if (isNaN(dcId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    // 1. Design case exists and is runnable
    const dcRes = await pool.query(
      `SELECT id, name, project_name, coil_id, feed_id, validation_status
       FROM cs_py_int.design_cases WHERE id = $1`,
      [dcId]
    )
    if (!dcRes.rows.length) return NextResponse.json({ error: 'Design case not found' }, { status: 404 })
    const dc = dcRes.rows[0]

    const checks: Array<{ name: string; ok: boolean; detail: string }> = []

    // 2. Has project_name
    checks.push({
      name:   'Project name set',
      ok:     !!dc.project_name,
      detail: dc.project_name ? dc.project_name : 'No project_name on design case — worker will auto-detect',
    })

    // 3. Has coil_id and feed_id
    checks.push({
      name:   'Coil ID configured',
      ok:     !!dc.coil_id,
      detail: dc.coil_id ? `coil_id = ${dc.coil_id}` : 'No coil_id — worker cannot build geometry',
    })
    checks.push({
      name:   'Feed ID configured',
      ok:     !!dc.feed_id,
      detail: dc.feed_id ? `feed_id = ${dc.feed_id}` : 'No feed_id — worker cannot build feed composition',
    })

    // 4. DCS history available in last 90 days
    const histRes = await pool.query(`
      SELECT
        COUNT(*) AS total,
        MIN(created_at) AS earliest,
        MAX(created_at) AS latest
      FROM cs_py_int.simulation_tasks
      WHERE status = 'Completed'
        AND task_type != 'validation'
        AND cot_input IS NOT NULL
        AND created_at >= NOW() - INTERVAL '90 days'
    `)
    const hist = histRes.rows[0]
    const histCount = parseInt(hist.total) || 0
    checks.push({
      name:   'DCS history (90 days)',
      ok:     histCount >= 24,  // at least 24 completed hourly tasks
      detail: histCount > 0
        ? `${histCount} completed DCS tasks from ${hist.earliest?.toISOString().slice(0,10)} to ${hist.latest?.toISOString().slice(0,10)}`
        : 'No completed DCS simulation tasks found in the last 90 days',
    })

    // 5. Worker is alive (last heartbeat within 5 min)
    const wRes = await pool.query(`
      SELECT updated_at FROM cs_py_int.worker_heartbeat
      ORDER BY updated_at DESC LIMIT 1
    `).catch(() => ({ rows: [] as any[] }))
    const lastBeat = wRes.rows[0]?.updated_at
    const workerAlive = lastBeat && (Date.now() - new Date(lastBeat).getTime()) < 5 * 60 * 1000
    checks.push({
      name:   'Worker heartbeat',
      ok:     !!workerAlive,
      detail: lastBeat ? `Last beat: ${new Date(lastBeat).toISOString()}` : 'No heartbeat found — worker may be offline',
    })

    // 6. No other validation currently running for this design case
    checks.push({
      name:   'No active run',
      ok:     dc.validation_status !== 'running',
      detail: dc.validation_status === 'running'
        ? 'A validation run is already in progress for this design case'
        : `Current status: ${dc.validation_status}`,
    })

    const allOk = checks.every(c => c.ok)
    return NextResponse.json({ design_case_id: dcId, name: dc.name, all_ok: allOk, checks })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'DB error' }, { status: 500 })
  }
}
