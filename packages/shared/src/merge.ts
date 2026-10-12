/**
 * Merge tags: `{{first_name}}`, and `{{first_name|there}}` for a fallback when
 * the contact has no value.
 *
 * One implementation, used by the server when it sends and by the browser when
 * it previews, so a preview can never disagree with what goes out.
 */
export interface MergeTag {
  tag: string
  label: string
  sample: string
  group: 'Contact' | 'Links' | 'Your organization'
}

export const MERGE_TAGS: readonly MergeTag[] = [
  { tag: 'first_name', label: 'First name', sample: 'Alex', group: 'Contact' },
  { tag: 'last_name', label: 'Last name', sample: 'Morgan', group: 'Contact' },
  { tag: 'full_name', label: 'Full name', sample: 'Alex Morgan', group: 'Contact' },
  { tag: 'email', label: 'Email address', sample: 'alex@example.com', group: 'Contact' },
  { tag: 'company', label: 'Company', sample: 'Northwind', group: 'Contact' },
  { tag: 'phone', label: 'Phone', sample: '555-0100', group: 'Contact' },
  { tag: 'unsubscribe_url', label: 'Unsubscribe link', sample: '#unsubscribe', group: 'Links' },
  { tag: 'preferences_url', label: 'Email preferences link', sample: '#preferences', group: 'Links' },
  { tag: 'view_url', label: 'View in browser link', sample: '#view', group: 'Links' },
  { tag: 'organization', label: 'Organization name', sample: 'Your organization', group: 'Your organization' },
  { tag: 'address', label: 'Mailing address', sample: '123 Main St, Charlotte, NC 28202', group: 'Your organization' },
  { tag: 'year', label: 'Current year', sample: String(new Date().getFullYear()), group: 'Your organization' },
]

const TAG_PATTERN = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\|([^}]*))?\}\}/g

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Replaces every tag it knows a value for. A tag with no value and no fallback
 * becomes nothing, never the literal `{{tag}}`: a blank reads as an oversight,
 * braces in someone's inbox read as a broken product.
 */
export function renderMerge(
  template: string,
  data: Readonly<Record<string, string | null | undefined>>,
  options: { html?: boolean } = {},
): string {
  return template.replace(TAG_PATTERN, (_match, key: string, fallback?: string) => {
    const raw = data[key.toLowerCase()]
    const value = raw !== undefined && raw !== null && raw !== '' ? raw : (fallback ?? '').trim()
    return options.html ? escapeHtml(value) : value
  })
}

/** Every tag a template uses, for "this template needs a field you do not have". */
export function findMergeTags(template: string): string[] {
  const found = new Set<string>()
  for (const match of template.matchAll(TAG_PATTERN)) found.add(match[1]!.toLowerCase())
  return [...found]
}

export function sampleMergeData(): Record<string, string> {
  return Object.fromEntries(MERGE_TAGS.map((tag) => [tag.tag, tag.sample]))
}

/** A readable plain-text part from the HTML one, for clients that want it. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return !text || text === href ? href : `${text} (${href})`
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|tr|table|li|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
