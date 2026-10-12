import * as React from 'react'
import { AlertTriangle, Check, Eye, EyeOff, Minus, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { IconButton } from './Button'
import { controlShell, useFieldControl, type ControlSize } from './Controls'

/* ===========================================================================
   TEXT CONTROLS — UI Bible spec (Text Field, Textarea, Password Input,
   Search Input, Checkbox, Radio Button).

   Every one of them is a control, so every one sits on --ds-field: above the
   surface it is on, never a well cut into it. Heights are the button's — 32
   and 36 — so a row of mixed controls shares one line with nothing nudged.

   Inside a Field they pick up the label's id, the hint and the error by
   themselves. `invalid` is for the field that has no Field around it.
   ======================================================================== */

/**
 * Sixteen pixels where a finger types — under 16, a phone zooms the page in to
 * the field and does not zoom back — and the 13px of the rest of the chrome
 * from `md` up on a mouse.
 */
const controlText = 'text-body text-[var(--ds-fg)] md:text-body-sm coarse:text-body'

/** The error state of a control that takes the focus itself. */
const invalidSelf = [
  'border-[var(--ds-danger-border)] hover:border-[var(--ds-danger)]',
  'focus:border-[var(--ds-danger)] focus:shadow-[0_0_0_3px_var(--ds-danger-subtle)]',
].join(' ')

/** The same, for a shell whose input is inside it. */
const invalidWithin = [
  'border-[var(--ds-danger-border)] hover:border-[var(--ds-danger)]',
  'has-[input:focus]:border-[var(--ds-danger)] has-[input:focus]:shadow-[0_0_0_3px_var(--ds-danger-subtle)]',
].join(' ')

/** Read-only is a value to take away, not a control: dashed, flat, and still selectable. */
const readOnlyShell = 'border-dashed bg-transparent hover:bg-transparent'

const shellSize: Record<ControlSize, string> = {
  sm: 'h-8 gap-2 px-2.5',
  md: 'h-9 gap-2 px-3',
}

const adornmentSize: Record<ControlSize, number> = { sm: 14, md: 15 }

function joinIds(...ids: (string | undefined)[]) {
  return ids.filter(Boolean).join(' ') || undefined
}

function mergeRefs<T>(...refs: (React.Ref<T> | undefined)[]): React.RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref) (ref as React.RefObject<T | null>).current = node
    }
  }
}

function sizeIcon(node: React.ReactNode, size: number) {
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ size?: number }>
    if (element.props.size === undefined) return React.cloneElement(element, { size })
  }
  return node
}

export interface TextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize
  /** The error state. Inside a Field with an `error` it is set already. */
  invalid?: boolean
  /** A muted glyph before the value. Wayfinding, not content. */
  startIcon?: React.ReactNode
  /** After the value, inside the border: a unit, a domain, a button. */
  endAdornment?: React.ReactNode
}

/**
 * Text field — UI Bible spec.
 *
 * 36px, 12px of padding so the caret is not against the border, and a focus
 * that is a border change plus a 3px halo: the halo is what is seen at a
 * glance, the border what makes it precise.
 *
 * The border belongs to a shell and the input sits inside it, so an icon and
 * an adornment read as one control with the value. A press anywhere on the
 * shell goes to the input, which is also what gives it a 44px target under a
 * finger without changing its height.
 *
 * `className` sizes the shell — give a field the width of its answer.
 */
