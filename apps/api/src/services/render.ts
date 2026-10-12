import {
  escapeHtml,
  formatAddress,
  htmlToText,
  renderMerge,
  sampleMergeData,
  type Settings,
} from '@ariad/shared'
import type { Ctx } from '../context.js'
import { parseJson } from '../db/index.js'
import type { AccountRow } from './accounts.js'
import type { ContactRow } from './contacts.js'
import type { OutgoingMail } from './mailer.js'

/**
 * Turns a template and a contact into the message that actually goes out.
 *
 * In order: merge tags, the compliance footer, click tracking, the open pixel,
 * then the headers. The order matters — links are rewritten after merging so a
 * merge tag inside a URL is tracked like any other, and the footer goes in
 * before rewriting so its own links are left alone by being ours.
 */
export interface RenderSource {
  subject: string
  html: string
  fromName: string | null
  fromEmail: string | null
  replyTo: string | null
  trackOpens: boolean
  trackClicks: boolean
  /**
   * Marketing mail: gets the unsubscribe footer and the List-Unsubscribe
   * headers. Off only for mail a person asked for one copy of — a signup
   * confirmation, a test.
   */
  marketing: boolean
}

export interface RenderInput {
  source: RenderSource
  account: AccountRow
  contact: ContactRow | null
  toEmail: string
  messageToken: string
  settings: Settings
  baseUrl: string
  /** Test sends say so in the subject and carry no tracking. */
  test?: boolean
}

export function contactUrls(baseUrl: string, contactToken: string | null, messageToken: string) {
  const who = contactToken ?? 'preview'
  return {
    unsubscribe: `${baseUrl}/unsubscribe/${who}?m=${messageToken}`,
    preferences: `${baseUrl}/preferences/${who}`,
    view: `${baseUrl}/api/v1/public/view/${messageToken}`,
    oneClick: `${baseUrl}/api/v1/public/unsubscribe/${who}?m=${messageToken}`,
  }
}

export function mergeData(
  contact: ContactRow | null,
  settings: Settings,
  urls: ReturnType<typeof contactUrls>,
): Record<string, string> {
  const organization = { organization: settings.organization.name, address: formatAddress(settings.organization), year: String(new Date().getFullYear()) }
  const links = { unsubscribe_url: urls.unsubscribe, preferences_url: urls.preferences, view_url: urls.view }
  if (!contact) return { ...sampleMergeData(), ...organization, ...links }

  const custom = parseJson<Record<string, string>>(contact.custom, {})
  return {
    first_name: contact.first_name ?? '',
    last_name: contact.last_name ?? '',
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(' '),
    email: contact.email,
    company: contact.company ?? '',
    phone: contact.phone ?? '',
    ...Object.fromEntries(Object.entries(custom).map(([key, value]) => [`custom.${key}`, value])),
    ...organization,
    ...links,
  }
}

/**
 * The footer the law asks for: who sent this, where they are, and how to
 * stop. Added unless the template already carries both the unsubscribe link
 * and the address itself.
 */
function complianceFooter(settings: Settings): string {
  const style = 'font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;'
  const link = 'color:#6b7280;text-decoration:underline;'
  const lines = [
    `<strong>{{organization}}</strong>`,
    `{{address}}`,
    settings.compliance.footerNote ? escapeHtml(settings.compliance.footerNote) : '',
    `<a href="{{unsubscribe_url}}" style="${link}">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="{{preferences_url}}" style="${link}">Email preferences</a>`,
  ].filter(Boolean)
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;margin:0 auto;"><tr><td style="padding:20px 32px 8px 32px;text-align:center;${style}">${lines.join('<br>')}</td></tr></table>`
}

const FOOTER_MARK = '<!--ariad:footer-->'

function withFooter(html: string, footer: string): string {
  if (html.includes(FOOTER_MARK)) return html.replace(FOOTER_MARK, footer)
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${footer}</body>`)
  return html + footer
}

export function needsFooter(template: string): boolean {
  return !(/\{\{\s*unsubscribe_url/i.test(template) && /\{\{\s*address/i.test(template))
}

const decodeAttr = (value: string) =>
  value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/**
 * Points every outside link at our redirect. The target travels in the link
 * with a signature, so the redirect only ever sends people where a message we
 * wrote said to — it cannot be borrowed to dress up someone else's link.
 */
export function trackClicks(ctx: Ctx, html: string, baseUrl: string, messageToken: string): string {
  return html.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (match, before: string, quote: string, raw: string) => {
    const url = decodeAttr(raw.trim())
    if (!/^https?:\/\//i.test(url) || url.startsWith(baseUrl)) return match
    const encoded = Buffer.from(url, 'utf8').toString('base64url')
    const signature = ctx.secrets.sign(`${messageToken}|${url}`)
    return `${before}${quote}${baseUrl}/t/c/${messageToken}?u=${encoded}&amp;s=${signature}${quote}`
  })
}

function openPixel(baseUrl: string, messageToken: string): string {
  return `<img src="${baseUrl}/t/o/${messageToken}.gif" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">`
}

export function renderEmail(ctx: Ctx, input: RenderInput): OutgoingMail {
  const { source, account, contact, settings, baseUrl, messageToken } = input
  const urls = contactUrls(baseUrl, contact?.token ?? null, messageToken)
  const data = mergeData(contact, settings, urls)

  const template = source.marketing && needsFooter(source.html) ? withFooter(source.html, complianceFooter(settings)) : source.html
  const merged = renderMerge(template, data, { html: true })
  const text = htmlToText(merged)

  let html = merged
  if (!input.test) {
    if (source.trackClicks) html = trackClicks(ctx, html, baseUrl, messageToken)
    if (source.trackOpens) {
      const pixel = openPixel(baseUrl, messageToken)
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pixel}</body>`) : html + pixel
    }
  }

  const subject = renderMerge(source.subject, data).replace(/\s+/g, ' ').trim()
  // Gmail sends as the signed-in mailbox whatever the From header says, and
  // rewrites a header that disagrees; so for Gmail the account's address wins.
  const fromAddress = account.kind === 'gmail' ? account.from_email : source.fromEmail || account.from_email
  const replyTo = source.replyTo || account.reply_to

  const headers: Record<string, string> = { 'X-Ariad-Message': messageToken }
  if (source.marketing && contact) {
    // RFC 8058 one-click: the mailbox provider POSTs to this URL itself when
    // the person presses "Unsubscribe" in its own interface.
    headers['List-Unsubscribe'] = `<${urls.oneClick}>, <mailto:${replyTo || fromAddress}?subject=unsubscribe>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
    headers['Precedence'] = 'bulk'
  }

  return {
    from: { name: source.fromName || account.from_name, address: fromAddress },
    to: input.toEmail,
    replyTo,
    subject: input.test ? `[Test] ${subject}` : subject,
    html,
    text,
    headers,
  }
}
