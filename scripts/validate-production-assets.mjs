import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const buildDirectory = path.resolve('dist')
const assetExtensions = new Set(['.css', '.html', '.js', '.json', '.webmanifest'])
const forbiddenMarkers = [
  'debug-perspective',
  'デバッグ用の視点切り替え',
  'テスト視点',
  'テスト用リセットです',
  'テスト用: イベントをリセットして最初からやり直す',
  'この端末のイベントデータを消して、最初からやり直しますか？',
]

async function findAssetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nestedFiles = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findAssetFiles(entryPath)
    return assetExtensions.has(path.extname(entry.name)) ? [entryPath] : []
  }))
  return nestedFiles.flat()
}

const assetFiles = await findAssetFiles(buildDirectory)
const violations = []

for (const assetFile of assetFiles) {
  const content = await readFile(assetFile, 'utf8')
  for (const marker of forbiddenMarkers) {
    if (content.includes(marker)) {
      violations.push(`${path.relative(buildDirectory, assetFile)}: ${marker}`)
    }
  }
}

if (violations.length > 0) {
  throw new Error(
    `Production assets contain development-only controls:\n${violations.join('\n')}`,
  )
}

console.log(`Validated ${assetFiles.length} production assets: development-only controls are absent.`)
