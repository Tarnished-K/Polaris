import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import pg from 'pg'

const connectionFile = path.resolve('supabase/.temp/pooler-url')
const testDirectory = path.resolve('supabase/tests/database')

const explicitConfig =
  process.env.POLARIS_PGHOST &&
  process.env.POLARIS_PGUSER &&
  process.env.POLARIS_PGPASSWORD
    ? {
        host: process.env.POLARIS_PGHOST,
        port: Number(process.env.POLARIS_PGPORT ?? 5432),
        user: process.env.POLARIS_PGUSER,
        password: process.env.POLARIS_PGPASSWORD,
        database: process.env.POLARIS_PGDATABASE ?? 'postgres',
      }
    : null

const linkedUrl = explicitConfig ? null : new URL((await readFile(connectionFile, 'utf8')).trim())
if (linkedUrl && process.env.SUPABASE_DB_PASSWORD) {
  linkedUrl.password = process.env.SUPABASE_DB_PASSWORD
}
if (linkedUrl && !linkedUrl.password) {
  throw new Error(
    'Database credentials are unavailable. Set SUPABASE_DB_PASSWORD, or provide POLARIS_PGHOST, POLARIS_PGUSER, and POLARIS_PGPASSWORD.',
  )
}

const client = new pg.Client({
  ...(explicitConfig ?? { connectionString: linkedUrl.href }),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20_000,
  query_timeout: 120_000,
})

let totalAssertions = 0
try {
  await client.connect()
  await client.query('set role postgres')
  const files = (await readdir(testDirectory)).filter((file) => file.endsWith('.test.sql')).sort()
  for (const file of files) {
    const source = await readFile(path.join(testDirectory, file), 'utf8')
    const planned = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1] ?? 0)
    if (!planned) throw new Error(`${file}: pgTAP plan is missing`)

    const queryResults = await client.query({ text: source, queryMode: 'simple' })
    const results = Array.isArray(queryResults) ? queryResults : [queryResults]
    const tapLines = results.flatMap((result) =>
      result.rows.flatMap((row) =>
        Object.values(row).filter((value) => typeof value === 'string' && /^(?:ok|not ok)\b/.test(value)),
      ),
    )
    const failures = tapLines.filter((line) => line.startsWith('not ok'))
    if (failures.length > 0) {
      throw new Error(`${file}:\n${failures.join('\n')}`)
    }
    if (tapLines.length !== planned) {
      throw new Error(`${file}: planned ${planned} assertions but observed ${tapLines.length}`)
    }
    totalAssertions += tapLines.length
    console.log(`${file}: ${tapLines.length} passed`)
  }
  console.log(`Hosted pgTAP: ${totalAssertions} assertions passed.`)
} finally {
  await client.end().catch(() => undefined)
}

process.exitCode = totalAssertions > 0 ? 0 : 1
