export interface SimulationTask {
  id: number
  status: string
  task_type: 'hourly' | 'design_case' | 'fresh' | null  // 'fresh' kept for backward compat
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
  design_case_id: number | null
  coil_number: number | null
}

export interface DesignCase {
  id: number
  name: string
  coil_id: number
  feed_id: number
  project_name: string
  created_at: string
}

export interface CoilCokeProfile {
  id: number
  coil_number: number
  design_case_id: number
  coke_thickness: number
  updated_at: string
}

export interface OperatingCoilRow {
  coil_number: number
  design_case_id: number | null
  design_case_name: string | null
  coke_thickness: number | null
  coke_updated_at: string | null
  // latest hourly task for this coil
  task_id: number | null
  task_status: string | null
  sim_cot: number | null      // cot from last completed run (profile max or stored)
  dcs_cot: number | null      // cot_input from task
  flow_input: number | null
  completed_at: string | null
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
