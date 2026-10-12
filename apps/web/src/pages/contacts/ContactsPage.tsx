import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, ListMinus, ListPlus, MoreHorizontal, Plus, Search, SlidersHorizontal, Tag as TagIcon, Trash2, Upload, UserMinus, Users, X } from 'lucide-react'
import { API_PREFIX, CONTACT_STATUSES, CONTACT_STATUS_LABELS, type Contact, type ContactStatus, type Paged } from '@ariad/shared'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { api, errorMessage, qs } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber, formatRelative, plural } from '@/lib/format'
import { useMediaQuery } from '@/lib/hooks'
import { keys, useInvalidate, useLists, useSegments, useTags } from '@/lib/queries'
import { cn } from '@/lib/cn'
import { Button, IconButton } from '@/ui/Button'
import { Field, Select, type SelectOption } from '@/ui/Controls'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog } from '@/ui/Dialog'
import { Chip } from '@/ui/Display'
import { Drawer } from '@/ui/Drawer'
import { Banner, EmptyState } from '@/ui/Feedback'
import { SearchInput } from '@/ui/Inputs'
import { ActionMenu, type MenuAction } from '@/ui/Menu'
import { Pagination } from '@/ui/Pagination'
import { Page, PageHeader } from '@/ui/Shell'
import { Card } from '@/ui/Surface'
import { toast } from '@/ui/Toast'
import { AddContactDialog } from './AddContactDialog'
import { StatusBadge, TagDot, contactKeys, useCan, withCurrent } from './parts'

const PAGE_SIZE = 25
/** As many ids as one bulk request takes, and as "select all matching" returns. */
const BULK_LIMIT = 5000

const SORTS = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'name_asc', label: 'Name, A to Z' },
  { value: 'email_asc', label: 'Email, A to Z' },
  { value: 'email_desc', label: 'Email, Z to A' },
  { value: 'activity_desc', label: 'Recently active' },
] as const
type Sort = (typeof SORTS)[number]['value']

type BulkAction = 'add_tag' | 'remove_tag' | 'add_to_list' | 'remove_from_list' | 'unsubscribe' | 'delete'

const PICKERS: Record<Exclude<BulkAction, 'unsubscribe' | 'delete'>, { title: (count: string) => string; confirm: string; note?: string }> = {
  add_tag: {
    title: (count) => `Add a tag to ${count}`,
    confirm: 'Add tag',
    note: 'Any automation that runs when this tag is added starts for each of them.',
  },
  remove_tag: { title: (count) => `Remove a tag from ${count}`, confirm: 'Remove tag' },
  add_to_list: {
    title: (count) => `Add ${count} to a list`,
    confirm: 'Add to list',
    note: 'They are subscribed to the list right away, and any automation that runs when someone joins it starts for each of them.',
  },
  remove_from_list: { title: (count) => `Remove ${count} from a list`, confirm: 'Remove from list' },
}

function lastActivity(contact: Contact): { verb: string; at: string } | null {
  const events = [
    { verb: 'Clicked', at: contact.lastClickedAt },
    { verb: 'Opened', at: contact.lastOpenedAt },
    { verb: 'Emailed', at: contact.lastSentAt },
  ].filter((event): event is { verb: string; at: string } => Boolean(event.at))
  return events.sort((a, b) => (a.at < b.at ? 1 : -1))[0] ?? null
}

