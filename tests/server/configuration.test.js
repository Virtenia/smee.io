import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { startServer } from '../helpers/server.js'

let server
before(async () => { server = await startServer({ BLOCKED_CHANNELS: 'disabled' }) })
after(async () => { await server?.stop() })

test('serves the landing page, channel UI, API docs and static assets', async () => {
  for (const path of ['/', '/example', '/documentation/', '/documentation/json', '/favicon.ico', '/public/favicon.png']) {
    const response = await fetch(server.url + path)
    assert.equal(response.status, 200, path)
  }
  assert.match(await (await fetch(server.url)).text(), /Start a new channel/)
  assert.match(await (await fetch(server.url + '/example')).text(), /class="mount"/)
})

test('creates unique channel URLs and honors the proxy URL', async () => {
  const locations = []
  for (let index = 0; index < 2; index++) {
    const response = await fetch(server.url + '/new', { redirect: 'manual' })
    assert.equal(response.status, 307)
    const location = new URL(response.headers.get('location'))
    assert.equal(location.origin, server.url)
    assert.match(location.pathname, /^\/[A-Za-z0-9_-]{16}$/)
    locations.push(location.href)
  }
  assert.notEqual(...locations)
  const response = await fetch(server.url + '/new', { redirect: 'manual', headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'hooks.example.test' } })
  assert.match(response.headers.get('location'), /^https:\/\/hooks\.example\.test\/[A-Za-z0-9_-]{16}$/)
})

test('rejects blocked channels on GET, POST and redelivery', async () => {
  for (const [method, path] of [['GET', '/disabled'], ['POST', '/disabled'], ['POST', '/disabled/redeliver']]) {
    const response = await fetch(server.url + path, { method, ...(method === 'POST' ? { headers: { 'content-type': 'text/plain' }, body: 'test' } : {}) })
    assert.equal(response.status, 403, `${method} ${path}`)
  }
})

test('serves both compressed and uncompressed production bundles', async () => {
  for (const extension of ['js', 'css']) {
    const url = `${server.url}/public/main.min.${extension}`
    const plain = await fetch(url, { headers: { 'accept-encoding': 'identity' } })
    const compressed = await fetch(url, { headers: { 'accept-encoding': 'gzip' } })
    assert.equal(plain.status, 200)
    assert.equal(compressed.status, 200)
    assert.equal(plain.headers.get('content-encoding'), null)
    assert.equal(compressed.headers.get('content-encoding'), 'gzip')
    assert.equal(await compressed.text(), await plain.text())
  }
})

test('enforces HTTPS while accepting HTTPS requests from the proxy', async t => {
  const secure = await startServer({ FORCE_HTTPS: '1' })
  t.after(secure.stop)
  const redirect = await fetch(secure.url + '/example', { redirect: 'manual' })
  assert.equal(redirect.status, 302)
  assert.equal(redirect.headers.get('location'), 'https://127.0.0.1/example')
  for (const [headers, status] of [[{}, 403], [{ 'x-forwarded-proto': 'https' }, 200]]) {
    const response = await fetch(secure.url + '/example', { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: 'test', redirect: 'manual' })
    assert.equal(response.status, status)
  }
})

test('starts with Sentry configured without contacting an external service', async t => {
  const monitored = await startServer({ SENTRY_DSN: 'http://public@127.0.0.1:9/1' })
  t.after(monitored.stop)
  assert.equal((await fetch(monitored.url)).status, 200)
})
