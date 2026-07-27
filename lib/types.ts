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
  error_message: string | null
  // joined from design_cases
  dc_severity_type: string | null
  dc_severity_nominal: number | string | null
  dc_source: string | null
}

export interface DesignCase {
  id: number
  name: string
  coil_id: number | null
  feed_id: number | null
  project_name: string
  created_at: string
  uploaded_proj_id: number | null
  verification_status: 'pending' | 'verified' | 'failed' | null
  verified_at: string | null
  verification_error: string | null
  severity_type_parsed: string | null
  severity_nominal: number | null
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
  tgas: number | null
  mass_conversion: number | null
  velocity: number | null
  pressure: number | null
  heat_flux: number | null
  coke_thickness: number | null
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
  reactor_txt: string | null
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

export interface ChannelConfig {
  param_key: string
  channel_type: 'input' | 'output'
  param_label: string
  unit: string | null
  enabled: boolean
  source: 'dcs' | 'static' | null
  static_value: number | null
  exp_row: number | null
  display_order: number
}

export interface ValidationResult {
  id: number
  design_case_id: number
  timestamp: string
  furnace_id: string
  pass_id: string
  hc_flow_kg_hr: number | null
  shc_ratio: number | null
  cit_degc: number | null
  cot_dcs_degc: number | null
  cot_coilsim_degc: number | null
  cop_atm: number | null
  c2h4_yield_wt: number | null
  c2h4_kg_hr: number | null
  h2_ch4_yield_wt: number | null
  h2_ch4_kg_hr: number | null
  c3plus_yield_wt: number | null
  c3plus_kg_hr: number | null
  max_tmt_degc: number | null
  coil_heat_kj_hr: number | null
  run_status: 'pending' | 'success' | 'failed' | 'filtered'
  filter_reason: string | null
}

export interface ValidationStatusResponse {
  status: string
  runs_total: number
  runs_complete: number
  runs_failed: number
  runs_not_converged: number
  pct_complete: number
  months: Array<{
    month: string
    sim_c2h4_mt: number
    error_pct: number | null
  }>
}

export interface ValidationAcceptanceCheck {
  name: string
  passed: boolean | null  // null = N/A (plant data not configured) — shown as ⚠️ amber
  value: string
  threshold: string
}

export interface ValidationBiasReport {
  all_passed: boolean
  checks: ValidationAcceptanceCheck[]
  per_furnace: Array<{
    furnace_id: string
    sim_c2h4_avg: number
    bias_kg_hr: number
  }>
  per_furnace_bias_availability: 'computed' | 'unavailable'
  monthly: Array<{
    month: string
    sim_c2h4_mt: number
    h2_ch4_error_pct: number | null
    c3plus_error_pct: number | null
  }>
  run_failure_rate_pct: number
  overall_c2h4_error_pct: number | null
  avg_coil_heat_kj_hr: number | null
  // COT bias — computed output, not user input
  recommended_cot_bias: number | null      // °C offset to apply to DCS COT
  c2h4_error_before_bias: number | null    // % error at raw DCS COT
  c2h4_error_after_bias:  number | null    // estimated residual after correction
  plant_data_mode: 'header' | 'per_furnace' | 'per_pass' | null
}
