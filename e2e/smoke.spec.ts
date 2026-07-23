import { expect, test } from '@playwright/test'

test('shows the create flow and local demo entry point', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '割り勘をはじめる' })).toBeVisible()
  await expect(page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' })).toBeVisible()
})

test('renders the four-person demo without horizontal overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await expect(page.getByRole('heading', { name: '4人・2泊3日デバッグ旅行' })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('navigates the demo dashboard and settlement views', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: '立替ダッシュボード' }).click()
  await expect(page.getByRole('heading', { name: '立替ダッシュボード' })).toBeVisible()
  await page.getByRole('button', { name: 'みんなの精算状況' }).click()
  await expect(page.getByText('全員の精算状況')).toBeVisible()
  await page.getByRole('button', { name: '支払い・受け取り' }).click()
  await expect(page.getByRole('button', { name: '支払い・受け取り' })).toHaveClass(/is-active/)
  await expect(page.getByRole('heading', { name: '支払い・受け取り' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'あなたの受取方法' })).toBeVisible()
  await expect(page.getByText('精算を確定すると、支払い先と金額が表示されます。')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('saves a local payment profile without collecting bank details', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: '支払い・受け取り' }).click()
  await page.getByLabel('PayPay ID（任意）').fill('organizer_1')
  await page.getByRole('button', { name: '受取方法を保存' }).click()
  await expect(page.getByText('受取方法を保存しました。')).toBeVisible()
  await expect(page.getByText('銀行口座やカード情報は入力しないでください。')).toBeVisible()
})

test('opens and cancels the expense form without changing the demo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await expect(page.getByText('8件')).toBeVisible()
  await page.getByRole('button', { name: '支出を追加' }).first().click()
  await expect(page.getByRole('heading', { name: '支出を追加' })).toBeVisible()
  await page.getByRole('button', { name: /キャンセル|閉じる|ホームへ戻る/ }).first().click()
  await expect(page.getByText('8件')).toBeVisible()
})

test('adds a local demo expense and shows it in the list', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: '支出を追加' }).first().click()
  await page.getByPlaceholder('例: 昼食・そば処').fill('E2Eテストの昼食')
  await page.getByLabel('金額（円）').fill('1200')
  await page.getByRole('button', { name: '追加する' }).click()
  await expect(page.getByRole('heading', { name: 'E2Eテストの昼食' })).toBeVisible()
  await expect(page.getByText('9件')).toBeVisible()
})

test('adds, edits, and deletes a local demo expense', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: '支出を追加' }).first().click()
  await page.getByPlaceholder('例: 昼食・そば処').fill('編集削除E2E')
  await page.getByLabel('金額（円）').fill('1200')
  await page.getByRole('button', { name: '追加する' }).click()

  const expenseCard = page.getByRole('heading', { name: '編集削除E2E' }).locator('xpath=ancestor::article')
  await expenseCard.getByRole('button', { name: '支出を編集' }).click()
  await page.getByLabel('金額（円）').fill('2400')
  await page.getByRole('button', { name: '変更を保存' }).click()
  await expect(page.getByRole('heading', { name: '編集削除E2E' }).locator('xpath=ancestor::article')).toContainText('￥2,400')

  await page.getByRole('heading', { name: '編集削除E2E' }).locator('xpath=ancestor::article').getByRole('button', { name: '支出を編集' }).click()
  await page.getByRole('button', { name: '削除', exact: true }).click()
  await page.getByRole('button', { name: '削除する' }).click()
  await expect(page.getByRole('heading', { name: '編集削除E2E' })).toHaveCount(0)
  await expect(page.getByText('8件')).toBeVisible()
})

test('serves installable PWA metadata and service worker', async ({ page, request }) => {
  await page.goto('/')
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBe('/manifest.webmanifest')
  const manifestResponse = await request.get('/manifest.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({ name: 'Warikan', display: 'standalone', start_url: '/' })
  const serviceWorkerResponse = await request.get('/sw.js')
  expect(serviceWorkerResponse.ok()).toBe(true)
})

test('shows the four-person settlement matrix without page overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: 'みんなの精算状況' }).click()
  await page.getByRole('tab', { name: '金額表' }).click()

  const matrix = page.getByRole('table', { name: '行の人が列の人へ支払う精算額' })
  await expect(matrix).toBeVisible()
  await expect(matrix.getByRole('button')).toHaveCount(6)
  await expect(matrix).toContainText('¥14,400')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})
