import { ConfirmPage } from './ConfirmPage'
import { PreferencesPage } from './PreferencesPage'
import { isEmbedded, useLightTheme } from './PublicFrame'
import { SubscribePage } from './SubscribePage'
import { UnsubscribePage } from './UnsubscribePage'

/**
 * The pages a subscriber reaches without signing in: from the links in an
 * email (unsubscribe, preferences, confirm) and from a signup form. They are
 * loaded apart from the admin app, look like the organization's own rather
 * than like Ariad, and are light whatever the admin's theme is.
 */
export default function PublicPages({
  page,
}: {
  page: 'unsubscribe' | 'preferences' | 'confirm' | 'subscribe'
}) {
  // Only the signup form is ever put inside another site's page.
  const embedded = page === 'subscribe' && isEmbedded
  useLightTheme(embedded)

  if (page === 'unsubscribe') return <UnsubscribePage />
  if (page === 'preferences') return <PreferencesPage />
  if (page === 'confirm') return <ConfirmPage />
  return <SubscribePage embedded={embedded} />
}
