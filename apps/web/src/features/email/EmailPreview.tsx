import * as React from 'react'
import { Monitor, Smartphone } from 'lucide-react'
import { formatAddress, renderMerge, sampleMergeData } from '@ariad/shared'
import { cn } from '@/lib/cn'
import { useSettings } from '@/lib/queries'
import { SegmentedControl } from '@/ui/Controls'

export type PreviewDevice = 'desktop' | 'mobile'

/**
 * The message as an inbox would show it.
 *
 * In a frame of its own, because an email's HTML is a whole document with its
 * own styles and must not meet the app's. Scripts are off — a mail client
 * would not run them either. The frame takes the height of what is in it, so
 * the page scrolls, not a window inside the page.
 */
export function EmailFrame({
  html,
  device,
  /** Merge tags are filled with sample values unless the HTML is already merged. */
  merged,
  className,
}: {
  html: string
  device: PreviewDevice
  merged?: boolean
  className?: string
}) {
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = React.useState(480)
  // Sample people, but the real organization: its name and address are known.
  const organization = useSettings().data?.organization
  const document = React.useMemo(() => {
    if (merged) return html
    const sample = sampleMergeData()
    return renderMerge(
      html,
      {
        ...sample,
        organization: organization?.name || sample.organization,
        address: (organization && formatAddress(organization)) || sample.address,
        unsubscribe_url: '#',
        preferences_url: '#',
        view_url: '#',
      },
      { html: true },
    )
  }, [html, merged, organization])

  const measure = React.useCallback(() => {
    const body = frame.current?.contentDocument?.body
    if (body) setHeight(Math.max(240, body.scrollHeight + 2))
  }, [])

  React.useEffect(() => {
    // Images arrive after `load` has fired for the document itself.
    const timers = [150, 600, 1500].map((delay) => window.setTimeout(measure, delay))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [document, device, measure])

  return (
    <div className={cn('flex justify-center overflow-hidden rounded-[var(--radius-lg)] border border-[var(--ds-border)] bg-[var(--c-email-stage)]', className)}>
      <iframe
        ref={frame}
        title="Email preview"
        // Same-origin so the height can be read; with no `allow-scripts`,
        // nothing in the email can run.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={document}
        onLoad={measure}
        className="block bg-white transition-[width] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]"
        style={{ width: device === 'mobile' ? 375 : '100%', maxWidth: '100%', height, border: 0 }}
      />
    </div>
  )
}

const DEVICES: { value: PreviewDevice; label: string }[] = [
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Phone' },
]

export function DeviceToggle({ value, onChange }: { value: PreviewDevice; onChange: (device: PreviewDevice) => void }) {
  return (
    <div className="flex items-center gap-2">
      {value === 'desktop' ? <Monitor size={15} aria-hidden className="text-[var(--ds-fg-muted)]" /> : <Smartphone size={15} aria-hidden className="text-[var(--ds-fg-muted)]" />}
      <SegmentedControl label="Preview size" value={value} onChange={onChange} options={DEVICES} className="w-44" />
    </div>
  )
}

/** A preview with its own desktop / phone switch. */
export function EmailPreview({ html, merged, subject, from }: { html: string; merged?: boolean; subject?: string; from?: string }) {
  const [device, setDevice] = React.useState<PreviewDevice>('desktop')
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* What the inbox list shows: who it is from, and the subject. */}
        <div className="flex min-w-0 flex-col gap-0.5">
          {from && <span className="truncate text-caption text-[var(--ds-fg-muted)]">{from}</span>}
          {subject !== undefined && (
            <span className="truncate text-label text-[var(--ds-fg)]">{subject || 'No subject yet'}</span>
          )}
        </div>
        <DeviceToggle value={device} onChange={setDevice} />
      </div>
      <EmailFrame html={html} device={device} merged={merged} />
    </div>
  )
}
