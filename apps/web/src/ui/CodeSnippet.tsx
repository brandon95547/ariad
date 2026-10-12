import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'

/* ===========================================================================
   CODE SNIPPET — UI Bible spec.

   Something to take away: a DNS record, an API key, a form's embed code. The
   copy button is the component, and the rest is a container for it —
   selecting a forty-character key by hand, on a phone least of all, is the
   worst thing a product like this asks of anyone.

   A well, on --ds-surface-inset: nobody types here, so it is set into the
   surface where a field stands on it. 13px monospace.

   One line is a 36px row that scrolls sideways and never wraps. More than one
   — or `wrap`, for a value too long to scroll, a DKIM key — is a block that
   stops growing at 24rem and scrolls.

   The copy is confirmed for 1.6 seconds — long enough to be seen when the eye
   comes back from where it pasted — with a tick and in words: the tick alone
   is a change of color and shape a screen reader never sees.
   ======================================================================== */

/** Where there is no clipboard to write to — a page served over plain http, as a self-hosted one may be. */
function copyThroughSelection(text: string) {
  const holder = document.createElement('textarea')
  holder.value = text
  holder.setAttribute('readonly', '')
  holder.style.position = 'fixed'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  let done = false
  try {
    done = document.execCommand('copy')
  } catch {
    done = false
  }
  holder.remove()
  return done
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused: fall through to the older way.
  }
  return copyThroughSelection(text)
}

export function CodeSnippet({
  code,
  label,
  wrap = false,
  maxHeight = 384,
  className,
}: {
  code: string
  /** What the code is — "DKIM record". Shown above it, and the copy button is named for it. */
  label?: string
  /** Break long lines in place of scrolling sideways. */
  wrap?: boolean
  /** In pixels. Past it the block scrolls. */
  maxHeight?: number
  className?: string
}) {
  const [state, setState] = React.useState<'idle' | 'copied' | 'failed'>('idle')
  const codeRef = React.useRef<HTMLElement>(null)
  const timer = React.useRef<number | undefined>(undefined)
  const block = wrap || code.includes('\n')

  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  const selectCode = () => {
    const node = codeRef.current
    const selection = window.getSelection()
    if (!node || !selection) return
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  const copy = async () => {
    const done = await copyText(code)
    // Could not be copied: it is selected, so the keyboard's own copy is one
    // press away.
    if (!done) selectCode()
    setState(done ? 'copied' : 'failed')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), done ? 1600 : 4000)
  }

  const copyLabel = label ? `Copy ${label}` : 'Copy'
  const copyButton = (
    <IconButton
      // Fixed in size whatever it sits in: it is a target, not a decoration.
      size="xs"
      label={copyLabel}
      icon={state === 'copied' ? <Check /> : <Copy />}
      onClick={copy}
      className={cn(
        'shrink-0',
        state === 'copied' && 'text-[var(--ds-success-text)] hover:text-[var(--ds-success-text)]',
      )}
    />
  )

  const codeProps = {
    // What scrolls has to be reachable from the keyboard to be scrolled.
    tabIndex: 0,
    role: 'group',
    'aria-label': label ?? 'Code',
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      // Select all, here, is all of the code and none of the page.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        selectCode()
      }
    },
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <span className="text-label text-[var(--ds-fg-secondary)]">{label}</span>}
      {block ? (
        <div className="relative rounded-[var(--radius-lg)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-inset)]">
          <pre
            {...codeProps}
            style={{ maxHeight }}
            className={cn(
              // As wide as what it is in, never as wide as its longest line.
              'contain-inline-size overflow-auto rounded-[inherit] p-3.5 pr-12 font-mono text-code leading-[1.55] text-[var(--ds-fg)]',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
              wrap ? 'break-words whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre',
            )}
          >
            <code ref={codeRef}>{code}</code>
          </pre>
          {/* Over the corner, with the well's own color behind it and out
              to the block's edges, so a long first line stops at the button
              in place of running through it. */}
          <span className="absolute top-0 right-0 flex rounded-tr-[calc(var(--radius-lg)-1px)] rounded-bl-[var(--radius-sm)] bg-[var(--ds-surface-inset)] pt-[7px] pr-[7px] pb-1 pl-1.5">
            {copyButton}
          </span>
        </div>
      ) : (
        <div className="flex h-9 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--ds-border-subtle)] bg-[var(--ds-surface-inset)] pr-1 pl-2.5">
          <code
            ref={codeRef}
            {...codeProps}
            className={cn(
              'contain-inline-size scrollbar-none min-w-0 flex-1 overflow-x-auto font-mono text-code whitespace-nowrap text-[var(--ds-fg)]',
              'rounded-[var(--radius-xs)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
            )}
          >
            {code}
          </code>
          {copyButton}
        </div>
      )}
      <span role="status" className="sr-only-ds">
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Could not copy. The text is selected: press Control or Command and C.'
            : ''}
      </span>
    </div>
  )
}
