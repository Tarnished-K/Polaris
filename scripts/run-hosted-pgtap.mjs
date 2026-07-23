import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import pg from 'pg'

const connectionFile = path.resolve('supabase/.temp/pooler-url')
const testDirectory = path.resolve('supabase/tests/database')

function testPlan(source, file) {
  const planned = Number(source.match(/select\s+plan\((\d+)\)/i)?.[1] ?? 0)
  const usesDynamicPlan = /select\s+no_plan\(\)/i.test(source)
  if (!planned && !usesDynamicPlan) throw new Error(`${file}: pgTAP plan is missing`)
  return { planned, usesDynamicPlan }
}

function verifyTapLines(file, tapLines, plan) {
  const failures = tapLines.filter((line) => line.startsWith('not ok'))
  if (failures.length > 0) {
    throw new Error(`${file}:\n${failures.join('\n')}`)
  }
  if (plan.planned && tapLines.length !== plan.planned) {
    throw new Error(`${file}: planned ${plan.planned} assertions but observed ${tapLines.length}`)
  }
  if (plan.usesDynamicPlan && tapLines.length === 0) {
    throw new Error(`${file}: dynamic plan produced no assertions`)
  }
}

async function runWithManagementApi(files) {
  const supabaseCli = path.resolve('node_modules/supabase/dist/supabase.js')
  let totalAssertions = 0

  for (const file of files) {
    const filePath = path.join(testDirectory, file)
    const source = await readFile(filePath, 'utf8')
    const plan = testPlan(source, file)
    const output = execFileSync(
      process.execPath,
      [supabaseCli, 'db', 'query', '--linked', '--file', filePath, '--output-format', 'json'],
      {
        cwd: path.resolve('.'),
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    const response = JSON.parse(output)
    const resultTexts = (response.rows ?? []).flatMap((row) =>
      Object.values(row).filter((value) => typeof value === 'string'),
    )
    const completion = resultTexts.find((value) => /^1\.\.\d+$/.test(value))
    const diagnostics = resultTexts.filter((value) => value.startsWith('#'))

    if (diagnostics.length > 0) {
      throw new Error(`${file}:\n${diagnostics.join('\n')}`)
    }

    let observed
    if (plan.planned) {
      const finalAssertion = resultTexts.find((value) =>
        new RegExp(`^ok ${plan.planned}(?:\\s|$)`).test(value),
      )
      if (!finalAssertion) {
        throw new Error(`${file}: final planned assertion did not pass`)
      }
      observed = plan.planned
    } else if (completion) {
      observed = Number(completion.slice(3))
    } else {
      throw new Error(`${file}: Management API did not return a pgTAP completion plan`)
    }
    if (plan.usesDynamicPlan && observed === 0) {
      throw new Error(`${file}: dynamic plan produced no assertions`)
    }

    totalAssertions += observed
    console.log(`${file}: ${observed} passed (Management API)`)
  }

  console.log(`Hosted pgTAP: ${totalAssertions} assertions passed.`)
  return totalAssertions
}

async function runWithDirectPostgres(files, connection) {
  const client = new pg.Client({
    ...connection,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20_000,
    query_timeout: 120_000,
  })
  let totalAssertions = 0

  try {
    await client.connect()
    await client.query('set role postgres')

    for (const file of files) {
      const source = await readFile(path.join(testDirectory, file), 'utf8')
      const plan = testPlan(source, file)
      const queryResults = await client.query({ text: source, queryMode: 'simple' })
      const results = Array.isArray(queryResults) ? queryResults : [queryResults]
      const tapLines = results.flatMap((result) =>
        result.rows.flatMap((row) =>
          Object.values(row).filter((value) => typeof value === 'string' && /^(?:ok|not ok)\b/.test(value)),
        ),
      )

      verifyTapLines(file, tapLines, plan)
      totalAssertions += tapLines.length
      console.log(`${file}: ${tapLines.length} passed`)
    }
  } finally {
    await client.end().catch(() => undefined)
  }

  console.log(`Hosted pgTAP: ${totalAssertions} assertions passed.`)
  return totalAssertions
}

const files = (await readdir(testDirectory)).filter((file) => file.endsWith('.test.sql')).sort()
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

let linkedUrl
if (!explicitConfig && process.env.SUPABASE_DB_PASSWORD) {
  linkedUrl = new URL((await readFile(connectionFile, 'utf8')).trim())
  linkedUrl.password = process.env.SUPABASE_DB_PASSWORD
}

const totalAssertions = explicitConfig || linkedUrl
  ? await runWithDirectPostgres(
      files,
      explicitConfig ?? { connectionString: linkedUrl.href },
    )
  : await runWithManagementApi(files)

process.exitCode = totalAssertions > 0 ? 0 : 1
