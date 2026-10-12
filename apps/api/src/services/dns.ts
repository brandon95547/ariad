import { Resolver } from 'node:dns/promises'
import type { DnsCheck } from '@ariad/shared'

/**
 * Looks up the three records that decide whether a domain's mail is believed.
 *
 *   SPF    which servers may send for the domain
 *   DKIM   the public key a receiver checks each message's signature against
 *   DMARC  what a receiver should do when SPF and DKIM do not line up
 *
 * Gmail and Yahoo now refuse bulk mail from domains without them, so this is a
 * check worth running before the first campaign rather than after it bounces.
 * Nothing here changes DNS; it reads what is published and says what is missing.
 */
const resolver = new Resolver({ timeout: 4000, tries: 2 })

async function txt(name: string): Promise<string[] | null> {
  try {
    return (await resolver.resolveTxt(name)).map((chunks) => chunks.join(''))
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // No record is an answer. A timeout or a refused query is not.
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN') return []
    return null
  }
}

const unknown = (what: string): DnsCheck => ({
  status: 'unknown',
  summary: `The ${what} lookup did not get an answer. Try again in a moment.`,
  record: null,
  advice: null,
})

/** What each provider's SPF include looks like, for the advice text. */
const SPF_INCLUDES: Record<string, string> = {
  'smtp.gmail.com': 'include:_spf.google.com',
  'smtp.sendgrid.net': 'include:sendgrid.net',
  'smtp.mailgun.org': 'include:mailgun.org',
  'smtp.postmarkapp.com': 'include:spf.mtasv.net',
  'smtp-relay.brevo.com': 'include:spf.brevo.com',
  'smtp.office365.com': 'include:spf.protection.outlook.com',
  'smtp.zoho.com': 'include:zoho.com',
}

function spfInclude(host: string | null): string | null {
  if (!host) return null
  if (host.includes('amazonaws.com')) return 'include:amazonses.com'
  return SPF_INCLUDES[host] ?? null
}

export async function checkSpf(domain: string, smtpHost: string | null): Promise<DnsCheck> {
  const records = await txt(domain)
  if (records === null) return unknown('SPF')
  const spf = records.filter((record) => /^v=spf1(\s|$)/i.test(record))
  const include = spfInclude(smtpHost)
  const suggested = `v=spf1 ${include ?? 'include:<your provider>'} ~all`

  if (spf.length === 0) {
    return {
      status: 'fail',
      summary: 'No SPF record.',
      record: null,
      advice: `Add a TXT record on ${domain}: ${suggested}`,
    }
  }
  if (spf.length > 1) {
    return {
      status: 'fail',
      summary: 'More than one SPF record. Receivers treat that as no SPF at all.',
      record: spf.join('\n'),
      advice: 'Combine them into a single TXT record that starts with v=spf1.',
    }
  }
  const record = spf[0]!
  if (/\+all\b/i.test(record)) {
    return {
      status: 'fail',
      summary: 'The SPF record ends in +all, which lets anyone send as this domain.',
      record,
      advice: 'Change +all to ~all.',
    }
  }
  if (include && !record.toLowerCase().includes(include.toLowerCase())) {
    return {
      status: 'warn',
      summary: 'There is an SPF record, but it does not name the server you send through.',
      record,
      advice: `Add ${include} to it, before the "all" at the end.`,
    }
  }
  return { status: 'pass', summary: 'SPF is published.', record, advice: null }
}

/** The selectors the common providers use, tried when none is given. */
const COMMON_SELECTORS = [
  'google',
  'default',
  'selector1',
  'selector2',
  's1',
  's2',
  'k1',
  'k2',
  'mail',
  'dkim',
  'smtp',
  'mxvault',
  'pm',
  'brevo',
  'zoho',
]

export async function checkDkim(
  domain: string,
  selector: string | null,
): Promise<DnsCheck & { selector: string | null }> {
  const candidates = selector ? [selector] : COMMON_SELECTORS
  let sawFailure = false
  for (const candidate of candidates) {
    const records = await txt(`${candidate}._domainkey.${domain}`)
    if (records === null) {
      sawFailure = true
      continue
    }
    const record = records.find((entry) => /(^|;)\s*p=/i.test(entry) || /v=DKIM1/i.test(entry))
    if (!record) continue
    if (/(^|;)\s*p=\s*(;|$)/i.test(record)) {
      return {
        status: 'fail',
        summary: `The DKIM key at selector "${candidate}" has been revoked (empty p=).`,
        record,
        advice: 'Publish a new key from your mail provider.',
        selector: candidate,
      }
    }
    return {
      status: 'pass',
      summary: `DKIM key found at selector "${candidate}".`,
      record: record.length > 140 ? `${record.slice(0, 140)}…` : record,
      advice: null,
      selector: candidate,
    }
  }
  if (sawFailure && !selector) return { ...unknown('DKIM'), selector: null }
  return {
    status: selector ? 'fail' : 'warn',
    summary: selector
      ? `No DKIM key at ${selector}._domainkey.${domain}.`
      : 'No DKIM key found at any of the common selectors.',
    record: null,
    advice: selector
      ? 'Check the selector, or publish the DKIM record your mail provider gives you.'
      : 'Turn on DKIM signing with your mail provider (in Google Workspace: Apps › Gmail › Authenticate email), then enter the selector it gives you here — Google uses "google".',
    selector,
  }
}

export async function checkDmarc(domain: string): Promise<DnsCheck> {
  const records = await txt(`_dmarc.${domain}`)
  if (records === null) return unknown('DMARC')
  const record = records.find((entry) => /^v=DMARC1/i.test(entry))
  if (!record) {
    return {
      status: 'fail',
      summary: 'No DMARC record.',
      record: null,
      advice: `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
    }
  }
  const policy = /(^|;)\s*p=\s*(\w+)/i.exec(record)?.[2]?.toLowerCase()
  if (policy === 'none') {
    return {
      status: 'warn',
      summary: 'DMARC is published with p=none: it reports, but does not protect the domain yet.',
      record,
      advice:
        'This is the right place to start. Once the reports show your real mail passing, move to p=quarantine.',
    }
  }
  return {
    status: 'pass',
    summary: `DMARC is published with p=${policy ?? 'unknown'}.`,
    record,
    advice: null,
  }
}

export async function checkMx(domain: string): Promise<DnsCheck> {
  try {
    const records = await resolver.resolveMx(domain)
    if (records.length === 0) throw Object.assign(new Error('none'), { code: 'ENODATA' })
    const hosts = records.sort((a, b) => a.priority - b.priority).map((record) => record.exchange)
    return {
      status: 'pass',
      summary: `Mail for this domain goes to ${hosts[0]}.`,
      record: hosts.join(', '),
      advice: null,
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NXDOMAIN') {
      return {
        status: 'warn',
        summary: 'This domain has no MX record, so it cannot receive mail.',
        record: null,
        advice:
          'Replies and bounces to addresses at this domain will be lost. Add MX records, or send from a domain that has them.',
      }
    }
    return unknown('MX')
  }
}

/** Free mailbox providers: you cannot publish DNS for them, and they do it themselves. */
export const FREE_MAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'gmx.com',
  'mail.com',
])

export async function checkDomain(
  domain: string,
  dkimSelector: string | null,
  smtpHost: string | null,
) {
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(domain, smtpHost),
    checkDkim(domain, dkimSelector),
    checkDmarc(domain),
    checkMx(domain),
  ])
  const { selector, ...dkimCheck } = dkim
  return { spf, dkim: dkimCheck, dmarc, mx, selector }
}
