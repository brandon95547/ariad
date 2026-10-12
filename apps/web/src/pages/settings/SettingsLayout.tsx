import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { roleAtLeast } from '@ariad/shared'
import { useAuthState } from '@/lib/queries'
import { Page, PageHeader } from '@/ui/Shell'
import { Tabs } from '@/ui/Tabs'

const TABS = [
  { value: 'sending', label: 'Sending accounts', admin: false },
  { value: 'organization', label: 'Organization', admin: false },
  { value: 'domains', label: 'Domains', admin: false },
  { value: 'team', label: 'Team', admin: true },
  { value: 'api-keys', label: 'API keys', admin: true },
  { value: 'logs', label: 'System logs', admin: true },
  { value: 'profile', label: 'Your profile', admin: false },
] as const

/** Settings is one page with peers, so it is tabs, and each tab is an address. */
export function SettingsLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const role = useAuthState().data?.user?.role ?? 'viewer'
  const tabs = TABS.filter((tab) => !tab.admin || roleAtLeast(role, 'admin'))
  const current =
    tabs.find((tab) => pathname.startsWith(`/settings/${tab.value}`))?.value ?? 'sending'

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Sending accounts, your organization's details, and who can sign in."
      >
        <Tabs
          aria-label="Settings sections"
          tabs={tabs.map(({ value, label }) => ({ value, label }))}
          value={current}
          onChange={(value) => navigate(`/settings/${value}`)}
        />
      </PageHeader>
      <Outlet />
    </Page>
  )
}
