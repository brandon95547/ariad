import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   BUTTON — UI Bible spec.

   Sizes are the Bible's: xs 28 (chips, dense toolbars) · sm 32 (card footers,
   panel headers) · md 36 (the default: forms, dialogs, page headers) ·
   lg 44 (mobile primary actions; one per screen at most).

   And its rule about weight: ONE filled button per view. `--filled` answers
   "what did you bring me here to do?", and two answers is the same as none.
   In Ariad that is the page's own verb: Add account, New campaign, Save.
   ======================================================================== */

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger' | 'danger-outline'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const base = [
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
  'font-medium align-middle',
  'transition-[background-color,border-color,color,box-shadow,transform,opacity]',
  'duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
  'active:scale-[0.985]',
  'disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
  // A real 44x44 pointer target on coarse pointers without inflating the box.
  // The mechanism lives in ariad.css, where its three failure modes are
  // written down next to it.
  'touch-target',
].join(' ')

const variants: Record<ButtonVariant, string> = {
  filled: [
    'bg-[var(--ds-accent)] text-[var(--ds-accent-fg)] shadow-e1',
    'hover:bg-[var(--ds-accent-hover)] hover:shadow-e2',
    'active:bg-[var(--ds-accent-active)] active:shadow-e0',
  ].join(' '),
  tonal: [
    'bg-[var(--ds-accent-subtle)] text-[var(--ds-accent-text)]',
    'hover:bg-[var(--ds-accent-subtle-hover)]',
  ].join(' '),
  outlined: [
    'border border-[var(--ds-border-interactive)] bg-transparent text-[var(--ds-fg)]',
    'hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-layer-hover)]',
    'active:bg-[var(--ds-layer-active)]',
  ].join(' '),
  text: [
    'bg-transparent text-[var(--ds-fg-secondary)]',
    'hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)]',
    'active:bg-[var(--ds-layer-active)]',
  ].join(' '),
  // Red means irreversible. It confirms a destructive action inside its
  // dialog; the button that opens that dialog is `danger-outline`.
  danger: [
    'bg-[var(--ds-danger)] text-[var(--ds-danger-fg)] shadow-e1',
    'hover:bg-[var(--ds-danger-hover)]',
    'active:bg-[var(--ds-danger-active)] active:shadow-e0',
  ].join(' '),
  'danger-outline': [
    'border border-[var(--ds-danger-border)] bg-transparent text-[var(--ds-danger-text)]',
    'hover:bg-[var(--ds-danger-subtle)]',
  ].join(' '),
}

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 rounded-[var(--radius-sm)] px-2.5 text-label-sm gap-1.5',
  sm: 'h-8 rounded-[var(--radius-md)] px-3 text-label gap-1.5',
  md: 'h-9 rounded-[var(--radius-md)] px-3.5 text-label',
  lg: 'h-11 rounded-[var(--radius-lg)] px-5 text-body-lg font-medium',
}

/** Icons scale sub-linearly with the button — a 1.5x button gets a 1.2x icon. */
export const buttonIconSize: Record<ButtonSize, number> = { xs: 13, sm: 14, md: 16, lg: 18 }

/** Icon-only buttons are square: the horizontal padding becomes the vertical. */
const iconOnly: Record<ButtonSize, string> = {
  xs: 'w-7 px-0 touch-target--icon',
  sm: 'w-8 px-0 touch-target--icon',
  md: 'w-9 px-0 touch-target--icon',
  lg: 'w-11 px-0 touch-target--icon',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  startIcon?: React.ReactNode
  endIcon?: React.ReactNode
  fullWidth?: boolean
  /** Renders square. Requires `aria-label`. */
  iconOnly?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'filled',
    size = 'md',
    loading = false,
    startIcon,
    endIcon,
    fullWidth,
    iconOnly: isIconOnly,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const px = buttonIconSize[size]
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        isIconOnly && iconOnly[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {/* Content is hidden rather than removed so the button never changes
          width when it enters the loading state. A button that resizes under
          the cursor is a button you mis-click. */}
      <span
        className={cn(
          'inline-flex items-center justify-center gap-[inherit]',
          loading && 'invisible',
        )}
      >
        {startIcon ? (
          <span className="shrink-0" style={{ lineHeight: 0 }} aria-hidden>
            {sizeIcon(startIcon, px)}
          </span>
        ) : null}
        {children}
        {endIcon ? (
          <span className="shrink-0" style={{ lineHeight: 0 }} aria-hidden>
            {sizeIcon(endIcon, px)}
          </span>
        ) : null}
      </span>

      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Loader2 size={px + 2} className="animate-[spin_720ms_linear_infinite]" aria-hidden />
          <span className="sr-only-ds">Loading</span>
        </span>
      )}
    </button>
  )
})

function sizeIcon(node: React.ReactNode, size: number) {
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ size?: number }>
    if (el.props.size === undefined) return React.cloneElement(el, { size })
  }
  return node
}

export interface IconButtonProps extends Omit<ButtonProps, 'iconOnly' | 'children'> {
  /** Required. An icon with no name is invisible to a screen reader. */
  label: string
  icon: React.ReactNode
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'text', size = 'md', ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      iconOnly
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      {...rest}
    >
      {sizeIcon(icon, buttonIconSize[size])}
    </Button>
  )
})
