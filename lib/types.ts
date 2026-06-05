export interface SimulationTask {
  id: number
  status: string
  created_at: string
  completed_at: string | null
  cot_input: number | null
  flow_input: number | null
}

export interface ProfileDetail {
  task_id: number
  axial_position: number
  tgas: number
  mass_conversion: number
}

export interface YieldRecord {
  task_id: number
  component_name: string
  yield_value: number
}

export interface WorkerHeartbeat {
  worker_name: string
  last_pulse: string
  status_message: string | null
  current_task_id: number | null
}

export interface DashboardData {
  task: SimulationTask
  profiles: ProfileDetail[]
  yields: YieldRecord[]
}
