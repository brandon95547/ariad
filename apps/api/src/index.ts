import { buildApp } from './app.js'
import { loadConfig } from './config.js'

/**
 * Process entry point. Everything testable lives in `buildApp`; this file owns
 * only the parts that are about being a process — binding a port, and shutting
 * down without dropping a request.
 */

/**
 * How long a graceful shutdown gets before the process leaves anyway.
 *
 * A close that never resolves is worse than an abrupt exit. The process stays
 * alive holding the listening socket, so the *next* start dies with
 * EADDRINUSE — and what the operator sees is not "shutdown is slow" but "the
 * API will not come back up", which sends them looking in entirely the wrong
 * place. In development the same thing happens every time a watcher restarts
 * the server; in production it is a container that has to be SIGKILLed.
 *
 * Five seconds is long enough for any request this API serves to finish and
 * short enough to stay under a typical orchestrator's kill grace period.
 */
const SHUTDOWN_TIMEOUT_MS = 5_000

const config = loadConfig()
const app = await buildApp(config)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info(`${signal} received, closing`)

    const deadline = setTimeout(() => {
      app.log.error(
        `close did not finish within ${SHUTDOWN_TIMEOUT_MS}ms — exiting and releasing the port`,
      )
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    // Unref'd so the timer itself never holds the process open once close wins.
    deadline.unref()

    // `close()` stops accepting connections, waits for in-flight requests and
    // then runs the onClose hooks, which is what closes the database cleanly.
    app.close().then(
      () => {
        clearTimeout(deadline)
        process.exit(0)
      },
      (error) => {
        clearTimeout(deadline)
        app.log.error({ err: error }, 'failed to close cleanly')
        process.exit(1)
      },
    )
  })
}

try {
  await app.listen({ port: config.port, host: config.host })
  app.log.info(`Ariad API ready on http://localhost:${config.port}`)
} catch (error) {
  if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    // Worth naming outright. The usual causes are a second `npm run dev` and a
    // previous process that has not let go of the port yet, and neither is
    // obvious from a bare stack trace.
    app.log.error(
      `port ${config.port} is already in use — another Ariad API is running, or the previous one has not exited yet`,
    )
  } else {
    app.log.error({ err: error }, 'failed to start')
  }
  process.exit(1)
}
