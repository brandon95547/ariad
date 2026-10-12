import * as React from 'react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   TABS — UI Bible spec.

   Peer views of one thing: a campaign's Overview, Recipients and Report.
   Never the steps of a wizard, never a filter, never the way between
   unrelated places — that is navigation, and it lives in the sidebar.

   Underline tabs. The 2px indicator lies on the row's own hairline, which is
   what joins the chosen tab to the panel under it. The label changes color
   and never weight: a bolder label is a wider one, and the whole row would
   shift on every switch.

   One Tab stop for the row. The arrows move along it and choose as they go,
   Home and End jump to its ends, and Tab again goes into the panel.
   ======================================================================== */

export interface TabItem<T extends string = string> {
  value: T
  label: string
  /** How many things are behind the tab. Shown to 99, said in full. */
  count?: number
  icon?: React.ReactNode
}

const tabElementId = (tabsId: string, value: string) => `${tabsId}-tab-${value}`
const panelElementId = (tabsId: string, value: string) => `${tabsId}-panel-${value}`

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
  id,
}: {
  tabs: readonly TabItem<T>[]
  value: T
  onChange: (value: T) => void
  /** Names the row. Two rows of tabs on a page need two names. */
  'aria-label': string
  className?: string
  /** Give it one, and the same one to each TabPanel, to tie every tab to its panel. */
  id?: string
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const selected = tabs.findIndex((tab) => tab.value === value)
  // Nothing chosen still has to be reachable: the first tab takes the stop.
  const stop = selected === -1 ? 0 : selected

  const go = (index: number) => {
    const next = (index + tabs.length) % tabs.length
    const tab = tabs[next]
    if (!tab) return
    onChange(tab.value)
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')
    buttons?.[next]?.focus()
  }

  // A row that scrolls keeps the chosen tab in sight.
  React.useEffect(() => {
    const list = listRef.current
    const tab = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!list || !tab) return
    const overLeft = tab.offsetLeft < list.scrollLeft
    const overRight = tab.offsetLeft + tab.offsetWidth > list.scrollLeft + list.clientWidth
    if (overLeft || overRight) list.scrollTo?.({ left: tab.offsetLeft - 24 })
  }, [value])

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') go(stop + 1)
        else if (event.key === 'ArrowLeft') go(stop - 1)
        else if (event.key === 'Home') go(0)
        else if (event.key === 'End') go(tabs.length - 1)
        else return
        event.preventDefault()
      }}
      className={cn(
        // The hairline is drawn inside the row rather than as its border, so
        // the indicator can lie on it without a negative margin: a row that
        // scrolls sideways would clip anything hung below its own edge.
        'scrollbar-none flex items-stretch gap-1 overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border-subtle)]',
        className,
      )}
    >
      {tabs.map((tab, index) => {
        const active = index === selected
        const count = tab.count ?? 0
        const counted = count > 0
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={id ? tabElementId(id, tab.value) : undefined}
            aria-selected={active}
            aria-controls={id ? panelElementId(id, tab.value) : undefined}
            // "Logs, 12 items", where the pill alone would be read "Logs 12".
            aria-label={counted ? `${tab.label}, ${count} items` : undefined}
            tabIndex={index === stop ? 0 : -1}
            onClick={() => onChange(tab.value)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 text-label font-medium',
              // Grown, not overlaid: the row clips, so the 44px has to be the
              // tab's own box under a finger.
              'coarse:h-11',
              'rounded-t-[var(--radius-sm)] rounded-b-none border-b-2',
              'transition-colors duration-[140ms] ease-[cubic-bezier(0.2,0,0,1)]',
              // Inset, so the row's own edge does not clip it.
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
              active
                ? 'border-[var(--ds-accent)] text-[var(--ds-fg)]'
                : 'border-transparent text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg-secondary)]',
            )}
          >
            {tab.icon ? (
              <span className="shrink-0" style={{ lineHeight: 0 }} aria-hidden>
                {tab.icon}
              </span>
            ) : null}
            {tab.label}
            {counted && (
              // Accent on the chosen tab and neutral on the rest: a bright
              // count on every tab is a row of competing signals.
              <span
                aria-hidden
                data-tabular
                className={cn(
                  'inline-grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-overline tracking-normal',
                  active
                    ? 'bg-[var(--ds-accent)] text-[var(--ds-accent-fg)]'
                    : 'bg-[var(--ds-fg-muted)] text-[var(--ds-canvas)]',
                )}
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The panel under a row of tabs — 20px under it, far enough to be its own
 * content and near enough to be the tab's.
 *
 * Render the chosen one only: a panel left in the page while hidden can still
 * be reached by a screen reader and found by a search. It takes the focus
 * itself, so one with nothing focusable in it can still be reached and
 * scrolled from the keyboard.
 */
export function TabPanel({
  tabsId,
  value,
  children,
  className,
}: {
  /** The `id` given to the Tabs it belongs to. */
  tabsId: string
  /** The tab it is the panel of. */
  value: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="tabpanel"
      id={panelElementId(tabsId, value)}
      aria-labelledby={tabElementId(tabsId, value)}
      tabIndex={0}
      className={cn(
        'pt-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
        className,
      )}
    >
      {children}
    </div>
  )
}
