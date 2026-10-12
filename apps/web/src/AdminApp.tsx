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
import { OrganizationPage } from './pages/settings/OrganizationPage'
import { SendingAccountsPage } from './pages/settings/SendingAccountsPage'
import { SettingsLayout } from './pages/settings/SettingsLayout'

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
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--ds-accent-subtle)] text-label text-[var(--ds-accent-text)]" aria-hidden>
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-label text-[var(--ds-fg)]">{user.name}</span>
        <span className="truncate text-caption text-[var(--ds-fg-muted)]">{ROLE_LABELS[user.role]}</span>
      </div>
      <ActionMenu
        label="Account"
        icon={<UserRound size={16} />}
        actions={[
          { id: 'profile', label: 'Your profile', icon: <UserRound size={14} />, onSelect: () => navigate('/settings/profile') },
          { id: 'logout', label: 'Sign out', icon: <LogOut size={14} />, onSelect: () => logout.mutate(), separated: true },
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
            <Button size="sm" variant="outlined" onClick={() => auth.refetch()} loading={auth.isFetching}>
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
        <Route path="settings" element={<SettingsLayout />}>
          <Route index element={<Navigate to="sending" replace />} />
          <Route path="sending" element={<SendingAccountsPage />} />
          <Route path="organization" element={<OrganizationPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/settings/sending" replace />} />
      </Route>
    </Routes>
  )
}
