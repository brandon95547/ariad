import * as React from 'react'
import { AlertCircle, Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDismissable } from '@/lib/hooks'

/* ===========================================================================
   FORM CONTROLS — UI Bible spec.

   The field sits on --ds-field, which is ABOVE every surface in the ramp, the
   overlay included. Material 3's rule and the Bible's: a control you can act
   on is a surface standing on the page, not a hole cut into it. Using the
   inset token here lands a field below the card it sits in, which reads as a
   recess and — on a near-black canvas — as a control that has been switched
   off.
   ======================================================================== */

export type ControlSize = 'sm' | 'md'

const controlSizes: Record<ControlSize, string> = {
  sm: 'h-8 text-body-sm rounded-[var(--radius-md)]',
  md: 'h-9 text-body rounded-[var(--radius-md)]',
}

export function controlShell(disabled?: boolean) {
  return cn(
    'w-full bg-[var(--ds-field)] border border-[var(--ds-border-interactive)]',
    'transition-[border-color,box-shadow,background-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
    // The hover lift is the other half of "this is a control": it answers the
    // pointer. Suppressed when disabled, which is not a control.
    !disabled && 'hover:bg-[var(--ds-field-hover)] hover:border-[var(--ds-border-strong)]',
    // Focus is a border colour change plus a 3px halo. The halo is what makes
    // it visible at a glance; the border change is what makes it precise.
    'focus:outline-none focus-visible:outline-none',
    'focus:border-[var(--ds-accent)] focus:shadow-[0_0_0_3px_var(--ds-accent-subtle)]',
    disabled && 'cursor-not-allowed opacity-50',
  )
}

/** What a Field hands the control inside it, so the two are wired without the page doing it. */
export interface FieldControl {
  /** The id the label points at. */
  id?: string
  /** The hint and the error, in the order they are read. */
  describedBy?: string
  invalid?: boolean
}

const FieldContext = React.createContext<FieldControl>({})

/**
 * Read by the text controls (TextInput, Textarea, PasswordInput, MultiSelect).
 * An explicit `id`, `aria-describedby` or `invalid` on the control still wins.
 * Outside a Field it returns nothing, and the control stands on its own props.
 */
export function useFieldControl(): FieldControl {
  return React.useContext(FieldContext)
}

