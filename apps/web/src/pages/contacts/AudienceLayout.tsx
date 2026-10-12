import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Page, PageHeader } from '@/ui/Shell'
import { Tabs } from '@/ui/Tabs'

const TABS = [
  { value: 'lists', label: 'Lists' },
  { value: 'segments', label: 'Segments' },
  { value: 'tags', label: 'Tags' },
  { value: 'fields', label: 'Custom fields' },
  { value: 'suppression', label: 'Suppression list' },
  { value: 'duplicates', label: 'Duplicates' },
] as const

/** The ways of grouping contacts, and of keeping some from being emailed. Peers, so tabs. */
export function AudienceLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current =
    TABS.find((tab) => pathname.startsWith(`/audience/${tab.value}`))?.value ?? 'lists'
  return (
    <Page>
      <PageHeader
        title="Lists and segments"
        description="How your contacts are grouped, and which addresses are never emailed."
      >
        <Tabs
          aria-label="Audience sections"
          tabs={[...TABS]}
          value={current}
          onChange={(value) => navigate(`/audience/${value}`)}
        />
      </PageHeader>
      <Outlet />
    </Page>
  )
}