export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    className,
    size = 'md',
    invalid,
    startIcon,
    endAdornment,
    disabled,
    readOnly,
    id,
    type = 'text',
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const field = useFieldControl()
  const inner = React.useRef<HTMLInputElement | null>(null)
  const setRef = React.useMemo(() => mergeRefs(inner, ref), [ref])
  const isInvalid = invalid ?? field.invalid ?? false

  const toInput = (event: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) return
    const target = event.target as HTMLElement
    // The input places its own caret, and a button inside the field is its own
    // target. Everything else — the icon, the padding — is the field.
    if (target.closest('input, button, a, select, textarea')) return
    event.preventDefault()
    inner.current?.focus()
  }

  return (
    <div
      className={cn(
        controlShell(disabled),
        'touch-target flex cursor-text items-center rounded-[var(--radius-md)]',
        shellSize[size],
        controlText,
        'has-[input:focus]:border-[var(--ds-accent)] has-[input:focus]:shadow-[0_0_0_3px_var(--ds-accent-subtle)]',
        isInvalid && invalidWithin,
        readOnly && readOnlyShell,
        disabled && 'cursor-not-allowed',
        className,
      )}
      onMouseDown={toInput}
      onClick={toInput}
    >
      {startIcon ? (
        <span className="shrink-0 text-[var(--ds-fg-muted)]" style={{ lineHeight: 0 }} aria-hidden>
          {sizeIcon(startIcon, adornmentSize[size])}
        </span>
      ) : null}
      <input
        ref={setRef}
        id={id ?? field.id}
        type={type}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={isInvalid || undefined}
        aria-describedby={joinIds(describedBy, field.describedBy)}
        // Above the shell's touch overlay, so a tap in the text still places
        // the caret where it landed.
        className="control-input relative z-[1] h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--ds-fg-muted)] disabled:cursor-not-allowed"
        {...rest}
      />
      {endAdornment ? (
        <span className="relative z-[1] flex shrink-0 items-center text-[var(--ds-fg-muted)]">
          {endAdornment}
        </span>
      ) : null}
    </div>
  )
})

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  /** JetBrains Mono, for what is pasted in or copied out: HTML, headers, a key. */
  mono?: boolean
}

/**
 * Textarea — UI Bible spec.
 *
 * Four rows by default: the row count is a promise about the length of answer
 * expected, and two reads as "be brief" where ten reads as homework. It
 * resizes downward only — a field wider than its column breaks the form — and
 * the resize is never taken away: someone with low vision enlarges the box to
 * read their own text.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    className,
    invalid,
    mono,
    rows = 4,
    disabled,
    readOnly,
    id,
    'aria-describedby': describedBy,
    ...rest
  },
  ref,
) {
  const field = useFieldControl()
  const isInvalid = invalid ?? field.invalid ?? false
  return (
    <textarea
      ref={ref}
      id={id ?? field.id}
      rows={rows}
      disabled={disabled}
      readOnly={readOnly}
      aria-invalid={isInvalid || undefined}
      aria-describedby={joinIds(describedBy, field.describedBy)}
      className={cn(
        controlShell(disabled),
        // A little more above the first line than a one-line field has: it has
        // to sit off the top edge rather than be centered in it.
        'block min-h-14 resize-y rounded-[var(--radius-md)] px-3 py-2.5 placeholder:text-[var(--ds-fg-muted)]',
        mono
          ? 'font-mono text-body text-[var(--ds-fg)] md:text-code coarse:text-body'
          : controlText,
        isInvalid && invalidSelf,
        readOnly && readOnlyShell,
        className,
      )}
      {...rest}
    />
  )
})

/**
 * Password field — UI Bible spec.
 *
 * The browser's own mask and a reveal button inside the border. The button is
 * a toggle whose name says what a press will do, and a press leaves the caret
 * where it was: swapping the input's type moves it to the end otherwise.
 *
 * Paste is never blocked and `autoComplete` is always set — `current-password`
 * unless told `new-password` — because that is how a password manager fills
 * it. Caps Lock is said in words while the field has the focus: it is the one
 * warning where the person it is for cannot see what went wrong.
 */
