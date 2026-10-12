import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Code,
  Columns2,
  Copy,
  GripVertical,
  Heading1,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  Minus,
  MousePointerClick,
  MoveVertical,
  Pilcrow,
  Trash2,
} from 'lucide-react'
import {
  BLOCK_TYPES,
  createBlock,
  defaultDesign,
  renderBlock,
  renderDesign,
  safeTheme,
  type Block,
  type BlockType,
  type DesignTheme,
  type EmailDesign,
} from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/ui/Button'
import { SegmentedControl } from '@/ui/Controls'
import { TextInput, Textarea } from '@/ui/Inputs'
import { Popover } from '@/ui/Menu'
import { toast } from '@/ui/Toast'
import { BlockInspector, ThemeInspector } from './Inspector'
import { EmailPreview } from './EmailPreview'
import { MergeTagMenu } from './MergeTagMenu'
import { RichText, format, insertText, isEditingText, makeLink, restoreSelection, saveSelection } from './RichText'

/**
 * The email editor: a block builder, or hand-written HTML.
 *
 * Built: a column of blocks, dragged in from the palette or added with a
 * click, reordered by dragging or with the arrows, edited in place. What is
 * drawn on the canvas is the same markup `renderDesign` sends, so the canvas
 * is not an impression of the email, it is the email.
 *
 * Written by hand: a design is dropped and the HTML is yours. There is no way
 * back from that, and the switch says so.
 */
export interface EmailBody {
  html: string
  design: EmailDesign | null
}

const BLOCK_ICONS: Record<BlockType, React.ReactNode> = {
  heading: <Heading1 />,
  text: <Pilcrow />,
  image: <ImageIcon />,
  button: <MousePointerClick />,
  columns: <Columns2 />,
  divider: <Minus />,
  spacer: <MoveVertical />,
  html: <Code />,
}

const NEW_BLOCK = 'application/x-ariad-new'
const MOVE_BLOCK = 'application/x-ariad-move'

type View = 'edit' | 'preview'

