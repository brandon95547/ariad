import { describe, expect, it } from 'vitest'
import { findMergeTags, htmlToText, renderMerge } from '../src/merge.js'

describe('merge tags', () => {
  const data = { first_name: 'Ada', company: '', 'custom.plan': 'Pro' }

  it('fills a tag, with or without spaces inside the braces', () => {
    expect(renderMerge('Hi {{first_name}} and {{ first_name }}', data)).toBe('Hi Ada and Ada')
  })

  it('uses the fallback when the contact has no value', () => {
    expect(renderMerge('Hi {{last_name|there}}', data)).toBe('Hi there')
    expect(renderMerge('At {{company|your company}}', data)).toBe('At your company')
  })

  it('leaves nothing behind for a tag with no value and no fallback', () => {
    expect(renderMerge('Hi {{last_name}}!', data)).toBe('Hi !')
  })

  it('reads custom fields and ignores case', () => {
    expect(renderMerge('{{custom.plan}} / {{CUSTOM.PLAN}}', data)).toBe('Pro / Pro')
  })

  it('escapes values going into HTML, and not those going into a subject', () => {
    const name = { first_name: '<b>Tom & Jerry</b>' }
    expect(renderMerge('{{first_name}}', name, { html: true })).toBe('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;')
    expect(renderMerge('{{first_name}}', name)).toBe('<b>Tom & Jerry</b>')
  })

  it('lists the tags a template uses', () => {
    expect(findMergeTags('{{first_name|x}} {{custom.plan}} {{first_name}}')).toEqual(['first_name', 'custom.plan'])
  })
})

describe('the plain-text part', () => {
  it('keeps the words and the links, and drops the markup', () => {
    const text = htmlToText(
      '<html><head><style>p{color:red}</style></head><body><h1>News</h1><p>Read <a href="https://example.com/a">the post</a>.</p><ul><li>One</li><li>Two</li></ul><p>Tom &amp; Jerry</p></body></html>',
    )
    expect(text).toBe('News\nRead the post (https://example.com/a).\n- One\n- Two\n\nTom & Jerry')
  })

  it('does not repeat a link whose text is its own address', () => {
    expect(htmlToText('<a href="https://example.com">https://example.com</a>')).toBe('https://example.com')
  })
})
