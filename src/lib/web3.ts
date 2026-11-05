import { createConfig, fallback, http, injected } from 'wagmi'
import { walletConnect } from 'wagmi/connectors'
import { defineChain } from 'viem'

export const portaldotTestnet = defineChain({
  id: 420420777,
  name: 'Portaldot V3 Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 14 },
  rpcUrls: { default: { http: ['https://test-evm-rpc-v3.portaldot.dev'] } },
  blockExplorers: {
    default: { name: 'Portaldot V3 Testnet Explorer', url: 'https://scanner-testnet-v3.portaldot.dev' },
  },
  testnet: true,
})

const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined

export const wagmiConfig = createConfig({
  chains: [portaldotTestnet],
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [walletConnect({ projectId: walletConnectProjectId, metadata: { name: 'CirclePot', description: 'Rotating savings circles on Portaldot V3', url: 'https://portaldot.dev', icons: [] } })]
      : []),
  ],
  transports: {
    [portaldotTestnet.id]: fallback([
      http('https://test-evm-rpc-v3.portaldot.dev', { retryCount: 3, retryDelay: 800 }),
      http('https://test-evm-rpc-v3.portaldot.dev', { retryCount: 2, retryDelay: 1_500 }),
    ]),
  },
})

export const TESTNET_RPC = 'https://test-evm-rpc-v3.portaldot.dev'
export const TESTNET_EXPLORER = 'https://scanner-testnet-v3.portaldot.dev'
export const NATIVE_DECIMALS = 14

// Route shapes verified against the live Portaldot V3 scanner bundle
// (routes /tx/:id and /addresses/:address) on the production explorer.
export const explorerTxUrl = (hash: string) => `${TESTNET_EXPLORER}/tx/${hash}`
export const explorerAddressUrl = (address: string) => `${TESTNET_EXPLORER}/addresses/${address}`

export function saveContractAddress(address: string) {
  localStorage.setItem('circlepot.contract', address)
  const url = new URL(window.location.href)
  url.searchParams.set('contract', address)
  window.history.replaceState({}, '', url)
}

export function clearContractAddress() {
  localStorage.removeItem('circlepot.contract')
  const url = new URL(window.location.href)
  url.searchParams.delete('contract')
  window.history.replaceState({}, '', url)
}

export function getInitialContractAddress() {
  const fromUrl = new URLSearchParams(window.location.search).get('contract')
  const fromStorage = localStorage.getItem('circlepot.contract')
  const value = fromUrl || fromStorage || import.meta.env.VITE_CIRCLEPOT_ADDRESS || ''
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : ''
}

export function setAppView(open: boolean) {
  const url = new URL(window.location.href)
  if (open) url.searchParams.set('app', '1')
  else url.searchParams.delete('app')
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
