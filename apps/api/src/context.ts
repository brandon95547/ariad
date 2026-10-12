import type { FastifyBaseLogger } from 'fastify'
import type { Config } from './config.js'
import type { Db } from './db/index.js'
import type { Secrets } from './lib/crypto.js'

/**
 * What every service needs and nothing else. Passed explicitly rather than
 * imported, so a test can hand in an in-memory database and a throwaway key.
 */
export interface Ctx {
  db: Db
  config: Config
  secrets: Secrets
  log: FastifyBaseLogger
}
