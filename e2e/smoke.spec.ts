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
  await expect(page.getByRole('button', { name: '連携コードを発行' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: '連携コードを発行' }).first()).toBeDisabled()
  await expect(page.getByText('BOT連携はクラウドの共有イベントで利用できます。')).toBeVisible()
})

test('shows organizer reminders only after settlement finalization', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '箱根旅行のデモを見る' }).click()
  await page.getByRole('button', { name: 'みんなの精算状況' }).click()
  await page.getByText('幹事メニュー', { exact: true }).click()
  await page.getByRole('button', { name: '精算を確定する' }).click()
  await page.getByRole('button', { name: '確定する', exact: true }).click()
  await page.getByRole('button', { name: '支払い・受け取り' }).click()
  const reminder = page.getByRole('button', { name: /未払い\d+件を催促/ })
  await expect(reminder).toBeVisible()
  await reminder.click()
  await expect(page.getByText('新しい催促はありません。本日送信済み、または通知先が未設定です。')).toBeVisible()
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
  await page.getByPlaceholder('集合場所、予約番号、支出の補足など').fill('12時に入口前で集合')
  await page.getByLabel('金額（円）').fill('1200')
  await page.getByRole('button', { name: '追加する' }).click()
  const addedCard = page.getByRole('heading', { name: 'E2Eテストの昼食' }).locator('xpath=ancestor::article')
  await expect(addedCard).toBeVisible()
  await expect(addedCard).toContainText('12時に入口前で集合')
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

test('shows the relationship map without the removed matrix switch', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()
  await page.getByRole('button', { name: 'みんなの精算状況' }).click()

  await expect(page.getByRole('heading', { name: '精算関係マップ' })).toBeVisible()
  await expect(page.getByRole('button', { name: '自分中心', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('中立の精算は非表示')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '金額表' })).toHaveCount(0)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('selects individual expense events for a partial payment', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '箱根旅行のデモを見る' }).click()
  await page.getByRole('button', { name: '支出を追加' }).first().click()
  await page.getByPlaceholder('例: 昼食・そば処').fill('ケンタ立替の追加交通費')
  await page.getByLabel('金額（円）').fill('1200')
  await page.getByRole('radio', { name: 'ケンタ', exact: true }).click()
  await page.getByRole('button', { name: '追加する' }).click()
  await page.getByRole('button', { name: 'みんなの精算状況' }).click()
  await page.getByText('幹事メニュー', { exact: true }).click()
  await page.getByRole('button', { name: '精算を確定する' }).click()
  await page.getByRole('button', { name: '確定する', exact: true }).click()
  await page.getByRole('button', { name: '支払い・受け取り' }).click()

  const outgoing = page.getByRole('heading', { name: '支払う予定' }).locator('xpath=ancestor::section')
  const card = outgoing.getByText('ケンタへ支払う', { exact: true }).locator('xpath=ancestor::article')
  await expect(card.getByRole('button', { name: '相手への全額' })).toBeVisible()
  await card.getByRole('button', { name: 'イベントを選ぶ' }).click()
  const checkboxes = card.getByRole('checkbox')
  expect(await checkboxes.count()).toBeGreaterThan(1)
  const selectedTitle = await checkboxes.first().locator('xpath=ancestor::label').locator('strong').textContent()
  expect(selectedTitle).toBeTruthy()
  await checkboxes.first().check()
  await expect(card.getByRole('button', { name: '1件の支払いを報告' })).toBeEnabled()
  await card.getByRole('button', { name: '1件の支払いを報告' }).click()
  await expect(card.getByText('確認待ち').first()).toBeVisible()

  await page.getByRole('button', { name: '支出イベント' }).click()
  const selectedExpense = page.getByRole('heading', { name: selectedTitle! }).locator('xpath=ancestor::article')
  await expect(selectedExpense.getByText('支払報告済み').first()).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  expect(overflow).toBe(false)
})

test('keeps narrow portrait navigation and expense controls separated', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'narrow-mobile', '320px-specific regression check')

  await page.goto('/')
  await page.getByRole('button', { name: '4人・2泊3日・全件金額指定テンプレート' }).click()

  const tabsFit = await page.locator('.event-section-tabs button').evaluateAll((buttons) =>
    buttons.every((button) => button.scrollWidth <= button.clientWidth),
  )
  expect(tabsFit).toBe(true)

  const addButton = await page.getByRole('button', { name: '支出を追加' }).first().boundingBox()
  const filters = await page.locator('.category-tabs').boundingBox()
  expect(addButton).not.toBeNull()
  expect(filters).not.toBeNull()
  expect(addButton!.y + addButton!.height).toBeLessThanOrEqual(filters!.y + 1)

  for (const name of ['立替ダッシュボード', 'みんなの精算状況', '支払い・受け取り', '支出イベント']) {
    await page.getByRole('button', { name }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    expect(overflow).toBe(false)
  }
})
