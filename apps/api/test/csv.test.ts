import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from '../src/lib/csv.js'

describe('reading CSV', () => {
  it('reads quoted fields with commas, quotes and line breaks in them', () => {
    const { headers, rows } = parseCsv('name,note\r\n"Lovelace, Ada","said ""hello""\nthen left"\r\nGrace,plain\r\n')
    expect(headers).toEqual(['name', 'note'])
    expect(rows).toEqual([
      ['Lovelace, Ada', 'said "hello"\nthen left'],
      ['Grace', 'plain'],
    ])
  })

  it('works out the delimiter a spreadsheet used', () => {
    expect(parseCsv('email;name\na@example.test;Ada').rows).toEqual([['a@example.test', 'Ada']])
    expect(parseCsv('email\tname\na@example.test\tAda').delimiter).toBe('\t')
  })

  it('ignores a byte-order mark and blank lines', () => {
    const { headers, rows } = parseCsv('﻿email\n\na@example.test\n,\n\n')
    expect(headers).toEqual(['email'])
    expect(rows).toEqual([['a@example.test']])
  })
})

describe('writing CSV', () => {
  it('quotes what needs it and round-trips', () => {
    const text = toCsv(['name', 'note'], [['Lovelace, Ada', 'said "hi"'], ['Grace', null]])
    expect(text).toBe('name,note\r\n"Lovelace, Ada","said ""hi"""\r\nGrace,\r\n')
    expect(parseCsv(text).rows[0]).toEqual(['Lovelace, Ada', 'said "hi"'])
  })

  it('writes a cell that looks like a formula as text', () => {
    expect(toCsv(['a'], [['=HYPERLINK("http://evil")'], ['+1 555 0100'], ['@handle']])).toBe(
      'a\r\n"\'=HYPERLINK(""http://evil"")"\r\n\'+1 555 0100\r\n\'@handle\r\n',
    )
  })
})
