import { lazy, Suspense } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { ApiError } from '@/lib/api'
import { Spinner } from '@/ui/Feedback'
import { Toaster } from '@/ui/Toast'

/**
 * Two apps behind one address.
 *
 * The admin app is behind a sign-in. The public pages are what a subscriber
 * reaches from a link in an email — unsubscribe, preferences, confirm, a
 * signup form — and they are loaded separately, so someone clicking
 * "unsubscribe" on a phone downloads a page, not the product.
 */
const AdminApp = lazy(() => import('./AdminApp'))
const PublicPages = lazy(() => import('./pages/public/PublicPages'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // A 4xx is an answer, not a fault: asking again gets the same one.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
})

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner size={22} label="Loading Ariad" />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<Splash />}>
          <Routes>
            <Route path="/unsubscribe/:token" element={<PublicPages page="unsubscribe" />} />
            <Route path="/preferences/:token" element={<PublicPages page="preferences" />} />
            <Route path="/confirm/:token" element={<PublicPages page="confirm" />} />
            <Route path="/subscribe/:id" element={<PublicPages page="subscribe" />} />
            <Route path="/*" element={<AdminApp />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  )
}
