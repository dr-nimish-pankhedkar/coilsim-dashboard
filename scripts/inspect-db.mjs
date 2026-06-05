import pkg from 'pg';
const { Pool } = pkg;
const pool = new Pool({ connectionString: 'process.env.DATABASE_URL', ssl: false });
const [cols, tables] = await Promise.all([
  pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='cs_py_int' AND table_name='simulation_tasks' ORDER BY ordinal_position"),
  pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='cs_py_int' ORDER BY table_name"),
]);
console.log('simulation_tasks cols:', cols.rows.map(r=>r.column_name));
console.log('tables:', tables.rows.map(r=>r.table_name));
pool.end();
