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
    ssl: false,
  })
}

export const pool: Pool = globalThis._pgPool ?? (globalThis._pgPool = createPool())
