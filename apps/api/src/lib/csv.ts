/**
 * CSV, read and written by hand.
 *
 * The files people import come out of spreadsheets, CRMs and other mailing
 * tools, so this accepts what those actually produce: a byte-order mark,
 * CRLF or LF line ends, semicolons or tabs instead of commas, quoted fields
 * with commas and line breaks inside them, and `""` for a literal quote.
 */
export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  delimiter: string
}

/** Whichever of , ; tab | splits the first line into the most columns. */
function sniffDelimiter(firstLine: string): string {
  let best = ','
  let bestCount = 0
  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0
    let quoted = false
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted
      else if (char === candidate && !quoted) count += 1
    }
    if (count > bestCount) {
      best = candidate
      bestCount = count
    }
  }
  return best
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const firstBreak = text.search(/\r?\n/)
  const delimiter = sniffDelimiter(firstBreak === -1 ? text : text.slice(0, firstBreak))

  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      record.push(field)
      field = ''
      records.push(record)
      record = []
    } else {
      field += char
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  // Blank lines, and the row of bare delimiters a spreadsheet leaves at the end.
  const filled = records.filter((row) => row.some((cell) => cell.trim() !== ''))
  const [headers = [], ...rows] = filled
  return { headers: headers.map((header) => header.trim()), rows, delimiter }
}

/**
 * A cell that starts with = + - or @ is run as a formula by Excel and Sheets.
 * In an export of other people's data that is an injection, so those cells are
 * written as text.
 */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
