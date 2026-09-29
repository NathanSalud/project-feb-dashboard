import posthog, { isPosthogConfigured } from './posthog'

export const posthogLog = {
  loginSucceeded() {
    if (isPosthogConfigured) {
      posthog.logger.info('authentication completed', {
        event: 'authentication.completed',
        outcome: 'success',
      })
    }
  },

  loginFailed() {
    if (isPosthogConfigured) {
      posthog.logger.warn('authentication completed', {
        event: 'authentication.completed',
        outcome: 'failure',
      })
    }
  },
}
