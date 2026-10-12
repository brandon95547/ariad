import * as React from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Skeleton } from './Feedback'
import { Checkbox } from './Inputs'

/* ===========================================================================
   DATA TABLE — UI Bible spec.

   A table is for comparing rows with each other. Where nobody is comparing,
   a list of cards reads better and folds better.

   It has no surface of its own: it lies on whatever holds it, flush to that
   container's edges — put it in a `Card padding="none"` (with
   `overflow-hidden`, so a hovered row keeps the card's corners). The header is
   plain text on that same surface with a hairline under it, not a filled
   band, and it is shorter than a row: a strip of labels, not a row of data.

   The outermost cells take the container's own padding (`gutter`) in place of
   the 14px between columns, so the first column starts on the same line as
   the card's title and everything else in it — while the hairlines and the
   row hover still run edge to edge.

   Horizontal rules only. Vertical ones turn a grid that is scanned into a
   spreadsheet. Numbers go right, in tabular figures, so magnitude can be read
   as shape.

   The rows are the caller's, already sorted and paged: `sort` says how they
   are ordered and `onSortChange` asks for another order.
   ======================================================================== */

export interface Column<T> {
  key: string
  header: React.ReactNode
  /** Keep it pure: it runs for every row on every render. */
  cell: (row: T) => React.ReactNode
  /** `right` for every column of numbers. */
  align?: 'left' | 'right' | 'center'
  /** Any CSS width, for a column that should not flex: `8rem`, `1%`. */
  width?: string
  sortable?: boolean
  /** On the body cells. */
  className?: string
  /** Hidden under this breakpoint. Drop what a decision needs least, first. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl'
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

type Tier = 'base' | 'sm' | 'md' | 'lg' | 'xl'
const TIERS: readonly Tier[] = ['base', 'sm', 'md', 'lg', 'xl']

/**
 * Padding toward a neighbor, then toward the table's own edge, at each width.
 * Spelled out, not built, so the stylesheet has them.
 */
const padStart: Record<Tier, readonly [string, string]> = {
  base: ['pl-[var(--dt-pad)]', 'pl-[var(--dt-gutter)]'],
  sm: ['sm:pl-[var(--dt-pad)]', 'sm:pl-[var(--dt-gutter)]'],
  md: ['md:pl-[var(--dt-pad)]', 'md:pl-[var(--dt-gutter)]'],
  lg: ['lg:pl-[var(--dt-pad)]', 'lg:pl-[var(--dt-gutter)]'],
  xl: ['xl:pl-[var(--dt-pad)]', 'xl:pl-[var(--dt-gutter)]'],
}
const padEnd: Record<Tier, readonly [string, string]> = {
  base: ['pr-[var(--dt-pad)]', 'pr-[var(--dt-gutter)]'],
  sm: ['sm:pr-[var(--dt-pad)]', 'sm:pr-[var(--dt-gutter)]'],
  md: ['md:pr-[var(--dt-pad)]', 'md:pr-[var(--dt-gutter)]'],
  lg: ['lg:pr-[var(--dt-pad)]', 'lg:pr-[var(--dt-gutter)]'],
  xl: ['xl:pr-[var(--dt-pad)]', 'xl:pr-[var(--dt-gutter)]'],
}

const hidden: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  // The sidebar arrives at `lg` and takes 268px with it, so the content column
  // is narrower at 1024 than at 768. A column that needs real room waits for xl.
  xl: 'hidden xl:table-cell',
}

const alignment = { left: 'text-left', right: 'text-right', center: 'text-center' }

/** Card `sm`, `md` and `lg` padding. */
const gutters = { sm: '0.875rem', md: '1.25rem', lg: '1.5rem' }

/**
 * Which column is outermost changes with the width, because columns fold away
 * under their breakpoints — and the one left at the edge has to take the
 * gutter. So each column is told, width by width, whether it is at an edge.
 */
function edgePadding<T>(columns: readonly Column<T>[], leadingCell: boolean): string[] {
  const from = columns.map((column) => (column.hideBelow ? TIERS.indexOf(column.hideBelow) : 0))
  return columns.map((_, index) => {
    const classes: string[] = []
    let wasFirst: boolean | null = null
    let wasLast: boolean | null = null
    TIERS.forEach((tier, step) => {
      const shown = from.map((value) => value <= step)
      const first = !leadingCell && shown.indexOf(true) === index
      const last = shown.lastIndexOf(true) === index
      if (first !== wasFirst) classes.push(padStart[tier][first ? 1 : 0])
      if (last !== wasLast) classes.push(padEnd[tier][last ? 1 : 0])
      wasFirst = first
      wasLast = last
    })
    return classes.join(' ')
  })
}

/** True once `active` has lasted `ms`: most waits are over before anything needs showing. */
function useDelayed(active: boolean, ms: number) {
  const [elapsed, setElapsed] = React.useState(false)
  React.useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const timer = window.setTimeout(() => setElapsed(true), ms)
    return () => window.clearTimeout(timer)
  }, [active, ms])
  return active && elapsed
}

