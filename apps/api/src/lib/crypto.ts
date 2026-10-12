import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Everything secret goes through here.
 *
 * SMTP passwords have to be stored in a form that can be read back — the
 * server signs in with them — so they are encrypted, not hashed, under a key
 * that lives outside the database. A copy of the SQLite file on its own gives
 * up no mailbox credentials.
 */
export class Secrets {
  private readonly key: Buffer

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('The secret key must be 32 bytes.')
    this.key = key
  }

  /**
   * From ARIAD_SECRET when set, otherwise from `secret.key` beside the
   * database, generated on first boot and readable only by its owner.
   */
  static load(options: { secret?: string; dataDir: string; ephemeral?: boolean }): Secrets {
    if (options.secret) return new Secrets(Buffer.from(options.secret, 'hex'))
    if (options.ephemeral) return new Secrets(crypto.randomBytes(32))

    const file = path.join(options.dataDir, 'secret.key')
    if (fs.existsSync(file)) {
      return new Secrets(Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex'))
    }
    fs.mkdirSync(options.dataDir, { recursive: true })
    const key = crypto.randomBytes(32)
    fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 })
    return new Secrets(key)
  }

  encrypt(plain: string): string {
    if (plain === '') return ''
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
  }

  decrypt(stored: string): string {
    if (stored === '') return ''
    const [version, iv, tag, data] = stored.split(':')
    if (version !== 'v1' || !iv || !tag || data === undefined) {
      throw new Error('Stored secret is not in a format this version can read.')
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  }

  /** A short signature for links we hand out and must recognize on the way back. */
  sign(value: string): string {
    return crypto.createHmac('sha256', this.key).update(value).digest('base64url').slice(0, 16)
  }

  verify(value: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(value))
    const given = Buffer.from(signature)
    return expected.length === given.length && crypto.timingSafeEqual(expected, given)
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, {
    ...SCRYPT,
    N: Number(n),
  })
  return crypto.timingSafeEqual(expected, actual)
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Unguessable, URL-safe. 24 bytes is 192 bits. */
export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** `con_k3j9x0a2m5p7q1w8` — the prefix says what the id is when it turns up in a log. */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(16)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length]
  return `${prefix}_${out}`
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}
