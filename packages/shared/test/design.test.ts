import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, createBlock, defaultDesign, emailDesignSchema, renderDesign, tidyHtml, withPreheader, type EmailDesign } from '../src/design.js'

const design = (blocks: EmailDesign['blocks']): EmailDesign => ({ version: 1, theme: { ...DEFAULT_THEME }, blocks })

describe('rendering a design', () => {
  it('produces a whole document with a place for the footer', () => {
    const html = renderDesign(defaultDesign(), { title: 'Hello', preheader: 'Preview line' })
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Hello</title>')
    expect(html).toContain('Preview line')
    expect(html).toContain('<!--ariad:footer-->')
    expect(html).toContain('role="presentation"')
  })

  it('escapes text typed into a heading or a button', () => {
    const html = renderDesign(
      design([
        { id: 'a', type: 'heading', text: 'Fish & <chips>', level: 1, align: 'left' },
        { id: 'b', type: 'button', label: 'Go "now"', href: 'https://example.com/?a=1&b=2', align: 'center', fullWidth: false },
      ]),
    )
    expect(html).toContain('Fish &amp; &lt;chips&gt;')
    expect(html).toContain('Go &quot;now&quot;')
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"')
  })

  it('gives bare tags the inline styles mail apps need, and leaves styled ones alone', () => {
    const html = renderDesign(design([{ id: 'a', type: 'text', align: 'left', html: '<p>One</p><p style="margin:0">Two</p><a href="https://example.com">x</a>' }]))
    expect(html).toContain('<p style="margin:0 0 14px 0;">One</p>')
    expect(html).toContain('<p style="margin:0">Two</p>')
    expect(html).toMatch(/<a href="https:\/\/example\.com" style="color:#5b5bd6;/)
  })

  it('draws nothing for an image with no address', () => {
    const empty = { ...createBlock('image') }
    expect(renderDesign(design([empty]))).not.toContain('<img')
  })

  it('falls back to the default for a color that is not one', () => {
    const html = renderDesign({ ...defaultDesign(), theme: { ...DEFAULT_THEME, accent: 'red; background:url(x)' } })
    expect(html).not.toContain('url(x)')
    expect(html).toContain(DEFAULT_THEME.accent)
  })

  it('keeps merge tags as they are, for the server to fill in', () => {
    expect(renderDesign(defaultDesign())).toContain('{{first_name|there}}')
  })
})

describe('tidying HTML', () => {
  it('takes out scripts, frames and inline handlers', () => {
    const html = tidyHtml('<p onclick="x()">Hi</p><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">y</a>')
    expect(html).toBe('<p>Hi</p><a href="#">y</a>')
  })
})

describe('the preheader in hand-written HTML', () => {
  it('goes straight after the body tag', () => {
    expect(withPreheader('<html><body class="x"><p>Hi</p></body></html>', 'Peek')).toMatch(/<body class="x">\n<div style="display:none[^"]*">Peek/)
  })

  it('changes nothing when there is none', () => {
    expect(withPreheader('<p>Hi</p>', null)).toBe('<p>Hi</p>')
  })
})

describe('the design schema', () => {
  it('accepts what the builder makes', () => {
    expect(emailDesignSchema.safeParse(defaultDesign()).success).toBe(true)
  })

  it('refuses a block type it does not know', () => {
    expect(emailDesignSchema.safeParse(design([{ id: 'a', type: 'video' } as never])).success).toBe(false)
  })
})
