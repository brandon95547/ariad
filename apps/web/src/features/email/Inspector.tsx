import * as React from 'react'
import { Upload } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { BLOCK_TYPES, EMAIL_FONTS, type Align, type Block, type DesignTheme } from '@ariad/shared'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/ui/Button'
import { Field, SegmentedControl, Select, Switch } from '@/ui/Controls'
import { TextInput, Textarea } from '@/ui/Inputs'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'

/**
 * The panel beside the canvas. With a block selected it holds what cannot be
 * edited in place — an image's address, a button's link, an alignment. With
 * nothing selected it holds the look of the whole email.
 */
const ALIGN: { value: Align; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]

function AlignControl({ value, onChange }: { value: Align; onChange: (align: Align) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="block text-label text-[var(--ds-fg-secondary)]">Alignment</span>
      <SegmentedControl label="Alignment" value={value} onChange={onChange} options={ALIGN} />
    </div>
  )
}

function Panel({ title, children, onDone }: { title: string; children: React.ReactNode; onDone?: () => void }) {
  return (
    <Card padding="sm" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">{title}</h3>
        {onDone && (
          <Button size="xs" variant="text" onClick={onDone}>
            Done
          </Button>
        )}
      </div>
      {children}
    </Card>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
}

export function BlockInspector({
  block,
  onChange,
  onDone,
}: {
  block: Block
  onChange: (patch: Partial<Block>) => void
  onDone: () => void
}) {
  const title = BLOCK_TYPES.find((entry) => entry.type === block.type)?.label ?? 'Block'
  const file = React.useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: async (chosen: File) => api.post<{ url: string }>('/uploads', { filename: chosen.name, data: await readAsDataUrl(chosen) }),
    onSuccess: ({ url }) => onChange({ src: url }),
    onError: (error) => toast.error('The image was not uploaded', { description: errorMessage(error) }),
  })

  return (
    <Panel title={title} onDone={onDone}>
      {block.type === 'heading' && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="block text-label text-[var(--ds-fg-secondary)]">Size</span>
            <SegmentedControl
              label="Heading size"
              value={String(block.level) as '1' | '2' | '3'}
              onChange={(level) => onChange({ level: Number(level) as 1 | 2 | 3 })}
              options={[
                { value: '1', label: 'Large' },
                { value: '2', label: 'Medium' },
                { value: '3', label: 'Small' },
              ]}
            />
          </div>
          <AlignControl value={block.align} onChange={(align) => onChange({ align })} />
          <p className="text-caption text-[var(--ds-fg-muted)]">Type the heading on the email itself.</p>
        </>
      )}

      {block.type === 'text' && (
        <>
          <AlignControl value={block.align} onChange={(align) => onChange({ align })} />
          <p className="text-caption text-[var(--ds-fg-muted)]">
            Type on the email itself. Select words to make them bold, italic or a link, from the bar above the block.
          </p>
        </>
      )}

      {block.type === 'columns' && (
        <p className="text-caption text-[var(--ds-fg-muted)]">
          Type in either column on the email itself. On a phone the right column drops under the left.
        </p>
      )}

      {block.type === 'image' && (
        <>
          <Field label="Image address" hint="A link to an image on the web, or upload one.">
            <TextInput value={block.src} onChange={(event) => onChange({ src: event.target.value })} placeholder="https://" inputMode="url" spellCheck={false} />
          </Field>
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              if (chosen) upload.mutate(chosen)
              event.target.value = ''
            }}
          />
          <Button variant="outlined" size="sm" startIcon={<Upload />} loading={upload.isPending} onClick={() => file.current?.click()} className="self-start">
            Upload an image
          </Button>
          <Field label="Description" hint="Read aloud by screen readers, and shown when images are blocked.">
            <TextInput value={block.alt} onChange={(event) => onChange({ alt: event.target.value })} />
          </Field>
          <Field label="Link" optional hint="Where a click on the image goes.">
            <TextInput value={block.href} onChange={(event) => onChange({ href: event.target.value })} placeholder="https://" inputMode="url" spellCheck={false} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="block text-label text-[var(--ds-fg-secondary)]">Width</span>
            <SegmentedControl
              label="Image width"
              value={String(block.width) as '25' | '50' | '75' | '100'}
              onChange={(width) => onChange({ width: Number(width) })}
              options={[
                { value: '25', label: '25%' },
                { value: '50', label: '50%' },
                { value: '75', label: '75%' },
                { value: '100', label: 'Full' },
              ]}
            />
          </div>
          <AlignControl value={block.align} onChange={(align) => onChange({ align })} />
        </>
      )}

      {block.type === 'button' && (
        <>
          <Field label="Label">
            <TextInput value={block.label} onChange={(event) => onChange({ label: event.target.value })} />
          </Field>
          <Field label="Link">
            <TextInput value={block.href} onChange={(event) => onChange({ href: event.target.value })} placeholder="https://" inputMode="url" spellCheck={false} />
          </Field>
          <AlignControl value={block.align} onChange={(align) => onChange({ align })} />
          <Switch label="Full width" checked={block.fullWidth} onChange={(fullWidth) => onChange({ fullWidth })} />
        </>
      )}

      {block.type === 'spacer' && (
        <Field label="Height" hint="In pixels, 4 to 200.">
          <TextInput
            value={String(block.height)}
            inputMode="numeric"
            onChange={(event) => onChange({ height: Math.max(4, Math.min(200, Number(event.target.value.replace(/\D/g, '')) || 4)) })}
          />
        </Field>
      )}

      {block.type === 'divider' && <p className="text-caption text-[var(--ds-fg-muted)]">A thin rule. There is nothing to set.</p>}

      {block.type === 'html' && (
        <Field label="HTML" hint="Put in as written. Use inline styles: mail apps ignore stylesheets.">
          <Textarea mono rows={12} spellCheck={false} value={block.html} onChange={(event) => onChange({ html: event.target.value })} />
        </Field>
      )}
    </Panel>
  )
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = React.useId()
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="block text-label text-[var(--ds-fg-secondary)]">
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* The native picker, sized to the field it sits beside. */}
        <input
          type="color"
          aria-label={`${label} color picker`}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-[var(--radius-md)] border border-[var(--ds-border-interactive)] bg-[var(--ds-field)] p-1"
        />
        <TextInput id={id} value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} className="font-mono" />
      </div>
    </div>
  )
}

