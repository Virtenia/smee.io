import { randomUUID } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { openStream, startServer } from '../helpers/server.js'

let server
test.beforeAll(async () => { server = await startServer() })
test.afterAll(async () => { await server?.stop() })

const cards = page => page.getByRole('listitem').filter({ has: page.locator('button.ellipsis-expander') })

async function openChannel (page) {
  const channel = randomUUID()
  await page.goto(`${server.url}/${channel}`)
  await expect(page.locator('[aria-label="Connected to event stream"]')).toBeVisible()
  return channel
}

async function deliver (page, channel, { body = { action: 'opened', repository: { name: 'alpha', full_name: 'example/alpha' } }, id = randomUUID(), event = 'issues' } = {}) {
  const response = await page.request.post(`${server.url}/${channel}`, {
    headers: {
      'content-type': 'application/cloudevents-batch+json',
      ...(event ? { 'x-github-event': event } : {}),
      ...(id ? { 'x-github-delivery': id } : {})
    },
    data: Buffer.from(JSON.stringify(body))
  })
  expect(response.status()).toBe(200)
}

test('shows the channel URL, then decodes and displays an incoming delivery', async ({ page }) => {
  const channel = await openChannel(page)
  const input = page.getByRole('textbox', { name: 'Webhook Proxy URL' })
  await expect(input).toHaveValue(`${server.url}/${channel}`)
  await expect(page.getByRole('heading', { name: 'Use the Node.js client' })).toBeVisible()
  await page.getByRole('heading', { name: 'Webhook Deliveries' }).click()
  await input.focus()
  await expect(input).toHaveJSProperty('selectionStart', 0)
  await expect(input).toHaveJSProperty('selectionEnd', `${server.url}/${channel}`.length)

  await deliver(page, channel, { event: 'unknown-event' })
  await expect(cards(page)).toHaveCount(1)
  await cards(page).locator('button.ellipsis-expander').click()
  await expect(page.getByRole('heading', { name: 'Payload', exact: true })).toBeVisible()
  await expect(page.getByText('This event was sent by example/alpha.')).toBeVisible()
  await expect(cards(page).getByText('unknown-event', { exact: true }).first()).toBeVisible()
  await expect(cards(page)).toContainText('"opened"')
})

test('filters deliveries using both supported paths and leaves plain text filters alone', async ({ page }) => {
  const channel = await openChannel(page)
  const alphaId = randomUUID()
  await deliver(page, channel, { id: alphaId, body: { repository: { name: 'alpha' } } })
  await deliver(page, channel, { body: { repository: { name: 'beta' } } })
  await expect(cards(page)).toHaveCount(2)
  const filter = page.getByRole('textbox', { name: 'Filter by' })
  for (const path of ['repository.name:alpha', 'body.repository.name:alpha']) {
    await filter.fill(path)
    await expect(cards(page)).toHaveCount(1)
    await cards(page).locator('button.ellipsis-expander').click()
    await expect(cards(page).getByRole('code').filter({ hasText: alphaId })).toHaveText(alphaId)
    await cards(page).locator('button.ellipsis-expander').click()
  }
  await filter.fill('ordinary text')
  await expect(cards(page)).toHaveCount(2)
})

test('displays and persists a CloudEvents batch without GitHub headers', async ({ page }) => {
  const channel = await openChannel(page)
  const body = [{ specversion: '1.0', id: 'event-1', type: 'example.created', data: { value: 42 } }]
  await deliver(page, channel, { body, id: null, event: null })
  await expect(cards(page)).toHaveCount(1)
  await page.reload()
  await expect(cards(page)).toHaveCount(1)
  await cards(page).locator('button.ellipsis-expander').click()
  await expect(cards(page)).toContainText('application/cloudevents-batch+json')
  await expect(page.getByRole('heading', { name: 'Payload', exact: true })).toBeVisible()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key))[0].body, `smee:log:${channel}`)).toEqual(body)
})