const COLUMNS: Column<Contact>[] = [
  {
    key: 'contact',
    header: 'Contact',
    // The whole of what the other columns leave, and no more: a zero max-width
    // lets the cell shrink under its text, so a long address is cut short and
    // the table is not made wide.
    // From `lg`, where the tags and lists join it, never under 11rem: where
    // the rest will not fit beside that, the table scrolls inside its card and
    // the name stays readable.
    width: '100%',
    className: 'max-w-0 lg:min-w-[11rem]',
    cell: (contact) => {
      const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
      return (
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-label text-[var(--ds-fg)]">{name || contact.email}</span>
          {name && <span className="truncate text-caption text-[var(--ds-fg-muted)]">{contact.email}</span>}
        </div>
      )
    },
  },
  { key: 'status', header: 'Status', cell: (contact) => <StatusBadge status={contact.status} /> },
  {
    key: 'tags',
    header: 'Tags',
    hideBelow: 'lg',
    cell: (contact) =>
      contact.tags.length === 0 ? null : (
        <div className="flex min-w-[10rem] flex-wrap items-center gap-1">
          {contact.tags.slice(0, 3).map((tag) => (
            <Chip key={tag.id} icon={<TagDot color={tag.color} />}>
              {tag.name}
            </Chip>
          ))}
          {contact.tags.length > 3 && (
            <span className="px-1 text-caption text-[var(--ds-fg-muted)]" title={contact.tags.slice(3).map((tag) => tag.name).join(', ')}>
              +{contact.tags.length - 3}
            </span>
          )}
        </div>
      ),
  },
  {
    key: 'lists',
    header: 'Lists',
    align: 'right',
    hideBelow: 'lg',
    cell: (contact) => {
      const on = contact.lists.filter((membership) => membership.status !== 'unsubscribed')
      return (
        <span data-tabular title={on.map((membership) => membership.name).join(', ') || undefined}>
          {formatNumber(on.length)}
        </span>
      )
    },
  },
  {
    key: 'activity',
    header: 'Last activity',
    hideBelow: 'md',
    className: 'whitespace-nowrap',
    cell: (contact) => {
      const last = lastActivity(contact)
      return last ? (
        <span title={formatDateTime(last.at)}>
          {last.verb} {formatRelative(last.at)}
        </span>
      ) : (
        <span className="text-[var(--ds-fg-muted)]">None yet</span>
      )
    },
  },
  { key: 'added', header: 'Added', hideBelow: 'sm', className: 'whitespace-nowrap', cell: (contact) => formatDate(contact.createdAt) },
]

/**
 * Contacts. Everyone Ariad knows about, found by search and by filter, and
 * changed a row or a selection at a time. The filters and the page live in the
 * address, so a filtered view can be linked to and Back returns to it.
 */
