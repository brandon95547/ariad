import * as React from 'react'
import { AlertCircle, FileText, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'

/* ===========================================================================
   FILE DROP — UI Bible spec (File Upload).

   A dashed zone that is really a label around a file input. That is the whole
   accessibility story: a press opens the platform's picker, Enter and Space
   open it from the keyboard, and a finger gets the sheet with the camera and
   the files in it — none of which a div with a drop handler can be made to
   do. Dragging is the extra, never the only way in.

   Dashed, because dashed is what a drop target looks like; a solid border
   reads as a container and nobody drags onto it. It is an outline with
   nothing in it: this is a control, and a control is not a well cut into the
   surface it stands on. Over it with a file, the border and the fill change
   together — one alone is easy to miss with a file hanging off the pointer.

   What it takes is said up front in `hint`, not found out by being refused.
   A dropped file of the wrong kind is refused in words that say why.

   One file. It hands the file over and keeps nothing but its name to show.
   ======================================================================== */

/** Whether a file is one of the kinds an `accept` string lists: `.csv`, `text/csv`, `image/*`. */
function accepts(file: File, accept: string | undefined) {
  if (!accept) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((part) => {
      if (part.startsWith('.')) return name.endsWith(part)
      if (part.endsWith('/*')) return type.startsWith(part.slice(0, -1))
      return type === part
    })
}

function sizeOf(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileDrop({
  accept,
  onFile,
  title,
  hint,
  disabled,
  className,
}: {
  /** As on a file input: `.csv,text/csv`. Checked on a drop as well. */
  accept?: string
  onFile: (file: File) => void
  /** What is being asked for: "Upload your contacts". */
  title?: string
  /** What is accepted and how big: "CSV, up to 10 MB". Always shown. */
  hint?: string
  disabled?: boolean
  className?: string
}) {
  const [over, setOver] = React.useState(false)
  const [picked, setPicked] = React.useState<{ name: string; size: number } | null>(null)
  const [refusal, setRefusal] = React.useState<string | null>(null)
  const baseId = React.useId()
  const nameId = `${baseId}-name`
  const hintId = `${baseId}-hint`
  const statusId = `${baseId}-status`

  const take = (file: File | undefined) => {
    if (!file) return
    if (!accepts(file, accept)) {
      setPicked(null)
      setRefusal(`${file.name} is not a file type that can be used here.${hint ? ` ${hint}.` : ''}`)
      return
    }
    setRefusal(null)
    setPicked({ name: file.name, size: file.size })
    onFile(file)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragOver={(event) => {
          // Without this the browser opens the file in place of the page.
          event.preventDefault()
          if (!disabled) setOver(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          if (!disabled) take(event.dataTransfer.files[0])
        }}
        className={cn(
          'flex min-h-24 flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed px-6 py-6 text-center',
          'transition-[background-color,border-color] duration-[120ms] ease-[cubic-bezier(0.2,0,0,1)]',
          'has-[input:focus-visible]:border-[var(--ds-accent)] has-[input:focus-visible]:shadow-[0_0_0_3px_var(--ds-accent-subtle)]',
          disabled
            ? 'cursor-not-allowed border-[var(--ds-border-strong)] opacity-50'
            : over
              ? 'cursor-copy border-[var(--ds-accent)] bg-[var(--ds-accent-subtle)]'
              : 'cursor-pointer border-[var(--ds-border-strong)] hover:border-[var(--ds-fg-disabled)] hover:bg-[var(--ds-layer-hover)]',
        )}
      >
        <input
          type="file"
          accept={accept}
          disabled={disabled}
          // Named by one line, not by everything the zone says: the label
          // wraps the hint and the chosen file too, and they are descriptions.
          aria-labelledby={nameId}
          aria-describedby={[hint ? hintId : null, statusId].filter(Boolean).join(' ')}
          className="sr-only-ds"
          onChange={(event) => {
            take(event.target.files?.[0])
            // Emptied, so choosing the same file again is still a change.
            event.target.value = ''
          }}
        />
        <span aria-hidden className="text-[var(--ds-fg-muted)]" style={{ lineHeight: 0 }}>
          {picked ? <FileText size={20} /> : <Upload size={20} />}
        </span>
        <span className="flex flex-col">
          {title && (
            <span id={nameId} className="mb-1 text-label text-[var(--ds-fg)]">
              {title}
            </span>
          )}
          <span id={title ? undefined : nameId} className="text-body-sm text-[var(--ds-fg-secondary)]">
            <span className="font-medium text-[var(--ds-accent-text)]">
              {picked ? 'Choose another file' : 'Choose a file'}
            </span>
            {/* Nothing to drag with a finger. */}
            <span className="coarse:hidden"> or drag it here</span>
          </span>
          {hint && (
            <span id={hintId} className="mt-1 text-caption text-[var(--ds-fg-muted)]">
              {hint}
            </span>
          )}
          {/* In the page from the start, so the file's name is said when it lands. */}
          <span id={statusId} role="status" className="text-caption not-empty:mt-1">
            {picked ? (
              <>
                <span className="[overflow-wrap:anywhere] text-[var(--ds-fg)]">{picked.name}</span>
                <span data-tabular className="text-[var(--ds-fg-muted)]">
                  {' '}
                  · {sizeOf(picked.size)}
                </span>
              </>
            ) : null}
          </span>
        </span>
      </label>

      {refusal && (
        <p role="alert" className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]">
          <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="[overflow-wrap:anywhere]">{refusal}</span>
        </p>
      )}
    </div>
  )
}
