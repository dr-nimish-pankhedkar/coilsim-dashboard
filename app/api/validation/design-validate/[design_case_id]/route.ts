export const dynamic = 'force-dynamic';

import { pool } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

const COT_SENSITIVITY = 0.18; // wt% C2H4 per °C

export async function GET(
  _req: NextRequest,
  { params }: { params: { design_case_id: string } }
) {
  const designCaseId = parseInt(params.design_case_id, 10);
  if (isNaN(designCaseId)) {
    return NextResponse.json({ error: 'Invalid design_case_id' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    // Fetch design case columns
    const dcRes = await client.query(
      `SELECT design_cot_bias_degc, design_validation_status, design_validated_at
       FROM cs_py_int.design_cases
       WHERE id = $1`,
      [designCaseId]
    );
    if (dcRes.rowCount === 0) {
      return NextResponse.json({ error: 'Design case not found' }, { status: 404 });
    }
    const dc = dcRes.rows[0];

    // Fetch latest design_validation_runs row
    const runRes = await client.query(
      `SELECT id, status, cot_degc, flow_kg_hr, shc_ratio, cit_degc, cip_atm, cop_atm,
              measured_yields, selected_components, task_id, sim_yields,
              bias_degc, errors_json, created_at, completed_at, error_message
       FROM cs_py_int.design_validation_runs
       WHERE design_case_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [designCaseId]
    );

    let run = runRes.rowCount && runRes.rowCount > 0 ? runRes.rows[0] : null;

    if (run) {
      // If running, poll the linked simulation_task
      if (run.status === 'running' && run.task_id != null) {
        const taskRes = await client.query(
          `SELECT status FROM cs_py_int.simulation_tasks WHERE id = $1`,
          [run.task_id]
        );
        if (taskRes.rowCount && taskRes.rowCount > 0) {
          const taskStatus = taskRes.rows[0].status;
          if (taskStatus === 'Error') {
            await client.query(
              `UPDATE cs_py_int.design_validation_runs
               SET status = 'failed', error_message = 'Simulation task failed', completed_at = NOW()
               WHERE id = $1`,
              [run.id]
            );
            run.status = 'failed';
            run.error_message = 'Simulation task failed';
          }
        }
      }

      // If completed but bias not yet computed, compute it now
      if (run.status === 'completed' && run.bias_degc == null && run.sim_yields) {
        const measured: Record<string, number> = run.measured_yields ?? {};
        const sim: Record<string, number> = run.sim_yields ?? {};
        const selected: string[] = run.selected_components ?? [];

        const errorsJson: Record<string, { measured: number; sim: number; abs_err: number; rel_err_pct: number }> = {};

        for (const comp of selected) {
          const m = measured[comp] ?? 0;
          const s = sim[comp] ?? 0;
          const abs_err = m - s;
          const rel_err_pct = m !== 0 ? (abs_err / m) * 100 : 0;
          errorsJson[comp] = { measured: m, sim: s, abs_err, rel_err_pct };
        }

        const driverComp = selected.includes('C2H4') ? 'C2H4' : selected[0];
        let biasDegc: number | null = null;
        if (driverComp && errorsJson[driverComp] != null) {
          biasDegc = Math.round((errorsJson[driverComp].abs_err / COT_SENSITIVITY) * 10) / 10;
        }

        await client.query(
          `UPDATE cs_py_int.design_validation_runs
           SET bias_degc = $1, errors_json = $2
           WHERE id = $3`,
          [biasDegc, JSON.stringify(errorsJson), run.id]
        );

        run.bias_degc = biasDegc;
        run.errors_json = errorsJson;
      }
    }

    return NextResponse.json({
      design_cot_bias_degc: dc.design_cot_bias_degc,
      design_validation_status: dc.design_validation_status,
      design_validated_at: dc.design_validated_at,
      run: run
        ? {
            id: run.id,
            status: run.status,
            cot_degc: run.cot_degc,
            flow_kg_hr: run.flow_kg_hr,
            shc_ratio: run.shc_ratio,
            cit_degc: run.cit_degc,
            cip_atm: run.cip_atm,
            cop_atm: run.cop_atm,
            measured_yields: run.measured_yields,
            selected_components: run.selected_components,
            sim_yields: run.sim_yields,
            bias_degc: run.bias_degc,
            errors_json: run.errors_json,
            created_at: run.created_at,
            completed_at: run.completed_at,
            error_message: run.error_message,
          }
        : null,
    });
  } catch (err) {
    console.error('GET design-validate error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { design_case_id: string } }
) {
  const designCaseId = parseInt(params.design_case_id, 10);
  if (isNaN(designCaseId)) {
    return NextResponse.json({ error: 'Invalid design_case_id' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Form A: accept action
  if (body.action === 'accept') {
    const { run_id, bias_degc } = body as { run_id: number; bias_degc: number };
    if (run_id == null || bias_degc == null) {
      return NextResponse.json({ error: 'run_id and bias_degc are required for accept action' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE cs_py_int.design_cases
         SET design_cot_bias_degc = $1,
             design_validation_status = 'validated',
             design_validated_at = NOW()
         WHERE id = $2`,
        [bias_degc, designCaseId]
      );
      return NextResponse.json({ ok: true, design_cot_bias_degc: bias_degc });
    } catch (err) {
      console.error('POST design-validate accept error:', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
      client.release();
    }
  }

  // Form B: new run
  const {
    cot_degc,
    flow_kg_hr,
    shc_ratio,
    cit_degc,
    cip_atm,
    cop_atm,
    measured_yields,
    selected_components,
  } = body as {
    cot_degc?: number;
    flow_kg_hr?: number;
    shc_ratio?: number;
    cit_degc?: number;
    cip_atm?: number;
    cop_atm?: number;
    measured_yields?: Record<string, number>;
    selected_components?: string[];
  };

  if (cot_degc == null || flow_kg_hr == null || shc_ratio == null || !measured_yields || !selected_components) {
    return NextResponse.json(
      { error: 'cot_degc, flow_kg_hr, shc_ratio, measured_yields, and selected_components are required' },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    // Fetch design case
    const dcRes = await client.query(
      `SELECT project_name, coil_id, feed_id FROM cs_py_int.design_cases WHERE id = $1`,
      [designCaseId]
    );
    if (dcRes.rowCount === 0) {
      return NextResponse.json({ error: 'Design case not found' }, { status: 404 });
    }
    const { project_name, coil_id, feed_id } = dcRes.rows[0];

    await client.query('BEGIN');

    // Mark design case as running
    await client.query(
      `UPDATE cs_py_int.design_cases SET design_validation_status = 'running' WHERE id = $1`,
      [designCaseId]
    );

    // Insert design_validation_runs
    const runInsert = await client.query(
      `INSERT INTO cs_py_int.design_validation_runs
         (design_case_id, cot_degc, flow_kg_hr, shc_ratio, cit_degc, cip_atm, cop_atm,
          measured_yields, selected_components, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'running')
       RETURNING id`,
      [
        designCaseId,
        cot_degc,
        flow_kg_hr,
        shc_ratio,
        cit_degc ?? null,
        cip_atm ?? null,
        cop_atm ?? null,
        JSON.stringify(measured_yields),
        selected_components,
      ]
    );
    const runId: number = runInsert.rows[0].id;

    // Insert simulation_tasks
    const taskInsert = await client.query(
      `INSERT INTO cs_py_int.simulation_tasks
         (status, task_type, project_name, design_case_id, coil_id, feed_id,
          cot_input, flow_input, dilution_ratio, cit_input, cip_input, cop_input,
          severity_type, flux_profile, design_validation_run_id)
       VALUES ('Pending', 'design_validate', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
        project_name,
        designCaseId,
        coil_id,
        feed_id,
        cot_degc,
        flow_kg_hr,
        shc_ratio,
        cit_degc ?? null,
        cip_atm ?? null,
        cop_atm ?? null,
        2,
        4,
        runId,
      ]
    );
    const taskId: number = taskInsert.rows[0].id;

    // Link task back to run
    await client.query(
      `UPDATE cs_py_int.design_validation_runs SET task_id = $1 WHERE id = $2`,
      [taskId, runId]
    );

    await client.query('COMMIT');

    return NextResponse.json({ run_id: runId, task_id: taskId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST design-validate new run error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