export const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<TextInputProps, 'type' | 'endAdornment'>
>(function PasswordInput(
  {
    autoComplete = 'current-password',
    size = 'md',
    className,
    disabled,
    onKeyDown,
    onKeyUp,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const [shown, setShown] = React.useState(false)
  const [capsLock, setCapsLock] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const inner = React.useRef<HTMLInputElement | null>(null)
  const setRef = React.useMemo(() => mergeRefs(inner, ref), [ref])
  const caret = React.useRef<[number | null, number | null] | null>(null)

  const toggle = () => {
    const input = inner.current
    caret.current =
      input && document.activeElement === input
        ? [input.selectionStart, input.selectionEnd]
        : null
    setShown((current) => !current)
  }

  React.useLayoutEffect(() => {
    const input = inner.current
    const kept = caret.current
    caret.current = null
    if (!input || !kept) return
    try {
      input.setSelectionRange(kept[0], kept[1])
    } catch {
      // A browser that will not set a selection here keeps its own caret.
    }
  }, [shown])

  const readCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState?.('CapsLock') ?? false)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <TextInput
        ref={setRef}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        size={size}
        disabled={disabled}
        // The button is 28px and sits 6px in from the field's edge.
        className={cn(size === 'sm' ? 'pr-1' : 'pr-[5px]', className)}
        onKeyDown={(event) => {
          readCapsLock(event)
          onKeyDown?.(event)
        }}
        onKeyUp={(event) => {
          readCapsLock(event)
          onKeyUp?.(event)
        }}
        onFocus={(event) => {
          setFocused(true)
          onFocus?.(event)
        }}
        onBlur={(event) => {
          setFocused(false)
          onBlur?.(event)
        }}
        endAdornment={
          <IconButton
            label={shown ? 'Hide password' : 'Show password'}
            aria-pressed={shown}
            icon={shown ? <EyeOff /> : <Eye />}
            size="xs"
            disabled={disabled}
            className={cn(size === 'sm' && 'h-6 w-6')}
            // A press with the mouse leaves the focus, and the caret, in the field.
            onMouseDown={(event) => event.preventDefault()}
            onClick={toggle}
          />
        }
        {...rest}
      />
      {capsLock && focused && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-caption text-[var(--ds-warning-text)]"
        >
          <AlertTriangle size={13} aria-hidden className="shrink-0" />
          Caps Lock is on
        </p>
      )}
    </div>
  )
})

