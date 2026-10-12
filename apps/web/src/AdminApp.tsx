import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Megaphone,
  Settings,
  UserRound,
  Users,
  Workflow,
} from 'lucide-react'
import { ROLE_LABELS, type User } from '@ariad/shared'
import { Brand } from '@/components/Brand'
import { api, errorMessage } from '@/lib/api'
import { keys, useAuthState } from '@/lib/queries'
import { Button } from '@/ui/Button'
import { Banner, Spinner } from '@/ui/Feedback'
import { ActionMenu } from '@/ui/Menu'
import { AppShell, type NavGroup } from '@/ui/Shell'
import { LoginPage } from './pages/auth/LoginPage'
import { SetupPage } from './pages/auth/SetupPage'
import { DashboardPage } from './pages/DashboardPage'
import { ReportsPage } from './pages/ReportsPage'
import { AutomationEditorPage } from './pages/automations/AutomationEditorPage'
import { AutomationsPage } from './pages/automations/AutomationsPage'
import { CampaignPage } from './pages/campaigns/CampaignPage'
import { CampaignsPage } from './pages/campaigns/CampaignsPage'
import { TemplateEditorPage } from './pages/campaigns/TemplateEditorPage'
import { TemplatesPage } from './pages/campaigns/TemplatesPage'
import { AudienceLayout } from './pages/contacts/AudienceLayout'
import { ContactDetailPage } from './pages/contacts/ContactDetailPage'
import { ContactsPage } from './pages/contacts/ContactsPage'
import { DuplicatesPage } from './pages/contacts/DuplicatesPage'
import { FieldsPage } from './pages/contacts/FieldsPage'
import { ImportPage } from './pages/contacts/ImportPage'
import { ListsPage } from './pages/contacts/ListsPage'
import { SegmentsPage } from './pages/contacts/SegmentsPage'
import { SuppressionPage } from './pages/contacts/SuppressionPage'
import { TagsPage } from './pages/contacts/TagsPage'
import { FormEditorPage } from './pages/forms/FormEditorPage'
import { FormsPage } from './pages/forms/FormsPage'
import { ApiKeysPage } from './pages/settings/ApiKeysPage'
import { DomainsPage } from './pages/settings/DomainsPage'
import { LogsPage } from './pages/settings/LogsPage'
import { OrganizationPage } from './pages/settings/OrganizationPage'
import { ProfilePage } from './pages/settings/ProfilePage'
import { SendingAccountsPage } from './pages/settings/SendingAccountsPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { TeamPage } from './pages/settings/TeamPage'

const NAV: NavGroup[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: <LayoutDashboard />, end: true }] },
  {
    label: 'Send',
    items: [
      { to: '/campaigns', label: 'Campaigns', icon: <Megaphone /> },
      { to: '/automations', label: 'Automations', icon: <Workflow /> },
      { to: '/templates', label: 'Templates', icon: <FileText /> },
    ],
  },
  {
    label: 'Audience',
    items: [
      { to: '/contacts', label: 'Contacts', icon: <Users /> },
      { to: '/audience', label: 'Lists and segments', icon: <ListFilter /> },
      { to: '/forms', label: 'Signup forms', icon: <ClipboardList /> },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/reports', label: 'Reports', icon: <BarChart3 /> },
      { to: '/settings', label: 'Settings', icon: <Settings /> },
    ],
  },
]

/** Who is signed in, and the way out. Pinned under the navigation. */
function AccountFooter({ user }: { user: User }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const logout = useMutation({
    mutationFn: () => api.post('/auth/logout'),
    onSettled: () => {
      client.clear()
      void client.invalidateQueries({ queryKey: keys.auth })
    },
  })
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ds-accent-subtle)] text-label text-[var(--ds-accent-text)]"
        aria-hidden
      >
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-label text-[var(--ds-fg)]">{user.name}</span>
        <span className="truncate text-caption text-[var(--ds-fg-muted)]">
          {ROLE_LABELS[user.role]}
        </span>
      </div>
      <ActionMenu
        label="Account"
        icon={<UserRound size={16} />}
        actions={[
          {
            id: 'profile',
            label: 'Your profile',
            icon: <UserRound size={14} />,
            onSelect: () => navigate('/settings/profile'),
          },
          {
            id: 'logout',
            label: 'Sign out',
            icon: <LogOut size={14} />,
            onSelect: () => logout.mutate(),
            separated: true,
          },
        ]}
      />
    </div>
  )
}

function Shell({ user }: { user: User }) {
  return (
    <AppShell brand={<Brand />} nav={NAV} sidebarFooter={<AccountFooter user={user} />}>
      <Outlet />
    </AppShell>
  )
}

/**
 * The gate in front of the app. Three states before the app itself: still
 * asking who this is, nobody has set Ariad up yet, and not signed in.
 */
export default function AdminApp() {
  const auth = useAuthState()
  const client = useQueryClient()

  // A session that ends while the app is open: ask again, and the sign-in
  // page takes over instead of every panel showing its own error.
  useEffect(() => {
    const onSignedOut = () => void client.invalidateQueries({ queryKey: keys.auth })
    window.addEventListener('ariad:signed-out', onSignedOut)
    return () => window.removeEventListener('ariad:signed-out', onSignedOut)
  }, [client])

  if (auth.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner size={22} label="Loading Ariad" />
      </div>
    )
  }
  if (auth.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <Banner
          tone="danger"
          title="Ariad could not be reached"
          className="max-w-[28rem]"
          actions={
            <Button
              size="sm"
              variant="outlined"
              onClick={() => auth.refetch()}
              loading={auth.isFetching}
            >
              Try again
            </Button>
          }
        >
          {errorMessage(auth.error)}
        </Banner>
      </div>
    )
  }
  if (auth.data.needsSetup) return <SetupPage />
  if (!auth.data.user) return <LoginPage />

  return (
    <Routes>
      <Route element={<Shell user={auth.data.user} />}>
        <Route index element={<DashboardPage />} />

        <Route path="campaigns" element={<CampaignsPage />} />
        <Route path="campaigns/:id" element={<CampaignPage />} />
        <Route path="templates" element={<TemplatesPage />} />
        <Route path="templates/:id" element={<TemplateEditorPage />} />
        <Route path="automations" element={<AutomationsPage />} />
        <Route path="automations/:id" element={<AutomationEditorPage />} />

        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/import" element={<ImportPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route path="audience" element={<AudienceLayout />}>
          <Route index element={<Navigate to="lists" replace />} />
          <Route path="lists" element={<ListsPage />} />
          <Route path="segments" element={<SegmentsPage />} />
          <Route path="tags" element={<TagsPage />} />
          <Route path="fields" element={<FieldsPage />} />
          <Route path="suppression" element={<SuppressionPage />} />
          <Route path="duplicates" element={<DuplicatesPage />} />
        </Route>
        <Route path="forms" element={<FormsPage />} />
        <Route path="forms/:id" element={<FormEditorPage />} />

        <Route path="reports" element={<ReportsPage />} />
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="sending" replace />} />
          <Route path="sending" element={<SendingAccountsPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="domains" element={<DomainsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
