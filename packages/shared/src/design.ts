import { z } from 'zod'
import { escapeHtml } from './merge.js'

/**
 * The email builder's document, and the one function that turns it into HTML.
 *
 * A design is a column of blocks. It is rendered to the kind of HTML email
 * clients actually agree on — nested tables, inline styles, a 600px column —
 * and the renderer lives here, in the shared package, so the builder's preview
 * and the stored message are the same string.
 */
export type Align = 'left' | 'center' | 'right'

export interface DesignTheme {
  /** Behind the message. */
  background: string
  /** The message column itself. */
  surface: string
  text: string
  muted: string
  /** Buttons and links. */
  accent: string
  accentText: string
  font: string
  width: number
  radius: number
}

export const EMAIL_FONTS = [
  { label: 'Helvetica / Arial', value: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: "'Trebuchet MS', Tahoma, sans-serif" },
  { label: 'Courier', value: "'Courier New', Courier, monospace" },
] as const

export const DEFAULT_THEME: DesignTheme = {
  background: '#f3f4f6',
  surface: '#ffffff',
  text: '#1f2933',
  muted: '#6b7280',
  accent: '#5b5bd6',
  accentText: '#ffffff',
  font: EMAIL_FONTS[0].value,
  width: 600,
  radius: 8,
}

export type Block =
  | { id: string; type: 'heading'; text: string; level: 1 | 2 | 3; align: Align }
  | { id: string; type: 'text'; html: string; align: Align }
  | { id: string; type: 'image'; src: string; alt: string; href: string; width: number; align: Align }
  | { id: string; type: 'button'; label: string; href: string; align: Align; fullWidth: boolean }
  | { id: string; type: 'divider' }
  | { id: string; type: 'spacer'; height: number }
  | { id: string; type: 'columns'; left: string; right: string }
  | { id: string; type: 'html'; html: string }

export type BlockType = Block['type']

export interface EmailDesign {
  version: 1
  theme: DesignTheme
  blocks: Block[]
}

export const BLOCK_TYPES: readonly { type: BlockType; label: string; description: string }[] = [
  { type: 'heading', label: 'Heading', description: 'A title or section heading' },
  { type: 'text', label: 'Text', description: 'Paragraphs, lists and links' },
  { type: 'image', label: 'Image', description: 'A picture, optionally linked' },
  { type: 'button', label: 'Button', description: 'One clear call to action' },
  { type: 'columns', label: 'Two columns', description: 'Side by side, stacked on phones' },
  { type: 'divider', label: 'Divider', description: 'A thin rule between sections' },
  { type: 'spacer', label: 'Spacer', description: 'Empty vertical space' },
  { type: 'html', label: 'Custom HTML', description: 'Your own markup, as written' },
]

const blockId = () => `b_${Math.random().toString(36).slice(2, 10)}`

export function createBlock(type: BlockType): Block {
  const id = blockId()
  switch (type) {
    case 'heading':
      return { id, type, text: 'A clear, short heading', level: 1, align: 'left' }
    case 'text':
      return {
        id,
        type,
        html: '<p>Hi {{first_name|there}},</p><p>Write your message here.</p>',
        align: 'left',
      }
    case 'image':
      return { id, type, src: '', alt: '', href: '', width: 100, align: 'center' }
    case 'button':
      return { id, type, label: 'Read more', href: 'https://', align: 'center', fullWidth: false }
    case 'divider':
      return { id, type }
    case 'spacer':
      return { id, type, height: 24 }
    case 'columns':
      return { id, type, left: '<p>Left column</p>', right: '<p>Right column</p>' }
    case 'html':
      return { id, type, html: '<!-- your HTML -->' }
  }
}

export function defaultDesign(): EmailDesign {
  return {
    version: 1,
    theme: { ...DEFAULT_THEME },
    blocks: [
      { ...createBlock('heading'), type: 'heading', text: 'Your headline', level: 1, align: 'left' },
      createBlock('text'),
      createBlock('button'),
    ],
  }
}

