import { useId, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, Check, Upload } from 'lucide-react'
import { IMPORT_TARGETS, type CustomField, type ImportSummary } from '@ariad/shared'
import { ApiError, api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatNumber, plural } from '@/lib/format'
import { keys, useFields, useInvalidate, useLists, useTags } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Field, Select, Switch } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Banner } from '@/ui/Feedback'
import { FileDrop } from '@/ui/FileDrop'
import { Checkbox, RadioGroup, TextInput, Textarea } from '@/ui/Inputs'
import { MultiSelect } from '@/ui/MultiSelect'
import { Page, PageHeader } from '@/ui/Shell'
import { StatTile } from '@/ui/Stat'
import { Card } from '@/ui/Surface'
import { contactKeys, useCan } from './parts'

const BACK = { to: '/contacts', label: 'Contacts' }
const STEPS = ['File', 'Columns', 'Options'] as const
/** The server takes 25 million characters. A file is refused here a little under that, in words, before it is read. */
const MAX_BYTES = 20 * 1024 * 1024

type NewStatus = 'subscribed' | 'pending' | 'unsubscribed'

interface Preview {
  headers: string[]
  /** The first few rows, for the sample values under each column. */
  samples: string[][]
  rowCount: number
}

/**
 * Reads the header row and a few rows of samples, and counts the rest.
 *
 * The server does the real parsing, from the same text. This follows its rules
 * exactly (a byte-order mark, the delimiter that splits the first line most,
 * quoted fields, blank lines dropped, header names trimmed), because the
 * mapping is sent by header name and a name read differently here would match
 * nothing there.
 */
function previewCsv(input: string, keep = 3): Preview {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const firstBreak = text.search(/\r?\n/)
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak)

  let delimiter = ','
  let most = 0
  for (const candidate of [',', ';', '\t', '|']) {
    let count = 0
    let quoted = false
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted
      else if (char === candidate && !quoted) count += 1
    }
    if (count > most) {
      delimiter = candidate
      most = count
    }
  }

  const kept: string[][] = []
  let filled = 0
  let record: string[] = []
  let field = ''
  let quoted = false
  const endRecord = () => {
    record.push(field)
    field = ''
    if (record.some((cell) => cell.trim() !== '')) {
      if (kept.length <= keep) kept.push(record)
      filled += 1
    }
    record = []
  }

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (quoted) {
      if (char !== '"') field += char
      else if (text[i + 1] === '"') {
        field += '"'
        i += 1
      } else quoted = false
    } else if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      record.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      endRecord()
    } else {
      field += char
    }
  }
  if (field !== '' || record.length > 0) endRecord()

  const [headers = [], ...samples] = kept
  return {
    headers: headers.map((header) => header.trim()),
    samples,
    rowCount: Math.max(0, filled - 1),
  }
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')

const GUESSES: Record<string, string> = {
  email: 'email',
  emailaddress: 'email',
  mail: 'email',
  emails: 'email',
  firstname: 'firstName',
  fname: 'firstName',
  first: 'firstName',
  givenname: 'firstName',
  forename: 'firstName',
  lastname: 'lastName',
  lname: 'lastName',
  last: 'lastName',
  surname: 'lastName',
  familyname: 'lastName',
  name: 'fullName',
  fullname: 'fullName',
  contactname: 'fullName',
  company: 'company',
  companyname: 'company',
  organization: 'company',
  organisation: 'company',
  business: 'company',
  employer: 'company',
  phone: 'phone',
  phonenumber: 'phone',
  mobile: 'phone',
  cell: 'phone',
  telephone: 'phone',
  tel: 'phone',
  birthday: 'birthday',
  birthdate: 'birthday',
  dateofbirth: 'birthday',
  dob: 'birthday',
  tags: 'tags',
  tag: 'tags',
  labels: 'tags',
}

/** What each column most likely is, from its header. Only the first email-looking column is taken as the email. */
function guessMapping(
  headers: readonly string[],
  fields: readonly CustomField[],
): Record<string, string> {
  const mapping: Record<string, string> = {}
  let hasEmail = false
  for (const header of headers) {
    if (header in mapping) continue
    const key = squash(header)
    const custom = fields.find((field) => squash(field.key) === key || squash(field.label) === key)
    let target = GUESSES[key] ?? (custom ? `custom.${custom.key}` : 'skip')
    if (target === 'email') {
      if (hasEmail) target = 'skip'
      hasEmail = true
    }
    mapping[header] = target
  }
  return mapping
}

