import * as React from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ArrowLeft, Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useDismissable, useFocusTrap, useMediaQuery } from '@/lib/hooks'
import { IconButton } from './Button'

/* ===========================================================================
   APP SHELL — UI Bible spec (Sidebar, App Bar, Dashboards, Mobile Patterns).

   Three regions: the navigation column, a bar, and the content well.

   The column is permanent from 1024px — a 268px sidebar beside a readable
   column needs about that much — and it does not move, so where things are
   becomes memory. It answers "where am I" as much as "where can I go". Below
   1024px there is no room for a column, and the same list comes out of the
   bar's menu button as a drawer over a scrim.

   Only the content well scrolls. The brand, the navigation and what is pinned
   under it stay put, and a long page never carries the way out off screen.

   A skip link is the first Tab stop: without one every keyboard user crosses
   the whole navigation on every page.
   ======================================================================== */

export interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  /** Current only on exactly this path, not on everything under it. For "/". */
  end?: boolean
  /** After the label: a count, a status. */
  badge?: React.ReactNode
}

export interface NavGroup {
  /** Set in small caps over its items. A first group can go without. */
  label?: string
  items: NavItem[]
}

function sizeIcon(node: React.ReactNode, size: number) {
  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ size?: number }>
    if (element.props.size === undefined) return React.cloneElement(element, { size })
  }
  return node
}

/**
 * The list of destinations, the same in the column and in the drawer.
 *
 * Rows are 32px, denser than a button because a list of places is scanned
 * down rather than acted on one at a time, and 44px under a finger. The label
 * is 15px — the size a product is operated through — and does not shrink to
 * fit more rows in.
 *
 * The current place carries `aria-current`, a tint and a 2px marker. The
 * marker is laid over the row and not a border on it: a border would change
 * the row's box and move every label by a pixel.
 */
