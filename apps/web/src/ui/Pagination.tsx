import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useCoarsePointer, useMediaQuery } from '@/lib/hooks'

/* ===========================================================================
   PAGINATION — UI Bible spec.

   The range comes first — "76–100 of 1,284" — because it answers "did my
   filter work?", and that question comes before "where next?".

   The run of numbers keeps one width from the first page to the last: first,
   last, the current page with a neighbor either side, and the gaps held by
   ellipses. A row that reflows makes the reader find Next again on every
   press. For the same reason Previous and Next are disabled at the ends, never
   removed.

   Every target is a 32px square, so page 1 and page 400 are the same thing to
   aim at. The current page is filled and is not a target: it is where you
   already are.

   Numbered paging is a desktop pattern. Under a finger, and on a narrow
   screen, it folds to Previous, "3 of 52", Next.
   ======================================================================== */

type Slot = number | 'gap-start' | 'gap-end'

/** Seven slots whenever there are more than seven pages, so the row never changes width. */
function pageSlots(page: number, pageCount: number): Slot[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap-end', pageCount]
  if (page >= pageCount - 3) {
    return [1, 'gap-start', pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount]
  }
  return [1, 'gap-start', page - 1, page, page + 1, 'gap-end', pageCount]
}

const count = (value: number) => value.toLocaleString('en-US')

const target = [
  'touch-target touch-target--icon grid h-8 min-w-8 shrink-0 place-items-center rounded-[var(--radius-md)] px-1.5 text-label-sm',
  'transition-colors duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
].join(' ')

const idle =
  'text-[var(--ds-fg-secondary)] hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)] active:bg-[var(--ds-layer-active)]'

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className,
}: {
  /** The current page, from 1. */
  page: number
  pageSize: number
  /** How many rows there are in all, not how many pages. */
  total: number
  onPageChange: (page: number) => void
  className?: string
}) {
  const coarse = useCoarsePointer()
  const wide = useMediaQuery('(min-width: 40rem)')
  const folded = coarse || !wide

  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const current = Math.min(Math.max(1, Math.round(page)), pageCount)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), pageCount)
    if (clamped !== current) onPageChange(clamped)
  }

  const step = (direction: -1 | 1, label: string) => {
    const disabled = direction === -1 ? current <= 1 : current >= pageCount
    const Icon = direction === -1 ? ChevronLeft : ChevronRight
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        // Kept in the Tab order and in its place: the focus is not thrown off
        // a button that has just stopped working.
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) go(current + direction)
        }}
        className={cn(target, disabled ? 'cursor-default text-[var(--ds-fg-disabled)]' : idle)}
      >
        <Icon size={15} aria-hidden />
      </button>
    )
  }

  return (
    <nav
      aria-label="Pagination"
      onKeyDown={(event) => {
        if (event.key === 'Home') go(1)
        else if (event.key === 'End') go(pageCount)
        else return
        event.preventDefault()
      }}
      className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2', className)}
    >
      {/* Said again after every change of page: it is the only word a screen
          reader gets that the rows under it are new ones. */}
      <p aria-live="polite" data-tabular className="text-caption text-[var(--ds-fg-muted)]">
        {total === 0 ? (
          'No results'
        ) : (
          <>
            <span className="sr-only-ds">Showing </span>
            <span className="text-[var(--ds-fg-secondary)]">
              {count(from)}–{count(to)}
            </span>{' '}
            of <span className="text-[var(--ds-fg-secondary)]">{count(total)}</span>
          </>
        )}
      </p>

      {/* 2px between the numbers, which are one control; 8px to Previous and
          Next, which are a different kind of step. */}
      <div className="ml-auto flex items-center gap-2 coarse:gap-3">
        {step(-1, 'Previous page')}
        {folded ? (
          <span data-tabular className="px-1 text-label-sm text-[var(--ds-fg-secondary)]">
            <span className="sr-only-ds">Page </span>
            {count(current)} of {count(pageCount)}
          </span>
        ) : (
          <ol className="flex items-center gap-0.5">
            {pageSlots(current, pageCount).map((slot) =>
              typeof slot !== 'number' ? (
                // Not a button. One that opened the hidden pages would be a
                // target that behaves unlike every one beside it.
                <li
                  key={slot}
                  aria-hidden
                  className="grid h-8 w-8 place-items-center text-label-sm text-[var(--ds-fg-disabled)]"
                >
                  …
                </li>
              ) : slot === current ? (
                <li key={slot}>
                  <span
                    aria-current="page"
                    data-tabular
                    className="grid h-8 min-w-8 cursor-default place-items-center rounded-[var(--radius-md)] bg-[var(--ds-accent)] px-1.5 text-label-sm text-[var(--ds-accent-fg)]"
                  >
                    <span className="sr-only-ds">Page </span>
                    {count(slot)}
                  </span>
                </li>
              ) : (
                <li key={slot}>
                  <button
                    type="button"
                    aria-label={`Go to page ${count(slot)}`}
                    data-tabular
                    onClick={() => go(slot)}
                    className={cn(target, idle)}
                  >
                    {count(slot)}
                  </button>
                </li>
              ),
            )}
          </ol>
        )}
        {step(1, 'Next page')}
      </div>
    </nav>
  )
}