export function EmailEditor({
  value,
  onChange,
  subject,
  preheader,
  toolbarEnd,
}: {
  value: EmailBody
  onChange: (next: EmailBody) => void
  /** Shown over the preview, and written into the document's title. */
  subject?: string
  preheader?: string | null
  /** Extra controls at the end of the editor's bar, e.g. "Start from a template". */
  toolbarEnd?: React.ReactNode
}) {
  const [view, setView] = React.useState<View>('edit')
  const [selected, setSelected] = React.useState<string | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const [confirm, setConfirm] = React.useState<'html' | 'builder' | null>(null)
  const canvas = React.useRef<HTMLDivElement>(null)

  const { design } = value
  const theme = React.useMemo(() => safeTheme(design?.theme ?? defaultDesign().theme), [design?.theme])

  const setDesign = (next: EmailDesign) => onChange({ design: next, html: renderDesign(next, { preheader, title: subject }) })
  const setBlocks = (blocks: Block[]) => design && setDesign({ ...design, blocks })

  const update = (id: string, patch: Partial<Block>) =>
    design && setBlocks(design.blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as Block) : block)))

  const insert = (type: BlockType, index?: number) => {
    if (!design) return
    const block = createBlock(type)
    const at = index ?? (selected ? design.blocks.findIndex((entry) => entry.id === selected) + 1 : design.blocks.length)
    setBlocks([...design.blocks.slice(0, at), block, ...design.blocks.slice(at)])
    setSelected(block.id)
  }

  const move = (id: string, to: number) => {
    if (!design) return
    const from = design.blocks.findIndex((block) => block.id === id)
    if (from === -1) return
    const without = design.blocks.filter((block) => block.id !== id)
    // Dropping below where it came from: the list is one shorter once it has left.
    const target = Math.max(0, Math.min(without.length, to > from ? to - 1 : to))
    without.splice(target, 0, design.blocks[from]!)
    setBlocks(without)
  }

  const remove = (id: string) => {
    if (!design) return
    setBlocks(design.blocks.filter((block) => block.id !== id))
    setSelected(null)
  }

  const duplicate = (id: string) => {
    if (!design) return
    const index = design.blocks.findIndex((block) => block.id === id)
    const source = design.blocks[index]
    if (!source) return
    const copy = { ...source, id: createBlock(source.type).id } as Block
    setBlocks([...design.blocks.slice(0, index + 1), copy, ...design.blocks.slice(index + 1)])
    setSelected(copy.id)
  }

  /* ---- Drag and drop ---------------------------------------------------- */

  const isOurs = (event: React.DragEvent) =>
    event.dataTransfer.types.includes(NEW_BLOCK) || event.dataTransfer.types.includes(MOVE_BLOCK)

  /** Which gap between blocks the pointer is over. */
  const indexAt = (clientY: number): number => {
    const blocks = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-block-id]') ?? [])]
    const after = blocks.findIndex((element) => {
      const box = element.getBoundingClientRect()
      return clientY < box.top + box.height / 2
    })
    return after === -1 ? blocks.length : after
  }

  const onDragOver = (event: React.DragEvent) => {
    if (!isOurs(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(MOVE_BLOCK) ? 'move' : 'copy'
    const index = indexAt(event.clientY)
    setDropIndex((current) => (current === index ? current : index))
  }

  const onDrop = (event: React.DragEvent) => {
    if (!isOurs(event)) return
    event.preventDefault()
    const index = indexAt(event.clientY)
    const fresh = event.dataTransfer.getData(NEW_BLOCK) as BlockType | ''
    const moved = event.dataTransfer.getData(MOVE_BLOCK)
    if (fresh) insert(fresh, index)
    else if (moved) move(moved, index)
    setDropIndex(null)
  }

  const selectedBlock = design?.blocks.find((block) => block.id === selected) ?? null

  /* ---- Hand-written HTML ------------------------------------------------ */

  if (!design) {
    return (
      <div className="flex flex-col gap-4">
        <EditorBar view={view} onView={setView}>
          {toolbarEnd}
          <Button size="sm" variant="text" onClick={() => setConfirm('builder')}>
            Use the builder instead
          </Button>
        </EditorBar>
        {view === 'preview' ? (
          <EmailPreview html={value.html} subject={subject} />
        ) : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email-html" className="block text-label text-[var(--ds-fg-secondary)]">
                HTML
              </label>
              <Textarea
                id="email-html"
                mono
                rows={26}
                spellCheck={false}
                value={value.html}
                onChange={(event) => onChange({ design: null, html: event.target.value })}
                placeholder="<html>…</html>"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-[var(--ds-fg-muted)]">
                  The unsubscribe link and your mailing address are added to the bottom when it is sent.
                </p>
                <MergeTagMenu
                  onPick={(token) => {
                    void navigator.clipboard?.writeText(token)
                    toast.info(`Copied ${token}`, { description: 'Paste it where the value should appear.' })
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="block text-label text-[var(--ds-fg-secondary)]">Preview</span>
              <EmailPreview html={value.html} />
            </div>
          </div>
        )}
        <ConfirmDialog
          open={confirm === 'builder'}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setDesign(defaultDesign())
            setConfirm(null)
          }}
          title="Start over in the builder?"
          confirmLabel="Replace my HTML"
        >
          <p>The builder cannot read hand-written HTML, so it starts from a blank design and the HTML you have now is replaced.</p>
        </ConfirmDialog>
      </div>
    )
  }

  /* ---- Builder ---------------------------------------------------------- */

  return (
    <div className="flex flex-col gap-4">
      <EditorBar view={view} onView={setView}>
        {toolbarEnd}
        <Button size="sm" variant="text" startIcon={<Code />} onClick={() => setConfirm('html')}>
          Edit as HTML
        </Button>
      </EditorBar>

      {view === 'preview' ? (
        <EmailPreview html={renderDesign(design, { preheader, title: subject })} subject={subject} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[11rem_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,1fr)_17rem]">
          {/* Palette */}
          <div className="flex flex-col gap-1.5 lg:sticky lg:top-4">
            <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Add a block</h3>
            <ul className="scrollbar-none flex gap-1.5 overflow-x-auto lg:flex-col lg:overflow-visible">
              {BLOCK_TYPES.map((entry) => (
                <li key={entry.type} className="shrink-0">
                  <button
                    type="button"
                    draggable
                    title={entry.description}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(NEW_BLOCK, entry.type)
                      event.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDragEnd={() => setDropIndex(null)}
                    onClick={() => insert(entry.type)}
                    className={cn(
                      'touch-target flex h-9 w-full cursor-grab items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--ds-border-interactive)] px-3 text-label text-[var(--ds-fg-secondary)] whitespace-nowrap',
                      'transition-colors duration-[120ms] hover:border-[var(--ds-border-strong)] hover:bg-[var(--ds-layer-hover)] hover:text-[var(--ds-fg)] active:cursor-grabbing',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-ring)]',
                    )}
                  >
                    <span className="text-[var(--ds-fg-muted)] [&>svg]:size-[15px]" aria-hidden>
                      {BLOCK_ICONS[entry.type]}
                    </span>
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-caption text-[var(--ds-fg-muted)] max-lg:hidden">Drag a block onto the email, or click to add it under the selected one.</p>
          </div>

          {/* Canvas */}
          <div
            className="email-stage min-w-0 rounded-[var(--radius-lg)] border border-[var(--ds-border)] px-3 py-7 sm:px-6"
            style={{ background: theme.background }}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelected(null)
            }}
          >
            <div
              ref={canvas}
              className="email-canvas relative mx-auto"
              style={
                {
                  maxWidth: theme.width,
                  background: theme.surface,
                  borderRadius: theme.radius,
                  padding: '32px 0 18px',
                  '--email-accent': theme.accent,
                  '--email-text': theme.text,
                } as React.CSSProperties
              }
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null)
              }}
            >
              {design.blocks.length === 0 && (
                <p className="px-8 py-10 text-center" style={{ color: theme.muted, fontFamily: theme.font, fontSize: 15 }}>
                  This email is empty. Drag a block here, or click one to add it.
                </p>
              )}
              {design.blocks.map((block, index) => (
                <React.Fragment key={block.id}>
                  {dropIndex === index && <DropLine />}
                  <CanvasBlock
                    block={block}
                    theme={theme}
                    selected={block.id === selected}
                    first={index === 0}
                    last={index === design.blocks.length - 1}
                    onSelect={() => setSelected(block.id)}
                    onChange={(patch) => update(block.id, patch)}
                    onMove={(delta) => move(block.id, delta < 0 ? index - 1 : index + 2)}
                    onDuplicate={() => duplicate(block.id)}
                    onRemove={() => remove(block.id)}
                    onDragEnd={() => setDropIndex(null)}
                  />
                </React.Fragment>
              ))}
              {dropIndex === design.blocks.length && design.blocks.length > 0 && <DropLine />}
            </div>
            <p className="mx-auto mt-4 text-center text-caption" style={{ maxWidth: theme.width, color: theme.muted }}>
              Your organization, mailing address and an unsubscribe link are added here when it is sent.
            </p>
          </div>

          {/* Inspector */}
          <div className="flex flex-col gap-4 lg:col-span-2 xl:sticky xl:top-4 xl:col-span-1">
            {selectedBlock ? (
              <BlockInspector block={selectedBlock} onChange={(patch) => update(selectedBlock.id, patch)} onDone={() => setSelected(null)} />
            ) : (
              <ThemeInspector theme={design.theme} onChange={(patch) => setDesign({ ...design, theme: { ...design.theme, ...patch } })} />
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm === 'html'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          onChange({ design: null, html: renderDesign(design, { preheader, title: subject }) })
          setConfirm(null)
        }}
        title="Edit this email as HTML?"
        confirmLabel="Switch to HTML"
        danger={false}
      >
        <p>
          You get the HTML this design produces, to change as you like. The builder cannot read it back afterwards, so this is one way:
          returning to the builder means starting a new design.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function EditorBar({ view, onView, children }: { view: View; onView: (view: View) => void; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <SegmentedControl
        label="Editor view"
        value={view}
        onChange={onView}
        options={[
          { value: 'edit', label: 'Edit' },
          { value: 'preview', label: 'Preview' },
        ]}
        className="w-44"
      />
      <div className="flex flex-wrap items-center gap-2 coarse:gap-3">{children}</div>
    </div>
  )
}

