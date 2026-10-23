import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { openStream, startServer } from '../helpers/server.js'

let server
before(async () => { server = await startServer() })
after(async () => { await server?.stop() })

const json = Buffer.from('{\r\n  "text": "café 😀", "value": 42\r\n}\r\n')
const binary = Buffer.from([0, 255, 128, 13, 10, 65])
const fixture = JSON.parse(readFileSync(new URL('../fixtures/issues.opened.json', import.meta.url)))
const payloads = [
  ['JSON object with original formatting', 'application/json', json],
  ['JSON with charset', 'application/json; charset=utf-8', json],
  ['JSON with a byte order mark', 'application/json', Buffer.concat([Buffer.from('\uFEFF'), json])],
  ['JSON array', 'application/json', Buffer.from('[1, 2, 3]')],
  ['JSON string', 'application/json', Buffer.from('"hello"')],
  ['malformed JSON passed through unparsed', 'application/json', Buffer.from('not JSON at all')],
  ['binary bytes declared JSON', 'application/json', binary],
  ['CloudEvents batch', 'application/cloudevents-batch+json', Buffer.from('[{"specversion":"1.0","id":"1","data":{"value":42}}]')],
  ['CloudEvents object', 'application/cloudevents+json', Buffer.from('{"specversion":"1.0","id":"1"}')],
  ['vendor JSON', 'application/vnd.api+json', json],
  ['plain text', 'text/plain', json],
  ['binary bytes declared text', 'text/plain', binary],
  ['binary content', 'application/octet-stream', binary],
  ['form carrying JSON', 'application/x-www-form-urlencoded', Buffer.from('payload=' + encodeURIComponent('{"action":"opened"}'))],
  ['GitHub fixture', 'application/json', Buffer.from(JSON.stringify(fixture.body))]
]

for (const [name, contentType, body] of payloads) {
  test(`preserves exact bytes and metadata: ${name}`, async t => {
    const channel = randomUUID()
    const stream = await openStream(`${server.url}/${channel}`)
    t.after(stream.close)
    const response = await fetch(`${server.url}/${channel}?source=example&attempt=2`, {
      method: 'POST',
      headers: { 'content-type': contentType, 'x-correlation-id': channel, 'x-hub-signature-256': 'opaque-signature' },
      body
    })
    assert.equal(response.status, 200, await response.text())
    const event = await stream.next()
    assert.equal(event.bodyEncoding, 'base64')
    assert.deepEqual(Buffer.from(event.body, 'base64'), body)
    assert.equal(event['content-type'], contentType)
    assert.equal(event['x-correlation-id'], channel)
    assert.equal(event['x-hub-signature-256'], 'opaque-signature')
    assert.deepEqual(event.query, { source: 'example', attempt: '2' })
    assert.equal(typeof event.timestamp, 'number')
  })
}

test('keeps delivery channels isolated', async t => {
  const channels = [randomUUID(), randomUUID()]
  const streams = await Promise.all(channels.map(channel => openStream(`${server.url}/${channel}`)))
  for (const stream of streams) t.after(stream.close)
  for (const channel of channels) {
    const response = await fetch(`${server.url}/${channel}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: channel })
    assert.equal(response.status, 200)
  }
  for (let index = 0; index < channels.length; index++) {
    assert.equal(Buffer.from((await streams[index].next()).body, 'base64').toString(), channels[index])
  }
})

test('redelivery endpoint forwards the posted bytes', async t => {
  const channel = randomUUID()
  const stream = await openStream(`${server.url}/${channel}`)
  t.after(stream.close)
  const body = Buffer.from(' { "redelivered": true }\n')
  const response = await fetch(`${server.url}/${channel}/redeliver`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  assert.equal(response.status, 200)
  assert.deepEqual(Buffer.from((await stream.next()).body, 'base64'), body)
})

test('retains the default request size limit', async () => {
  const response = await fetch(`${server.url}/oversized`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.alloc(1024 * 1024 + 1) })
  assert.equal(response.status, 413)
})