export function ThemeInspector({ theme, onChange }: { theme: DesignTheme; onChange: (patch: Partial<DesignTheme>) => void }) {
  return (
    <Panel title="Email style">
      <Field label="Font" htmlFor="email-theme-font">
        <Select
          id="email-theme-font"
          value={theme.font}
          onChange={(event) => onChange({ font: event.target.value })}
          options={EMAIL_FONTS.map((font) => ({ value: font.value, label: font.label }))}
        />
      </Field>
      <ColorField label="Buttons and links" value={theme.accent} onChange={(accent) => onChange({ accent })} />
      <ColorField label="Text" value={theme.text} onChange={(text) => onChange({ text })} />
      <ColorField label="Email background" value={theme.surface} onChange={(surface) => onChange({ surface })} />
      <ColorField label="Page background" value={theme.background} onChange={(background) => onChange({ background })} />
      <div className="flex flex-col gap-1.5">
        <span className="block text-label text-[var(--ds-fg-secondary)]">Corners</span>
        <SegmentedControl
          label="Corner radius"
          value={String(theme.radius) as '0' | '8' | '16'}
          onChange={(radius) => onChange({ radius: Number(radius) })}
          options={[
            { value: '0', label: 'Square' },
            { value: '8', label: 'Rounded' },
            { value: '16', label: 'Soft' },
          ]}
        />
      </div>
      <p className="text-caption text-[var(--ds-fg-muted)]">Select a block on the email to change it.</p>
    </Panel>
  )
}
