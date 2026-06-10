import { pool } from './db'
import type {
  SimulationTask, ProfileDetail, YieldRecord, WorkerHeartbeat,
  CoilGeometry, FeedstockDefinition, LegDefinition, ComponentDefinition,
  DesignCase, CoilCokeProfile, OperatingCoilRow,
} from './types'

// ── Dashboard ───────────────────────────────────────────────────────────────

export async function getLatestTask(): Promise<SimulationTask | null> {
  const res = await pool.query<SimulationTask>(
    'SELECT * FROM cs_py_int.simulation_tasks ORDER BY id DESC LIMIT 1'
  )
  return res.rows[0] ?? null
}

export async function getLatestCompletedTask(): Promise<SimulationTask | null> {
  const res = await pool.query<SimulationTask>(
    "SELECT * FROM cs_py_int.simulation_tasks WHERE status = 'Completed' ORDER BY id DESC LIMIT 1"
  )
  return res.rows[0] ?? null
}

export async function getProfileForTask(taskId: number): Promise<ProfileDetail[]> {
  const res = await pool.query<ProfileDetail>(
    'SELECT task_id, axial_position, tgas, mass_conversion FROM cs_py_int.profile_details WHERE task_id = $1 ORDER BY axial_position',
    [taskId]
  )
  return res.rows
}

export async function getYieldsForTask(taskId: number): Promise<YieldRecord[]> {
  const res = await pool.query<YieldRecord>(
    'SELECT task_id, component_name, yield_value FROM cs_py_int.yield_history WHERE task_id = $1 ORDER BY yield_value DESC',
    [taskId]
  )
  return res.rows
}

// ── Logs ────────────────────────────────────────────────────────────────────

export async function getAllTasks(): Promise<SimulationTask[]> {
  const res = await pool.query<SimulationTask>(
    'SELECT id, status, task_type, created_at, completed_at, cot_input, flow_input, project_name, coil_id, feed_id FROM cs_py_int.simulation_tasks ORDER BY id DESC'
  )
  return res.rows
}

export async function getAllYields(): Promise<YieldRecord[]> {
  const res = await pool.query<YieldRecord>(
    'SELECT task_id, component_name, yield_value FROM cs_py_int.yield_history ORDER BY task_id DESC'
  )
  return res.rows
}

export async function getAllProfiles(): Promise<ProfileDetail[]> {
  const res = await pool.query<ProfileDetail>(
    'SELECT * FROM cs_py_int.profile_details ORDER BY task_id DESC, axial_position ASC'
  )
  return res.rows
}

// ── Worker ──────────────────────────────────────────────────────────────────

export async function getHeartbeat(): Promise<WorkerHeartbeat | null> {
  const res = await pool.query<WorkerHeartbeat>(
    'SELECT worker_name, last_pulse, status_message, current_task_id FROM cs_py_int.worker_heartbeat ORDER BY last_pulse DESC LIMIT 1'
  )
  return res.rows[0] ?? null
}

// ── Admin ───────────────────────────────────────────────────────────────────

export async function resetStuckTasks(): Promise<number> {
  const res = await pool.query(
    "UPDATE cs_py_int.simulation_tasks SET status = 'Pending' WHERE status IN ('Processing', 'Error')"
  )
  return res.rowCount ?? 0
}

// ── Coil Geometries ─────────────────────────────────────────────────────────

export async function getAllCoilGeometries(): Promise<CoilGeometry[]> {
  const res = await pool.query<CoilGeometry>(
    'SELECT id, name, ncoil, legs, adiabatic_flag, created_at FROM cs_py_int.coil_geometries ORDER BY id DESC'
  )
  return res.rows
}

export async function insertCoilGeometry(
  name: string, ncoil: number, legs: LegDefinition[], adiabatic_flag: boolean,
  extra?: Record<string, unknown>
): Promise<number> {
  const res = await pool.query<{ id: number }>(
    'INSERT INTO cs_py_int.coil_geometries (name, ncoil, legs, adiabatic_flag) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, ncoil, JSON.stringify(extra ? { legs, ...extra } : legs), adiabatic_flag ? 1 : 0]
  )
  return res.rows[0].id
}

// ── Feedstock Definitions ───────────────────────────────────────────────────

export async function getAllFeedstockDefinitions(): Promise<FeedstockDefinition[]> {
  const res = await pool.query<FeedstockDefinition>(
    'SELECT id, name, components, product_ids, created_at FROM cs_py_int.feedstock_definitions ORDER BY id DESC'
  )
  return res.rows
}

export async function insertFeedstockDefinition(
  name: string, components: ComponentDefinition[], product_ids: number[]
): Promise<number> {
  const res = await pool.query<{ id: number }>(
    'INSERT INTO cs_py_int.feedstock_definitions (name, components, product_ids) VALUES ($1, $2, $3) RETURNING id',
    [name, JSON.stringify(components), JSON.stringify(product_ids)]
  )
  return res.rows[0].id
}

// ── Run submission ───────────────────────────────────────────────────────────

export interface RunParams {
  cot: number
  flow: number
  dilution?: number           // kg steam / kg HC          (exp.txt row 8)
  cit?: number                // Coil Inlet Temperature °C  (exp.txt row 9)
  cip?: number                // Coil Inlet Pressure atm    (exp.txt row 10)
  cop?: number                // Coil Outlet Pressure atm   (exp.txt pressure severity)
  severity_type?: number      // shooting flag 1-13         (exp.txt row 1)
  sev_location?: string       // 'reactor_end'|'adiabatic_pct'|'tle_end'
  sev_location_pct?: number | null
  pressure_sev_type?: string  // 'cop'|'eth_eth'
  pressure_location?: string
  pressure_location_pct?: number | null
  heat_flux_input_type?: string  // 'net'|'incident'
  flux_profile?: number       // heat flux profile shape 1-5 (exp.txt row 6)
  run_length_sim?: number     // 0 or 1
  coke_model?: string         // 'Plehiers'|'Reyniers'
  coke_conduction?: number    // kcal/(K·m·s), default 0.0045
  coke_density?: number       // kg/m³, default 1600
}