/**
 * Takes out what has no business in an email body and would be stripped by the
 * client anyway: scripts, frames, inline event handlers, `javascript:` links.
 * It is tidying, not a security boundary — the only people who can write a
 * design are signed-in editors.
 */
export function tidyHtml(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|form|link|meta)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"')
}

const color = (value: string, fallback: string) => (/^#[0-9a-f]{3,8}$/i.test(value) ? value : fallback)

/** Gives bare tags the inline styles email clients need; they ignore stylesheets. */
function styleRichText(html: string, theme: DesignTheme): string {
  const add = (tag: string, style: string) => (source: string) =>
    source.replace(new RegExp(`<${tag}(\\s[^>]*)?>`, 'gi'), (match, attrs: string = '') =>
      /\sstyle\s*=/.test(attrs) ? match : `<${tag}${attrs} style="${style}">`,
    )
  return [
    add('p', 'margin:0 0 14px 0;'),
    add('ul', 'margin:0 0 14px 0;padding-left:22px;'),
    add('ol', 'margin:0 0 14px 0;padding-left:22px;'),
    add('li', 'margin:0 0 6px 0;'),
    add('a', `color:${theme.accent};text-decoration:underline;`),
    add('h2', `margin:0 0 10px 0;font-size:20px;line-height:1.3;color:${theme.text};`),
    add('h3', `margin:0 0 8px 0;font-size:17px;line-height:1.35;color:${theme.text};`),
  ].reduce((source, apply) => apply(source), tidyHtml(html))
}

/**
 * One block as the table row it becomes in the email. Exported so the builder
 * draws its canvas from the same markup that is sent.
 */
export function renderBlock(block: Block, theme: DesignTheme): string {
  const pad = 'padding:0 32px;'
  const body = `font-family:${theme.font};font-size:16px;line-height:1.6;color:${theme.text};`
  switch (block.type) {
    case 'heading': {
      const size = { 1: 28, 2: 22, 3: 18 }[block.level]
      return `<tr><td style="${pad}padding-bottom:14px;text-align:${block.align};"><h${block.level} style="margin:0;font-family:${theme.font};font-size:${size}px;line-height:1.25;font-weight:700;color:${theme.text};">${escapeHtml(block.text)}</h${block.level}></td></tr>`
    }
    case 'text':
      return `<tr><td style="${pad}${body}text-align:${block.align};">${styleRichText(block.html, theme)}</td></tr>`
    case 'image': {
      if (!block.src) return ''
      const width = Math.round(((theme.width - 64) * Math.min(100, Math.max(10, block.width))) / 100)
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" width="${width}" style="display:inline-block;max-width:100%;height:auto;border:0;border-radius:${theme.radius}px;">`
      const inner = block.href ? `<a href="${escapeHtml(block.href)}">${img}</a>` : img
      return `<tr><td style="${pad}padding-bottom:16px;text-align:${block.align};">${inner}</td></tr>`
    }
    case 'button': {
      const width = block.fullWidth ? 'display:block;' : 'display:inline-block;'
      return `<tr><td style="${pad}padding-top:6px;padding-bottom:20px;text-align:${block.align};"><a href="${escapeHtml(block.href)}" style="${width}background:${theme.accent};color:${theme.accentText};font-family:${theme.font};font-size:16px;font-weight:600;line-height:1;text-decoration:none;text-align:center;padding:14px 26px;border-radius:${theme.radius}px;">${escapeHtml(block.label)}</a></td></tr>`
    }
    case 'divider':
      return `<tr><td style="${pad}padding-top:8px;padding-bottom:22px;"><div style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>`
    case 'spacer':
      return `<tr><td style="height:${Math.min(200, Math.max(4, block.height))}px;font-size:0;line-height:0;">&nbsp;</td></tr>`
    case 'columns': {
      const cell = (html: string, side: 'left' | 'right') =>
        `<td class="ariad-col" width="50%" valign="top" style="${body}padding-${side === 'left' ? 'right' : 'left'}:12px;">${styleRichText(html, theme)}</td>`
      return `<tr><td style="${pad}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cell(block.left, 'left')}${cell(block.right, 'right')}</tr></table></td></tr>`
    }
    case 'html':
      return `<tr><td style="${pad}${body}">${tidyHtml(block.html)}</td></tr>`
  }
}

export interface RenderDesignOptions {
  /** The line shown after the subject in the inbox list. */
  preheader?: string | null
  title?: string | null
}

/** The theme with anything that is not a color replaced by the default. */
export function safeTheme(theme: DesignTheme): DesignTheme {
  return {
    ...DEFAULT_THEME,
    ...theme,
    background: color(theme.background, DEFAULT_THEME.background),
    surface: color(theme.surface, DEFAULT_THEME.surface),
    text: color(theme.text, DEFAULT_THEME.text),
    muted: color(theme.muted, DEFAULT_THEME.muted),
    accent: color(theme.accent, DEFAULT_THEME.accent),
    accentText: color(theme.accentText, DEFAULT_THEME.accentText),
  }
}

export function renderDesign(design: EmailDesign, options: RenderDesignOptions = {}): string {
  const theme = safeTheme(design.theme)
  const rows = design.blocks.map((block) => renderBlock(block, theme)).join('\n')
  return wrapEmailHtml(rows, theme, options)
}

function preheaderHtml(preheader: string | null | undefined): string {
  if (!preheader) return ''
  // The padding after it stops the client filling the preview with body text.
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`
}

function wrapEmailHtml(rows: string, theme: DesignTheme, options: RenderDesignOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(options.title ?? '')}</title>
<style>
  body { margin:0; padding:0; }
  img { -ms-interpolation-mode:bicubic; }
  @media (max-width: 620px) {
    .ariad-col { display:block !important; width:100% !important; padding-left:0 !important; padding-right:0 !important; }
    .ariad-shell { padding:12px 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${theme.background};">
${preheaderHtml(options.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${theme.background};">
<tr><td class="ariad-shell" align="center" style="padding:28px 12px;">
<table role="presentation" width="${theme.width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${theme.width}px;background:${theme.surface};border-radius:${theme.radius}px;">
<tr><td style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
${rows}
<tr><td style="height:18px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<!--ariad:footer-->
</td></tr>
</table>
</body>
</html>`
}

/** Puts the preheader into hand-written HTML, which has no design to carry it. */
export function withPreheader(html: string, preheader: string | null | undefined): string {
  const block = preheaderHtml(preheader)
  if (!block) return html
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (tag) => `${tag}\n${block}`) : block + html
}

const blockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string(), type: z.literal('heading'), text: z.string().max(500), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), align: z.enum(['left', 'center', 'right']) }),
  z.object({ id: z.string(), type: z.literal('text'), html: z.string().max(100_000), align: z.enum(['left', 'center', 'right']) }),
  z.object({ id: z.string(), type: z.literal('image'), src: z.string().max(2000), alt: z.string().max(500), href: z.string().max(2000), width: z.number().min(10).max(100), align: z.enum(['left', 'center', 'right']) }),
  z.object({ id: z.string(), type: z.literal('button'), label: z.string().max(200), href: z.string().max(2000), align: z.enum(['left', 'center', 'right']), fullWidth: z.boolean() }),
  z.object({ id: z.string(), type: z.literal('divider') }),
  z.object({ id: z.string(), type: z.literal('spacer'), height: z.number().min(4).max(200) }),
  z.object({ id: z.string(), type: z.literal('columns'), left: z.string().max(50_000), right: z.string().max(50_000) }),
  z.object({ id: z.string(), type: z.literal('html'), html: z.string().max(200_000) }),
])

export const emailDesignSchema = z.object({
  version: z.literal(1),
  theme: z.object({
    background: z.string().max(20),
    surface: z.string().max(20),
    text: z.string().max(20),
    muted: z.string().max(20),
    accent: z.string().max(20),
    accentText: z.string().max(20),
    font: z.string().max(200),
    width: z.number().min(320).max(800),
    radius: z.number().min(0).max(40),
  }),
  blocks: z.array(blockSchema).max(200),
})
