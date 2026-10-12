import fs from 'node:fs'
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import fastifyStatic from '@fastify/static'
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { API_PREFIX } from '@ariad/shared'
import type { Config } from './config.js'
import type { Ctx } from './context.js'
import { openDatabase } from './db/index.js'
import { AppError } from './errors.js'
import { Secrets } from './lib/crypto.js'
import { authPlugin } from './plugins/auth.js'
import { Mailer } from './services/mailer.js'
import { Worker } from './services/worker.js'
import { accountRoutes } from './routes/accounts.js'
import { authRoutes } from './routes/auth.js'
import { automationRoutes } from './routes/automations.js'
import { campaignRoutes } from './routes/campaigns.js'
import { contactRoutes } from './routes/contacts.js'
import { formRoutes } from './routes/forms.js'
import { publicRoutes, trackingRoutes } from './routes/public.js'
import { reportRoutes } from './routes/reports.js'
import { settingsRoutes } from './routes/settings.js'

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Ctx
    mailer: Mailer
    worker: Worker
  }
}

export interface BuildOptions {
  /** Tests hand in a mailer pointed at a local SMTP catcher. */
  mailer?: Mailer
}

export async function buildApp(config: Config, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.isProduction || config.env === 'test'
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }),
    },
    trustProxy: config.isProduction,
    // Big enough for an email body; the CSV import route raises its own.
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: true,
    forceCloseConnections: 'idle',
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  /**
   * Installed BEFORE any route is registered: a child context captures its
   * parent's error handler at the moment it is created.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
        message: issue.message,
      }))
      return reply.code(400).send({
        error: {
          code: 'validation_failed',
          // The first problem, in words, so a form with no field-level
          // handling still tells the person what to fix.
          message: details[0]?.message ?? 'Some of that was not filled in correctly.',
          details,
        },
      })
    }

    if (error instanceof AppError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      })
    }

    const status = error.statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error')
      return reply.code(500).send({ error: { code: 'internal_error', message: 'Something went wrong.' } })
    }
    return reply.code(status).send({ error: { code: error.code ?? 'request_error', message: error.message } })
  })

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(`${request.method} ${request.url} ${reply.statusCode} ${Math.round(reply.elapsedTime)}ms`)
    done()
  })

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false })
  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  })
  await app.register(cookie)

  const db = openDatabase({
    path: config.databasePath,
    log: (message) => app.log.info({ scope: 'db' }, message),
  })
  const secrets = Secrets.load({
    secret: config.secret,
    dataDir: config.dataDir,
    ephemeral: config.databasePath === ':memory:',
  })
  const ctx: Ctx = { db, config, secrets, log: app.log }
  const mailer = options.mailer ?? new Mailer()
  const worker = new Worker(ctx, mailer)

  app.decorate('ctx', ctx)
  app.decorate('mailer', mailer)
  app.decorate('worker', worker)

  app.addHook('onClose', async () => {
    await worker.stop()
    mailer.closeAll()
    db.close()
  })

  await app.register(authPlugin)

  await app.register(
    async (api) => {
      api.get('/health', async () => ({
        status: 'ok',
        name: 'ariad',
        version: config.version,
        worker: worker.status(),
      }))
      await api.register(authRoutes)
      await api.register(accountRoutes)
      await api.register(settingsRoutes)
      await api.register(contactRoutes)
      await api.register(campaignRoutes)
      await api.register(automationRoutes)
      await api.register(formRoutes)
      await api.register(reportRoutes)
      await api.register(publicRoutes, { prefix: '/public' })
    },
    { prefix: API_PREFIX },
  )

  // Open pixels and click redirects: short paths, because they are in every email.
  await app.register(trackingRoutes, { prefix: '/t' })

  /**
   * In production the API also serves the built web app, so the whole product
   * is one process on one port. Anything that is not an API or tracking path
   * gets index.html and the client router takes it from there.
   */
  const hasWeb = fs.existsSync(`${config.webDist}/index.html`)
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false })
  }
  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url.startsWith('/api/') || request.url.startsWith('/t/')
    if (hasWeb && !isApi && request.method === 'GET') return reply.sendFile('index.html')
    return reply.code(404).send({
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}.` },
    })
  })

  if (config.worker) worker.start()

  return app
}