/**
 * Contacts › Import. A file of people, taken in three steps: the file, which
 * column is what, and what to do with them. Then what happened, row by row
 * where a row could not be used.
 */
export function ImportPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const lists = useLists()
  const tags = useTags()
  const fields = useFields()
  const consentId = useId()

  const [step, setStep] = useState(0)
  const [csv, setCsv] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [pasted, setPasted] = useState('')
  /** Remounts the drop zone, which keeps the name of the last file itself. */
  const [dropKey, setDropKey] = useState(0)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [listIds, setListIds] = useState<string[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [updateExisting, setUpdateExisting] = useState(true)
  const [status, setStatus] = useState<NewStatus>('subscribed')
  const [consent, setConsent] = useState(false)
  const [consentSource, setConsentSource] = useState('')
  const [checked, setChecked] = useState(false)
  const [summary, setSummary] = useState<ImportSummary | null>(null)

  const preview = useMemo(() => (csv ? previewCsv(csv) : null), [csv])
  const emailMapped = Object.values(mapping).includes('email')

  const run = useMutation({
    mutationFn: () =>
      api.post<ImportSummary>('/contacts/import', {
        csv,
        mapping,
        listIds,
        tagIds,
        updateExisting,
        status,
        consentSource: consentSource.trim() || (fileName ? `Imported from ${fileName}` : undefined),
        consentConfirmed: consent,
      }),
    onSuccess: (result) => {
      setSummary(result)
      void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
    },
  })

  const targetOptions = [
    ...IMPORT_TARGETS.map((target) => ({
      value: target.key as string,
      label: target.label as string,
    })),
    ...(fields.data ?? []).map((field) => ({ value: `custom.${field.key}`, label: field.label })),
  ]

  const takeFile = async (file: File) => {
    setPasted('')
    if (file.size > MAX_BYTES) {
      setCsv('')
      setFileName(null)
      setFileError(
        `${file.name} is too big to import in one go. Split it into files of under 20 MB each.`,
      )
      return
    }
    try {
      const text = await file.text()
      setCsv(text)
      setFileName(file.name)
      setFileError(null)
    } catch {
      setCsv('')
      setFileName(null)
      setFileError(`${file.name} could not be read. Save it again as a CSV file and choose that.`)
    }
  }

  const toColumns = () => {
    if (!preview || preview.headers.length === 0 || preview.rowCount === 0) {
      setFileError(
        !csv.trim()
          ? 'Choose a file, or paste some rows, first.'
          : 'There is a header row here and nothing under it. The first line names the columns, and each line after it is one contact.',
      )
      return
    }
    setFileError(null)
    setMapping(guessMapping(preview.headers, fields.data ?? []))
    setChecked(false)
    setStep(1)
  }

  const setTarget = (header: string, target: string) =>
    setMapping((current) => {
      const next = { ...current, [header]: target }
      // One column is the email. Choosing another gives up the first.
      if (target === 'email')
        for (const other of Object.keys(next))
          if (other !== header && next[other] === 'email') next[other] = 'skip'
      return next
    })

  const startOver = () => {
    run.reset()
    setSummary(null)
    setCsv('')
    setFileName(null)
    setPasted('')
    setDropKey((key) => key + 1)
    setFileError(null)
    setConsent(false)
    setChecked(false)
    setStep(0)
  }

  if (!canEdit) {
    return (
      <Page width="narrow">
        <PageHeader title="Import contacts" back={BACK} />
        <Banner tone="info" title="Only editors can import">
          Your account can look at contacts but not add them. Ask an admin to make you an editor.
        </Banner>
      </Page>
    )
  }

  if (summary) {
    return (
      <Page width="narrow">
        <PageHeader
          title="Import finished"
          back={BACK}
          description={`${plural(summary.total, 'row')} read${fileName ? ` from ${fileName}` : ''}.`}
        />
        <ImportResult summary={summary} updated={updateExisting} />
        <div className="flex flex-wrap items-center gap-2 coarse:gap-3">
          <Button onClick={() => navigate('/contacts')}>View contacts</Button>
          <Button variant="outlined" onClick={startOver}>
            Import another file
          </Button>
        </div>
      </Page>
    )
  }

  const importing =
    preview?.headers.filter((header) => (mapping[header] ?? 'skip') !== 'skip').length ?? 0
  const general =
    run.isError && !(run.error instanceof ApiError && run.error.fields.consentConfirmed)
      ? errorMessage(run.error)
      : null

  return (
    <Page width="narrow">
      <PageHeader
        title="Import contacts"
        back={BACK}
        description="Bring in a spreadsheet of people who have agreed to hear from you."
      />

      <ol className="flex w-full max-w-md items-start">
        {STEPS.map((label, index) => {
          const state = index < step ? 'done' : index === step ? 'current' : 'todo'
          return (
            <li key={label} className="relative flex flex-1 flex-col items-center gap-2">
              {index > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-[11px] right-1/2 h-px w-full',
                    state === 'todo' ? 'bg-[var(--ds-border-subtle)]' : 'bg-[var(--ds-accent)]',
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative z-10 grid h-[23px] w-[23px] place-items-center rounded-full border text-overline tracking-normal',
                  state === 'done'
                    ? 'border-[var(--ds-accent)] bg-[var(--ds-accent)] text-[var(--ds-accent-fg)]'
                    : state === 'current'
                      ? 'border-[var(--ds-accent)] bg-[var(--ds-canvas)] text-[var(--ds-accent-text)]'
                      : 'border-[var(--ds-border)] bg-[var(--ds-canvas)] text-[var(--ds-fg-muted)]',
                )}
              >
                {state === 'done' ? <Check size={13} /> : index + 1}
              </span>
              <span
                className={cn(
                  'text-caption',
                  state === 'todo' ? 'text-[var(--ds-fg-muted)]' : 'text-[var(--ds-fg)]',
                )}
              >
                {label}
              </span>
              {state === 'current' && (
                <span className="sr-only-ds" aria-current="step">
                  Current step
                </span>
              )}
            </li>
          )
        })}
      </ol>

      {step === 0 && (
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-h4 text-[var(--ds-fg)]">Choose the file</h2>
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              A CSV file with one contact on each line and the column names on the first. Any
              spreadsheet can save one, and so can other email tools.
            </p>
          </div>
          <FileDrop
            key={dropKey}
            accept=".csv,text/csv,.txt"
            hint="CSV or text, up to 20 MB"
            onFile={(file) => void takeFile(file)}
          />
          <Field
            label="Or paste the rows here"
            hint="Include the first line with the column names."
          >
            <Textarea
              mono
              rows={5}
              value={pasted}
              spellCheck={false}
              placeholder={'email,first name,last name\njane@example.com,Jane,Doe'}
              onChange={(event) => {
                setPasted(event.target.value)
                setCsv(event.target.value)
                setFileError(null)
                if (fileName) {
                  setFileName(null)
                  setDropKey((key) => key + 1)
                }
              }}
            />
          </Field>
          {fileError && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
            >
              <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
              <span className="[overflow-wrap:anywhere]">{fileError}</span>
            </p>
          )}
          {preview && preview.rowCount > 0 && !fileError && (
            <p className="text-body-sm text-[var(--ds-fg-secondary)]" role="status">
              {fileName ? `${fileName}: ` : ''}
              {plural(preview.rowCount, 'row')} and {plural(preview.headers.length, 'column')}{' '}
              found.
            </p>
          )}
          <div className="flex items-center gap-3 border-t border-[var(--ds-border-subtle)] pt-5">
            <Button endIcon={<ArrowRight />} onClick={toColumns}>
              Continue
            </Button>
          </div>
        </Card>
      )}

      {step === 1 && preview && (
        <Card padding="none" className="overflow-hidden">
          <div className="flex flex-col gap-1 p-5">
            <h2 className="text-h4 text-[var(--ds-fg)]">Match the columns</h2>
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              Say what each column of your file holds. {plural(preview.rowCount, 'row')},{' '}
              {plural(preview.headers.length, 'column')}: {formatNumber(importing)} to import,{' '}
              {formatNumber(preview.headers.length - importing)} left out.
            </p>
          </div>
          <ul>
            {preview.headers.map((header, index) => {
              const target = mapping[header] ?? 'skip'
              const repeat = preview.headers.indexOf(header) !== index
              const samples = preview.samples
                .map((row) => (row[index] ?? '').trim())
                .filter(Boolean)
              const selectId = `import-column-${index}`
              return (
                <li
                  key={index}
                  className="flex flex-col gap-2 border-t border-[var(--ds-border-subtle)] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <label
                      htmlFor={selectId}
                      className={cn(
                        'text-label [overflow-wrap:anywhere]',
                        target === 'skip' ? 'text-[var(--ds-fg-secondary)]' : 'text-[var(--ds-fg)]',
                      )}
                    >
                      {header || `Column ${index + 1} (no name)`}
                    </label>
                    <span className="truncate text-caption text-[var(--ds-fg-muted)]">
                      {repeat
                        ? 'Another column has this name. The two are imported the same way.'
                        : samples.length > 0
                          ? samples.join(' · ')
                          : 'Empty in the first rows'}
                    </span>
                  </div>
                  <div className="w-full shrink-0 sm:w-[17rem]">
                    <Select
                      id={selectId}
                      value={target}
                      onChange={(event) => setTarget(header, event.target.value)}
                      options={targetOptions}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] p-5">
            {checked && !emailMapped && (
              <p
                role="alert"
                className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
              >
                <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
                <span>
                  Choose which column holds the email address. Without one there is nobody to
                  import.
                </span>
              </p>
            )}
            <div className="flex items-center gap-3">
              <Button
                endIcon={<ArrowRight />}
                onClick={() => {
                  if (!emailMapped) {
                    setChecked(true)
                    return
                  }
                  setChecked(false)
                  setStep(2)
                }}
              >
                Continue
              </Button>
              <Button variant="text" startIcon={<ArrowLeft />} onClick={() => setStep(0)}>
                Back
              </Button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && preview && (
        <Card className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-h4 text-[var(--ds-fg)]">What to do with them</h2>
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              {plural(preview.rowCount, 'row')} from {fileName ?? 'what you pasted'}. The same
              address twice in the file becomes one contact.
            </p>
          </div>
          {general && <Banner tone="danger">{general}</Banner>}

          <RadioGroup<NewStatus>
            label="Status for new contacts"
            value={status}
            onChange={setStatus}
            options={[
              {
                value: 'subscribed',
                label: 'Subscribed',
                description: 'They can be emailed right away.',
              },
              {
                value: 'pending',
                label: 'Pending',
                description:
                  'On file, but not emailed. Nothing is sent to ask them to confirm, so use this while you still need their permission.',
              },
              {
                value: 'unsubscribed',
                label: 'Unsubscribed',
                description:
                  'On file so they are never emailed. For an opt-out list from another tool.',
              },
            ]}
          />
          {status !== 'unsubscribed' && (
            <Field
              label="Add to lists"
              optional
              hint="Nobody gets a welcome email for being imported: automations do not start."
            >
              <MultiSelect
                options={(lists.data ?? []).map((list) => ({
                  value: list.id,
                  label: list.name,
                  hint: formatNumber(list.subscribedCount),
                }))}
                value={listIds}
                onChange={setListIds}
                placeholder="Choose lists…"
                emptyText={lists.data?.length === 0 ? 'No lists yet' : 'No matches'}
              />
            </Field>
          )}
          <Field
            label="Add tags"
            optional
            hint="On top of any tags a column of the file gives them."
          >
            <MultiSelect
              options={(tags.data ?? []).map((tag) => ({
                value: tag.id,
                label: tag.name,
                hint: formatNumber(tag.contactCount),
              }))}
              value={tagIds}
              onChange={setTagIds}
              placeholder="Choose tags…"
              emptyText={tags.data?.length === 0 ? 'No tags yet' : 'No matches'}
            />
          </Field>
          <Switch
            label="Update contacts that already exist"
            description="Where the file has a value, it replaces what is saved. Off, the file only fills in what is blank. Either way nobody who unsubscribed is subscribed again."
            checked={updateExisting}
            onChange={setUpdateExisting}
          />

          {/* Bringing people in as unsubscribed claims no permission, so none is asked for. */}
          {status !== 'unsubscribed' && (
            <div className="flex flex-col gap-4 border-t border-[var(--ds-border-subtle)] pt-5">
              <h3 className="text-overline text-[var(--ds-fg-muted)] uppercase">Consent</h3>
              <div className="flex flex-col gap-1.5">
                <Checkbox
                  id={consentId}
                  checked={consent}
                  onChange={setConsent}
                  label="These people agreed to receive email from us."
                  description="Anti-spam and privacy law require permission before marketing email is sent. Ariad keeps your statement with each contact as the record of it, and will not import without it."
                />
                {((checked && !consent) ||
                  (run.error instanceof ApiError &&
                    run.error.fields.consentConfirmed &&
                    !consent)) && (
                  <p
                    role="alert"
                    className="flex items-start gap-1.5 text-caption text-[var(--ds-danger-text)]"
                  >
                    <AlertCircle size={13} aria-hidden className="mt-0.5 shrink-0" />
                    <span>Tick this to confirm before importing.</span>
                  </p>
                )}
              </div>
              {status === 'subscribed' && (
                <Field
                  label="How they agreed"
                  optional
                  hint="Kept on each contact. For example: signed up at the spring trade show."
                >
                  <TextInput
                    value={consentSource}
                    onChange={(event) => setConsentSource(event.target.value)}
                    maxLength={200}
                  />
                </Field>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-[var(--ds-border-subtle)] pt-5">
            <Button
              startIcon={<Upload />}
              loading={run.isPending}
              onClick={() => {
                if (!consent && status !== 'unsubscribed') {
                  setChecked(true)
                  return
                }
                run.mutate()
              }}
            >
              Import {plural(preview.rowCount, 'row')}
            </Button>
            <Button
              variant="text"
              startIcon={<ArrowLeft />}
              onClick={() => setStep(1)}
              disabled={run.isPending}
            >
              Back
            </Button>
            {run.isPending && (
              <span className="text-caption text-[var(--ds-fg-muted)]">
                A big file takes a few seconds.
              </span>
            )}
          </div>
        </Card>
      )}
    </Page>
  )
}

type InvalidRow = ImportSummary['invalid'][number]

const INVALID_COLUMNS: Column<InvalidRow>[] = [
  {
    key: 'row',
    header: 'Row',
    align: 'right',
    width: '1%',
    cell: (row) => <span data-tabular>{formatNumber(row.row)}</span>,
  },
  {
    key: 'value',
    header: 'What the file has',
    cell: (row) =>
      row.value ? (
        <span className="[overflow-wrap:anywhere] text-[var(--ds-fg)]">{row.value}</span>
      ) : (
        <span className="text-[var(--ds-fg-muted)]">Nothing</span>
      ),
  },
  { key: 'reason', header: 'Why it was left out', cell: (row) => row.reason },
]

/** What an import did: four counts, then each row that could not be used, with its line in the file. */
function ImportResult({ summary, updated }: { summary: ImportSummary; updated: boolean }) {
  const invalid = summary.invalid.length
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatTile label="New contacts" value={formatNumber(summary.created)} />
        <StatTile
          label={updated ? 'Updated' : 'Already contacts'}
          value={formatNumber(summary.updated)}
          hint={
            updated
              ? 'Already contacts. The file replaced what was saved.'
              : 'Only their blank details were filled in.'
          }
        />
        <StatTile
          label="Repeated in the file"
          value={formatNumber(summary.duplicatesInFile)}
          hint="The same address more than once, folded into one contact."
        />
        <StatTile
          label="Kept unsubscribed"
          value={formatNumber(summary.suppressed)}
          hint="Unsubscribed, bounced or on the suppression list. Not subscribed again."
        />
      </div>

      {invalid === 0 ? (
        <Banner tone="success">Every row had an email address that could be used.</Banner>
      ) : (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-h4 text-[var(--ds-fg)]">
              {invalid >= 200
                ? 'The first 200 rows that were left out'
                : `${plural(invalid, 'row')} left out`}
            </h2>
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              Row 1 is the header, and blank lines are not counted. Fix these in the file and import
              it again: contacts already in are not doubled.
            </p>
          </div>
          <Card padding="none" className="overflow-hidden">
            <DataTable
              aria-label="Rows that were left out"
              gutter="md"
              columns={INVALID_COLUMNS}
              rows={summary.invalid}
              rowKey={(row) => String(row.row)}
            />
          </Card>
        </section>
      )}
    </>
  )
}