/**
 * Search field — UI Bible spec.
 *
 * The magnifier leads: at the end it reads as a submit button, and nothing
 * would be expected to happen until it was pressed. The clear button is there
 * only while there is something to clear, hands the focus back to the field,
 * and Escape does the same from the keyboard.
 *
 * The placeholder names what is searched — "Search contacts…" — and stands in
 * as the field's name where it has no label of its own.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  size = 'md',
  className,
  id,
  disabled,
  autoFocus,
  'aria-label': ariaLabel,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  size?: ControlSize
  className?: string
  id?: string
  disabled?: boolean
  autoFocus?: boolean
  'aria-label'?: string
}) {
  const field = useFieldControl()
  const ref = React.useRef<HTMLInputElement>(null)
  // A placeholder is never a name. Inside a Field the label is the name.
  const name = ariaLabel ?? (field.id ? undefined : placeholder.replace(/[….\s]+$/, ''))

  return (
    <TextInput
      ref={ref}
      id={id}
      type="search"
      enterKeyHint="search"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !value) return
        // Clearing the search and closing the panel it is in are two
        // intentions, and Escape means the nearer one first.
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
        onChange('')
      }}
      placeholder={placeholder}
      aria-label={name}
      size={size}
      disabled={disabled}
      autoFocus={autoFocus}
      startIcon={<Search />}
      className={cn(value && 'pr-2', className)}
      endAdornment={
        value ? (
          <button
            type="button"
            aria-label="Clear search"
            disabled={disabled}
            onClick={() => {
              onChange('')
              ref.current?.focus()
            }}
            className={cn(
              'touch-target touch-target--icon grid h-5 w-5 place-items-center rounded-full text-[var(--ds-fg-muted)]',
              'transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
              'hover:bg-[var(--ds-layer-active)] hover:text-[var(--ds-fg)]',
              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ds-focus-ring)]',
            )}
          >
            <X size={13} aria-hidden />
          </button>
        ) : undefined
      }
    />
  )
}

const tickBox = [
  'peer h-[18px] w-[18px] cursor-pointer appearance-none border border-[var(--ds-border-strong)] bg-[var(--ds-field)]',
  'transition-all duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
  'hover:border-[var(--ds-accent)] [&:not(:checked,:indeterminate,:disabled):hover]:bg-[var(--ds-accent-subtle)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
  'disabled:cursor-not-allowed',
].join(' ')

/**
 * Checkbox — UI Bible spec.
 *
 * An 18px box, the smallest a tick still reads as a tick in, and square: a
 * round one reads as a radio. The tick is the state — the fill alone would be
 * color alone.
 *
 * The whole row is the label, so the target is the row and not the box, and
 * 44px of it under a finger. The focus ring stays on the box, where it says
 * which of several stacked options has the focus.
 *
 * Without a label it is the bare box a table row selects with, and needs an
 * `aria-label` that says what it selects.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate = false,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: React.ReactNode
  description?: React.ReactNode
  /** Some, not all. Shown as a dash and announced as "mixed". */
  indeterminate?: boolean
  disabled?: boolean
  id?: string
  'aria-label'?: string
}) {
  const generated = React.useId()
  const inputId = id ?? generated
  const ref = React.useRef<HTMLInputElement>(null)
  const hasText = Boolean(label) || Boolean(description)

  // There is no attribute for it: indeterminate exists only as a property.
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <label
      className={cn(
        hasText
          ? 'control-row flex items-start gap-2.5'
          : 'touch-target touch-target--icon inline-flex',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      {/* 2px down, so the box sits on the first line's cap height rather than
          in the middle of its line box, where it reads as low. */}
      <span className={cn('relative inline-grid shrink-0 place-items-center', hasText && 'mt-0.5')}>
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-label={ariaLabel}
          // The name is the label alone. Wrapped, it would be the label and
          // the description run together.
          aria-labelledby={label && !ariaLabel ? `${inputId}-label` : undefined}
          aria-describedby={description ? `${inputId}-description` : undefined}
          className={cn(
            tickBox,
            'rounded-[var(--radius-xs)]',
            'checked:border-[var(--ds-accent)] checked:bg-[var(--ds-accent)]',
            'indeterminate:border-[var(--ds-accent)] indeterminate:bg-[var(--ds-accent)]',
          )}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 grid place-items-center text-[var(--ds-accent-fg)]',
            'scale-50 opacity-0 transition-all duration-[140ms] ease-[cubic-bezier(0.32,0.72,0,1)]',
            'peer-checked:scale-100 peer-checked:opacity-100',
            'peer-indeterminate:scale-100 peer-indeterminate:opacity-100',
          )}
        >
          {indeterminate ? (
            <Minus size={13} strokeWidth={3.2} />
          ) : (
            <Check size={13} strokeWidth={3.2} />
          )}
        </span>
      </span>
      {hasText && (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <span id={`${inputId}-label`} className="text-body-sm leading-snug text-[var(--ds-fg)]">
              {label}
            </span>
          )}
          {description && (
            <span id={`${inputId}-description`} className="text-caption text-[var(--ds-fg-muted)]">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  )
}

/**
 * Radio group — UI Bible spec.
 *
 * One of a short, known set — past about six, a Select. Stacked, so the
 * options are read in one movement down a single edge.
 *
 * Real radios sharing a name: that is what makes the group one Tab stop, the
 * arrows move and choose within it, and each option is read with its place in
 * the set. The legend names the group and is read before every option.
 *
 * Chosen is a 5px ring where unchosen is a 1px border, which survives a
 * screen without color.
 */
export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  name,
  disabled,
  className,
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: string; description?: string }[]
  label: string
  /** The form name the radios share. One is made up when the group is not submitted. */
  name?: string
  disabled?: boolean
  className?: string
}) {
  const generated = React.useId()
  return (
    <fieldset
      disabled={disabled}
      className={cn('m-0 min-w-0 border-0 p-0', disabled && 'opacity-50', className)}
    >
      <legend className="mb-1.5 p-0 text-label text-[var(--ds-fg-secondary)]">{label}</legend>
      <div className="flex flex-col gap-2.5">
        {options.map((option, index) => {
          const optionId = `${generated}-${index}`
          return (
            <label
              key={option.value}
              className={cn(
                'control-row flex items-start gap-2.5',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <span className="relative mt-0.5 inline-grid shrink-0 place-items-center">
                <input
                  type="radio"
                  name={name ?? generated}
                  value={option.value}
                  checked={option.value === value}
                  onChange={() => onChange(option.value)}
                  aria-labelledby={`${optionId}-label`}
                  aria-describedby={option.description ? `${optionId}-description` : undefined}
                  className={cn(
                    tickBox,
                    'rounded-full',
                    // The dot is what the ring leaves showing: no second
                    // element to keep centered, and no seam between the two.
                    'checked:border-[5px] checked:border-[var(--ds-accent)]',
                  )}
                />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  id={`${optionId}-label`}
                  className="text-body-sm leading-snug text-[var(--ds-fg)]"
                >
                  {option.label}
                </span>
                {option.description && (
                  <span
                    id={`${optionId}-description`}
                    className="text-caption text-[var(--ds-fg-muted)]"
                  >
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
