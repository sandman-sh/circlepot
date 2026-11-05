import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { wagmiConfig } from './lib/web3'
import App from './App'
import './styles.css'

// Optional error reporting; only loads when a DSN is configured.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
if (sentryDsn) {
  void import('@sentry/react').then((Sentry) => Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0.1 })).catch(() => {})
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
        <Toaster position="bottom-right" theme="dark" richColors closeButton />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