/**
 * Field — UI Bible spec (Text Field, Form).
 *
 * The label sits 6px above the control: close enough to be owned by it. Under
 * the control, the hint and then the error. The error is added below the hint
 * and never takes its place — the instructions are needed most at the moment
 * the answer was wrong.
 *
 * The hint is `{id}-hint` and the error `{id}-error`, where id is `htmlFor`.
 * The text controls pick both up by themselves; a Select or a Combobox takes
 * them as `aria-describedby`.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  htmlFor,
  children,
  className,
}: {
  label: string
  hint?: React.ReactNode
  /** What is wrong and what to do about it. Announced when it appears. */
  error?: string
  /** Marks the field "Optional". Most fields are required, so the few that are not say so. */
  optional?: boolean
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  const generated = React.useId()
  const id = htmlFor ?? generated
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')
  const control = React.useMemo<FieldControl>(
    () => ({ id, describedBy: describedBy || undefined, invalid: Boolean(error) }),
    [id, describedBy, error],
  )

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-label text-[var(--ds-fg-secondary)]">
        {label}
        {optional && (
          <span className="ml-1.5 text-caption font-normal text-[var(--ds-fg-muted)]">
            Optional
          </span>
        )}
      </label>
      <FieldContext.Provider value={control}>{children}</FieldContext.Provider>
      {(hint || error) && (
        <div className="flex flex-col gap-1">
          {hint && (
            <p id={hintId} className="text-caption text-[var(--ds-fg-muted)]">
              {hint}
            </p>
          )}
          {error && (
            // Never color alone: the border changes, an icon appears, and the
            // message is text.
            <p
              id={errorId}
              role="alert"
              className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
            >
              <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

/**
 * Native select. Under about fifteen known options with no search need, the
 * native control wins outright: free keyboard support, a free mobile wheel
 * picker, and zero bundle cost. A custom listbox has to re-implement all of it
 * and usually gets type-ahead wrong.
 */
export function Select({
  options,
  size = 'md',
  className,
  ...rest
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  options: readonly SelectOption[]
  size?: ControlSize
}) {
  return (
    <div className="relative">
      <select
        className={cn(
          controlShell(rest.disabled),
          controlSizes[size],
          // 36px of right padding, not 12: the chevron needs 16px plus its own
          // gutter, or a long option label collides with it.
          'cursor-pointer appearance-none pl-3 pr-9 text-[var(--ds-fg)]',
          className,
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ds-fg-muted)]"
      />
    </div>
  )
}

export interface ComboboxOption {
  value: string
  label: string
  /** The heading it is listed under. Options of one heading are given together. */
  group?: string
  /** What else it is called: looked through by a search, and said when it is what matched. */
  also?: readonly string[]
}

/** Lower case and without accents, so "thaat" finds "Thãt" and "hirajoshi" finds "Hirajōshi". */
const foldText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * Combobox — UI Bible spec.
 *
 * A field that is typed in to choose from a list too long to scan. Past about
 * fifteen options a select stops being faster than typing: "hira" finds
 * Hirajoshi among a hundred and twenty scales, where a select would have to be
 * scrolled to it. It is still a choice of one, not free text. What is typed
 * narrows the list, and leaving without choosing puts the field back.
 *
 * Untouched, the list is everything under its headings, opened at the current
 * choice — so it still works as the select it replaces, for someone who would
 * rather look than type. A search looks through each option's other names
 * too, and says which one it found.
 *
 * Focus never leaves the field. The arrows move a highlight through the list
 * (`aria-activedescendant`), so typing and arrowing can be mixed.
 *
 * The list sits under the field, inside whatever holds it, rather than
 * floating over the page: the options panel scrolls, and a list that scrolls
 * with its field cannot come loose from it.
 */
export function Combobox({
  id,
  options,
  value,
  onChange,
  size = 'md',
  emptyText = 'No matches',
  'aria-label': ariaLabel,
}: {
  id?: string
  options: readonly ComboboxOption[]
  value: string
  onChange: (value: string) => void
  size?: ControlSize
  emptyText?: string
  'aria-label'?: string
}) {
  const selected = options.find((option) => option.value === value)
  const [open, setOpen] = React.useState(false)
  /** What has been typed since the list opened. Null while the field still shows the choice. */
  const [query, setQuery] = React.useState<string | null>(null)
  const [active, setActive] = React.useState(0)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()

  const close = React.useCallback(() => {
    setOpen(false)
    setQuery(null)
  }, [])
  useDismissable(open, close, [wrapRef])

  const sought = foldText((query ?? '').trim())
  const results = React.useMemo(() => {
    if (!sought)
      return options.map((option) => ({ option, found: undefined as string | undefined }))
    // A name that begins with what was typed, then one that has it anywhere,
    // then one found by another of its names.
    const begins: { option: ComboboxOption; found: string | undefined }[] = []
    const within: typeof begins = []
    const byOther: typeof begins = []
    for (const option of options) {
      const label = foldText(option.label)
      if (label.startsWith(sought)) begins.push({ option, found: undefined })
      else if (label.includes(sought)) within.push({ option, found: undefined })
      else {
        const found = option.also?.find((name) => foldText(name).includes(sought))
        if (found) byOther.push({ option, found })
      }
    }
    return [...begins, ...within, ...byOther]
  }, [options, sought])

  const openList = () => {
    setOpen(true)
    setActive(
      Math.max(
        0,
        options.findIndex((option) => option.value === value),
      ),
    )
  }
  const choose = (option: ComboboxOption | undefined) => {
    if (!option) return
    onChange(option.value)
    close()
  }

  // The highlighted option stays in sight, including the current choice when
  // the list first opens: a list of a hundred opened at its top hides where
  // you are.
  React.useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active, sought])

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        value={query ?? selected?.label ?? ''}
        onFocus={(event) => {
          // Everything selected, so the first key typed replaces the name
          // rather than adding to it.
          event.target.select()
          if (!open) openList()
        }}
        onClick={() => {
          if (!open) openList()
        }}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
          setActive(0)
        }}
        onBlur={(event) => {
          if (!wrapRef.current?.contains(event.relatedTarget)) close()
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            if (!open) openList()
            else setActive((index) => Math.min(results.length - 1, index + 1))
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            if (open) setActive((index) => Math.max(0, index - 1))
          } else if (event.key === 'Enter' && open) {
            event.preventDefault()
            choose(results[active]?.option)
          } else if (event.key === 'Escape' && open) {
            // The list's Escape, not the panel's: it shuts the list and leaves
            // the panel it is in open.
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation()
            close()
          }
        }}
        className={cn(
          controlShell(),
          controlSizes[size],
          // Sixteen pixels where a finger types: smaller, and a phone zooms the
          // page in to the field.
          'pr-9 pl-3 text-body text-[var(--ds-fg)] md:text-body-sm',
        )}
      />
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[var(--ds-fg-muted)]"
      />

      {open && (
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          className="absolute top-[calc(100%+6px)] right-0 left-0 z-10 max-h-64 overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] p-1 shadow-e4"
        >
          {results.length === 0 && (
            <p className="px-3 py-6 text-center text-caption text-[var(--ds-fg-muted)]">
              {emptyText}
            </p>
          )}
          {results.map(({ option, found }, index) => {
            // Headings only while nothing is being searched for: a search
            // gathers its finds from every heading into one short list.
            const heading =
              !sought && option.group && option.group !== results[index - 1]?.option.group
                ? option.group
                : null
            const chosen = option.value === value
            return (
              <React.Fragment key={option.value}>
                {heading && (
                  <div
                    role="presentation"
                    className="px-2.5 pt-2.5 pb-1 text-overline text-[var(--ds-fg-muted)] uppercase first:pt-1.5"
                  >
                    {heading}
                  </div>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={chosen}
                  data-active={index === active}
                  // The field keeps the focus; a press on an option must not take it.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 coarse:min-h-11',
                    index === active && 'bg-[var(--ds-layer-hover)]',
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        'truncate text-label',
                        chosen ? 'text-[var(--ds-fg)]' : 'text-[var(--ds-fg-secondary)]',
                      )}
                    >
                      {option.label}
                    </span>
                    {(found || (sought && option.group)) && (
                      <span className="truncate text-caption text-[var(--ds-fg-muted)]">
                        {found ? `Also called ${found}` : option.group}
                      </span>
                    )}
                  </span>
                  {chosen && (
                    <Check
                      size={14}
                      aria-hidden
                      className="shrink-0 text-[var(--ds-accent-text)]"
                    />
                  )}
                </div>
              </React.Fragment>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** A row of mutually exclusive options. Use under about five choices. */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string }[]
  label: string
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex w-full items-center gap-0.5 rounded-[var(--radius-md)] border border-[var(--ds-border-interactive)] bg-[var(--ds-field)] p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 flex-1 rounded-[var(--radius-sm)] px-2 text-label-sm transition-colors duration-[120ms]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ds-focus-ring)]',
              selected
                ? 'bg-[var(--ds-accent)] text-[var(--ds-accent-fg)]'
                : 'text-[var(--ds-fg-secondary)] hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)]',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * A filter chip: a pill that is on or off — UI Bible spec.
 *
 * 28px, between a badge and a button: something to press, but not what the
 * view is for. `aria-pressed` rather than `aria-selected`: each is a button
 * that is on or off, whether the row lets several be on or only one, and not
 * an option in a listbox. On, it changes fill, border and text together, so
 * the state survives a row of a dozen and a screen without color.
 *
 * Off, it is an outline with nothing in it, where the Bible fills it with the
 * page's surface. A chip here lands in a dialog, and the page's surface inside
 * a dialog is a hole cut in it; an outline takes on whatever it stands on.
 */
export function FilterChip({
  selected,
  count,
  className,
  children,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'> & {
  selected: boolean
  /** How many things it stands for, said after the label. */
  count?: number
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'touch-target inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-label whitespace-nowrap',
        'transition-[background-color,border-color,color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
        'disabled:pointer-events-none disabled:opacity-45',
        selected
          ? 'border-[var(--ds-accent-border)] bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)] hover:bg-[var(--ds-accent-subtle-hover)]'
          : 'border-[var(--ds-border-interactive)] text-[var(--ds-fg-secondary)] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)]',
        className,
      )}
      {...rest}
    >
      {children}
      {count !== undefined && (
        <span className={cn('text-caption', !selected && 'text-[var(--ds-fg-muted)]')} data-tabular>
          {count}
        </span>
      )}
    </button>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  id,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  id?: string
}) {
  const generated = React.useId()
  const inputId = id ?? generated
  return (
    // `control-row` gives the row a 44px minimum under a finger. On the row
    // rather than on the switch: growing an 18px control to 44px would wreck
    // the panel's rhythm, and the label is part of the target anyway.
    <div className="control-row flex items-start justify-between gap-4">
      <label htmlFor={inputId} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-ui text-[var(--ds-fg)]">{label}</span>
        {description && (
          <span className="text-caption text-[var(--ds-fg-muted)]">{description}</span>
        )}
      </label>
      <button
        id={inputId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-[160ms] ease-[cubic-bezier(0.2,0,0,1)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
          checked
            ? 'bg-[var(--ds-accent)]'
            : 'bg-[var(--ds-field)] border border-[var(--ds-border-strong)]',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full shadow-e1',
            'transition-[left] duration-[160ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
            // On, the knob is whatever the accent carries its labels in: white
            // on every fill but a pale one, where white would be lost.
            checked ? 'left-[21px] bg-[var(--ds-accent-fg)]' : 'left-[3px] bg-white',
          )}
        />
      </button>
    </div>
  )
}
