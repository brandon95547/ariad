import * as React from 'react'

/**
 * Editable text, in place on the email canvas.
 *
 * A contentEditable region rather than a rich-text library: an email body
 * needs bold, italic, links and lists, and nothing a library would add
 * survives an inbox anyway. The DOM is the source of truth while typing —
 * React only writes into it when the value arrives from somewhere else, which
 * is what keeps the caret where the person left it.
 */
export interface RichTextHandle {
  focus: () => void
}

export const RichText = React.forwardRef<
  RichTextHandle,
  {
    /** HTML, or plain text when `plain` is set. */
    value: string
    onChange: (value: string) => void
    /** One line of plain text: a heading. No formatting, no line breaks. */
    plain?: boolean
    'aria-label': string
    className?: string
    style?: React.CSSProperties
    onFocus?: () => void
  }
>(function RichText({ value, onChange, plain, className, style, onFocus, 'aria-label': ariaLabel }, ref) {
  const element = React.useRef<HTMLDivElement>(null)

  React.useImperativeHandle(ref, () => ({ focus: () => element.current?.focus() }), [])

  React.useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    if (plain) {
      if (node.textContent !== value) node.textContent = value
    } else if (node.innerHTML !== value) {
      node.innerHTML = value
    }
  }, [value, plain])

  const emit = () => {
    const node = element.current
    if (node) onChange(plain ? (node.textContent ?? '') : node.innerHTML)
  }

  return (
    <div
      ref={element}
      role="textbox"
      aria-multiline={!plain}
      aria-label={ariaLabel}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      className={className}
      style={{ outline: 'none', minHeight: '1.6em', overflowWrap: 'anywhere', ...style }}
      onFocus={onFocus}
      onInput={emit}
      onBlur={emit}
      onKeyDown={(event) => {
        if (plain && event.key === 'Enter') event.preventDefault()
      }}
      // Pasted as plain text. What comes off a web page or out of Word carries
      // fonts, colors and nested spans that look fine here and fall apart in
      // an inbox.
      onPaste={(event) => {
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, plain ? text.replace(/\s*\n\s*/g, ' ') : text)
      }}
      // A dragged block must not be dropped into the text as its id.
      onDrop={(event) => {
        if ([...event.dataTransfer.types].some((type) => type.startsWith('application/x-ariad'))) event.preventDefault()
      }}
    />
  )
})

/** The selection inside an editable region, kept while a popover takes the focus. */
export function saveSelection(): Range | null {
  const selection = window.getSelection()
  return selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null
}

export function restoreSelection(range: Range | null): void {
  if (!range) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/** True when the caret is inside an editable region on the canvas. */
export function isEditingText(): boolean {
  const node = window.getSelection()?.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  return Boolean(element?.closest('[contenteditable="true"]'))
}

/**
 * `execCommand` is deprecated and has no replacement; every browser still
 * implements it, and it is the only way to keep the edit on the undo stack.
 */
export function format(command: 'bold' | 'italic' | 'insertUnorderedList' | 'unlink'): void {
  document.execCommand(command)
}

export function insertText(text: string): void {
  document.execCommand('insertText', false, text)
}

export function makeLink(url: string): void {
  const selection = window.getSelection()
  if (selection && selection.isCollapsed) {
    // Nothing selected: the address becomes its own link text.
    document.execCommand('insertHTML', false, `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`)
  } else {
    document.execCommand('createLink', false, url)
  }
}
