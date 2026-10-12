import { useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AuthState,
  ContactList,
  CustomField,
  Segment,
  SendingAccount,
  SettingsView,
  Tag,
} from '@ariad/shared'
import { api } from './api'

/**
 * The lookups several pages need: who is signed in, and the small reference
 * lists (accounts, lists, tags, fields, segments) that pickers are filled from.
 * Each has one key, so a change made on one page is seen by the others.
 */
export const keys = {
  auth: ['auth'] as const,
  settings: ['settings'] as const,
  accounts: ['sending-accounts'] as const,
  lists: ['lists'] as const,
  tags: ['tags'] as const,
  fields: ['fields'] as const,
  segments: ['segments'] as const,
}

export const useAuthState = () =>
  useQuery({
    queryKey: keys.auth,
    queryFn: () => api.get<AuthState>('/auth/state'),
    staleTime: 60_000,
    retry: 1,
  })

export const useSettings = () =>
  useQuery({
    queryKey: keys.settings,
    queryFn: () => api.get<SettingsView>('/settings'),
    staleTime: 30_000,
  })

export const useAccounts = (options: { refetchInterval?: number } = {}) =>
  useQuery({
    queryKey: keys.accounts,
    queryFn: () => api.get<SendingAccount[]>('/sending-accounts'),
    ...options,
  })

export const useLists = () =>
  useQuery({ queryKey: keys.lists, queryFn: () => api.get<ContactList[]>('/lists') })
export const useTags = () =>
  useQuery({ queryKey: keys.tags, queryFn: () => api.get<Tag[]>('/tags') })
export const useFields = () =>
  useQuery({ queryKey: keys.fields, queryFn: () => api.get<CustomField[]>('/fields') })
export const useSegments = () =>
  useQuery({ queryKey: keys.segments, queryFn: () => api.get<Segment[]>('/segments') })

/** Marks everything under these keys stale, e.g. after an import touches contacts, lists and tags at once. */
export function useInvalidate() {
  const client = useQueryClient()
  return (...queryKeys: (readonly unknown[])[]) =>
    Promise.all(queryKeys.map((queryKey) => client.invalidateQueries({ queryKey })))
}
