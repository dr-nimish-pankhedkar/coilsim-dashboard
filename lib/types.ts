export interface SimulationTask {
  id: number
  status: string
  task_type: 'hourly' | 'fresh' | null
  cot_input: number | null
  flow_input: number | null
  convergence: number | null
  created_at: string
  completed_at: string | null
  coil_id: number | null
  feed_id: number | null
  project_name: string | null
  dilution_ratio: number | null
  cit_input: number | null
  cip_input: number | null
  severity_type: number | null
  flux_profile: number | null
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

export interface LegDefinition {
  length: number
  diameter: number
  wall_thickness: number
  bend_length?: number
}

export interface CoilGeometry {
  id: number
  name: string
  ncoil: number
  legs: LegDefinition[]
  adiabatic_flag: boolean
  created_at: string
}

export interface ComponentDefinition {
  component_id: number
  wt_frac: number
  in_conversion: boolean
}

export interface FeedstockDefinition {
  id: number
  name: string
  components: ComponentDefinition[]
  product_ids: number[]
  created_at: string
}