function Navigation({ nav, onNavigate }: { nav: readonly NavGroup[]; onNavigate?: () => void }) {
  const baseId = React.useId()
  return (
    <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
      <div className="flex flex-col gap-5">
        {nav.map((group, groupIndex) => {
          const headingId = `${baseId}-${groupIndex}`
          return (
            <div key={group.label ?? groupIndex} className="flex flex-col gap-1.5">
              {group.label && (
                <p
                  id={headingId}
                  className="px-2.5 text-overline text-[var(--ds-fg-muted)] uppercase"
                >
                  {group.label}
                </p>
              )}
              {/* A list, so its size is said: "Audience, list, 3 items". */}
              <ul
                aria-labelledby={group.label ? headingId : undefined}
                className="flex flex-col gap-px"
              >
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        cn(
                          'nav-row group relative flex h-8 w-full items-center gap-2.5 rounded-[var(--radius-md)] pr-2 pl-2.5 text-ui',
                          'transition-[background-color,color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
                          // Inset, so the column's own edge does not clip it.
                          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
                          isActive
                            ? 'bg-[var(--ds-layer-selected)] font-medium text-[var(--ds-fg)]'
                            : 'text-[var(--ds-fg-secondary)] hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)]',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive && (
                            <span
                              aria-hidden
                              className="absolute top-1/2 left-0 h-[15px] w-0.5 -translate-y-1/2 rounded-r-full bg-[var(--ds-accent)]"
                            />
                          )}
                          <span
                            aria-hidden
                            style={{ lineHeight: 0 }}
                            className={cn(
                              'shrink-0 transition-colors duration-[120ms]',
                              isActive
                                ? 'text-[var(--ds-accent-text)]'
                                : 'text-[var(--ds-fg-muted)] group-hover:text-[var(--ds-fg-secondary)]',
                            )}
                          >
                            {sizeIcon(item.icon, 16)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.badge ? <span className="shrink-0">{item.badge}</span> : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </nav>
  )
}

const rowEdge = 'border-[var(--ds-border-subtle)]'

export function AppShell({
  brand,
  nav,
  sidebarFooter,
  topbarEnd,
  children,
}: {
  /** The mark and the name. At the head of the column, and in the bar where there is no column. */
  brand: React.ReactNode
  nav: NavGroup[]
  /** Pinned under the navigation, outside its scroll: the account, settings. */
  sidebarFooter?: React.ReactNode
  /** The end of the bar: what is needed from every screen. Two controls on a phone, three at most. */
  topbarEnd?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const wide = useMediaQuery('(min-width: 64rem)')
  const location = useLocation()
  const drawerRef = React.useRef<HTMLDivElement>(null)
  const mainRef = React.useRef<HTMLElement>(null)
  const closeDrawer = React.useCallback(() => setDrawerOpen(false), [])

  useDismissable(drawerOpen, closeDrawer, [drawerRef])
  useFocusTrap(drawerOpen, drawerRef)

  // A drawer covers what it leads to, so arriving anywhere closes it — by its
  // own links, and by Back and Forward too.
  React.useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Growing past 1024px brings the column back. A drawer left open then would
  // be lying over the page it is now beside.
  React.useEffect(() => {
    if (wide) setDrawerOpen(false)
  }, [wide])

  // The focus goes into the drawer and comes back to the button that opened it.
  React.useEffect(() => {
    if (!drawerOpen) return
    const previous = document.activeElement as HTMLElement | null
    drawerRef.current?.focus()
    return () => previous?.focus?.()
  }, [drawerOpen])

  // A new page starts at its top. The well is what scrolls, not the window,
  // so nothing else will put it back there.
  React.useLayoutEffect(() => {
    if (!location.hash) mainRef.current?.scrollTo?.({ top: 0 })
  }, [location.pathname, location.hash])

  const footer = sidebarFooter ? (
    <div className={cn('shrink-0 border-t px-2.5 py-2', rowEdge)}>{sidebarFooter}</div>
  ) : null

  return (
    <div className="app-ambient relative flex h-dvh overflow-hidden bg-[var(--ds-canvas)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <a
        href="#main"
        onClick={(event) => {
          // Moved by hand, so the address is left alone whatever the router is.
          event.preventDefault()
          mainRef.current?.focus()
        }}
        className="absolute top-3 left-3 z-[100] -translate-y-[300%] rounded-[var(--radius-md)] bg-[var(--ds-accent)] px-4 py-2 text-label text-[var(--ds-accent-fg)] shadow-e3 focus:translate-y-0"
      >
        Skip to content
      </a>

      {/* The column. Hidden under 1024px by the stylesheet, not by a script,
          so a phone never paints a sidebar it is about to take away. */}
      <div
        className={cn(
          'relative z-10 hidden w-[16.75rem] shrink-0 flex-col border-r bg-[var(--ds-surface)] lg:flex',
          rowEdge,
        )}
      >
        <div className={cn('flex h-14 shrink-0 items-center border-b px-4', rowEdge)}>{brand}</div>
        <Navigation nav={nav} />
        {footer}
      </div>

      {drawerOpen && !wide && (
        <div className="fixed inset-0 z-50 flex" role="presentation">
          <div
            className="absolute inset-0 bg-[var(--ds-layer-scrim)] motion-safe:animate-[fade-in_160ms_cubic-bezier(0.2,0,0,1)_both]"
            aria-hidden
          />
          {/* Never the whole width: a strip of the page stays in sight, so it
              reads as a panel over the content and not as another screen. */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            tabIndex={-1}
            className={cn(
              'relative flex h-full w-[min(19rem,calc(100vw-3rem))] flex-col border-r border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] shadow-e5 outline-none',
              'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
              'motion-safe:animate-[drawer-in-left_260ms_cubic-bezier(0.32,0.72,0,1)_both]',
            )}
          >
            <div
              className={cn(
                'flex h-14 shrink-0 items-center justify-between gap-2 border-b pr-2.5 pl-4',
                rowEdge,
              )}
            >
              <div className="min-w-0">{brand}</div>
              {/* A way out that is not a gesture: the menu button is behind
                  the scrim once this is open. */}
              <IconButton label="Close navigation" icon={<X />} size="sm" onClick={closeDrawer} />
            </div>
            <Navigation nav={nav} onNavigate={closeDrawer} />
            {footer}
          </div>
        </div>
      )}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* The bar. Under 1024px it carries the way to the navigation and the
            brand. From there up the column has both, and the bar is only a
            strip for what `topbarEnd` puts at its end — with nothing to put
            there, it is not drawn. */}
        <header
          className={cn(
            'flex h-[calc(3.5rem_+_env(safe-area-inset-top))] shrink-0 items-center gap-2 border-b bg-[var(--ds-canvas)] pt-[env(safe-area-inset-top)]',
            rowEdge,
            // The menu button's glyph, not its box, stands on the content's edge.
            'pr-[var(--ds-layout-gutter)] pl-[calc(var(--ds-layout-gutter)_-_0.625rem)]',
            'sm:pr-[var(--ds-layout-gutter-lg)] sm:pl-[calc(var(--ds-layout-gutter-lg)_-_0.625rem)]',
            !topbarEnd && 'lg:hidden',
          )}
        >
          <IconButton
            label="Open navigation"
            icon={<Menu />}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="lg:hidden"
          />
          <div className="min-w-0 flex-1 lg:hidden">{brand}</div>
          {topbarEnd ? (
            <div className="ml-auto flex shrink-0 items-center gap-0.5 coarse:gap-3">
              {topbarEnd}
            </div>
          ) : null}
        </header>

        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  )
}

/**
 * The content column — UI Bible spec (Grid & Layout).
 *
 * Capped at --ds-layout-container (76rem) and centered: past that, more width
 * is more eye travel and no more information. The gutters are the layout's
 * own, 24px and 40px from 640px.
 *
 * `narrow` is a form or a settings page: about 44rem, so a label, its field
 * and its error stay in one span of the eye. It keeps the default column's
 * left edge, so a title does not jump sideways between a list and its
 * settings. `wide` gives up the cap, for a table that needs every column.
 *
 * Its children are 24px apart: a page header, then the page.
 */
export function Page({
  children,
  width = 'default',
  className,
}: {
  children: React.ReactNode
  width?: 'default' | 'narrow' | 'wide'
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'mx-auto w-full px-[var(--ds-layout-gutter)] pt-6 pb-[calc(4rem_+_env(safe-area-inset-bottom))] sm:px-[var(--ds-layout-gutter-lg)] sm:pt-8',
        width === 'wide' ? 'max-w-none' : 'max-w-[var(--ds-layout-container)]',
      )}
    >
      <div className={cn('flex flex-col gap-6', width === 'narrow' && 'max-w-[44rem]', className)}>
        {children}
      </div>
    </div>
  )
}

/**
 * The head of a page: its one h1, and the page's own verb beside it.
 *
 * The title is --text-h1 at every width — type does not shrink on a phone,
 * the layout narrows instead — and the actions drop under it where they no
 * longer fit beside it. The filled button of the view belongs here, last.
 *
 * `children` go under the title, 16px down: a row of Tabs, a filter bar.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  /** The way back up, over the title: `{ to: '/campaigns', label: 'Campaigns' }`. */
  back?: { to: string; label: string }
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        {back && (
          <Link
            to={back.to}
            className={cn(
              'touch-target -ml-1 inline-flex items-center gap-1.5 self-start rounded-[var(--radius-xs)] px-1 text-label text-[var(--ds-fg-muted)]',
              'transition-colors duration-[120ms] hover:text-[var(--ds-fg)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
            )}
          >
            <ArrowLeft size={14} aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="text-balance-ds text-h1 text-[var(--ds-fg)] [overflow-wrap:anywhere]">
              {title}
            </h1>
            {description && (
              <p className="max-w-[68ch] text-body text-[var(--ds-fg-muted)]">{description}</p>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 coarse:gap-3">{actions}</div>
          )}
        </div>
      </div>
      {children}
    </header>
  )
}
