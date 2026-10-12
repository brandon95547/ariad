#!/usr/bin/env node
/**
 * Starts whichever halves of the dev stack are not already running.
 *
 * Two `npm run dev` stacks at once is a confusing failure: the second API
 * cannot bind its port and exits, and the app in the browser keeps talking to
 * the first one. So this looks at what is already there before deciding. A
 * port answering as Ariad is reused, and said so; a port held by something
 * else is refused with the reason. Run it as often as you like and you end up
 * with exactly one stack.
 */
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'

const API_PORT = Number(process.env.PORT ?? 5191)
const WEB_PORT = Number(process.env.WEB_PORT ?? 5190)

const isFree = (port) =>
  new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.listen(port, '0.0.0.0', () => server.close(() => resolve(true)))
  })

async function identify(url, matches) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) })
    if (!response.ok) return false
    return matches(await response.text())
  } catch {
    return false
  }
}

const halves = [
  {
    name: 'api',
    port: API_PORT,
    task: 'npm:dev:api',
    color: 'magenta',
    identify: () =>
      identify(`http://127.0.0.1:${API_PORT}/api/v1/health`, (body) => /"name":"ariad"/.test(body)),
  },
  {
    name: 'web',
    port: WEB_PORT,
    task: 'npm:dev:web',
    color: 'cyan',
    identify: () => identify(`http://127.0.0.1:${WEB_PORT}/`, (body) => /<title>Ariad/.test(body)),
  },
]

const toStart = []
for (const half of halves) {
  if (await isFree(half.port)) {
    toStart.push(half)
    continue
  }
  if (await half.identify()) {
    process.stdout.write(`  reusing the ${half.name} already running on ${half.port}\n`)
    continue
  }
  process.stderr.write(
    `\n  Port ${half.port} is in use, but whatever is on it is not Ariad's ${half.name}.\n\n` +
      `  Find it and free the port:\n    lsof -nP -iTCP:${half.port} -sTCP:LISTEN\n\n`,
  )
  process.exit(1)
}

if (toStart.length === 0) {
  process.stdout.write(`\n  Ariad is already running - http://localhost:${WEB_PORT}\n\n`)
  process.exit(0)
}

// After the ports are read, not before: rebuilding shared restarts a running
// API, and for those few seconds its port looks free.
const build = spawnSync('npm', ['run', 'build:shared'], { stdio: 'inherit' })
if (build.status !== 0) process.exit(build.status ?? 1)

const tasks = [{ name: 'shared', task: 'npm:dev:shared', color: 'gray' }, ...toStart]
const child = spawn(
  'npx',
  [
    'concurrently',
    '-n',
    tasks.map((t) => t.name).join(','),
    '-c',
    tasks.map((t) => t.color).join(','),
    ...tasks.map((t) => t.task),
  ],
  { stdio: 'inherit' },
)

child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
