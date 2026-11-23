import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './AuthContext'
import './posthog'
import App from './App.tsx'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Dashboard data only changes once a night (backend nightly cache refresh),
      // so there is nothing to gain from refetching when the tab regains focus or
      // the network reconnects — it just dims the cards with a "Loading…" flicker
      // and fires needless backend calls. Keep each dataset fresh for the session
      // (matches the "fetch once per session" design) and let a manual reload pick
      // up the nightly refresh.
      staleTime: 60 * 60 * 1000, // 1 hour
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)