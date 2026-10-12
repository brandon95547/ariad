import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  automationUpdateSchema,
  campaignUpdateSchema,
  contactUpdateSchema,
  customFieldUpdateSchema,
  listUpdateSchema,
  patchOf,
  settingsUpdateSchema,
  tagUpdateSchema,
  updateSendingAccountSchema,
  updateUserSchema,
} from '../src/index.js'

/**
 * A partial update must change what it names and nothing else.
 *
 * zod 4 applies a default even inside an optional, so `schema.partial()` on a
 * schema with defaults quietly fills in every field that was left out — a PATCH
 * that renames an automation would empty its steps. Every update schema is
 * checked here, by name, so a new one cannot bring the problem back unnoticed.
 */
const UPDATES: Record<string, z.ZodType> = {
  campaignUpdateSchema,
  automationUpdateSchema,
  contactUpdateSchema,
  listUpdateSchema,
  tagUpdateSchema,
  customFieldUpdateSchema,
  updateSendingAccountSchema,
  updateUserSchema,
  settingsUpdateSchema,
}

describe('update schemas', () => {
  for (const [name, schema] of Object.entries(UPDATES)) {
    it(`${name} adds nothing to an empty update`, () => {
      expect(schema.parse({})).toEqual({})
    })
  }

  it('keeps what a campaign update leaves out, out', () => {
    expect(campaignUpdateSchema.parse({ subject: 'New subject' })).toEqual({
      subject: 'New subject',
    })
  })

  it('still validates and transforms the fields that are given', () => {
    expect(contactUpdateSchema.parse({ email: '  Ada@Example.TEST ', firstName: '' })).toEqual({
      email: 'ada@example.test',
      firstName: null,
    })
    expect(listUpdateSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('takes the default off and leaves the rest of the field alone', () => {
    const schema = patchOf(
      z.object({ count: z.number().int().min(1).default(5), label: z.string() }),
    )
    expect(schema.parse({})).toEqual({})
    expect(schema.parse({ count: 2 })).toEqual({ count: 2 })
    expect(schema.safeParse({ count: 0 }).success).toBe(false)
  })
})
