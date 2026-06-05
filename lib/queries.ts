import { pool } from './db'
import type { SimulationTask, ProfileDetail, YieldRecord, WorkerHeartbeat } from './types'

export async function getLatestTask(): Promise<SimulationTask | null> {
  const res = await pool.query<SimulationTask>(
    "SELECT * FROM cs_py_int.simulation_tasks ORDER BY id DESC LIMIT 1"
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

export async function getAllTasks(): Promise<SimulationTask[]> {
  const res = await pool.query<SimulationTask>(
    'SELECT id, status, created_at, completed_at, cot_input, flow_input FROM cs_py_int.simulation_tasks ORDER BY id DESC'
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

export async function getHeartbeat(): Promise<WorkerHeartbeat | null> {
  // Get the most recently pulsed worker row
  const res = await pool.query<WorkerHeartbeat>(
    'SELECT worker_name, last_pulse, status_message, current_task_id FROM cs_py_int.worker_heartbeat ORDER BY last_pulse DESC LIMIT 1'
  )
  return res.rows[0] ?? null
}

export async function resetStuckTasks(): Promise<number> {
  const res = await pool.query(
    "UPDATE cs_py_int.simulation_tasks SET status = 'Pending' WHERE status IN ('Processing', 'Error')"
  )
  return res.rowCount ?? 0
}