/** Where a dragged block will land. */
function DropLine() {
  return (
    <div className="pointer-events-none relative h-0" aria-hidden>
      <div className="absolute inset-x-4 -top-px h-0.5 rounded-full bg-[var(--ds-accent)] shadow-[0_0_0_3px_var(--ds-accent-subtle)]" />
    </div>
  )
}

function CanvasBlock({
  block,
  theme,
  selected,
  first,
  last,
  onSelect,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
  onDragEnd,
}: {
  block: Block
  theme: DesignTheme
  selected: boolean
  first: boolean
  last: boolean
  onSelect: () => void
  onChange: (patch: Partial<Block>) => void
  onMove: (delta: -1 | 1) => void
  onDuplicate: () => void
  onRemove: () => void
  onDragEnd: () => void
}) {
  const element = React.useRef<HTMLDivElement>(null)
  const label = BLOCK_TYPES.find((entry) => entry.type === block.type)?.label ?? 'Block'
  const editable = block.type === 'text' || block.type === 'columns'
  const body: React.CSSProperties = { fontFamily: theme.font, fontSize: 16, lineHeight: 1.6, color: theme.text }

  return (
    <div
      ref={element}
      data-block-id={block.id}
      data-selected={selected || undefined}
      className="email-block group/block relative"
      onClick={onSelect}
    >
      {selected && (
        <div
          role="toolbar"
          aria-label={`${label} block`}
          // An app control laid over the email: it wears the app's surface, not the email's.
          className="absolute -top-10 right-2 z-10 flex items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--ds-border)] bg-[var(--ds-surface-overlay)] p-0.5 shadow-e3 coarse:gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          <span
            draggable
            role="img"
            aria-label="Drag to move"
            title="Drag to move"
            onDragStart={(event) => {
              event.dataTransfer.setData(MOVE_BLOCK, block.id)
              event.dataTransfer.effectAllowed = 'move'
              if (element.current) event.dataTransfer.setDragImage(element.current, 24, 16)
            }}
            onDragEnd={onDragEnd}
            className="grid h-7 w-6 cursor-grab place-items-center text-[var(--ds-fg-muted)] hover:text-[var(--ds-fg)] active:cursor-grabbing"
          >
            <GripVertical size={14} aria-hidden />
          </span>
          {editable && <TextTools />}
          <IconButton size="xs" label="Move up" icon={<ArrowUp />} onClick={() => onMove(-1)} disabled={first} />
          <IconButton size="xs" label="Move down" icon={<ArrowDown />} onClick={() => onMove(1)} disabled={last} />
          <IconButton size="xs" label="Duplicate" icon={<Copy />} onClick={onDuplicate} />
          <IconButton size="xs" label="Delete block" icon={<Trash2 />} onClick={onRemove} className="text-[var(--ds-danger-text)]" />
        </div>
      )}

      {block.type === 'heading' && (
        <div style={{ padding: '0 32px 14px', textAlign: block.align }}>
          <RichText
            plain
            aria-label="Heading"
            value={block.text}
            onChange={(text) => onChange({ text })}
            onFocus={onSelect}
            style={{ fontFamily: theme.font, fontSize: { 1: 28, 2: 22, 3: 18 }[block.level], lineHeight: 1.25, fontWeight: 700, color: theme.text }}
          />
        </div>
      )}

      {block.type === 'text' && (
        <div style={{ padding: '0 32px', textAlign: block.align }}>
          <RichText aria-label="Text" className="email-rich" value={block.html} onChange={(html) => onChange({ html })} onFocus={onSelect} style={body} />
        </div>
      )}

      {block.type === 'columns' && (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2" style={{ padding: '0 32px' }}>
          <RichText aria-label="Left column" className="email-rich" value={block.left} onChange={(left) => onChange({ left })} onFocus={onSelect} style={body} />
          <RichText aria-label="Right column" className="email-rich" value={block.right} onChange={(right) => onChange({ right })} onFocus={onSelect} style={body} />
        </div>
      )}

      {block.type === 'image' && !block.src && (
        <div style={{ padding: '0 32px 16px' }}>
          <div
            className="grid h-36 place-items-center rounded-[8px] border border-dashed text-center"
            style={{ borderColor: theme.muted, color: theme.muted, fontFamily: theme.font, fontSize: 14 }}
          >
            <span className="flex flex-col items-center gap-2">
              <ImageIcon size={22} aria-hidden />
              Choose an image in the panel
            </span>
          </div>
        </div>
      )}

      {/* Everything not edited in place is drawn from the markup that is sent. */}
      {(block.type === 'button' || block.type === 'divider' || block.type === 'spacer' || block.type === 'html' || (block.type === 'image' && block.src)) && (
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          // Links and buttons inside the canvas select the block; they do not navigate.
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest('a')) event.preventDefault()
          }}
        >
          <tbody dangerouslySetInnerHTML={{ __html: renderBlock(block, theme) }} />
        </table>
      )}
    </div>
  )
}

