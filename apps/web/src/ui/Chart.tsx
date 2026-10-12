import * as React from 'react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   CHARTS — UI Bible spec (Chart).

   The data is the only thing allowed to be loud. The grid is a hairline one
   step off the surface, the axis text is muted and tabular, the lines are
   2px — thin enough to cross each other legibly — and each ends in a dot with
   a 2px ring of the surface, so two series ending at one value stay apart.

   Color is identity and never the only one. Two or more series always get a
   legend; up to four are also named at the ends of their lines where there is
   room; the readout lists every series by name; and the figures are there as
   a table for a screen reader. Text is never set in a series color — a light
   hue is illegible as text — a mark beside it carries the identity.

   Series take --p-viz-1…8 in order, by position, so a series keeps its color
   whatever else is filtered away. Four separate cleanly for every kind of
   color vision; past that, fewer series or small multiples.

   The readout enhances and never gates: hover, a tap that pins it, or the
   arrow keys with the chart focused all reach the same figures.
   ======================================================================== */

const SERIES_COLORS = [
  'var(--p-viz-1)',
  'var(--p-viz-2)',
  'var(--p-viz-3)',
  'var(--p-viz-4)',
  'var(--p-viz-5)',
  'var(--p-viz-6)',
  'var(--p-viz-7)',
  'var(--p-viz-8)',
] as const

/** What the marks are ringed with. A chart on something other than a card sets `--chart-surface`. */
const SURFACE = 'var(--chart-surface, var(--ds-surface))'

/** The width of a character of 11px axis text, near enough to lay labels out by. */
const CHARACTER = 6.4

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export interface ChartSeries {
  name: string
  /** Any CSS color. Left out, the series takes the next of --p-viz-1…8. */
  color?: string
  points: { x: string; y: number }[]
}

/** A step people count in — 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(rough: number) {
  const power = 10 ** Math.floor(Math.log10(rough))
  const unit = rough / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power
}

/** An axis from zero, in round steps: a line that starts anywhere else exaggerates its own slope. */
function axisFor(values: readonly number[], steps: number) {
  const low = Math.min(0, ...values)
  const high = Math.max(0, ...values)
  const step = niceStep((high - low || 1) / steps)
  const start = Math.floor(low / step) * step
  const end = Math.max(start + step, Math.ceil(high / step) * step)
  const ticks: number[] = []
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)))
  }
  return { start, end, ticks }
}

function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    setWidth(element.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}

