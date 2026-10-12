import type { Database } from 'better-sqlite3'
import { DEFAULT_THEME, renderDesign, type Block, type EmailDesign } from '@ariad/shared'

/**
 * The starter templates. Kept in code and written on boot, keyed by a fixed
 * id, so an upgrade can improve one without a migration and without touching
 * anything a person made — built-ins can be copied but never edited.
 */
interface Starter {
  id: string
  name: string
  description: string
  subject: string
  preheader: string
  blocks: Block[]
}

const b = <T extends Block>(block: T): T => block

const STARTERS: readonly Starter[] = [
  {
    id: 'tpl_builtin_newsletter',
    name: 'Newsletter',
    description: 'A headline, a few short sections and one button.',
    subject: 'What we have been working on',
    preheader: 'Three things worth two minutes of your time.',
    blocks: [
      b({ id: 'n1', type: 'heading', text: 'This month at {{organization}}', level: 1, align: 'left' }),
      b({ id: 'n2', type: 'text', align: 'left', html: '<p>Hi {{first_name|there}},</p><p>Here is what is new. Keep this opening to two or three sentences: say what the email is about and why it is worth reading.</p>' }),
      b({ id: 'n3', type: 'divider' }),
      b({ id: 'n4', type: 'heading', text: 'The first story', level: 2, align: 'left' }),
      b({ id: 'n5', type: 'text', align: 'left', html: '<p>A short paragraph about the first thing. One idea, plainly said.</p>' }),
      b({ id: 'n6', type: 'heading', text: 'The second story', level: 2, align: 'left' }),
      b({ id: 'n7', type: 'text', align: 'left', html: '<p>A short paragraph about the second thing.</p>' }),
      b({ id: 'n8', type: 'button', label: 'Read more', href: 'https://', align: 'left', fullWidth: false }),
    ],
  },
  {
    id: 'tpl_builtin_announcement',
    name: 'Announcement',
    description: 'One piece of news and one thing to do about it.',
    subject: 'Something new from {{organization}}',
    preheader: 'Here is what changed and what it means for you.',
    blocks: [
      b({ id: 'a1', type: 'heading', text: 'Say the news in one line', level: 1, align: 'center' }),
      b({ id: 'a2', type: 'text', align: 'center', html: '<p>Two or three sentences on what it is, who it is for and why it matters.</p>' }),
      b({ id: 'a3', type: 'button', label: 'See what is new', href: 'https://', align: 'center', fullWidth: false }),
    ],
  },
  {
    id: 'tpl_builtin_welcome',
    name: 'Welcome',
    description: 'For new subscribers: what to expect, and a first step.',
    subject: 'Welcome to {{organization}}',
    preheader: 'Thanks for signing up. Here is what happens next.',
    blocks: [
      b({ id: 'w1', type: 'heading', text: 'Welcome, {{first_name|friend}}', level: 1, align: 'left' }),
      b({ id: 'w2', type: 'text', align: 'left', html: '<p>Thanks for subscribing. You will hear from us about once a month, and only when we have something worth saying.</p><p>In the meantime:</p><ul><li>One useful thing to read or do</li><li>A second one</li><li>How to reach a person if you need one</li></ul>' }),
      b({ id: 'w3', type: 'button', label: 'Get started', href: 'https://', align: 'left', fullWidth: false }),
    ],
  },
  {
    id: 'tpl_builtin_letter',
    name: 'Plain letter',
    description: 'Just words, like an email from a person.',
    subject: 'A quick note',
    preheader: '',
    blocks: [
      b({ id: 'l1', type: 'text', align: 'left', html: '<p>Hi {{first_name|there}},</p><p>Write this the way you would write to one person. Short paragraphs, one subject, one thing you would like them to do.</p><p>Thanks,<br>{{organization}}</p>' }),
    ],
  },
]

export function seedTemplates(db: Database, log?: (message: string) => void): void {
  const upsert = db.prepare(/* sql */ `
    INSERT INTO templates (id, name, description, subject, preheader, html, design, builtin, created_at, updated_at)
    VALUES (@id, @name, @description, @subject, @preheader, @html, @design, 1, @now, @now)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, description = excluded.description, subject = excluded.subject,
      preheader = excluded.preheader, html = excluded.html, design = excluded.design
  `)
  const now = new Date().toISOString()
  db.transaction(() => {
    for (const starter of STARTERS) {
      const design: EmailDesign = { version: 1, theme: { ...DEFAULT_THEME }, blocks: starter.blocks }
      upsert.run({
        id: starter.id,
        name: starter.name,
        description: starter.description,
        subject: starter.subject,
        preheader: starter.preheader || null,
        html: renderDesign(design, { preheader: starter.preheader, title: starter.subject }),
        design: JSON.stringify(design),
        now,
      })
    }
  })()
  log?.(`starter templates ready (${STARTERS.length})`)
}