/** Bold, italic, link, list and merge tags for the text being edited. */
function TextTools() {
  const [linking, setLinking] = React.useState(false)
  const [url, setUrl] = React.useState('https://')
  const range = React.useRef<Range | null>(null)
  const trigger = React.useRef<HTMLButtonElement>(null)
  // Pressing a tool must not take the caret out of the text it acts on.
  const keep = (event: React.MouseEvent) => event.preventDefault()

  const apply = () => {
    restoreSelection(range.current)
    if (url.trim() && url.trim() !== 'https://') makeLink(url.trim())
    setLinking(false)
  }

  return (
    <>
      <IconButton size="xs" label="Bold" icon={<Bold />} onMouseDown={keep} onClick={() => format('bold')} />
      <IconButton size="xs" label="Italic" icon={<Italic />} onMouseDown={keep} onClick={() => format('italic')} />
      <IconButton size="xs" label="Bulleted list" icon={<List />} onMouseDown={keep} onClick={() => format('insertUnorderedList')} />
      <IconButton
        ref={trigger}
        size="xs"
        label="Link"
        icon={<LinkIcon />}
        onMouseDown={keep}
        onClick={() => {
          if (!isEditingText()) {
            toast.info('Select some text first', { description: 'Then press Link to turn it into one.' })
            return
          }
          range.current = saveSelection()
          setUrl('https://')
          setLinking(true)
        }}
      />
      <Popover open={linking} onClose={() => setLinking(false)} anchorRef={trigger} align="end" label="Add a link">
        <form
          className="flex w-72 max-w-full flex-col gap-3 p-3"
          onSubmit={(event) => {
            event.preventDefault()
            apply()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email-link-url" className="block text-label text-[var(--ds-fg-secondary)]">
              Link address
            </label>
            <TextInput id="email-link-url" value={url} onChange={(event) => setUrl(event.target.value)} autoFocus inputMode="url" spellCheck={false} />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="text"
              onClick={() => {
                restoreSelection(range.current)
                format('unlink')
                setLinking(false)
              }}
            >
              Remove link
            </Button>
            <Button size="sm" type="submit" variant="tonal">
              Apply
            </Button>
          </div>
        </form>
      </Popover>
      <MergeTagMenu
        iconOnly
        size="xs"
        variant="text"
        onOpen={() => {
          range.current = isEditingText() ? saveSelection() : null
        }}
        onPick={(token) => {
          if (range.current) {
            restoreSelection(range.current)
            insertText(token)
          } else {
            void navigator.clipboard?.writeText(token)
            toast.info(`Copied ${token}`, { description: 'Click where it should go and paste.' })
          }
        }}
      />
      <span className="mx-0.5 h-4 w-px bg-[var(--ds-border)]" aria-hidden />
    </>
  )
}
