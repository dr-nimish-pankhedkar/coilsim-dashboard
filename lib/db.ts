import { Pool } from 'pg'

// Reuse pool across serverless warm instances and hot reloads in dev
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined
}

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3, // critical: keep low for serverless concurrency
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
  })
}

export const pool: Pool = globalThis._pgPool ?? (globalThis._pgPool = createPool())
