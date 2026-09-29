import posthog from 'posthog-js'

const posthogKey = import.meta.env.VITE_POSTHOG_KEY
const posthogHost = import.meta.env.VITE_POSTHOG_HOST

export const isPosthogConfigured = Boolean(posthogKey && posthogHost)

if (!isPosthogConfigured) {
  if (import.meta.env.DEV) {
    const missingVariable = posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY'
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    )
  }
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-05-30',
    // Session replay is intentionally disabled: this dashboard shows each
    // tenant's private sales figures on screen, and we only need click/view
    // (event) analytics, not screen recordings.
    disable_session_recording: true,
    logs: {
      serviceName: 'gdec-analytics-web',
      environment: import.meta.env.MODE,
    },
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  })
}

// Minimal shape needed to attribute usage to a tenant. Kept local so posthog.ts
// stays decoupled from the auth User type.
type IdentifiableUser = {
  username: string
  companyName: string
  displayName?: string
  isAdmin: boolean
  platforms?: string[]
}

// Tie the current (previously anonymous) visitor to their account and company,
// so usage can be sliced per company and per user. `company` is set both as a
// person property (always filterable) and as a PostHog group (for group-level
// aggregation). Safe no-op when PostHog isn't configured.
export function identifyTenant(user: IdentifiableUser) {
  if (!isPosthogConfigured) return
  posthog.identify(user.username, {
    company: user.companyName,
    name: user.displayName || user.username,
    is_admin: user.isAdmin,
    platforms: user.platforms,
  })
  posthog.group('company', user.companyName, { name: user.companyName })
}

// Clear the identity on sign-out so the next user on the same browser starts
// fresh (prevents identity bleed between accounts).
export function resetTracking() {
  if (!isPosthogConfigured) return
  posthog.reset()
}

export default posthog