/** What in a row is its own target, and so not a press on the row. */
const OWN_TARGET =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="switch"], [data-row-ignore]'

const skeletonWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'] as const

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowLabel,
  loading = false,
  skeletonRows = 6,
  empty,
  selection,
  sort,
  onSortChange,
  onRowClick,
  dense = false,
  gutter = 'md',
  'aria-label': ariaLabel,
  className,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** What a row is called — "Spring sale" — for the name of its checkbox. */
  rowLabel?: (row: T) => string
  /** With no rows yet, skeleton rows. With rows, they stay and a bar runs under the header. */
  loading?: boolean
  /** How many rows to hold the place of while the first page loads. */
  skeletonRows?: number
  /** Shown in place of the rows when there are none. An `EmptyState compact`. */
  empty?: React.ReactNode
  selection?: { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }
  sort?: SortState | null
  onSortChange?: (next: SortState) => void
  /** Makes the row a target: a press, or Enter with the row focused. */
  onRowClick?: (row: T) => void
  /** 36px rows for a big screen and a mouse. Under a finger they stay 44px. */
  dense?: boolean
  /** The padding of what the table sits in. `md` is a Card's 20px. */
  gutter?: 'sm' | 'md' | 'lg'
  'aria-label': string
  className?: string
}): React.JSX.Element {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = React.useState(false)
  const anchor = React.useRef<string | null>(null)
  const shiftHeld = React.useRef(false)

  const waiting = loading && rows.length === 0
  const late = useDelayed(loading, 200)
  const columnCount = columns.length + (selection ? 1 : 0)
  const edges = edgePadding(columns, Boolean(selection))

  // A table wider than its column scrolls sideways, and what scrolls has to be
  // reachable from the keyboard.
  React.useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => setScrolls(element.scrollWidth > element.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const keys = rows.map(rowKey)
  const chosen = selection ? keys.filter((key) => selection.selected.has(key)).length : 0
  const allChosen = keys.length > 0 && chosen === keys.length

  // Only ever this page's rows: what was selected on another page stays so.
  const setRows = (targets: readonly string[], on: boolean) => {
    if (!selection) return
    const next = new Set(selection.selected)
    for (const key of targets) {
      if (on) next.add(key)
      else next.delete(key)
    }
    selection.onChange(next)
  }

  const toggleRow = (key: string, index: number, on: boolean) => {
    const from = shiftHeld.current && anchor.current !== null ? keys.indexOf(anchor.current) : -1
    anchor.current = key
    // Shift takes every row between the last one touched and this one.
    if (from === -1) setRows([key], on)
    else setRows(keys.slice(Math.min(from, index), Math.max(from, index) + 1), on)
  }

  const toggleSort = (column: Column<T>) => {
    if (!onSortChange) return
    const flipped = sort?.key === column.key && sort.dir === 'asc'
    onSortChange({ key: column.key, dir: flipped ? 'desc' : 'asc' })
  }

  const cellPad = dense ? 'py-1.5' : 'py-2'

  return (
    <div className={cn('relative', className)}>
      <div
        ref={scrollRef}
        // Its width is its container's and never its columns': a table too
        // wide for a phone scrolls in here and does not push the page wide.
        className="contain-inline-size overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]"
        {...(scrolls ? { tabIndex: 0, role: 'region', 'aria-label': ariaLabel } : {})}
        onKeyDown={(event) => {
          if (!selection || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') {
            return
          }
          const target = event.target as HTMLElement
          // In a field inside the table it is still "select this text".
          if (target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]')) {
            return
          }
          event.preventDefault()
          setRows(keys, true)
        }}
      >
        <table
          className="w-full border-collapse text-body-sm"
          style={
            {
              '--dt-pad': dense ? '0.75rem' : '0.875rem',
              '--dt-gutter': gutters[gutter],
            } as React.CSSProperties
          }
        >
          <caption className="sr-only-ds">{ariaLabel}</caption>
          <thead>
            <tr className="border-b border-[var(--ds-border-subtle)]">
              {selection && (
                <th
                  scope="col"
                  className="h-9 w-px pr-0 pl-[var(--dt-gutter)] text-left align-middle"
                >
                  {/* Zero line height: the cell is as tall as the box, and the box sits mid-row. */}
                  <span className="flex" style={{ lineHeight: 0 }}>
                    <Checkbox
                      checked={allChosen}
                      indeterminate={chosen > 0 && !allChosen}
                      disabled={keys.length === 0}
                      onChange={() => setRows(keys, !allChosen)}
                      aria-label={allChosen ? 'Deselect all rows' : 'Select all rows'}
                    />
                  </span>
                </th>
              )}
              {columns.map((column, index) => {
                const sorted = sort?.key === column.key ? sort.dir : null
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'h-9 align-middle text-label-sm font-medium whitespace-nowrap text-[var(--ds-fg-muted)]',
                      alignment[column.align ?? 'left'],
                      edges[index],
                      column.hideBelow && hidden[column.hideBelow],
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className={cn(
                          'touch-target group/sort -mx-1 inline-flex items-center gap-1.5 rounded-[var(--radius-xs)] px-1 py-1',
                          'transition-colors duration-[120ms] hover:text-[var(--ds-fg)]',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ds-focus-ring)]',
                          sorted && 'text-[var(--ds-fg)]',
                          // The arrow goes on the inside, so the label keeps
                          // the column's edge.
                          column.align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {column.header}
                        <span aria-hidden className="shrink-0" style={{ lineHeight: 0 }}>
                          {sorted === 'asc' ? (
                            <ArrowUp size={12} />
                          ) : sorted === 'desc' ? (
                            <ArrowDown size={12} />
                          ) : (
                            // Out of sight until asked for: a standing arrow on
                            // every column is chrome nobody is looking at.
                            // Under a finger there is no hover to ask with.
                            <ChevronsUpDown
                              size={12}
                              className="opacity-0 transition-opacity duration-[120ms] group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60 coarse:opacity-60"
                            />
                          )}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody aria-busy={loading || undefined}>
            {waiting &&
              Array.from({ length: skeletonRows }, (_, rowIndex) => (
                <tr
                  key={rowIndex}
                  className={cn(
                    'border-b border-[var(--ds-border-subtle)] last:border-b-0',
                    dense ? 'h-9 coarse:h-11' : 'h-11',
                  )}
                >
                  {selection && (
                    <td className="w-px pr-0 pl-[var(--dt-gutter)]">
                      <Skeleton className={cn('h-[18px] w-[18px]', !late && 'invisible')} />
                    </td>
                  )}
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(edges[index], column.hideBelow && hidden[column.hideBelow])}
                    >
                      {/* The rows hold their place from the start and are only
                          drawn once the wait is long enough to be worth saying:
                          nothing flashes, and nothing jumps when the data lands. */}
                      <Skeleton
                        className={cn(
                          'h-3 max-w-40',
                          skeletonWidths[(rowIndex + index) % skeletonWidths.length],
                          column.align === 'right' && 'ml-auto',
                          column.align === 'center' && 'mx-auto',
                          !late && 'invisible',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="p-0">
                  {empty ?? (
                    <p className="px-[var(--dt-gutter)] py-10 text-center text-body-sm text-[var(--ds-fg-muted)]">
                      Nothing here yet
                    </p>
                  )}
                </td>
              </tr>
            )}

            {rows.map((row, rowIndex) => {
              const key = keys[rowIndex] ?? rowKey(row)
              const selected = selection?.selected.has(key) ?? false
              return (
                <tr
                  key={key}
                  data-selected={selected || undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={
                    onRowClick
                      ? (event) => {
                          const own = (event.target as HTMLElement).closest(OWN_TARGET)
                          if (own && event.currentTarget.contains(own)) return
                          // A drag across the row was to select its text.
                          if (window.getSelection()?.toString()) return
                          onRowClick(row)
                        }
                      : undefined
                  }
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key !== 'Enter' || event.target !== event.currentTarget) return
                          event.preventDefault()
                          onRowClick(row)
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-[var(--ds-border-subtle)] transition-colors duration-75 last:border-b-0',
                    dense ? 'h-9 coarse:h-11' : 'h-11',
                    // Three states, three values: at rest, under the pointer, chosen.
                    selected ? 'bg-[var(--ds-layer-selected)]' : 'hover:bg-[var(--ds-layer-hover)]',
                    onRowClick &&
                      'cursor-pointer focus-visible:bg-[var(--ds-layer-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
                  )}
                >
                  {selection && (
                    <td
                      data-row-ignore
                      className="w-px pr-0 pl-[var(--dt-gutter)] align-middle"
                      onClickCapture={(event) => {
                        shiftHeld.current = event.shiftKey
                      }}
                    >
                      <span className="flex" style={{ lineHeight: 0 }}>
                        <Checkbox
                          checked={selected}
                          onChange={(on) => toggleRow(key, rowIndex, on)}
                          // "Select Spring sale", not a column of "Select row".
                          aria-label={`Select ${rowLabel?.(row) ?? `row ${rowIndex + 1}`}`}
                        />
                      </span>
                    </td>
                  )}
                  {columns.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'align-middle text-[var(--ds-fg-secondary)]',
                        cellPad,
                        alignment[column.align ?? 'left'],
                        edges[index],
                        column.hideBelow && hidden[column.hideBelow],
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {late && !waiting && (
        // A refresh keeps what is there readable — stale rows are still rows —
        // and says so with a 2px bar under the header.
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-9 h-0.5 overflow-hidden"
        >
          <div className="h-full w-full origin-left animate-[indeterminate_1.4s_cubic-bezier(0.2,0,0,1)_infinite] bg-[var(--ds-accent)]" />
        </div>
      )}
    </div>
  )
}
