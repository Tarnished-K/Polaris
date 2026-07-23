import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { chromium } from 'playwright'
import { launch } from 'chrome-launcher'
import lighthouse, { desktopConfig } from 'lighthouse'
import { preview as startPreview } from 'vite'

const root = process.cwd()
const baseUrl = 'http://127.0.0.1:4174'
const resultPath = path.join(root, 'lighthouse-results.json')
const baselinePath = path.join(root, 'LIGHTHOUSE_BASELINES.json')
const updateBaseline = process.argv.includes('--update-baseline')

function metric(lhr, auditId) {
  return Math.round((lhr.audits[auditId]?.numericValue ?? 0) * 100) / 100
}

function transferredBytes(lhr, resourceTypes) {
  const requests = lhr.audits['network-requests']?.details?.items ?? []
  return requests
    .filter((request) => resourceTypes.includes(request.resourceType))
    .reduce((sum, request) => sum + (request.transferSize ?? 0), 0)
}

async function assetBudgets() {
  const directory = path.join(root, 'dist', 'assets')
  const files = await readdir(directory)
  const size = async (name) => (await stat(path.join(directory, name))).size
  const matchingSize = async (pattern) => {
    const names = files.filter((name) => pattern.test(name))
    return (await Promise.all(names.map(size))).reduce((sum, bytes) => sum + bytes, 0)
  }
  return {
    initialJsBytes: await matchingSize(/^index-.*\.js$/),
    initialCssBytes: await matchingSize(/^index-.*\.css$/),
    settingsChunkBytes: await matchingSize(/^EventSettingsView-.*\.js$/),
    dashboardChunkBytes: await matchingSize(/^AdvanceDashboardView-.*\.js$/),
    settlementChunkBytes: await matchingSize(/^SettlementView-.*\.js$/),
  }
}

function regression(name, current, baseline, lowerIsBetter) {
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null
  if (baseline === 0) {
    if (lowerIsBetter && current > 0.05) return { level: 'fail', message: `${name}: ${current} (baseline 0)` }
    return null
  }
  const percent = lowerIsBetter
    ? ((current - baseline) / baseline) * 100
    : ((baseline - current) / baseline) * 100
  if (percent > 20) return { level: 'fail', message: `${name}: ${current} vs ${baseline} (${percent.toFixed(1)}% regression)` }
  if (percent > 10) return { level: 'warn', message: `${name}: ${current} vs ${baseline} (${percent.toFixed(1)}% regression)` }
  return null
}

const preview = await startPreview({
  root,
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
})

try {
  const chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu'],
  })
  try {
    const profiles = {}
    for (const profile of [
      { name: 'desktop', config: desktopConfig, screenEmulation: { mobile: false, width: 1280, height: 800, deviceScaleFactor: 1, disabled: false } },
      { name: 'mobile', config: undefined, screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 2.75, disabled: false } },
    ]) {
      const result = await lighthouse(baseUrl, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        screenEmulation: profile.screenEmulation,
      }, profile.config)
      if (!result) throw new Error(`Lighthouse returned no result for ${profile.name}.`)
      profiles[profile.name] = {
        performanceScore: Math.round((result.lhr.categories.performance.score ?? 0) * 1000) / 1000,
        fcpMs: metric(result.lhr, 'first-contentful-paint'),
        lcpMs: metric(result.lhr, 'largest-contentful-paint'),
        cls: metric(result.lhr, 'cumulative-layout-shift'),
        jsTransferBytes: transferredBytes(result.lhr, ['Script']),
        cssTransferBytes: transferredBytes(result.lhr, ['Stylesheet']),
        jsonTransferBytes: transferredBytes(result.lhr, ['XHR', 'Fetch']),
      }
    }

    const results = {
      generatedAt: new Date().toISOString(),
      auditedUrl: baseUrl,
      profiles,
      assets: await assetBudgets(),
    }
    await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8')

    if (updateBaseline) {
      await writeFile(baselinePath, `${JSON.stringify({ version: 1, profiles, assets: results.assets }, null, 2)}\n`, 'utf8')
      console.log('Updated LIGHTHOUSE_BASELINES.json.')
    } else {
      const baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
      const findings = []
      for (const profileName of Object.keys(profiles)) {
        const current = profiles[profileName]
        const expected = baseline.profiles[profileName]
        for (const key of ['performanceScore', 'fcpMs', 'lcpMs', 'cls', 'jsTransferBytes', 'cssTransferBytes', 'jsonTransferBytes']) {
          const finding = regression(`${profileName}.${key}`, current[key], expected[key], key !== 'performanceScore')
          if (finding) findings.push(finding)
        }
      }
      for (const key of Object.keys(results.assets)) {
        const finding = regression(`assets.${key}`, results.assets[key], baseline.assets[key], true)
        if (finding) findings.push(finding)
      }
      findings.filter(({ level }) => level === 'warn').forEach(({ message }) => console.warn(`WARN ${message}`))
      findings.filter(({ level }) => level === 'fail').forEach(({ message }) => console.error(`FAIL ${message}`))
      if (findings.some(({ level }) => level === 'fail')) process.exitCode = 1
    }

    console.log(JSON.stringify(results, null, 2))
  } finally {
    try {
      await chrome.kill()
    } catch (cause) {
      // Chrome is already terminated when Windows briefly keeps the temporary
      // profile directory locked. Do not turn a completed audit into a failure.
      if (process.platform !== 'win32') throw cause
      console.warn('WARN Chrome temporary profile cleanup was deferred by Windows.')
    }
  }
} finally {
  await new Promise((resolve, reject) => preview.httpServer.close((error) => error ? reject(error) : resolve()))
}
