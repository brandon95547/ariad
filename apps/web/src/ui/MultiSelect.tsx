import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDismissable } from '@/lib/hooks'
import { controlShell, useFieldControl } from './Controls'

/* ===========================================================================
   MULTI-SELECT — UI Bible spec.

   Several of a known set: the lists a campaign goes to, the tags on a
   contact. What is chosen sits in the field as tokens, so the state is read
   without opening anything, and the field types to narrow the list.

   The list stays open while choosing. That is the whole difference from a
   select: closing after every pick makes four choices cost four openings.

   Focus never leaves the field. The arrows move a highlight through the list
   (`aria-activedescendant`), Enter — and Space, while nothing is typed —
   toggles it, Backspace in an empty field takes the last token away, as it
   does in any "To" line, and Escape closes the list and nothing else. Tab
   leaves in one press: the tokens are not stops on the way.

   The field is a text field's height when empty, so a form row stays level,
   and grows to three lines of tokens before it scrolls: an unbounded one
   pushes the rest of the form down the page with every pick.
   ======================================================================== */

export interface MultiSelectOption {
  value: string
  label: string
  /** Said after the label, quietly: a count, a kind. */
  hint?: string
}

/** Lower case and without accents, so "zoe" finds "Zoë". */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Select…',
  emptyText = 'No matches',
  id,
  disabled,
  invalid,
  'aria-label': ariaLabel,
}: {
  options: readonly MultiSelectOption[]
  /** The chosen values, in the order they were chosen. */
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  /** Said in the list when what was typed matches nothing. */
  emptyText?: string
  id?: string
  disabled?: boolean
  invalid?: boolean
  'aria-label'?: string
}) {
  const field = useFieldControl()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [active, setActive] = React.useState(0)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const baseId = React.useId()
  const listId = `${baseId}-list`
  const valueId = `${baseId}-value`
  const isInvalid = invalid ?? field.invalid ?? false

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])
  useDismissable(open, close, [wrapRef])

  const chosen = value
    .map((one) => options.find((option) => option.value === one))
    .filter((option): option is MultiSelectOption => option !== undefined)

  const sought = fold(query.trim())
  const results = React.useMemo(
    () => (sought ? options.filter((option) => fold(option.label).includes(sought)) : options),
    [options, sought],
  )

  const toggle = (optionValue: string) => {
    onChange(
      value.includes(optionValue)
        ? value.filter((one) => one !== optionValue)
        : [...value, optionValue],
    )
  }

  const openList = () => {
    if (disabled) return
    setOpen(true)
    setActive(0)
  }

  // The highlighted option stays in sight.
  React.useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, sought])

  // And so does the end of the field, where the next thing typed goes.
  React.useEffect(() => {
    const shell = shellRef.current
    if (shell) shell.scrollTop = shell.scrollHeight
  }, [value.length])

  return (
    <div ref={wrapRef} className="relative">
      <div
        ref={shellRef}
        className={cn(
          controlShell(disabled),
          'flex max-h-24 min-h-9 cursor-text flex-wrap items-center gap-1.5 overflow-y-auto rounded-[var(--radius-md)] py-[5px] pr-9 pl-1.5',
          // 44px under a finger: the field itself grows, because what scrolls
          // cannot carry a target that overhangs it.
          'coarse:min-h-11',
          'text-body text-[var(--ds-fg)] md:text-body-sm coarse:text-body',
          'has-[input:focus]:border-[var(--ds-accent)] has-[input:focus]:shadow-[0_0_0_3px_var(--ds-accent-subtle)]',
          isInvalid &&
            'border-[var(--ds-danger-border)] hover:border-[var(--ds-danger)] has-[input:focus]:border-[var(--ds-danger)] has-[input:focus]:shadow-[0_0_0_3px_var(--ds-danger-subtle)]',
          disabled && 'cursor-not-allowed',
        )}
        onMouseDown={(event) => {
          if (disabled) return
          const target = event.target as HTMLElement
          if (target.closest('button')) return
          if (target !== inputRef.current) {
            // The padding and the tokens are the field too.
            event.preventDefault()
            inputRef.current?.focus()
          }
          if (!open) openList()
        }}
      >
        {chosen.map((option) => (
          <span
            key={option.value}
            className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-full border border-[var(--ds-accent-border)] bg-[var(--ds-accent-subtle)] pr-[3px] pl-2 text-caption font-medium text-[var(--ds-accent-text)]"
          >
            <span className="truncate">{option.label}</span>
            <button
              type="button"
              // Not a stop: nine tokens would be nine presses of Tab. From the
              // keyboard a token goes with Backspace, or by its row in the list.
              tabIndex={-1}
              disabled={disabled}
              aria-label={`Remove ${option.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggle(option.value)}
              className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full transition-colors duration-[120ms] hover:bg-[var(--ds-layer-active)] hover:text-[var(--ds-fg)] coarse:h-6 coarse:w-6"
            >
              <X size={11} strokeWidth={2.5} aria-hidden />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id ?? field.id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
          aria-label={ariaLabel}
          aria-invalid={isInvalid || undefined}
          // What is already chosen is said on arriving, before anything is typed.
          aria-describedby={[valueId, field.describedBy].filter(Boolean).join(' ')}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={query}
          placeholder={chosen.length === 0 ? placeholder : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(0)
          }}
          onBlur={(event) => {
            if (!wrapRef.current?.contains(event.relatedTarget)) close()
          }}
          onKeyDown={(event) => {
            const current = results[active]
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (!open) openList()
              else setActive((index) => Math.min(results.length - 1, index + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (open) setActive((index) => Math.max(0, index - 1))
            } else if (event.key === 'Enter' && open) {
              // The list's Enter, not the form's.
              event.preventDefault()
              if (current) toggle(current.value)
            } else if (event.key === ' ' && open && query === '' && current) {
              // A space in the middle of something typed is still a space.
              event.preventDefault()
              toggle(current.value)
            } else if (event.key === 'Backspace' && query === '' && chosen.length > 0) {
              const last = chosen[chosen.length - 1]
              if (last) toggle(last.value)
            } else if (event.key === 'Escape' && open) {
              // The list's Escape, not the dialog's: it shuts the list and
              // leaves whatever the field is in open.
              event.stopPropagation()
              event.nativeEvent.stopImmediatePropagation()
              close()
            }
          }}
          className="control-input h-6 min-w-16 flex-1 bg-transparent px-1.5 outline-none placeholder:text-[var(--ds-fg-muted)] disabled:cursor-not-allowed"
        />
      </div>
      <ChevronDown
        size={15}
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-2.5 right-3 text-[var(--ds-fg-muted)] transition-transform duration-[160ms] coarse:top-3.5',
          open && 'rotate-180',
          disabled && 'opacity-50',
        )}
      />

      <span id={valueId} className="sr-only-ds">
        {chosen.length > 0
          ? `Selected: ${chosen.map((option) => option.label).join(', ')}`
          : 'Nothing selected'}
      </span>
      {/* The only word a screen reader gets that a toggle landed. */}
      <p className="sr-only-ds" aria-live="polite">
        {chosen.length} of {options.length} selected
      </p>

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          aria-label={ariaLabel ?? 'Options'}
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-10 max-h-64 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] p-1 shadow-e4"
        >
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-caption text-[var(--ds-fg-muted)]">
              {emptyText}
            </p>
          )}
          {results.map((option, index) => {
            const on = value.includes(option.value)
            return (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={on}
                data-active={index === active}
                // The field keeps the focus; a press on an option must not take it.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => toggle(option.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 coarse:min-h-11',
                  index === active && 'bg-[var(--ds-layer-hover)]',
                )}
              >
                {/* The same width on every row, ticked or not, so the labels
                    keep one edge and nothing shifts as rows are toggled. */}
                <span
                  aria-hidden
                  className={cn(
                    'grid h-4 w-4 shrink-0 place-items-center rounded-[var(--radius-xs)] border transition-colors duration-[120ms]',
                    on
                      ? 'border-[var(--ds-accent)] bg-[var(--ds-accent)] text-[var(--ds-accent-fg)]'
                      : 'border-[var(--ds-border-strong)] bg-[var(--ds-field)]',
                  )}
                >
                  {on && <Check size={11} strokeWidth={3.2} />}
                </span>
                {/* The label changes with the tick, so the state is not the
                    tick alone. */}
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-label',
                    on ? 'text-[var(--ds-fg)]' : 'text-[var(--ds-fg-secondary)]',
                  )}
                >
                  {option.label}
                </span>
                {option.hint && (
                  <span data-tabular className="shrink-0 text-caption text-[var(--ds-fg-muted)]">
                    {option.hint}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
