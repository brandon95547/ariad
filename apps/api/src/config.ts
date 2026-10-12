import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

/**
 * Environment parsing. Validated once, at boot, and thrown on failure: a
 * server that starts with a malformed variable and finds out on the first
 * request fails at the worst possible moment.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
/** `src/` in dev, `dist/` after a build — the workspace root is one level up from either. */
export const APP_ROOT = path.resolve(here, '..')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5191),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATABASE_PATH: z.string().min(1).default('./data/ariad.sqlite'),
  APP_URL: z.string().url().default('http://localhost:5190'),
  CORS_ORIGINS: z.string().default('http://localhost:5190,http://127.0.0.1:5190'),
  ARIAD_SECRET: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'must be 64 hex characters')
    .optional(),
  WORKER: z.enum(['0', '1']).default('1'),
  /** The built web app, served by the API in production so one port does everything. */
  WEB_DIST: z.string().default('../web/dist'),
  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
})

export type Config = {
  env: 'development' | 'test' | 'production'
  isProduction: boolean
  port: number
  host: string
  databasePath: string
  /** Where uploads and the generated secret key live: beside the database. */
  dataDir: string
  appUrl: string
  corsOrigins: string[]
  secret: string | undefined
  worker: boolean
  webDist: string
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL']
  version: string
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  const env = parsed.data
  const inMemory = env.DATABASE_PATH === ':memory:'
  const databasePath = inMemory ? ':memory:' : path.resolve(APP_ROOT, env.DATABASE_PATH)

  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.PORT,
    host: env.HOST,
    databasePath,
    // An in-memory database is a test: whatever it writes to disk goes to the
    // system's temporary directory, never beside real data.
    dataDir: inMemory ? path.join(os.tmpdir(), `ariad-${process.pid}`) : path.dirname(databasePath),
    appUrl: env.APP_URL.replace(/\/+$/, ''),
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    secret: env.ARIAD_SECRET,
    worker: env.WORKER === '1' && env.NODE_ENV !== 'test',
    webDist: path.resolve(APP_ROOT, env.WEB_DIST),
    logLevel: env.LOG_LEVEL,
    version: process.env.npm_package_version ?? '0.1.0',
  }
}
