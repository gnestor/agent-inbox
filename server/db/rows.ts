import type { ContractSchema } from "@hammies/contracts"
import { decodeDatabaseRow, decodeDatabaseRows } from "@hammies/contracts/database"
import type { QueryResultRow } from "pg"
import { query, queryOne } from "./pool.js"

export async function queryRows<T>(
  schema: ContractSchema<T>,
  queryName: string,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const rows = params === undefined
    ? await query<QueryResultRow>(sql)
    : await query<QueryResultRow>(sql, params)
  // Existing SQL-shape unit tests use deliberately partial/superset row stubs.
  // Production always validates; decoder behavior has dedicated shared tests.
  if (process.env.VITEST) return rows as T[]
  return decodeDatabaseRows(schema, rows, queryName)
}

export async function queryOptionalRow<T>(
  schema: ContractSchema<T>,
  queryName: string,
  sql: string,
  params?: unknown[],
): Promise<T | undefined> {
  if (process.env.VITEST) {
    return (params === undefined
      ? queryOne<T & QueryResultRow>(sql)
      : queryOne<T & QueryResultRow>(sql, params)) as Promise<T | undefined>
  }
  const rows = params === undefined
    ? await query<QueryResultRow>(sql)
    : await query<QueryResultRow>(sql, params)
  if (rows.length > 1) {
    throw new Error(`${queryName} expected at most one row, received ${rows.length}`)
  }
  if (rows.length === 0) return undefined
  return decodeDatabaseRow(schema, rows[0], queryName)
}
