import { motion, useReducedMotion } from 'motion/react'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown,
  Copy, ExternalLink, HandCoins, LoaderCircle, LockKeyhole,
  LogOut, RefreshCw, ShieldCheck, Users, Wallet, X,
} from 'lucide-react'
import {
  parseEventLogs, type Address, type Hash,
} from 'viem'
import { useAccount, useBalance, useConnect, useDeployContract, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './dashboard.css'
import { toast } from 'sonner'
import { circlePotAbi, circlePotBytecode } from './generated/circlePotArtifact'
import { clearContractAddress, explorerAddressUrl, explorerTxUrl, getInitialContractAddress, NATIVE_DECIMALS, portaldotTestnet, saveContractAddress, setAppView, TESTNET_EXPLORER, TESTNET_RPC } from './lib/web3'
import {
  amountToWei, copyText, errMsg, formatPot, formatPotShort, shortAddress,
  type ChainEvent, type CircleRow,
} from './lib/utils'

const Dashboard = lazy(() => import('./Dashboard'))

export type TxEntry = { id: number; label: string; hash?: Hash; status: 'pending' | 'success' | 'error'; detail?: string }
type CircleAction = 'join' | 'contribute' | 'refund' | 'cancel' | 'leave'
type Eip1193Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
  }
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' brand-mark-small' : ''}`} aria-hidden="true">
    <svg viewBox="0 0 40 40" fill="none">
      <circle cx="20" cy="20" r="15.5" stroke="currentColor" strokeWidth="2.2" />
      <path d="M20 4.5v8.1M35.5 20h-8.1M20 35.5v-8.1M4.5 20h8.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20" cy="20" r="5.1" fill="currentColor" />
    </svg>
  </span>
}

function Wordmark({ light = false, small = false }: { light?: boolean; small?: boolean }) {
  return <button className={`wordmark${light ? ' wordmark-light' : ''}${small ? ' wordmark-small' : ''}`} onClick={() => setAppView(false)} aria-label="CirclePot home">
    <BrandMark small={small} /><span>circlepot</span><sup>V3</sup>
  </button>
}

function NetworkBadge({ block }: { block?: string }) {
  return <div className="network-badge"><span className="status-dot" /><span>PORTALDOT V3 TESTNET</span>{block && <span className="network-block">#{block}</span>}</div>
}

function WalletButton({ address, isConnected, chainId, connecting, onConnect, onSwitchNetwork }: {
  address?: Address; isConnected: boolean; chainId?: number; connecting: boolean;
  onConnect: () => Promise<void>; onSwitchNetwork: () => Promise<void>;
}) {
  const { disconnect, isPending: disconnecting } = useDisconnect()
  if (!isConnected) {
    return <button className="wbtn" onClick={() => void onConnect()} disabled={connecting}>
      {connecting ? <LoaderCircle className="spin" size={15} /> : <Wallet size={15} />}
      {connecting ? 'Connecting…' : 'Connect wallet'}
    </button>
  }
  const handleDisconnect = () => {
    disconnect()
    toast.success('Wallet disconnected')
  }
  const wrongNetwork = chainId !== portaldotTestnet.id
  return <div className="wallet-control">
    {wrongNetwork && <button className="wbtn wbtn-warn" onClick={() => void onSwitchNetwork()} title="Switch to Portaldot V3 Testnet" aria-label="Switch to Portaldot V3 Testnet">
      <RefreshCw size={14} /><span className="wbtn-action-label">Switch to Portaldot</span>
    </button>}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="wbtn" aria-label="Wallet options"><span className="wbtn-dot" /><span className="wbtn-addr">{shortAddress(address)}</span><ChevronDown size={14} /></button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="ddm" sideOffset={8} align="end">
          <div className="ddm-head"><span>CONNECTED WALLET</span><strong>{shortAddress(address)}</strong></div>
          <div className="ddm-sep" />
          <DropdownMenu.Item className="ddm-item" onSelect={async () => { if (address && await copyText(address)) toast.success('Wallet address copied'); else toast.error('Could not copy the address') }}><Copy size={14} /> Copy address</DropdownMenu.Item>
          <DropdownMenu.Item className="ddm-item" asChild><a href={address ? explorerAddressUrl(address) : TESTNET_EXPLORER} target="_blank" rel="noreferrer"><ExternalLink size={14} /> View on explorer</a></DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    <button className="wbtn wbtn-disconnect" onClick={handleDisconnect} disabled={disconnecting} title="Disconnect wallet" aria-label={`Disconnect wallet${address ? ` ${shortAddress(address)}` : ''}`}>
      {disconnecting ? <LoaderCircle className="spin" size={14} /> : <LogOut size={14} />}
      <span>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</span>
    </button>
  </div>
}

function App() {
  const reduceMotion = useReducedMotion()
  const { address, chainId, connector: activeConnector, isConnected } = useAccount()
  const { connectAsync, connectors, isPending: connecting } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const [noWalletOpen, setNoWalletOpen] = useState(false)
  const [chooserOpen, setChooserOpen] = useState(false)
  const { writeContractAsync } = useWriteContract()
  const { deployContractAsync } = useDeployContract()
  const publicClient = usePublicClient({ chainId: portaldotTestnet.id })
  const { data: balanceData } = useBalance({ address, chainId: portaldotTestnet.id })
  const [view, setView] = useState(() => new URLSearchParams(location.search).get('app') === '1')
  const [contractAddress, setContractAddress] = useState<Address | ''>(getInitialContractAddress())
  const [circles, setCircles] = useState<CircleRow[]>([])
  const [chainEvents, setChainEvents] = useState<ChainEvent[]>([])
  const [paidStates, setPaidStates] = useState<Record<string, boolean>>({})
  const [claimable, setClaimable] = useState(0n)
  const [txs, setTxs] = useState<TxEntry[]>([])
  const txSeq = useRef(0)
  const [blockNumber, setBlockNumber] = useState('')
  const [networkLive, setNetworkLive] = useState(false)
  const [loadingCircles, setLoadingCircles] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [selectedCircle, setSelectedCircle] = useState<bigint | null>(() => {
    const inviteCircle = new URLSearchParams(location.search).get('circle')
    return inviteCircle && /^\d+$/.test(inviteCircle) ? BigInt(inviteCircle) : null
  })
  const [busyAction, setBusyAction] = useState<string>('')
  const [loadError, setLoadError] = useState('')
  const selectedRef = useRef<bigint | null>(null)
  const invitedNoticeRef = useRef('')
  const validatedContracts = useRef(new Set<string>())
  const validationRun = useRef(0)

  const trackTx = (label: string) => {
    const id = ++txSeq.current
    setTxs((prev) => [{ id, label, status: 'pending' as const }, ...prev].slice(0, 6))
    return {
      sent: (hash: Hash) => setTxs((prev) => prev.map((x) => (x.id === id ? { ...x, hash } : x))),
      done: (ok: boolean, detail?: string) => setTxs((prev) => prev.map((x) => (x.id === id ? { ...x, status: ok ? ('success' as const) : ('error' as const), detail } : x))),
    }
  }

  useEffect(() => {
    const onPop = () => setView(new URLSearchParams(location.search).get('app') === '1')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => { selectedRef.current = selectedCircle }, [selectedCircle])

  useEffect(() => {
    let alive = true
    const poll = async () => {
      try {
        const response = await fetch(TESTNET_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }) })
        const data = await response.json()
        if (!alive) return
        if (data.result) {
          setBlockNumber(BigInt(data.result).toLocaleString('en-US'))
          setNetworkLive(true)
        } else setNetworkLive(false)
      } catch { if (alive) setNetworkLive(false) }
    }
    void poll()
    const timer = window.setInterval(poll, 20_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    if (contractAddress) saveContractAddress(contractAddress)
  }, [contractAddress])

  // A stored or shared contract address is only trusted after the chain answers for it.
  useEffect(() => {
    if (!contractAddress || !publicClient) return
    const candidate = contractAddress as Address
    if (validatedContracts.current.has(candidate.toLowerCase())) return
    const run = ++validationRun.current
    void (async () => {
      const code = await publicClient.getCode({ address: candidate }).catch(() => null)
      if (validationRun.current !== run || code === null) return
      if (!code || code === '0x') {
        toast.error('No contract at the saved address', { description: 'It has no code on Portaldot V3 Testnet, so CirclePot returned to setup.' })
        clearContractAddress()
        setContractAddress('')
        return
      }
      try {
        await publicClient.readContract({ address: candidate, abi: circlePotAbi, functionName: 'circleCount' })
        validatedContracts.current.add(candidate.toLowerCase())
      } catch {
        if (validationRun.current !== run) return
        toast.error('That address is not a CirclePot contract', { description: 'CirclePot returned to setup. Deploy or connect the right contract to continue.' })
        clearContractAddress()
        setContractAddress('')
      }
    })()
  }, [contractAddress, publicClient])

  const refreshCircles = useCallback(async (target?: Address) => {
    const currentContract = (target || contractAddress) as Address | ''
    if (!publicClient || !currentContract) { setCircles([]); setChainEvents([]); return }
    setLoadingCircles(true)
    try {
      const fetchRow = async (id: bigint): Promise<CircleRow> => {
        const [info, members] = await Promise.all([
          publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'getCircle', args: [id] }),
          publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'getMembers', args: [id] }),
        ])
        const [name, creator, contribution, maxMembers, memberCount, round, open, paidCount, roundPot, roundStartedAt, refundWindow, completed, cancelled, inviteOnly] = info
        const joined = address ? await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'isMember', args: [id, address] }) : false
        const paid = address && joined ? await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'getContributionState', args: [id, address] }) : false
        return { id, name, creator, contribution, maxMembers: Number(maxMembers), memberCount: Number(memberCount), round: Number(round), open, paidCount: Number(paidCount), roundPot, roundStartedAt, refundWindowSec: Number(refundWindow), completed, cancelled, inviteOnly, members, joined, paid }
      }
      const count = await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'circleCount' })
      const total = Number(count)
      const ids = Array.from({ length: Math.min(total, 30) }, (_, index) => BigInt(total - 1 - index))
      const rows = await Promise.all(ids.map(fetchRow))
      const invited = selectedRef.current
      if (invited !== null && !rows.some((row) => row.id === invited)) {
        try { rows.unshift(await fetchRow(invited)) } catch {
          if (invitedNoticeRef.current !== invited.toString()) {
            invitedNoticeRef.current = invited.toString()
            toast.error('That circle was not found', { description: 'The invite may point to a different contract. Check the contract address in settings.' })
          }
        }
      }
      if (address) {
        try {
          const mine = await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'getUserCircles', args: [address] })
          for (const id of mine.slice(-20)) {
            if (!rows.some((row) => row.id === id)) rows.unshift(await fetchRow(id))
          }
        } catch { /* recent list still works */ }
        const pending = await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'pendingReturns', args: [address] }).catch(() => 0n)
        setClaimable(pending)
      } else setClaimable(0n)
      setLoadError('')
      setCircles(rows)

      try {
        const latest = await publicClient.getBlockNumber()
        const cacheKey = `circlepot.events.${currentContract.toLowerCase()}`
        let cached: ChainEvent[] = []
        let cachedBlock = 0
        try {
          const raw = JSON.parse(localStorage.getItem(cacheKey) ?? 'null') as { block: number; events: (Omit<ChainEvent, 'circleId'> & { circleId: string })[] } | null
          if (raw) { cached = raw.events.map((e) => ({ ...e, circleId: BigInt(e.circleId) })); cachedBlock = raw.block }
        } catch { /* fresh cache */ }
        const fromBlock = cachedBlock > 0 ? BigInt(cachedBlock + 1) : latest > 12_000n ? latest - 12_000n : 0n
        const logs = fromBlock > latest ? [] : await publicClient.getLogs({ address: currentContract, fromBlock, toBlock: latest })
        const parsed = parseEventLogs({ abi: circlePotAbi, logs, strict: false })
        const fresh: ChainEvent[] = parsed.flatMap((event) => {
          if (!event.eventName || !event.args || !event.transactionHash) return []
          const a = event.args as Record<string, unknown>
          return [{
            key: `${event.transactionHash}-${event.logIndex}`,
            kind: event.eventName,
            circleId: BigInt(String(a.circleId ?? 0)),
            round: Number(a.round ?? 0),
            amountWei: String(a.amount ?? '0'),
            actor: String(a.member ?? a.recipient ?? a.creator ?? ''),
            hash: event.transactionHash,
            block: Number(event.blockNumber ?? 0n),
          }]
        })
        const seenKeys = new Set(cached.map((e) => e.key))
        const merged = [...cached, ...fresh.filter((e) => !seenKeys.has(e.key))].sort((a, b) => a.block - b.block).slice(-1000)
        setChainEvents(merged)
        try { localStorage.setItem(cacheKey, JSON.stringify({ block: Number(latest), events: merged.map((e) => ({ ...e, circleId: e.circleId.toString() })) })) } catch { /* storage full/blocked */ }
      } catch (error) {
        console.warn('CirclePot activity history unavailable', error)
      }
    } catch (error) {
      console.error('CirclePot refresh failed', error)
      setLoadError('Could not read this contract on Portaldot V3 Testnet. Check your connection, or verify the contract address in settings.')
    } finally { setLoadingCircles(false) }
  }, [publicClient, contractAddress, address])

  useEffect(() => {
    if (!view || !contractAddress) return
    const initialRefresh = window.setTimeout(() => void refreshCircles(), 0)
    const timer = window.setInterval(() => { if (!document.hidden) void refreshCircles() }, 30_000)
    return () => { window.clearTimeout(initialRefresh); window.clearInterval(timer) }
  }, [view, contractAddress, refreshCircles])

  // Live updates: any CirclePot event triggers a refresh (polling stays as fallback).
  useEffect(() => {
    if (!view || !contractAddress || !publicClient) return
    let debounce = 0
    const unwatch = publicClient.watchContractEvent({
      address: contractAddress as Address,
      abi: circlePotAbi,
      onLogs: () => {
        window.clearTimeout(debounce)
        debounce = window.setTimeout(() => void refreshCircles(), 1200)
      },
      onError: () => { /* polling fallback covers RPC hiccups */ },
    })
    return () => { window.clearTimeout(debounce); unwatch() }
  }, [view, contractAddress, publicClient, refreshCircles])

  const ensureWallet = async () => {
    if (isConnected && activeConnector) return activeConnector
    const connector = connectors.find((c) => c.id === 'injected') ?? connectors[0]
    if (!connector) throw new Error('No EVM wallet connector is available. Install a wallet extension or configure WalletConnect.')
    await connectAsync({ connector })
    return connector
  }

  const getActiveWalletProvider = async (connector = activeConnector) => {
    if (connector) {
      try {
        const provider = await connector.getProvider() as Eip1193Provider
        if (provider && typeof provider.request === 'function') return provider
      } catch { /* fall back to the injected provider below */ }
    }
    return window.ethereum as Eip1193Provider | undefined
  }

  const ensureNetwork = async () => {
    const connector = await ensureWallet()
    const provider = await getActiveWalletProvider(connector)
    if (!provider) throw new Error('No EVM wallet provider is available. Open CirclePot in the browser where your wallet is installed.')
    const chainHex = `0x${portaldotTestnet.id.toString(16)}`
    const getProviderChainId = async () => Number(BigInt(String(await provider.request({ method: 'eth_chainId' }))))
    const errorCode = (error: unknown): number | undefined => {
      const pending: unknown[] = [error]
      const seen = new Set<unknown>()
      while (pending.length) {
        const current = pending.shift()
        if (!current || typeof current !== 'object' || seen.has(current)) continue
        seen.add(current)
        const value = current as { code?: unknown; cause?: unknown; data?: unknown; originalError?: unknown }
        if (typeof value.code === 'number') return value.code
        pending.push(value.cause, value.data, value.originalError)
      }
      return undefined
    }

    // The provider can switch before Wagmi's React state updates; trust the live provider first.
    if (await getProviderChainId() === portaldotTestnet.id) return
    const chainConfig = {
      chainId: chainHex,
      chainName: portaldotTestnet.name,
      nativeCurrency: { name: 'POT', symbol: 'POT', decimals: NATIVE_DECIMALS },
      rpcUrls: [TESTNET_RPC],
      blockExplorerUrls: [TESTNET_EXPLORER],
    }
    try {
      await switchChainAsync({ chainId: portaldotTestnet.id })
    } catch (switchError) {
      if (errorCode(switchError) === 4001) throw new Error('Network switch was rejected in your wallet.')
      if (connector?.id === 'walletConnect') {
        throw new Error('WalletConnect cannot switch this session. Switch to Portaldot V3 Testnet in your wallet, then reconnect.')
      }
      const switchWithProvider = () => provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainHex }] })
      try {
        // Some injected wallets surface 4901 ('chain disconnected') through Wagmi
        // even though their provider accepts the standard EIP-3326 switch request.
        await switchWithProvider()
      } catch (providerSwitchError) {
        const providerCode = errorCode(providerSwitchError)
        const wagmiCode = errorCode(switchError)
        if (![4901, 4902].includes(providerCode ?? -1) && ![4901, 4902].includes(wagmiCode ?? -1)) throw providerSwitchError
        // Some injected wallets report a missing/disconnected chain as 4901 instead
        // of 4902. Add it, then retry via the same provider that owns the account.
        try {
          await provider.request({ method: 'wallet_addEthereumChain', params: [chainConfig] })
        } catch (addError) {
          if (errorCode(addError) === 4001) throw new Error('Adding Portaldot V3 Testnet was rejected in your wallet.')
          // The wallet may already have this chain; continue with the switch request.
        }
        await switchWithProvider()
      }
    }
    if (await getProviderChainId() !== portaldotTestnet.id) {
      throw new Error('Your wallet did not switch to Portaldot V3 Testnet. Select Portaldot V3 Testnet in the wallet and try again.')
    }
  }

  const connectWith = async (connectorId: string) => {
    const connector = connectors.find((c) => c.id === connectorId) ?? connectors[0]
    if (!connector) { setNoWalletOpen(true); return }
    try {
      const result = await connectAsync({ connector })
      setChooserOpen(false)
      toast.success('Wallet connected', { description: result.accounts[0] ? shortAddress(result.accounts[0]) : undefined })
    } catch (error) {
      const details = error instanceof Error ? `${error.name} ${error.message}` : String(error)
      if (connector.id === 'injected' && /provider not found|no injected provider|connector not found/i.test(details)) {
        setChooserOpen(false)
        setNoWalletOpen(true)
        return
      }
      toast.error(errMsg(error, 'Could not connect wallet'))
    }
  }

  const connectWallet = async () => {
    if (isConnected) return
    if (connectors.length > 1) { setChooserOpen(true); return }
    await connectWith(connectors[0]?.id ?? 'injected')
  }

  const switchToPortaldot = async () => {
    try {
      await ensureNetwork()
      toast.success('On Portaldot V3 Testnet')
    } catch (error) {
      console.warn('Could not switch to Portaldot V3 Testnet', error)
      toast.error(errMsg(error, 'Could not switch to Portaldot V3 Testnet'))
    }
  }

  const deployContract = async () => {
    const tx = trackTx('Deploy CirclePot contract')
    try {
      setBusyAction('deploy')
      toast.loading('Approve deployment in your wallet…', { id: 'deploy' })
      await ensureNetwork()
      if (!publicClient) throw new Error('Portaldot testnet is unavailable. Try again in a moment.')
      const hash = await deployContractAsync({ abi: circlePotAbi, bytecode: circlePotBytecode, args: [], chainId: portaldotTestnet.id })
      tx.sent(hash)
      toast.loading('Waiting for CirclePot to deploy…', { id: 'deploy' })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Deployment reverted. No contract was created.')
      if (!receipt?.contractAddress) throw new Error('Deployment transaction did not return a contract address.')
      const deployedCode = await publicClient.getCode({ address: receipt.contractAddress })
      if (!deployedCode || deployedCode === '0x') throw new Error('Deployment confirmed, but no code was found at the contract address.')
      await publicClient.readContract({ address: receipt.contractAddress, abi: circlePotAbi, functionName: 'circleCount' })
      validatedContracts.current.add(receipt.contractAddress.toLowerCase())
      setContractAddress(receipt.contractAddress)
      saveContractAddress(receipt.contractAddress)
      tx.done(true, shortAddress(receipt.contractAddress))
      toast.success('CirclePot is live on testnet', { id: 'deploy', description: shortAddress(receipt.contractAddress) })
      await refreshCircles(receipt.contractAddress)
    } catch (error) { tx.done(false, errMsg(error, 'Failed')); toast.error(errMsg(error, 'Deployment failed'), { id: 'deploy' }) }
    finally { setBusyAction('') }
  }

  const createCircle = async (name: string, amount: string, maxMembers: number, refundDays: number, invited: Address[]) => {
    const tx = trackTx(`Create circle "${name.trim()}"`)
    try {
      setBusyAction('create')
      toast.loading('Approve circle setup in your wallet…', { id: 'create-circle' })
      await ensureNetwork()
      if (!publicClient) throw new Error('Portaldot testnet is unavailable. Try again in a moment.')
      const currentContract = contractAddress as Address
      const hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'createCircle', args: [name.trim(), amountToWei(amount), maxMembers, refundDays, invited], chainId: portaldotTestnet.id })
      tx.sent(hash)
      toast.loading('Waiting for your circle to open…', { id: 'create-circle' })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Circle creation reverted. Check the contribution and member count.')
      const created = parseEventLogs({ abi: circlePotAbi, logs: receipt.logs, strict: false }).find((event) => event.eventName === 'CircleCreated')
      const circleId = created?.args && typeof created.args === 'object' && 'circleId' in created.args ? BigInt(String((created.args as { circleId: unknown }).circleId)) : null
      tx.done(true)
      toast.success('Circle opened', { id: 'create-circle', description: 'Join it yourself to take seat 01, then share the invite link.' })
      setShowCreate(false)
      if (circleId !== null) setSelectedCircle(circleId)
      await refreshCircles()
    } catch (error) { tx.done(false, errMsg(error, 'Failed')); toast.error(errMsg(error, 'Could not create circle'), { id: 'create-circle' }) }
    finally { setBusyAction('') }
  }

  const ACTION_WRITE: Record<CircleAction, { fn: 'joinCircle' | 'contribute' | 'refundExpiredRound' | 'cancelCircle' | 'leaveCircle'; label: string; done: string }> = {
    join: { fn: 'joinCircle', label: 'joining circle', done: 'You have a seat' },
    contribute: { fn: 'contribute', label: 'contributing to the round', done: 'Contribution confirmed' },
    refund: { fn: 'refundExpiredRound', label: 'refunding the expired round', done: 'Refunds credited — claim them any time' },
    cancel: { fn: 'cancelCircle', label: 'cancelling the circle', done: 'Circle cancelled' },
    leave: { fn: 'leaveCircle', label: 'leaving the circle', done: 'You left the circle' },
  }

  const sendAction = async (row: CircleRow, action: CircleAction) => {
    const spec = ACTION_WRITE[action]
    const tx = trackTx(`${spec.done} · ${row.name}`)
    try {
      setBusyAction(`${action}-${row.id}`)
      toast.loading(`Approve ${spec.label} in your wallet…`, { id: `circle-${row.id}` })
      await ensureNetwork()
      if (!publicClient) throw new Error('Portaldot testnet is unavailable. Try again in a moment.')
      const currentContract = contractAddress as Address
      let hash: Hash
      if (action === 'join') hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'joinCircle', args: [row.id], chainId: portaldotTestnet.id })
      else if (action === 'contribute') hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'contribute', args: [row.id], value: row.contribution, chainId: portaldotTestnet.id })
      else if (action === 'refund') hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'refundExpiredRound', args: [row.id], chainId: portaldotTestnet.id })
      else if (action === 'cancel') hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'cancelCircle', args: [row.id], chainId: portaldotTestnet.id })
      else hash = await writeContractAsync({ address: currentContract, abi: circlePotAbi, functionName: 'leaveCircle', args: [row.id], chainId: portaldotTestnet.id })
      tx.sent(hash)
      toast.loading('Waiting for confirmation on Portaldot…', { id: `circle-${row.id}` })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Transaction reverted. Check the circle state and try again.')
      tx.done(true)
      toast.success(spec.done, { id: `circle-${row.id}`, description: 'Confirmed on Portaldot V3 Testnet.' })
      await refreshCircles()
    } catch (error) { tx.done(false, errMsg(error, 'Failed')); toast.error(errMsg(error, 'Transaction failed'), { id: `circle-${row.id}` }) }
    finally { setBusyAction('') }
  }

  const claimReturns = async () => {
    const tx = trackTx('Claim POT returns')
    try {
      setBusyAction('claim')
      toast.loading('Approve the claim in your wallet…', { id: 'claim' })
      await ensureNetwork()
      if (!publicClient) throw new Error('Portaldot testnet is unavailable. Try again in a moment.')
      const hash = await writeContractAsync({ address: contractAddress as Address, abi: circlePotAbi, functionName: 'claimReturns', args: [], chainId: portaldotTestnet.id })
      tx.sent(hash)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('Claim reverted. Your credit is still on the contract.')
      tx.done(true)
      toast.success('POT claimed', { id: 'claim', description: 'Credited pots and refunds are now in your wallet.' })
      await refreshCircles()
    } catch (error) { tx.done(false, errMsg(error, 'Failed')); toast.error(errMsg(error, 'Claim failed'), { id: 'claim' }) }
    finally { setBusyAction('') }
  }

  const estimateAction = async (row: CircleRow, action: CircleAction) => {
    if (!publicClient || !address) return {}
    const contract = contractAddress as Address
    try {
      let gas: bigint
      if (action === 'join') { const a = { address: contract, abi: circlePotAbi, functionName: 'joinCircle', args: [row.id], account: address } as const; await publicClient.simulateContract(a); gas = await publicClient.estimateContractGas(a) }
      else if (action === 'contribute') { const a = { address: contract, abi: circlePotAbi, functionName: 'contribute', args: [row.id], account: address, value: row.contribution } as const; await publicClient.simulateContract(a); gas = await publicClient.estimateContractGas(a) }
      else if (action === 'refund') { const a = { address: contract, abi: circlePotAbi, functionName: 'refundExpiredRound', args: [row.id], account: address } as const; await publicClient.simulateContract(a); gas = await publicClient.estimateContractGas(a) }
      else if (action === 'cancel') { const a = { address: contract, abi: circlePotAbi, functionName: 'cancelCircle', args: [row.id], account: address } as const; await publicClient.simulateContract(a); gas = await publicClient.estimateContractGas(a) }
      else { const a = { address: contract, abi: circlePotAbi, functionName: 'leaveCircle', args: [row.id], account: address } as const; await publicClient.simulateContract(a); gas = await publicClient.estimateContractGas(a) }
      const gasPrice = await publicClient.getGasPrice()
      return { feeText: `≈ ${formatPot(gas * gasPrice, 4)} POT` }
    } catch (error) {
      return { error: errMsg(error, 'This transaction would fail right now.') }
    }
  }

  const connectContractAddress = async (candidate: Address) => {
    if (!publicClient) throw new Error('Portaldot testnet is unavailable. Try again in a moment.')
    const code = await publicClient.getCode({ address: candidate })
    if (!code || code === '0x') throw new Error('There is no deployed contract at that address on Portaldot V3 Testnet.')
    await publicClient.readContract({ address: candidate, abi: circlePotAbi, functionName: 'circleCount' })
    validatedContracts.current.add(candidate.toLowerCase())
    setContractAddress(candidate)
  }

  const disconnectContract = () => {
    clearContractAddress()
    setContractAddress('')
    setCircles([])
    setChainEvents([])
    setPaidStates({})
    setClaimable(0n)
    setSelectedCircle(null)
    toast.success('Contract disconnected', { description: 'CirclePot is back at setup. No funds were moved.' })
  }

  // Live per-member contribution states for the circle being inspected (powers the round tracker).
  useEffect(() => {
    if (!publicClient || !contractAddress || selectedCircle === null) return
    const row = circles.find((item) => item.id === selectedCircle)
    if (!row || row.open || row.members.length === 0) return
    const currentContract = contractAddress as Address
    let stale = false
    void (async () => {
      const entries = await Promise.all(row.members.map(async (member) => {
        const paid = await publicClient.readContract({ address: currentContract, abi: circlePotAbi, functionName: 'getContributionState', args: [row.id, member] }).catch(() => false)
        return [`${row.id}:${member.toLowerCase()}`, paid] as const
      }))
      if (!stale) setPaidStates((prev) => ({ ...prev, ...Object.fromEntries(entries) }))
    })()
    return () => { stale = true }
  }, [publicClient, contractAddress, selectedCircle, circles])

  const highlightedCircle = useMemo(() => (selectedCircle === null ? null : circles.find((item) => item.id === selectedCircle) ?? null), [circles, selectedCircle])

  return <div className="site-frame">
    <header className={`topbar ${view ? 'topbar-app' : ''}`}>
      <Wordmark light={view} />
      {!view ? <>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#how-it-works">HOW IT WORKS</a><a href="#the-circle">THE CIRCLE</a><a href="#trust">TRUST, BUILT IN</a>
        </nav>
        <button className="nav-cta" onClick={() => setAppView(true)}>OPEN CIRCLEPOT <span className="nav-arrow"><ArrowRight size={16} /></span></button>
      </> : <>
        <div className="app-top-center"><NetworkBadge block={blockNumber} /></div>
        <div className="wallet-actions">
          {isConnected && balanceData && <span className="wbtn-balance">{formatPotShort(balanceData.value)} POT</span>}
          <WalletButton address={address} isConnected={isConnected} chainId={chainId} connecting={connecting} onConnect={connectWallet} onSwitchNetwork={switchToPortaldot} />
        </div>
      </>}
    </header>

    {view && <div className="testnet-banner">PORTALDOT V3 TESTNET — POT here has no real value. Never send mainnet funds to this app.</div>}
    {!view ? <HomePage networkLive={networkLive} blockNumber={blockNumber} onStart={() => setAppView(true)} reduceMotion={!!reduceMotion} /> : <Suspense fallback={<div className="x-shell"><div className="x-empty" style={{ marginTop: 60 }}><LoaderCircle className="spin" size={22} /><span>Loading your workspace…</span></div></div>}><Dashboard
      address={address} isConnected={isConnected} chainId={chainId} circles={circles} events={chainEvents} paidStates={paidStates} loading={loadingCircles} loadError={loadError}
      contractAddress={contractAddress} showCreate={showCreate} selectedCircle={highlightedCircle} busyAction={busyAction} claimable={claimable} userBalance={balanceData?.value}
      onCreateClick={() => setShowCreate(!showCreate)} onCreate={createCircle} onDeploy={deployContract} onSetAddress={connectContractAddress} onDisconnectContract={disconnectContract} onConnectWallet={connectWallet} onSwitchNetwork={switchToPortaldot}
      onAction={sendAction} onClaim={claimReturns} onSelect={setSelectedCircle} onRefresh={() => void refreshCircles()} onBack={() => setAppView(false)} onEstimate={estimateAction}
    /></Suspense>}

    {view && txs.length > 0 && <div className="tx-dock" aria-label="Recent transactions">
      <div className="tx-dock-head"><span>TRANSACTIONS</span><button onClick={() => setTxs([])} aria-label="Clear transaction list"><X size={13} /></button></div>
      {txs.map((tx) => <div key={tx.id} className="tx-row">
        <span className={`tx-status ${tx.status}`}>{tx.status === 'pending' ? <LoaderCircle className="spin" size={13} /> : tx.status === 'success' ? <Check size={13} /> : <X size={13} />}</span>
        <span className="tx-label">{tx.label}<small>{tx.detail ?? (tx.status === 'pending' ? 'Waiting for confirmation…' : tx.status === 'success' ? 'Confirmed' : 'Failed')}</small></span>
        {tx.hash && <a href={explorerTxUrl(tx.hash)} target="_blank" rel="noreferrer" aria-label="View transaction on explorer"><ExternalLink size={12} /></a>}
      </div>)}
    </div>}

    <Dialog.Root open={chooserOpen} onOpenChange={setChooserOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
          <div className="dlg-head">
            <div><span className="eyebrow">CONNECT WALLET</span><Dialog.Title asChild><h2>Choose a wallet</h2></Dialog.Title><p className="dlg-desc">Pick how you want to connect to Portaldot V3 Testnet.</p></div>
            <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
          </div>
          <div className="wallet-chooser">
            {connectors.map((connector) => <button key={connector.id} className="wallet-choice" onClick={() => void connectWith(connector.id)}>
              <span className="dlg-wallet-art"><Wallet size={19} /></span>
              <span><b>{connector.name}</b><small>{connector.id === 'injected' ? 'Browser extension wallet' : 'Scan with your mobile wallet'}</small></span>
              <ArrowRight size={15} />
            </button>)}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>

    <Dialog.Root open={noWalletOpen} onOpenChange={setNoWalletOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-overlay" />
        <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
          <div className="dlg-head">
            <div><span className="dlg-wallet-art"><Wallet size={22} /></span><Dialog.Title asChild><h2>No EVM wallet detected</h2></Dialog.Title><p className="dlg-desc">Install an EVM wallet extension in this browser, or open CirclePot in a browser where one is installed. CirclePot asks the wallet to connect; it never stores your wallet keys.</p></div>
            <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
          </div>
          <div className="dlg-actions">
            <button className="x-btn x-btn-ghost" onClick={() => window.location.reload()}>Reload after installing</button>
            <a className="x-btn x-btn-dark" href="https://metamask.io/download" target="_blank" rel="noreferrer">Install MetaMask <ArrowUpRight size={15} /></a>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}

function HomePage({ networkLive, blockNumber, onStart, reduceMotion }: { networkLive: boolean; blockNumber: string; onStart: () => void; reduceMotion: boolean }) {
  const reveal = reduceMotion ? {} : { initial: { opacity: 0, transform: 'translateY(14px)' }, animate: { opacity: 1, transform: 'translateY(0px)' } }
  return <main className="homepage">
    <section className="hero-section">
      <div className="hero-kicker"><span className="kicker-dot" /> A SAVINGS CIRCLE, HELD IN COMMON</div>
      <motion.h1 {...reveal} transition={{ duration: 0.58, ease: [0.23, 1, 0.32, 1] }}>
        A good circle<br />keeps its <span className="hero-highlight">promise<span className="highlight-mark"><ArrowUpRight size={31} strokeWidth={1.8} /></span></span>
      </motion.h1>
      <motion.p className="hero-copy" {...reveal} transition={{ duration: 0.58, delay: 0.08, ease: [0.23, 1, 0.32, 1] }}>
        Save together. Take turns. See every POT move, right on Portaldot.
      </motion.p>
      <div className="hero-actions">
        <button className="button button-dark button-large" onClick={onStart}>Start a circle <span className="button-icon"><ArrowRight size={17} /></span></button>
        <a className="text-link" href="#how-it-works">See how it works <ArrowDownRight size={16} /></a>
      </div>
      <div className="hero-art" aria-label="Illustration of a three-member savings circle">
        <div className="art-line art-line-left" /><div className="art-line art-line-right" />
        <div className="art-note note-left"><span className="note-label">YOUR CONTRIBUTION</span><strong>100 <small>POT</small></strong><div className="note-bars"><i /><i /><i /><i /><i /></div></div>
        <div className="art-orbit orbit-one"><span className="orbit-avatar avatar-one">A</span><span className="orbit-avatar avatar-two">M</span><span className="orbit-avatar avatar-three">J</span><div className="orbit-core"><BrandMark /></div><div className="orbit-dash" /></div>
        <div className="art-note note-right"><div className="note-top"><span className="note-label">ROUND 02 / 03</span><span className="round-status"><span className="status-dot" /> READY</span></div><strong>300 <small>POT</small></strong><div className="recipient-line"><span className="recipient-avatar">M</span><span><b>Next up</b><small>Maya gets the pot</small></span><ArrowRight size={15} /></div></div>
        <div className="art-sticker"><HandCoins size={16} /><span>EVERY TURN<br />ON THE RECORD</span></div>
        <div className="art-caption"><span className="caption-rule" /> A little trust, made visible.</div>
      </div>
      <div className="hero-footnote"><span className="footnote-left"><span className={`status-dot ${networkLive ? '' : 'status-dot-muted'}`} />{networkLive ? `PORTALDOT V3 · BLOCK ${blockNumber}` : 'PORTALDOT V3 TESTNET'}</span><span>BUILT FOR PEOPLE WHO SHOW UP</span></div>
    </section>

    <section className="intro-strip" id="the-circle">
      <div className="intro-label">A circle is a simple thing.</div>
      <p>People agree to save a fixed amount. Each round, one person receives the pool. The order is known from the start; the record is always there.</p>
      <div className="intro-side"><div className="circle-glyph"><span /><span /><span /><b>3</b></div><span>NO HOUSE.<br />NO GUESSWORK.</span></div>
    </section>

    <section className="steps-section" id="how-it-works">
      <div className="section-heading"><div><span className="eyebrow">HOW THE CIRCLE TURNS</span><h2>Clear before<br />the first coin.</h2></div><p>Everyone knows their seat, their contribution, and whose turn comes next. CirclePot keeps the shared record.</p></div>
      <div className="steps-grid">
        <article className="step-card"><span className="step-number">01</span><div className="step-icon step-icon-lilac"><Users size={20} strokeWidth={1.7} /></div><h3>Make your circle</h3><p>Choose a contribution and invite the people you trust. Seats close when the group is full.</p><span className="step-foot">2—12 PEOPLE</span></article>
        <article className="step-card"><span className="step-number">02</span><div className="step-icon step-icon-lime"><HandCoins size={20} strokeWidth={1.7} /></div><h3>Put in your share</h3><p>Each member sends the agreed amount to the circle. You can see the round fill in real time.</p><span className="step-foot">ONE FIXED AMOUNT</span></article>
        <article className="step-card"><span className="step-number">03</span><div className="step-icon step-icon-ink"><ArrowUpRight size={20} strokeWidth={1.7} /></div><h3>Take your turn</h3><p>When everyone has contributed, the full pot is credited to the next person in the agreed order — ready to claim any time.</p><span className="step-foot">EVERY TURN RECORDED</span></article>
      </div>
    </section>

    <section className="trust-section" id="trust">
      <div className="trust-copy"><span className="eyebrow">THE RECORD IS THE AGREEMENT</span><h2>Trust, with<br />a paper trail.</h2><p>CirclePot uses a small Portaldot smart contract to hold contributions for a round and credit the scheduled member when the circle is complete. Anyone can verify the transactions.</p><button className="text-link trust-link" onClick={onStart}>Look inside CirclePot <ArrowRight size={16} /></button></div>
      <div className="trust-card"><div className="trust-card-head"><span className="trust-emblem"><ShieldCheck size={18} /></span><span>THE CIRCLE PROMISE</span><span className="trust-card-number">01 / 03</span></div><div className="promise-title">The same amount.<br />The next name.<br /><em>The whole pot.</em></div><div className="promise-rule" /><div className="promise-meta"><span>CONTRACT-ENFORCED</span><span><LockKeyhole size={12} /> PORTALDOT V3</span></div><div className="trust-watermark"><BrandMark /></div></div>
    </section>

    <footer className="home-footer"><Wordmark small /><span>GOOD CIRCLES KEEP THEIR WORD.</span><a href="https://portaldot.dev" target="_blank" rel="noreferrer">BUILT ON PORTALDOT <ArrowUpRight size={13} /></a></footer>
  </main>
}

export default App