export function ContactsPage() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canEdit = useCan('editor')
  const inlineFilters = useMediaQuery('(min-width: 84rem)')
  const roomForActions = useMediaQuery('(min-width: 40rem)')
  const roomForBulk = useMediaQuery('(min-width: 64rem)')
  const [params, setParams] = useSearchParams()
  const lists = useLists()
  const tags = useTags()
  const segments = useSegments()

  const status = CONTACT_STATUSES.find((value) => value === params.get('status')) ?? ''
  const sort: Sort = SORTS.find((option) => option.value === params.get('sort'))?.value ?? 'created_desc'
  const q = params.get('q') ?? ''
  const listId = params.get('listId') ?? ''
  const tagId = params.get('tagId') ?? ''
  const segmentId = params.get('segmentId') ?? ''
  const page = Math.max(1, Math.floor(Number(params.get('page'))) || 1)

  const filters = useMemo(() => ({ q, status, listId, tagId, segmentId }), [q, status, listId, tagId, segmentId])
  const activeFilters = [status, listId, tagId, segmentId].filter(Boolean).length
  const filtered = activeFilters > 0 || q !== ''

  /** Changing what is shown starts again from the first page; typing in the search does not add to the history. */
  const update = (changes: Record<string, string | number>, replace = false) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (!('page' in changes)) next.delete('page')
        for (const [key, value] of Object.entries(changes)) {
          if (value === '' || value === 1 || value === 'created_desc') next.delete(key)
          else next.set(key, String(value))
        }
        return next
      },
      { replace },
    )
  }
  const clearFilters = () => update({ q: '', status: '', listId: '', tagId: '', segmentId: '' })

  const [search, setSearch] = useState(q)
  const typed = useRef(q)
  useEffect(() => {
    if (search === q) return
    const timer = window.setTimeout(() => {
      typed.current = search
      update({ q: search.trim() }, true)
    }, 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
  // Back, Forward and "Clear filters" change the address from outside the field.
  useEffect(() => {
    if (q !== typed.current.trim()) {
      typed.current = q
      setSearch(q)
    }
  }, [q])

  const contacts = useQuery({
    queryKey: contactKeys.list({ ...filters, sort, page }),
    queryFn: ({ signal }) => api.get<Paged<Contact>>(`/contacts${qs({ ...filters, sort, page, pageSize: PAGE_SIZE })}`, { signal }),
    placeholderData: keepPreviousData,
  })
  const rows = contacts.data?.items ?? []
  const total = contacts.data?.total ?? 0
  const noContactsAtAll = contacts.isSuccess && !contacts.isPlaceholderData && total === 0 && !filtered

  // A page past the end, after a delete or from an old link, falls back to the last one.
  useEffect(() => {
    if (contacts.isSuccess && !contacts.isPlaceholderData && rows.length === 0 && total > 0) {
      update({ page: Math.ceil(total / PAGE_SIZE) }, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts.isSuccess, contacts.isPlaceholderData, rows.length, total])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bulk, setBulk] = useState<BulkAction | null>(null)
  const [pick, setPick] = useState('')
  const [pickMissing, setPickMissing] = useState(false)
  const pickId = useId()

  // What is selected was selected from one set of results. Another set starts clean.
  useEffect(() => setSelected(new Set()), [filters])

  const selectAll = useMutation({
    mutationFn: () => api.get<{ ids: string[] }>(`/contacts/ids${qs(filters)}`),
    onSuccess: ({ ids }) => setSelected(new Set(ids)),
    onError: (error) => toast.error(errorMessage(error)),
  })

  const runBulk = useMutation({
    mutationFn: (action: BulkAction) =>
      api.post<{ affected: number }>('/contacts/bulk', {
        ids: [...selected],
        action,
        tagId: action === 'add_tag' || action === 'remove_tag' ? pick : undefined,
        listId: action === 'add_to_list' || action === 'remove_from_list' ? pick : undefined,
      }),
    onSuccess: ({ affected }, action) => {
      const people = plural(affected, 'contact')
      const tagName = tags.data?.find((tag) => tag.id === pick)?.name ?? 'the tag'
      const listName = lists.data?.find((list) => list.id === pick)?.name ?? 'the list'
      toast.success(
        {
          add_tag: `${people} tagged ${tagName}`,
          remove_tag: `${tagName} removed from ${people}`,
          add_to_list: `${people} added to ${listName}`,
          remove_from_list: `${people} removed from ${listName}`,
          unsubscribe: `${people} unsubscribed`,
          delete: `${people} deleted`,
        }[action],
      )
      setBulk(null)
      setSelected(new Set())
      void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
    },
  })

  const openBulk = (action: BulkAction) => {
    runBulk.reset()
    setPick('')
    setPickMissing(false)
    setBulk(action)
  }

  const count = selected.size
  const people = plural(count, 'contact')
  const pageSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const reachable = Math.min(total, BULK_LIMIT)
  const offerAll = pageSelected && total > rows.length && count < reachable

  const exportHref = `${API_PREFIX}/contacts/export${qs(filters)}`
  const download = () => window.location.assign(exportHref)

  const listOptions = (lists.data ?? []).map((list) => ({ value: list.id, label: list.name }))
  const tagOptions = (tags.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))
  const segmentOptions = (segments.data ?? []).map((segment) => ({ value: segment.id, label: segment.name }))

  const filterSelects: { key: string; label: string; value: string; options: SelectOption[]; width: string }[] = [
    {
      key: 'status',
      label: 'Status',
      value: status,
      width: 'w-[9.5rem]',
      options: [{ value: '', label: 'All statuses' }, ...CONTACT_STATUSES.map((value: ContactStatus) => ({ value, label: CONTACT_STATUS_LABELS[value] }))],
    },
    {
      key: 'listId',
      label: 'List',
      value: listId,
      width: 'w-[9.5rem]',
      options: withCurrent([{ value: '', label: 'All lists' }, ...listOptions], lists.isSuccess ? listId : '', 'A deleted list'),
    },
    {
      key: 'tagId',
      label: 'Tag',
      value: tagId,
      width: 'w-[8.5rem]',
      options: withCurrent([{ value: '', label: 'All tags' }, ...tagOptions], tags.isSuccess ? tagId : '', 'A deleted tag'),
    },
    {
      key: 'segmentId',
      label: 'Segment',
      value: segmentId,
      width: 'w-[10rem]',
      options: withCurrent([{ value: '', label: 'All segments' }, ...segmentOptions], segments.isSuccess ? segmentId : '', 'A deleted segment'),
    },
    { key: 'sort', label: 'Sort by', value: sort, width: 'w-[10rem]', options: [...SORTS] },
  ]

  const searchField = (
    <SearchInput value={search} onChange={setSearch} placeholder="Search contacts…" aria-label="Search contacts by name, email or company" className="min-w-0 flex-1" />
  )

  const bulkMenu: MenuAction[] = [
    { id: 'add_tag', label: 'Add tag', icon: <TagIcon size={14} />, onSelect: () => openBulk('add_tag') },
    { id: 'remove_tag', label: 'Remove tag', icon: <TagIcon size={14} />, onSelect: () => openBulk('remove_tag') },
    { id: 'add_to_list', label: 'Add to list', icon: <ListPlus size={14} />, onSelect: () => openBulk('add_to_list'), separated: true },
    { id: 'remove_from_list', label: 'Remove from list', icon: <ListMinus size={14} />, onSelect: () => openBulk('remove_from_list') },
    { id: 'unsubscribe', label: 'Unsubscribe', icon: <UserMinus size={14} />, onSelect: () => openBulk('unsubscribe'), separated: true },
    { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, onSelect: () => openBulk('delete'), danger: true },
  ]

  const picker = bulk && bulk !== 'unsubscribe' && bulk !== 'delete' ? PICKERS[bulk] : null
  const pickingTag = bulk === 'add_tag' || bulk === 'remove_tag'
  const pickOptions = pickingTag ? tagOptions : listOptions

  return (
    <Page>
      <PageHeader
        title="Contacts"
        description="Everyone you email, and everyone who has unsubscribed."
        actions={
          noContactsAtAll ? undefined : !canEdit ? (
            <Button variant="outlined" startIcon={<Download />} onClick={download}>
              Export
            </Button>
          ) : roomForActions ? (
            <>
              <Button variant="outlined" startIcon={<Upload />} onClick={() => navigate('/contacts/import')}>
                Import
              </Button>
              <Button variant="outlined" startIcon={<Download />} onClick={download}>
                Export
              </Button>
              <Button startIcon={<Plus />} onClick={() => setAdding(true)}>
                Add contact
              </Button>
            </>
          ) : (
            <>
              <Button startIcon={<Plus />} onClick={() => setAdding(true)}>
                Add contact
              </Button>
              <ActionMenu
                label="More contact actions"
                icon={<MoreHorizontal size={16} />}
                actions={[
                  { id: 'import', label: 'Import', icon: <Upload size={14} />, onSelect: () => navigate('/contacts/import') },
                  { id: 'export', label: 'Export', icon: <Download size={14} />, onSelect: download },
                ]}
              />
            </>
          )
        }
      />

      {noContactsAtAll ? (
        <Card padding="none">
          <EmptyState
            icon={<Users />}
            title="No contacts yet"
            description={
              canEdit
                ? 'Import a spreadsheet of the people who have agreed to hear from you, or add them one at a time.'
                : 'Nobody has been added yet. An editor can import a file or add contacts by hand.'
            }
            action={
              canEdit ? (
                <>
                  <Button startIcon={<Upload />} onClick={() => navigate('/contacts/import')}>
                    Import contacts
                  </Button>
                  <Button variant="text" onClick={() => setAdding(true)}>
                    Add contact
                  </Button>
                </>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {/* The bulk bar takes the filters' place and their height, so the row just ticked stays under the pointer. */}
          <div className="grid">
            <div className={cn('col-start-1 row-start-1 flex flex-wrap items-center gap-2', count > 0 && 'invisible')}>
              {searchField}
              {inlineFilters ? (
                filterSelects.map((filter) => (
                  <div key={filter.key} className={filter.width}>
                    <Select
                      aria-label={filter.label}
                      value={filter.value}
                      options={filter.options}
                      onChange={(event) => update({ [filter.key]: event.target.value })}
                    />
                  </div>
                ))
              ) : (
                <Button variant="outlined" startIcon={<SlidersHorizontal />} onClick={() => setFiltersOpen(true)}>
                  {activeFilters > 0 ? `Filters · ${activeFilters}` : 'Filters'}
                </Button>
              )}
            </div>

            {count > 0 && (
              <div className="col-start-1 row-start-1 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 self-start rounded-[var(--radius-md)] bg-[var(--ds-accent-subtle)] py-0.5 pr-0.5 pl-3">
                <span aria-live="polite" data-tabular className="text-label text-[var(--ds-accent-text)]">
                  {formatNumber(count)} selected
                </span>
                {offerAll && (
                  <Button size="xs" variant="text" onClick={() => selectAll.mutate()} loading={selectAll.isPending}>
                    {total > BULK_LIMIT ? `Select the first ${formatNumber(BULK_LIMIT)} matching` : `Select all ${formatNumber(total)} matching`}
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-1 coarse:gap-3">
                  {roomForBulk ? (
                    <>
                      <Button size="xs" variant="text" startIcon={<TagIcon />} onClick={() => openBulk('add_tag')}>
                        Add tag
                      </Button>
                      <Button size="xs" variant="text" startIcon={<ListPlus />} onClick={() => openBulk('add_to_list')}>
                        Add to list
                      </Button>
                      <Button size="xs" variant="text" startIcon={<UserMinus />} onClick={() => openBulk('unsubscribe')}>
                        Unsubscribe
                      </Button>
                      <Button size="xs" variant="danger-outline" startIcon={<Trash2 />} onClick={() => openBulk('delete')}>
                        Delete
                      </Button>
                      <ActionMenu
                        label="More actions for the selection"
                        icon={<MoreHorizontal size={16} />}
                        actions={bulkMenu.filter((action) => action.id === 'remove_tag' || action.id === 'remove_from_list').map((action) => ({ ...action, separated: false }))}
                      />
                    </>
                  ) : (
                    <ActionMenu label="Actions for the selection" icon={<MoreHorizontal size={16} />} actions={bulkMenu} />
                  )}
                  <IconButton label="Clear selection" icon={<X />} size="sm" onClick={() => setSelected(new Set())} />
                </div>
              </div>
            )}
          </div>

          {contacts.isError && (
            <Banner
              tone="danger"
              actions={
                <>
                  <Button size="sm" variant="outlined" onClick={() => contacts.refetch()} loading={contacts.isFetching}>
                    Try again
                  </Button>
                  {filtered && (
                    <Button size="sm" variant="text" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  )}
                </>
              }
            >
              {errorMessage(contacts.error)}
            </Banner>
          )}

          {!(contacts.isError && rows.length === 0) && (
            <>
              <Card padding="none" className="overflow-hidden">
                <DataTable
                  aria-label="Contacts"
                  gutter="md"
                  columns={COLUMNS}
                  rows={rows}
                  rowKey={(contact) => contact.id}
                  rowLabel={(contact) => contact.email}
                  loading={contacts.isPending || contacts.isPlaceholderData}
                  skeletonRows={8}
                  selection={canEdit ? { selected, onChange: setSelected } : undefined}
                  onRowClick={(contact) => navigate(`/contacts/${contact.id}`)}
                  empty={
                    <EmptyState
                      compact
                      icon={<Search size={18} />}
                      title="No contacts match"
                      description={q ? `Nothing matches “${q}”${activeFilters > 0 ? ' with these filters' : ''}.` : 'Nobody fits these filters.'}
                      action={
                        <Button size="sm" variant="outlined" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      }
                    />
                  }
                />
              </Card>
              {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={(next) => update({ page: next })} />}
            </>
          )}
        </div>
      )}

      <Drawer
        open={filtersOpen && !inlineFilters}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        description={contacts.isSuccess ? `${plural(total, 'contact')} shown` : undefined}
        footer={
          <>
            <Button variant="text" onClick={clearFilters} disabled={!filtered}>
              Clear filters
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          {filterSelects.map((filter) => (
            <Field key={filter.key} label={filter.label} htmlFor={`contacts-filter-${filter.key}`}>
              <Select
                id={`contacts-filter-${filter.key}`}
                value={filter.value}
                options={filter.options}
                onChange={(event) => update({ [filter.key]: event.target.value })}
              />
            </Field>
          ))}
        </div>
      </Drawer>

      <AddContactDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(contact) => {
          setAdding(false)
          void invalidate(contactKeys.all, keys.lists, keys.tags, keys.segments)
          toast.success(`${contact.email} added`, { action: { label: 'View', onClick: () => navigate(`/contacts/${contact.id}`) } })
        }}
      />

      <Dialog
        open={picker !== null}
        onClose={() => setBulk(null)}
        title={picker?.title(people) ?? ''}
        size="sm"
        footer={
          <>
            <Button variant="text" onClick={() => setBulk(null)} disabled={runBulk.isPending}>
              Cancel
            </Button>
            <Button onClick={() => (pick && bulk ? runBulk.mutate(bulk) : setPickMissing(true))} loading={runBulk.isPending}>
              {picker?.confirm}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field
            label={pickingTag ? 'Tag' : 'List'}
            htmlFor={pickId}
            hint={picker?.note}
            error={pickMissing && !pick ? (pickingTag ? 'Choose a tag.' : 'Choose a list.') : undefined}
          >
            <Select
              id={pickId}
              value={pick}
              onChange={(event) => setPick(event.target.value)}
              options={[{ value: '', label: pickingTag ? 'Choose a tag' : 'Choose a list' }, ...pickOptions]}
            />
          </Field>
          {pickOptions.length === 0 && (
            <p className="text-body-sm text-[var(--ds-fg-muted)]">
              {pickingTag ? 'There are no tags yet. Make one under Lists and segments, then come back.' : 'There are no lists yet. Make one under Lists and segments, then come back.'}
            </p>
          )}
          {runBulk.isError && <Banner tone="danger">{errorMessage(runBulk.error)}</Banner>}
        </div>
      </Dialog>

      <ConfirmDialog
        open={bulk === 'unsubscribe'}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk.mutate('unsubscribe')}
        title={`Unsubscribe ${people}?`}
        confirmLabel={`Unsubscribe ${people}`}
        loading={runBulk.isPending}
      >
        <p>
          They stop getting all email from you. Anything waiting to send to them is canceled, any automation they are in ends, and their addresses go
          on the suppression list so an import cannot add them back by mistake.
        </p>
        {runBulk.isError && <Banner tone="danger">{errorMessage(runBulk.error)}</Banner>}
      </ConfirmDialog>

      <ConfirmDialog
        open={bulk === 'delete'}
        onClose={() => setBulk(null)}
        onConfirm={() => runBulk.mutate('delete')}
        title={`Delete ${people}?`}
        confirmLabel={`Delete ${people}`}
        loading={runBulk.isPending}
      >
        <p>
          This removes them and their history for good. Anyone who had unsubscribed stays on the suppression list, so they still will not be emailed.
        </p>
        {runBulk.isError && <Banner tone="danger">{errorMessage(runBulk.error)}</Banner>}
      </ConfirmDialog>
    </Page>
  )
}
