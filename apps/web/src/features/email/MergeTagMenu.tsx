import * as React from 'react'
import { Braces } from 'lucide-react'
import { MERGE_TAGS } from '@ariad/shared'
import { useFields } from '@/lib/queries'
import { Button, type ButtonProps } from '@/ui/Button'
import { Popover } from '@/ui/Menu'

/** Tags that read badly when the contact has no value get a fallback written in. */
const FALLBACKS: Record<string, string> = { first_name: 'there', full_name: 'there' }

export const mergeToken = (tag: string) => `{{${tag}${FALLBACKS[tag] ? `|${FALLBACKS[tag]}` : ''}}}`

/**
 * "Personalize": the merge tags, as a menu.
 *
 * It hands the chosen tag to whoever opened it rather than inserting it, since
 * only the caller knows where the caret was — in a subject field, or in a
 * paragraph on the canvas.
 */
export function MergeTagMenu({
  onPick,
  onOpen,
  size = 'sm',
  variant = 'outlined',
  iconOnly,
}: {
  onPick: (token: string) => void
  /** Called before the menu takes the focus: the moment to remember a selection. */
  onOpen?: () => void
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  iconOnly?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const fields = useFields()

  const groups = React.useMemo(() => {
    const all = [
      ...MERGE_TAGS.map((tag) => ({ tag: tag.tag, label: tag.label, group: tag.group as string })),
      ...(fields.data ?? []).map((field) => ({
        tag: `custom.${field.key}`,
        label: field.label,
        group: 'Custom fields',
      })),
    ]
    const byGroup = new Map<string, typeof all>()
    for (const entry of all) byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry])
    return [...byGroup]
  }, [fields.data])

  return (
    <>
      <Button
        ref={trigger}
        size={size}
        variant={variant}
        iconOnly={iconOnly}
        aria-label={iconOnly ? 'Personalize' : undefined}
        title={iconOnly ? 'Personalize' : undefined}
        startIcon={iconOnly ? undefined : <Braces />}
        aria-haspopup="menu"
        aria-expanded={open}
        // Keeps the caret where it is while the button is pressed.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!open) onOpen?.()
          setOpen((current) => !current)
        }}
      >
        {iconOnly ? <Braces size={14} /> : 'Personalize'}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={trigger}
        label="Personalize"
        role="menu"
        className="popover--menu"
      >
        {groups.map(([group, tags]) => (
          <div key={group} role="group" aria-label={group}>
            <div
              role="presentation"
              className="px-2 pt-2 pb-1 text-overline text-[var(--ds-fg-muted)] uppercase"
            >
              {group}
            </div>
            {tags.map((tag) => (
              <button
                key={tag.tag}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false)
                  onPick(mergeToken(tag.tag))
                }}
              >
                <span className="menu-item__text">{tag.label}</span>
                <span className="ml-auto font-mono text-caption text-[var(--ds-fg-muted)]">
                  {tag.tag}
                </span>
              </button>
            ))}
          </div>
        ))}
      </Popover>
    </>
  )
}

/** Puts text where the caret is in an input, and leaves the caret after it. */
export function insertAtCursor(
  input: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  text: string,
): string {
  if (!input) return value + text
  const start = input.selectionStart ?? value.length
  const end = input.selectionEnd ?? value.length
  const next = value.slice(0, start) + text + value.slice(end)
  requestAnimationFrame(() => {
    input.focus()
    input.setSelectionRange(start + text.length, start + text.length)
  })
  return next
}