export function LineChart({
  series,
  height = 240,
  yFormat,
  'aria-label': ariaLabel,
  className,
}: {
  /** Sharing one x axis, in the order of the first series' points. */
  series: ChartSeries[]
  /** The whole figure, axis text included. 140 in a tile, 240 for a section, 360 for a page. */
  height?: number
  /** For the axis and the readout both. Left out: 1.2K on the axis, 1,204 in the readout. */
  yFormat?: (n: number) => string
  /** The trend, not "chart": "Opens rise from 312 to 542 between January and July". */
  'aria-label': string
  className?: string
}) {
  const frameRef = React.useRef<HTMLDivElement>(null)
  const width = useWidth(frameRef)
  const [active, setActive] = React.useState<number | null>(null)
  const [announcement, setAnnouncement] = React.useState('')

  const tickText = yFormat ?? ((value: number) => compact.format(value))
  const valueText = yFormat ?? ((value: number) => exact.format(value))

  const categories = React.useMemo(() => {
    const seen = new Set<string>()
    const ordered: string[] = []
    for (const one of series) {
      for (const point of one.points) {
        if (seen.has(point.x)) continue
        seen.add(point.x)
        ordered.push(point.x)
      }
    }
    return ordered
  }, [series])

  const lines = React.useMemo(
    () =>
      series.map((one, index) => ({
        name: one.name,
        color: one.color ?? SERIES_COLORS[index % SERIES_COLORS.length]!,
        values: new Map(one.points.map((point) => [point.x, point.y])),
      })),
    [series],
  )

  // A tap pins the readout, and a tap anywhere else lets it go.
  React.useEffect(() => {
    if (active === null) return
    const release = (event: PointerEvent) => {
      if (!frameRef.current?.contains(event.target as Node)) setActive(null)
    }
    document.addEventListener('pointerdown', release)
    return () => document.removeEventListener('pointerdown', release)
  }, [active])

  const count = categories.length
  const last = count - 1

  // ---- Layout ------------------------------------------------------------
  const padTop = 8
  const padBottom = 24
  const plotHeight = Math.max(1, height - padTop - padBottom)
  const axis = axisFor(
    series.flatMap((one) => one.points.map((point) => point.y)),
    Math.max(2, Math.min(5, Math.floor(plotHeight / 44))),
  )
  const yAt = (value: number) =>
    padTop + (1 - (value - axis.start) / (axis.end - axis.start)) * plotHeight

  const tickLabels = axis.ticks.map(tickText)
  const padLeft = Math.max(...tickLabels.map((text) => text.length), 2) * CHARACTER + 10

  // Names at the ends of the lines, for up to four series, where the chart is
  // wide enough and the ends are far enough apart to take them. Lines that
  // converge are left to the legend: labels nudged apart stop pointing at
  // their lines.
  const lastCategory = categories[last]
  const ends = lines.map((line) =>
    lastCategory === undefined ? undefined : line.values.get(lastCategory),
  )
  const endsApart = ends
    .filter((value): value is number => value !== undefined)
    .map(yAt)
    .sort((a, b) => a - b)
    .every((y, index, all) => index === 0 || y - all[index - 1]! >= 14)
  const named =
    lines.length >= 2 &&
    lines.length <= 4 &&
    width >= 520 &&
    endsApart &&
    ends.every((value) => value !== undefined)
  const endName = (name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)
  const padRight = named
    ? Math.max(...lines.map((line) => endName(line.name).length)) * CHARACTER + 18
    : 12

  const plotWidth = Math.max(1, width - padLeft - padRight)
  const xAt = (index: number) =>
    last <= 0 ? padLeft + plotWidth / 2 : padLeft + (index / last) * plotWidth

  // Fewer x labels rather than turned ones: counted back from the latest, so
  // the newest point is always the one that is named.
  const widestLabel = Math.max(...categories.map((text) => text.length), 1) * CHARACTER + 16
  // One and a half label widths apart, not one: the last label is set flush to
  // the plot's edge and so reaches a full width back toward its neighbor,
  // which is centered and reaches half a width forward.
  const every = last <= 0 ? 1 : Math.max(1, Math.ceil((widestLabel * 1.5) / (plotWidth / last)))

  const nearest = (clientX: number) => {
    const frame = frameRef.current
    if (!frame || count === 0) return null
    const x = clientX - frame.getBoundingClientRect().left
    if (last <= 0) return 0
    return Math.min(last, Math.max(0, Math.round(((x - padLeft) / plotWidth) * last)))
  }

  const describe = (index: number) => {
    const category = categories[index]
    if (category === undefined) return ''
    const parts = lines
      .map((line) => {
        const value = line.values.get(category)
        return value === undefined ? null : `${line.name} ${valueText(value)}`
      })
      .filter(Boolean)
    return `${category}: ${parts.join(', ')}`
  }

  const moveTo = (index: number) => {
    const next = Math.min(last, Math.max(0, index))
    setActive(next)
    setAnnouncement(describe(next))
  }

  const activeCategory = active === null ? undefined : categories[active]
  const activeX = active === null ? 0 : xAt(active)

  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-2', className)}>
      <div
        ref={frameRef}
        role="group"
        aria-roledescription="chart"
        aria-label={ariaLabel}
        tabIndex={count > 0 ? 0 : undefined}
        style={{ height }}
        className="relative min-w-0 rounded-[var(--radius-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]"
        onKeyDown={(event) => {
          if (count === 0) return
          if (event.key === 'ArrowRight') moveTo(active === null ? 0 : active + 1)
          else if (event.key === 'ArrowLeft') moveTo(active === null ? last : active - 1)
          else if (event.key === 'Home') moveTo(0)
          else if (event.key === 'End') moveTo(last)
          else if (event.key === 'Escape' && active !== null) setActive(null)
          else return
          event.preventDefault()
        }}
        onBlur={() => setActive(null)}
      >
        {count === 0 ? (
          <p className="grid h-full place-items-center text-body-sm text-[var(--ds-fg-muted)]">
            No data for this period
          </p>
        ) : (
          width > 0 && (
            <svg
              width={width}
              height={height}
              aria-hidden
              // Laid over the frame, not in it: a drawing with a width of its
              // own would hold the frame open, and a chart that cannot get
              // narrower pushes the page wide on a phone.
              className="absolute inset-0 touch-pan-y select-none"
              onPointerMove={(event) => setActive(nearest(event.clientX))}
              onPointerDown={(event) => setActive(nearest(event.clientX))}
              onPointerLeave={(event) => {
                // A finger lifting leaves the readout where it was put.
                if (event.pointerType === 'mouse') setActive(null)
              }}
            >
              {axis.ticks.map((tick, index) => (
                <g key={tick}>
                  <line
                    x1={padLeft}
                    x2={padLeft + plotWidth}
                    y1={yAt(tick)}
                    y2={yAt(tick)}
                    stroke={tick === 0 ? 'var(--ds-border)' : 'var(--ds-border-subtle)'}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={padLeft - 8}
                    y={yAt(tick)}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-[var(--ds-fg-muted)] text-[11px] tabular-nums"
                  >
                    {tickLabels[index]}
                  </text>
                </g>
              ))}

              {categories.map((category, index) =>
                (last - index) % every === 0 ? (
                  <text
                    key={category}
                    x={xAt(index)}
                    y={height - 6}
                    textAnchor={
                      last > 0 && index === last
                        ? 'end'
                        : last > 0 && index === 0
                          ? 'start'
                          : 'middle'
                    }
                    className="fill-[var(--ds-fg-muted)] text-[11px]"
                  >
                    {category}
                  </text>
                ) : null,
              )}

              {active !== null && (
                <line
                  x1={activeX}
                  x2={activeX}
                  y1={padTop}
                  y2={padTop + plotHeight}
                  stroke="var(--ds-border-strong)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
              )}

              {lines.map((line, lineIndex) => {
                // A missing point is a gap in the line, not a fall to zero.
                let pen = false
                const path = categories
                  .map((category, index) => {
                    const value = line.values.get(category)
                    if (value === undefined) {
                      pen = false
                      return ''
                    }
                    const command = `${pen ? 'L' : 'M'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`
                    pen = true
                    return command
                  })
                  .join(' ')
                const end = lastCategory === undefined ? undefined : line.values.get(lastCategory)
                const marked =
                  activeCategory === undefined ? undefined : line.values.get(activeCategory)
                return (
                  <g key={lineIndex}>
                    <path
                      d={path}
                      fill="none"
                      stroke={line.color}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {end !== undefined && (
                      <circle
                        cx={xAt(last)}
                        cy={yAt(end)}
                        r={4}
                        fill={line.color}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                    )}
                    {marked !== undefined && active !== last && (
                      <circle
                        cx={activeX}
                        cy={yAt(marked)}
                        r={4}
                        fill={line.color}
                        stroke={SURFACE}
                        strokeWidth={2}
                      />
                    )}
                    {named && end !== undefined && (
                      <text
                        x={xAt(last) + 10}
                        y={yAt(end)}
                        dominantBaseline="middle"
                        className="fill-[var(--ds-fg-secondary)] text-[11px] font-medium"
                      >
                        {endName(line.name)}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          )
        )}

        {active !== null && activeCategory !== undefined && width > 0 && (
          // One readout, every series: the pointer aims at a date and never
          // has to land on a 2px line. The figure leads and the name follows —
          // here the reader has the series and wants the number.
          <div
            className="pointer-events-none absolute z-10 flex min-w-32 flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] px-2.5 py-2 shadow-e3"
            style={{
              top: padTop,
              ...(activeX > width / 2 ? { right: width - activeX + 12 } : { left: activeX + 12 }),
            }}
          >
            <p className="text-caption text-[var(--ds-fg-muted)]">{activeCategory}</p>
            <ul className="flex flex-col gap-1">
              {lines.map((line, lineIndex) => {
                const value = line.values.get(activeCategory)
                return (
                  <li key={lineIndex} className="flex items-center gap-2 text-caption">
                    <span
                      aria-hidden
                      className="h-0.5 w-3 shrink-0 rounded-full"
                      style={{ background: line.color }}
                    />
                    <span className="min-w-0 truncate text-[var(--ds-fg-secondary)]">
                      {line.name}
                    </span>
                    <span data-tabular className="ml-auto pl-3 font-medium text-[var(--ds-fg)]">
                      {value === undefined ? '—' : valueText(value)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>

      {lines.length > 1 && (
        // One series needs none: the title already says what the line is.
        <ul className="flex flex-wrap gap-x-4 gap-y-1" style={{ paddingLeft: padLeft }}>
          {lines.map((line, lineIndex) => (
            <li key={lineIndex} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="h-0.5 w-3 shrink-0 rounded-full"
                style={{ background: line.color }}
              />
              <span className="text-caption text-[var(--ds-fg-secondary)]">{line.name}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="sr-only-ds" aria-live="polite">
        {announcement}
      </p>

      {count > 0 && (
        // The figures themselves. A label is one reading of the chart; this is
        // the data.
        // In a box of its own: a table takes the width of its columns whatever
        // width it is given, and would stick out of the page unseen.
        <div className="sr-only-ds">
          <table>
            <caption>{ariaLabel}</caption>
            <thead>
              <tr>
                <td />
                {lines.map((line, lineIndex) => (
                  <th key={lineIndex} scope="col">
                    {line.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category}>
                  <th scope="row">{category}</th>
                  {lines.map((line, lineIndex) => {
                    const value = line.values.get(category)
                    return <td key={lineIndex}>{value === undefined ? '' : valueText(value)}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}

/**
 * Bar list — UI Bible spec (Chart).
 *
 * A ranking: the links that were clicked most, the domains that bounced most.
 * One measure, so one color. Every bar starts at the same edge and is rounded
 * at the value and square at the baseline — rounding both ends detaches a bar
 * from the line it is measured against.
 *
 * Each row says its figure in text, so nothing is read off a bar's length
 * alone and there is nothing here that needs a hover.
 *
 * In the order given: sort before passing them in.
 */
export function BarList({
  items,
  valueFormat,
  max,
  className,
}: {
  items: { label: string; value: number; hint?: string }[]
  valueFormat?: (n: number) => string
  /** What a full-width bar stands for. Left out, the largest value. */
  max?: number
  className?: string
}) {
  const full = max ?? Math.max(0, ...items.map((item) => item.value))
  const text = valueFormat ?? ((value: number) => exact.format(value))

  if (items.length === 0) {
    return <p className={cn('text-body-sm text-[var(--ds-fg-muted)]', className)}>No data yet</p>
  }

  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {items.map((item, index) => {
        const share = full > 0 ? Math.max(0, Math.min(1, item.value / full)) : 0
        return (
          <li key={`${item.label}-${index}`} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-body-sm text-[var(--ds-fg)]">{item.label}</span>
                {item.hint && (
                  <span className="shrink-0 text-caption text-[var(--ds-fg-muted)]">
                    {item.hint}
                  </span>
                )}
              </span>
              <span data-tabular className="shrink-0 text-body-sm font-medium text-[var(--ds-fg)]">
                {text(item.value)}
              </span>
            </div>
            <div aria-hidden className="h-2">
              <div
                // Never nothing: a value too small to draw still leaves a mark.
                className="h-full min-w-0.5 rounded-r-[var(--radius-xs)] bg-[var(--p-viz-1)]"
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