export async function submitHourlyRun(p: RunParams): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO cs_py_int.simulation_tasks
       (status, task_type, cot_input, flow_input,
        dilution_ratio, cit_input, cip_input, severity_type, flux_profile)
     VALUES ('Pending', 'hourly', $1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [p.cot, p.flow, p.dilution ?? 0.35, p.cit ?? 600, p.cip ?? 1.8,
     p.severity_type ?? 1, p.flux_profile ?? 1]
  )
  return res.rows[0].id
}

export async function submitDesignCaseRun(
  coil_id: number, feed_id: number, project_name: string, p: RunParams
): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // 1. Ensure a design_cases record exists for this project (upsert by project_name)
    await client.query(
      `INSERT INTO cs_py_int.design_cases (name, coil_id, feed_id, project_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_name) DO UPDATE
         SET coil_id = EXCLUDED.coil_id,
             feed_id = EXCLUDED.feed_id`,
      [project_name, coil_id, feed_id, project_name]
    )

    // 2. Queue the simulation task
    const res = await client.query<{ id: number }>(
      `INSERT INTO cs_py_int.simulation_tasks
         (status, task_type, coil_id, feed_id, cot_input, flow_input, project_name,
          dilution_ratio, cit_input, cip_input, cop_input,
          severity_type, sev_location, sev_location_pct,
          pressure_sev_type, pressure_location, pressure_location_pct,
          heat_flux_input_type, flux_profile,
          run_length_sim, coke_model, coke_conduction, coke_density)
       VALUES ('Pending', 'design_case',
         $1,  $2,  $3,  $4,  $5,
         $6,  $7,  $8,  $9,
         $10, $11, $12,
         $13, $14, $15,
         $16, $17,
         $18, $19, $20, $21)
       RETURNING id`,
      [
        coil_id, feed_id, p.cot, p.flow, project_name,
        p.dilution ?? 0.35, p.cit ?? 668, p.cip ?? 2.59, p.cop ?? 2.053,
        p.severity_type ?? 2, p.sev_location ?? 'adiabatic_pct', p.sev_location_pct ?? 60,
        p.pressure_sev_type ?? 'cop', p.pressure_location ?? 'adiabatic_pct', p.pressure_location_pct ?? 100,
        p.heat_flux_input_type ?? 'net', p.flux_profile ?? 1,
        p.run_length_sim ?? 0, p.coke_model ?? 'Plehiers',
        p.coke_conduction ?? 0.0045, p.coke_density ?? 1600,
      ]
    )

    await client.query('COMMIT')
    return res.rows[0].id
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Design Cases ─────────────────────────────────────────────────────────────

export async function getAllDesignCases(): Promise<DesignCase[]> {
  const res = await pool.query<DesignCase>(
    'SELECT id, name, coil_id, feed_id, project_name, created_at FROM cs_py_int.design_cases ORDER BY id DESC'
  )
  return res.rows
}

export async function insertDesignCase(
  name: string, coil_id: number, feed_id: number, project_name: string
): Promise<number> {
  const res = await pool.query<{ id: number }>(
    `INSERT INTO cs_py_int.design_cases (name, coil_id, feed_id, project_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name, coil_id, feed_id, project_name]
  )
  return res.rows[0].id
}

// ── Operating Case ────────────────────────────────────────────────────────────

export async function getOperatingCoilGrid(): Promise<OperatingCoilRow[]> {
  // Join latest hourly task per coil with latest coke profile
  const res = await pool.query<OperatingCoilRow>(`
    WITH latest_tasks AS (
      SELECT DISTINCT ON (coil_number)
        id AS task_id, status AS task_status, coil_number,
        cot_input AS dcs_cot, flow_input, completed_at, design_case_id,
        convergence AS sim_cot
      FROM cs_py_int.simulation_tasks
      WHERE task_type = 'hourly' AND coil_number IS NOT NULL
      ORDER BY coil_number, id DESC
    ),
    latest_coke AS (
      SELECT DISTINCT ON (coil_number)
        coil_number, design_case_id, coke_thickness, updated_at AS coke_updated_at
      FROM cs_py_int.coil_coke_profiles
      ORDER BY coil_number, updated_at DESC
    )
    SELECT
      COALESCE(t.coil_number, c.coil_number)     AS coil_number,
      COALESCE(t.design_case_id, c.design_case_id) AS design_case_id,
      dc.name                                     AS design_case_name,
      c.coke_thickness,
      c.coke_updated_at,
      t.task_id,
      t.task_status,
      t.sim_cot,
      t.dcs_cot,
      t.flow_input,
      t.completed_at
    FROM latest_tasks t
    FULL OUTER JOIN latest_coke c USING (coil_number)
    LEFT JOIN cs_py_int.design_cases dc
      ON dc.id = COALESCE(t.design_case_id, c.design_case_id)
    ORDER BY coil_number
  `)
  return res.rows
}

export async function getCokeTrend(
  coil_number: number, limit = 48
): Promise<{ updated_at: string; coke_thickness: number }[]> {
  const res = await pool.query(
    `SELECT updated_at, coke_thickness
     FROM cs_py_int.coil_coke_profiles
     WHERE coil_number = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [coil_number, limit]
  )
  return res.rows
}
