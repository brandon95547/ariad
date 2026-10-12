/** Query keys for signup forms: the list, and each form under it, so a change to one refreshes both. */
export const formKeys = {
  all: ['forms'] as const,
  one: (id: string) => ['forms', id] as const,
}