test('suppresses duplicate GitHub IDs and retains deliveries without GitHub IDs', async ({ page }) => {
  const channel = await openChannel(page)
  const id = randomUUID()
  await deliver(page, channel, { id })
  await deliver(page, channel, { id })
  await deliver(page, channel)
  await expect(cards(page)).toHaveCount(2)
  await deliver(page, channel, { id: null })
  await expect(cards(page)).toHaveCount(3)
  await deliver(page, channel, { id: null })
  await expect(cards(page)).toHaveCount(4)
  await page.reload()
  await expect(cards(page)).toHaveCount(4)
})

test('persists pins across reload and preserves pinned deliveries when clearing', async ({ page }) => {
  const channel = await openChannel(page)
  await deliver(page, channel)
  const pinnedId = randomUUID()
  await deliver(page, channel, { id: pinnedId })
  await expect(cards(page)).toHaveCount(2)
  await cards(page).first().locator('button.ellipsis-expander').click()
  await cards(page).first().getByRole('button', { name: 'Pin this delivery' }).click()
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible()
  await page.reload()
  await expect(cards(page)).toHaveCount(2)
  await expect(page.getByRole('heading', { name: 'Pinned', exact: true })).toBeVisible()

  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Clear deliveries' }).click()
  await expect(cards(page)).toHaveCount(2)
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Clear deliveries' }).click()
  await expect(cards(page)).toHaveCount(1)
  await cards(page).locator('button.ellipsis-expander').click()
  await expect(cards(page).getByRole('code').filter({ hasText: pinnedId })).toHaveText(pinnedId)
  await cards(page).getByRole('button', { name: 'Pin this delivery' }).click()
  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: 'Clear deliveries' }).click()
  await expect(page.getByRole('textbox', { name: 'Webhook Proxy URL' })).toBeVisible()
  await page.reload()
  await expect(cards(page)).toHaveCount(0)
})

test('copies the payload only after success and does not claim success on failure', async ({ page }) => {
  const channel = await openChannel(page)
  const body = { action: 'opened', message: 'copy this payload' }
  await deliver(page, channel, { body })
  await cards(page).locator('button.ellipsis-expander').click()
  await page.evaluate(() => {
    window.clipboardWrites = 0
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText (text) {
          window.copiedText = text
          window.clipboardWrites++
          return new Promise((resolve, reject) => { window.finishCopy = resolve; window.failCopy = reject })
        }
      }
    })
    document.execCommand = () => { window.copyFallbackUsed = true; return false }
  })
  const copy = page.getByRole('button', { name: 'Copy payload to clipboard', exact: true })
  await copy.click()
  await expect.poll(() => page.evaluate(() => window.clipboardWrites)).toBe(1)
  await expect(copy).toBeVisible()
  await page.evaluate(() => window.failCopy(new Error('Clipboard permission denied')))
  await expect.poll(() => page.evaluate(() => window.copyFallbackUsed)).toBe(true)
  await expect(copy).toBeVisible()
  await copy.click()
  await expect.poll(() => page.evaluate(() => window.clipboardWrites)).toBe(2)
  await page.evaluate(() => window.finishCopy())
  await expect(page.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.copiedText)).toBe(JSON.stringify(body, null, 2))
  await page.keyboard.press('Tab')
  await expect(copy).toBeVisible()
})

test('redelivers the original payload rather than wrapping the delivery envelope', async ({ page }) => {
  const channel = await openChannel(page)
  const stream = await openStream(`${server.url}/${channel}`)
  try {
    const body = { action: 'opened', message: 'redeliver this payload' }
    await deliver(page, channel, { body })
    const original = await stream.next()
    await cards(page).locator('button.ellipsis-expander').click()
    const request = page.waitForRequest(request => request.url().endsWith('/redeliver'))
    await page.getByRole('button', { name: 'Redeliver this payload' }).click()
    const sent = await request
    const redelivered = await stream.next()
    expect(sent.method()).toBe('POST')
    await expect(page.getByRole('button', { name: 'Sent!', exact: true })).toBeVisible()
    test.fail(true, 'Existing UI bug: redelivery posts the whole event as the new payload; see tests/README.md.')
    expect(Buffer.from(redelivered.body, 'base64')).toEqual(Buffer.from(original.body, 'base64'))
    expect(redelivered['content-type']).toBe(original['content-type'])
  } finally {
    stream.close()
  }
})
