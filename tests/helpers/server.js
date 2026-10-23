import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { devNull } from 'node:os'
import { fileURLToPath } from 'node:url'
import { EventSource } from 'eventsource'

const root = fileURLToPath(new URL('../../', import.meta.url))

export async function startServer (overrides = {}) {
  const reservation = createServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const { port } = reservation.address()
  await new Promise(resolve => reservation.close(resolve))
  const env = { ...process.env, NODE_ENV: 'production', PORT: String(port), DOTENV_PATH: devNull, DOTENV_QUIET: 'true', DOTENV_OVERRIDE: 'false' }
  for (const name of ['REDIS_URL', 'REDIS_NAMESPACE', 'SENTRY_DSN', 'FORCE_HTTPS', 'BLOCKED_CHANNELS']) delete env[name]
  Object.assign(env, overrides)
  const child = spawn(process.execPath, ['index.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  const append = data => { logs = (logs + data).slice(-16000) }
  child.stdout.on('data', append)
  child.stderr.on('data', append)

  async function stop () {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000)
    try {
      await exited
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Server startup timed out:\n${logs}`)), 5000)
      const onExit = () => finish(new Error(`Server exited during startup:\n${logs}`))
      const onData = () => { if (logs.includes('Server listening at')) finish() }
      function finish (error) {
        clearTimeout(timeout)
        child.off('exit', onExit)
        child.off('error', finish)
        child.stdout.off('data', onData)
        if (error) reject(error)
        else resolve()
      }
      child.on('exit', onExit)
      child.on('error', finish)
      child.stdout.on('data', onData)
    })
    return { url: `http://127.0.0.1:${port}`, stop }
  } catch (error) {
    await stop()
    throw error
  }
}

export async function openStream (url) {
  const source = new EventSource(url)
  const messages = []
  let notify
  source.addEventListener('message', event => {
    messages.push(JSON.parse(event.data))
    notify?.()
  })
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`No SSE ready event: ${url}`)), 5000)
      source.addEventListener('ready', () => { clearTimeout(timeout); resolve() }, { once: true })
      source.addEventListener('error', () => { clearTimeout(timeout); reject(new Error(`SSE connection failed: ${url}`)) }, { once: true })
    })
  } catch (error) {
    source.close()
    throw error
  }
  return {
    close: () => source.close(),
    async next () {
      if (!messages.length) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => { notify = undefined; reject(new Error(`No SSE message: ${url}`)) }, 5000)
          notify = () => { clearTimeout(timeout); notify = undefined; resolve() }
        })
      }
      return messages.shift()
    }
  }
}
