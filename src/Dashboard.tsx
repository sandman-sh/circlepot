import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Activity as ActivityIcon, ArrowLeft, ArrowRight, ArrowUpRight, Bell, Check,
  CircleHelp, Clock, Coins, Copy, Download, ExternalLink, Fingerprint, HandCoins, History, LayoutDashboard, LoaderCircle,
  LockKeyhole, Plus, QrCode, RefreshCw, Search, Settings, Share2, ShieldCheck, TrendingUp, UserPlus, Users, Wallet, X, Zap,
} from 'lucide-react'
import { toCanvas as qrToCanvas } from 'qrcode'
import { formatUnits, type Address } from 'viem'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { explorerAddressUrl, explorerTxUrl, NATIVE_DECIMALS, portaldotTestnet } from './lib/web3'
import {
  amountToWei, copyText, errMsg, formatPot, formatPotShort, isValidAddress, shortAddress,
  type ChainEvent, type CircleRow,
} from './lib/utils'

export type CircleAction = 'join' | 'contribute' | 'refund' | 'cancel' | 'leave'
type DashView = 'overview' | 'circles' | 'activity' | 'settings'
type ConfirmSpec = {
  title: string
  cta: string
  lines: { label: string; value: string }[]
  warning?: string
  estimate?: { row: CircleRow; action: CircleAction }
  run: () => Promise<void>
}
type FeedItem = { key: string; title: string; detail: string; circleId: bigint; hash: string; block: number; kind: string; actor: string }

const DAY = 24 * 60 * 60
const labelFor = (labels: Record<string, string>, addr?: string) => {
  if (!addr) return 'â€”'
  const label = labels[addr.toLowerCase()]
  return label ? `${label} (${shortAddress(addr)})` : shortAddress(addr)
}

// Counts animate through React state (never direct DOM writes, which would detach React's text nodes).
function AnimatedNumber({ value }: { value: number }) {
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    if (reduced) return
    const fx: { tween?: { kill: () => void }; cancelled: boolean } = { cancelled: false }
    const obj = { v: fromRef.current }
    void import('gsap').then(({ default: gsap }) => {
      if (fx.cancelled) return
      fx.tween = gsap.to(obj, { v: value, duration: 0.7, ease: 'power2.out', onUpdate: () => setDisplay(Math.round(obj.v)), onComplete: () => { fromRef.current = value } })
    })
    return () => { fx.cancelled = true; fx.tween?.kill(); fromRef.current = value }
  }, [value, reduced])
  return <>{String(reduced ? value : display).padStart(2, '0')}</>
}

export default function Dashboard({
  address, isConnected, chainId, circles, events, paidStates, loading, loadError, contractAddress, showCreate, selectedCircle, busyAction, claimable, userBalance,
  onCreateClick, onCreate, onDeploy, onSetAddress, onDisconnectContract, onConnectWallet, onSwitchNetwork, onAction, onClaim, onSelect, onRefresh, onBack, onEstimate,
}: {
  address?: Address; isConnected: boolean; chainId?: number; circles: CircleRow[]; events: ChainEvent[]; paidStates: Record<string, boolean>; loading: boolean; loadError: string; contractAddress: Address | '';
  showCreate: boolean; selectedCircle: CircleRow | null; busyAction: string; claimable: bigint; userBalance?: bigint;
  onCreateClick: () => void;
  onCreate: (name: string, amount: string, maxMembers: number, refundDays: number, invited: Address[]) => Promise<void>; onDeploy: () => Promise<void>;
  onSetAddress: (address: Address) => Promise<void>; onDisconnectContract: () => void; onConnectWallet: () => Promise<void>; onSwitchNetwork: () => Promise<void>;
  onAction: (circle: CircleRow, action: CircleAction) => Promise<void>; onClaim: () => Promise<void>;
  onSelect: (id: bigint | null) => void; onRefresh: () => void; onBack: () => void;
  onEstimate: (circle: CircleRow, action: CircleAction) => Promise<{ feeText?: string; error?: string }>;
}) {
  const [dashView, setDashView] = useState<DashView>('overview')
  const [filter, setFilter] = useState<'all' | 'open' | 'active' | 'mine'>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'new' | 'pot' | 'filling'>('new')
  const [actFilter, setActFilter] = useState<string>('all')
  const [actMine, setActMine] = useState(false)
  const [contractInput, setContractInput] = useState('')
  const [showContractForm, setShowContractForm] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)
  const [shareRow, setShareRow] = useState<CircleRow | null>(null)
  const [faucetOpen, setFaucetOpen] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [refDismissed, setRefDismissed] = useState(false)
  const refParam = new URLSearchParams(location.search).get('ref')
  const [labels, setLabels] = useState<Record<string, string>>(() => { try { return JSON.parse(localStorage.getItem('circlepot.labels') ?? '{}') } catch { return {} } })
  const [labelAddr, setLabelAddr] = useState('')
  const [labelName, setLabelName] = useState('')
  const shellRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const invitedId = new URLSearchParams(location.search).get('circle')
  useEffect(() => { if (invitedId && /^\d+$/.test(invitedId)) onSelect(BigInt(invitedId)) }, [invitedId, onSelect])
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null)
  const selectedKey = selectedCircle ? selectedCircle.id.toString() : null
  if (selectedKey !== lastSelectedKey) {
    setLastSelectedKey(selectedKey)
    if (selectedKey) setDashView('circles')
  }
  const correctNetwork = chainId === portaldotTestnet.id
  const hasContract = !!contractAddress

  useEffect(() => {
    const root = shellRef.current
    if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const fx: { ctx?: { revert: () => void }; cancelled: boolean } = { cancelled: false }
    void import('gsap').then(({ default: gsap }) => {
      if (fx.cancelled) return
      fx.ctx = gsap.context(() => {
        gsap.fromTo('[data-rise]', { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.7, ease: 'power3.out', stagger: 0.07, overwrite: 'auto', clearProps: 'transform,opacity,visibility' })
      }, root)
    })
    return () => { fx.cancelled = true; fx.ctx?.revert() }
  }, [hasContract, dashView])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !hasContract) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); onCreateClick() }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hasContract, onCreateClick])

  const saveLabels = (next: Record<string, string>) => { setLabels(next); localStorage.setItem('circlepot.labels', JSON.stringify(next)) }
  const mySeats = circles.filter((row) => row.joined).length
  const totalPot = circles.reduce((sum, row) => sum + row.roundPot, 0n)
  const totalPaidOut = events.filter((e) => e.kind === 'RoundPaid').reduce((sum, e) => sum + BigInt(e.amountWei || '0'), 0n)
  const roundsDone = circles.reduce((sum, row) => sum + row.round, 0)
  const activeCircles = circles.filter((c) => !c.open && !c.completed && !c.cancelled)
  const visibleCircles = circles
    .filter((row) => filter === 'all' ? true : filter === 'open' ? row.open && !row.cancelled : filter === 'active' ? !row.open && !row.completed && !row.cancelled : row.joined)
    .filter((row) => { const q = query.trim().toLowerCase(); if (!q) return true; return row.name.toLowerCase().includes(q) || row.id.toString() === q || row.members.some((m) => m.toLowerCase().includes(q)) || (labels[row.creator.toLowerCase()] ?? '').toLowerCase().includes(q) })
    .sort((a, b) => sort === 'pot' ? Number(b.contribution * BigInt(Math.max(b.memberCount, 1)) - a.contribution * BigInt(Math.max(a.memberCount, 1))) : sort === 'filling' ? b.memberCount / b.maxMembers - a.memberCount / a.maxMembers : Number(b.id - a.id))

  const feed: FeedItem[] = useMemo(() => events.slice().reverse().map((e) => {
    const circle = circles.find((c) => c.id === e.circleId)
    let title: string = e.kind
    let detail = `Circle #${e.circleId}`
    if (e.kind === 'CircleCreated') { title = 'A new circle opened'; detail = circle?.name ?? detail }
    if (e.kind === 'MemberJoined') { title = 'Member joined'; detail = labelFor(labels, e.actor) }
    if (e.kind === 'ContributionMade') { title = 'Contribution received'; detail = `${formatPot(BigInt(e.amountWei || '0'))} POT Â· round ${e.round + 1} Â· ${labelFor(labels, e.actor)}` }
    if (e.kind === 'RoundPaid') { title = 'Round paid (claimable)'; detail = `${formatPot(BigInt(e.amountWei || '0'))} POT â†’ ${labelFor(labels, e.actor)}` }
    if (e.kind === 'RoundRefunded') { title = 'Round refunded (claimable)'; detail = `${formatPot(BigInt(e.amountWei || '0'))} POT credited back` }
    if (e.kind === 'ReturnsClaimed') { title = 'Returns claimed'; detail = `${formatPot(BigInt(e.amountWei || '0'))} POT Â· ${labelFor(labels, e.actor)}` }
    if (e.kind === 'CircleCompleted') { title = 'Circle completed'; detail = circle?.name ?? detail }
    if (e.kind === 'CircleCancelled') { title = 'Circle cancelled'; detail = circle?.name ?? detail }
    return { key: e.key, title, detail, circleId: e.circleId, hash: e.hash, block: e.block, kind: e.kind, actor: e.actor }
  }), [events, circles, labels])
  const visibleFeed = feed.filter((i) => (actFilter === 'all' || i.kind === actFilter) && (!actMine || !address || i.actor.toLowerCase() === address.toLowerCase())).slice(0, 80)

  const requestAction = (row: CircleRow, action: CircleAction) => {
    const pot = formatPot(row.contribution * BigInt(Math.max(row.memberCount, 1)))
    const specs: Record<CircleAction, ConfirmSpec> = {
      join: { title: `Join ${row.name}?`, cta: 'Join circle', estimate: { row, action }, lines: [{ label: 'Your seat', value: `Seat ${row.memberCount + 1} of ${row.maxMembers}` }, { label: 'Contribution', value: `${formatPot(row.contribution)} POT per round` }, { label: 'Payout order', value: 'Set by joining order â€” you receive in this seatâ€™s round' }], run: () => onAction(row, 'join') },
      contribute: { title: `Contribute to ${row.name}?`, cta: `Send ${formatPot(row.contribution)} POT`, estimate: { row, action }, warning: userBalance !== undefined && userBalance < row.contribution ? 'Your POT balance is below the contribution amount.' : undefined, lines: [{ label: 'You send', value: `${formatPot(row.contribution)} POT` }, { label: 'Round', value: `${row.round + 1} Â· ${row.paidCount}/${row.memberCount} funded so far` }, { label: 'When full, pays', value: `${pot} POT to seat ${row.memberCount ? (row.round % row.memberCount) + 1 : 1} (credited, then claimed)` }], run: () => onAction(row, 'contribute') },
      refund: { title: `Refund the stalled round?`, cta: 'Trigger refund', estimate: { row, action }, lines: [{ label: 'Returns', value: `${formatPot(row.roundPot)} POT credited back` }, { label: 'To', value: 'Every contributor, exact amounts, claimable instantly' }], run: () => onAction(row, 'refund') },
      cancel: { title: `Cancel ${row.name}?`, cta: 'Cancel circle', estimate: { row, action }, lines: [{ label: 'Effect', value: 'No new members can join. No funds are held yet, so nothing is trapped.' }], run: () => onAction(row, 'cancel') },
      leave: { title: `Leave ${row.name}?`, cta: 'Leave circle', estimate: { row, action }, lines: [{ label: 'Effect', value: 'Your seat is removed. Remaining seats keep their order. You can rejoin while it is still filling.' }], run: () => onAction(row, 'leave') },
    }
    setConfirm(specs[action])
  }
  const requestClaim = () => setConfirm({ title: 'Claim your POT?', cta: `Claim ${formatPot(claimable)} POT`, lines: [{ label: 'You receive', value: `${formatPot(claimable)} POT to your wallet` }, { label: 'From', value: 'Scheduled pots and refunds credited to you' }], run: onClaim })

  const submitContract = async () => {
    if (!isValidAddress(contractInput)) { toast.error('Enter a valid 0x contract address'); return }
    try { await onSetAddress(contractInput.trim() as Address); setContractInput(''); setShowContractForm(false); toast.success('CirclePot contract connected') }
    catch (error) { toast.error(errMsg(error, 'Could not connect to that contract')) }
  }
  const goCircle = (id: bigint) => { onSelect(id); setDashView('circles') }
  const exportCsv = () => {
    const rows = [['block', 'event', 'circle', 'round', 'amount_pot', 'actor', 'tx'], ...feed.map((i) => [String(i.block), i.kind, i.circleId.toString(), '', '', i.actor, i.hash])]
    events.forEach((e, idx) => { const row = rows[idx + 1]; if (row) { row[3] = String(e.round + 1); row[4] = formatUnits(BigInt(e.amountWei || '0'), NATIVE_DECIMALS) } })
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'circlepot-activity.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('Activity exported', { description: 'circlepot-activity.csv downloaded.' })
  }
  const navItems: { id: DashView; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={17} /> },
    { id: 'circles', label: 'Circles', icon: <Users size={17} />, count: circles.length },
    { id: 'activity', label: 'Activity', icon: <History size={17} />, count: feed.length },
    { id: 'settings', label: 'Contract', icon: <Settings size={17} /> },
  ]
  const viewTitle: Record<DashView, { title: string; sub: string }> = {
    overview: { title: 'Good money moves in good company.', sub: 'Your savings circles at a glance â€” what needs you, what is moving, what lands next.' },
    circles: { title: 'Circles', sub: 'Every circle on this contract. Open one for seats, the live round and the payout schedule.' },
    activity: { title: 'Activity', sub: 'The on-chain record for this contract, newest first. Every row opens on the explorer.' },
    settings: { title: 'Contract & settings', sub: 'The verified CirclePot contract, your address labels, and app preferences.' },
  }
  const invitedRow = invitedId && /^\d+$/.test(invitedId) ? circles.find((c) => c.id === BigInt(invitedId)) : undefined

  return <main className="x-shell" ref={shellRef}>
    <div className="x-subbar">
      <button className="x-back" onClick={onBack}><ArrowLeft size={15} /> CirclePot home</button>
      <div className="x-sub-right">
        <span className="x-livepill"><span className="status-dot" /> PORTALDOT V3 TESTNET Â· CHAIN 420420777</span>
        <button className="x-iconbtn" onClick={onRefresh} aria-label="Refresh circle data"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
      </div>
    </div>

    {!hasContract ? <>
      <div className="x-setup">
        <section className="x-setup-main" data-rise>
          <span className="eyebrow">ONE-TIME SETUP Â· PORTALDOT V3 TESTNET</span>
          <h1>Put your circle<br />on the chain.</h1>
          <p>Three quick steps and CirclePot is live. Your wallet approves everything â€” the app never holds keys or funds.</p>
          <div className="x-stepper">
            <div className={`x-step ${isConnected ? 'done' : 'active'}`}>
              <span className="x-step-num">{isConnected ? <Check size={16} /> : '01'}</span>
              <div><h4>Connect your wallet</h4><p>{isConnected ? `Connected as ${shortAddress(address)}` : 'Use MetaMask or any injected EVM wallet in this browser.'}</p></div>
              {isConnected ? <span className="x-step-done"><Check size={14} /> Connected</span> : <button className="x-btn x-btn-dark" onClick={() => void onConnectWallet()}><Wallet size={15} /> Connect wallet</button>}
            </div>
            <div className={`x-step ${correctNetwork && isConnected ? 'done' : isConnected ? 'active' : 'locked'}`}>
              <span className="x-step-num">{correctNetwork && isConnected ? <Check size={16} /> : '02'}</span>
              <div><h4>Switch to Portaldot V3</h4><p>Chain ID 420420777 Â· native POT. Added automatically if your wallet doesn't know it yet.</p></div>
              {correctNetwork && isConnected ? <span className="x-step-done"><Check size={14} /> On Portaldot</span> : <button className="x-btn x-btn-ghost" disabled={!isConnected} onClick={() => void onSwitchNetwork()}><RefreshCw size={14} /> Switch network</button>}
            </div>
            <div className={`x-step ${isConnected && correctNetwork ? 'active' : 'locked'}`}>
              <span className="x-step-num">03</span>
              <div><h4>Deploy CirclePot</h4><p>One transaction creates the shared contract for every circle you start here.</p></div>
              <button className="x-btn x-btn-dark" disabled={!isConnected || !correctNetwork || busyAction === 'deploy'} onClick={() => void onDeploy()}>{busyAction === 'deploy' ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} Deploy contract</button>
            </div>
          </div>
          <div className="x-have">
            <span>ALREADY DEPLOYED? CONNECT IT INSTEAD</span>
            <div className="row">
              <input value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="0xâ€¦ contract address" aria-label="Existing CirclePot contract address" />
              <button className="x-btn x-btn-ghost" onClick={() => void submitContract()}>Connect</button>
            </div>
          </div>
          <button className="text-link s-faucet-link" onClick={() => setFaucetOpen(true)}>Need test POT first? Here is how <ArrowUpRight size={13} /></button>
        </section>
        <aside className="x-setup-side" data-rise>
          <span className="eyebrow">WHAT YOU'RE DEPLOYING</span>
          <div className="x-orbit" aria-hidden="true"><div className="x-orbit-path" /><span className="x-orbit-p a">A</span><span className="x-orbit-p b">M</span><span className="x-orbit-p c">J</span><div className="x-orbit-center"><span className="brand-mark"><svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="15.5" stroke="currentColor" strokeWidth="2.2" /><path d="M20 4.5v8.1M35.5 20h-8.1M20 35.5v-8.1M4.5 20h8.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="20" cy="20" r="5.1" fill="currentColor" /></svg></span></div></div>
          <h3>One contract.<br />Every circle you run.</h3>
          <p>The contract holds each round's contributions and credits the scheduled member automatically when the round completes. No owner, no fees, no custodian.</p>
          <div className="x-setup-points">
            <span><ShieldCheck size={15} /> Fixed contribution, fixed payout order</span>
            <span><Clock size={15} /> Stalled rounds refundable after the chosen window</span>
            <span><Fingerprint size={15} /> Every move verifiable on the explorer</span>
          </div>
        </aside>
      </div>
      <div className="x-setup-foot"><span>DEPLOYMENT NEEDS ONE WALLET CONFIRMATION</span><span>NOTHING IS SENT WITHOUT YOUR APPROVAL</span></div>
    </> : <div className="s-layout">
      <aside className="s-side" data-rise>
        <span className="s-side-label">WORKSPACE</span>
        <nav className="s-nav" aria-label="App views">
          {navItems.map((item) => <button key={item.id} className={dashView === item.id ? 'sel' : ''} onClick={() => { setDashView(item.id); if (item.id !== 'circles') onSelect(null) }} aria-current={dashView === item.id ? 'page' : undefined}>{item.icon}<span>{item.label}</span>{item.count !== undefined && <span className="s-nav-count">{item.count}</span>}</button>)}
        </nav>
        <button className="s-side-create" onClick={onCreateClick}><Plus size={16} /> New circle</button>
        <button className="s-side-invite" onClick={() => setInviteOpen(true)}><UserPlus size={15} /> Invite to CirclePot</button>
        {claimable > 0n && <button className="s-claim-card" onClick={requestClaim}><span><Coins size={15} /> Ready to claim</span><strong>{formatPot(claimable)} POT</strong><small>Tap to withdraw to your wallet</small></button>}
        <div className="s-side-card">
          <span className="s-side-label">NETWORK</span>
          <div className="s-net"><span className="status-dot" /><div><strong>Portaldot V3</strong><small>{correctNetwork || !isConnected ? 'Testnet Â· 420420777' : 'Wallet on wrong chain'}</small></div></div>
          <div className="s-net"><ShieldCheck size={15} /><div><strong>Contract verified</strong><small>{shortAddress(contractAddress)}</small></div><a href={explorerAddressUrl(contractAddress)} target="_blank" rel="noreferrer" aria-label="View contract on explorer"><ExternalLink size={12} /></a></div>
          {isConnected && <div className="s-net"><Wallet size={15} /><div><strong>{userBalance !== undefined ? `${formatPotShort(userBalance)} POT` : 'Balanceâ€¦'}</strong><small>your test POT</small></div></div>}
        </div>
        <p className="s-side-foot">Live updates stream from the chain.<br />Writes always need your signature.<br />Shortcuts: <b>N</b> new circle Â· <b>/</b> search</p>
      </aside>

      <section className="s-main">
        <header className="s-head" data-rise>
          <div><h2>{selectedCircle && dashView === 'circles' ? selectedCircle.name : viewTitle[dashView].title}</h2><p>{selectedCircle && dashView === 'circles' ? `Circle #${selectedCircle.id} Â· ${selectedCircle.completed ? 'completed' : selectedCircle.cancelled ? 'cancelled' : selectedCircle.open ? 'filling seats' : `round ${selectedCircle.round + 1} in progress`}` : viewTitle[dashView].sub}</p></div>
          <div className="s-head-actions">
            <NotificationsBell circles={circles} events={events} address={address} claimable={claimable} onGoCircle={goCircle} onClaim={requestClaim} />
            <label className="s-search"><Search size={14} /><input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); if (dashView !== 'circles') setDashView('circles'); onSelect(null) }} placeholder="Search circles, seats, addressesâ€¦" aria-label="Search circles" /></label>
            <button className="x-btn x-btn-dark s-new" onClick={onCreateClick}><Plus size={16} /> New circle</button>
          </div>
        </header>

        {loadError && <div className="x-alert" role="alert"><CircleHelp size={16} /> {loadError} <button className="text-link" onClick={onRefresh}>Try again <RefreshCw size={13} /></button></div>}
        {isConnected && !correctNetwork && <div className="x-alert" role="alert"><CircleHelp size={16} /> Your wallet is on another network. <button className="text-link" onClick={() => void onSwitchNetwork()}>Switch to Portaldot <ArrowRight size={13} /></button></div>}
        {!isConnected && <div className="x-alert" role="alert"><Wallet size={16} /> You're browsing read-only. <button className="text-link" onClick={() => void onConnectWallet()}>Connect a wallet to join <ArrowRight size={13} /></button></div>}
        {refParam && isValidAddress(refParam) && refParam.toLowerCase() !== address?.toLowerCase() && !refDismissed && <div className="x-alert s-ref-alert" role="alert"><UserPlus size={16} /> <span><strong>{shortAddress(refParam)}</strong> invited you to CirclePot. Join a circle below, or start your own â€” seats pay out in joining order.</span> <button className="text-link" onClick={() => { setDashView('circles'); onSelect(null) }}>Browse circles <ArrowRight size={13} /></button><button className="x-iconbtn" onClick={() => setRefDismissed(true)} aria-label="Dismiss invite banner"><X size={13} /></button></div>}
        {claimable > 0n && isConnected && <div className="x-alert s-claim-alert" role="alert"><Coins size={16} /> You have <strong>{formatPot(claimable)} POT</strong> credited and ready. <button className="text-link" onClick={requestClaim}>Claim it now <ArrowRight size={13} /></button></div>}
        {invitedRow && invitedRow.open && !invitedRow.joined && !invitedRow.cancelled && <div className="s-invite" data-rise>
          <span className="s-invite-icon"><Users size={19} /></span>
          <div><strong>You've been invited to {invitedRow.name}</strong><p>{formatPot(invitedRow.contribution)} POT per round Â· seat {invitedRow.memberCount + 1} of {invitedRow.maxMembers} is open Â· joining order is payout order{invitedRow.inviteOnly ? ' Â· invite-only circle' : ''}.</p></div>
          {isConnected ? <button className="x-btn x-btn-dark" onClick={() => requestAction(invitedRow, 'join')}>Join this circle</button> : <button className="x-btn x-btn-dark" onClick={() => void onConnectWallet()}><Wallet size={15} /> Connect to join</button>}
          <button className="x-btn x-btn-ghost" onClick={() => goCircle(invitedRow.id)}>View details</button>
        </div>}

        {dashView === 'overview' && <>
          <section className="x-kpis s-kpis">
            <div className="x-kpi" data-rise><div className="x-kpi-top"><span>TOTAL CIRCLES</span><span className="x-kpi-icon"><Users size={16} /></span></div><strong><AnimatedNumber value={circles.length} /></strong><small>{circles.filter((c) => c.open && !c.cancelled).length} filling Â· {activeCircles.length} running Â· {circles.filter((c) => c.completed).length} completed</small></div>
            <div className="x-kpi" data-rise><div className="x-kpi-top"><span>POT IN PLAY</span><span className="x-kpi-icon ink"><Coins size={16} /></span></div><strong>{formatPot(totalPot)} <small>POT</small></strong><small>locked in open rounds</small></div>
            <div className="x-kpi" data-rise><div className="x-kpi-top"><span>PAID OUT TO DATE</span><span className="x-kpi-icon lime"><TrendingUp size={16} /></span></div><strong>{formatPot(totalPaidOut)} <small>POT</small></strong><small>{roundsDone} rounds completed</small></div>
            <div className="x-kpi" data-rise><div className="x-kpi-top"><span>YOUR POSITION</span><span className="x-kpi-icon"><Fingerprint size={16} /></span></div><strong><AnimatedNumber value={mySeats} /></strong><small>{claimable > 0n ? `${formatPot(claimable)} POT claimable` : isConnected ? shortAddress(address) : 'connect a wallet to join'}</small></div>
          </section>

          <div className="s-ov-grid">
            <PortfolioCard userBalance={userBalance} claimable={claimable} circles={circles} events={events} address={address} isConnected={isConnected} onClaim={requestClaim} onConnectWallet={onConnectWallet} />
            <GrowthChart events={events} address={address} />
          </div>
          <div className="s-ov-grid">
            <ActionCenter circles={circles} address={address} isConnected={isConnected} claimable={claimable} busyAction={busyAction} onRequestAction={requestAction} onClaim={requestClaim} onConnectWallet={onConnectWallet} onGoCircle={goCircle} onCreateClick={onCreateClick} />
            <FlowChart events={events} />
          </div>
          <div className="s-ov-grid">
            <section className="x-panel" data-rise>
              <div className="x-panel-head"><div><span className="eyebrow">RECENT CIRCLES</span><h3 className="s-panel-title">Latest on the contract</h3></div><button className="text-link" onClick={() => setDashView('circles')}>View all <ArrowRight size={13} /></button></div>
              <div className="s-recent">
                {circles.length === 0 ? <p className="s-muted">No circles yet â€” the first one starts with you.</p> : circles.slice(0, 5).map((row) => <button key={row.id.toString()} className="s-recent-row" onClick={() => goCircle(row.id)}>
                  <span className="x-ring s-ring-sm" aria-hidden="true"><svg width="40" height="40" viewBox="0 0 52 52"><circle className="ring-bg" cx="26" cy="26" r="21" fill="none" strokeWidth="5" /><circle className={`ring-fg ${row.open ? 'lime' : ''}`} cx="26" cy="26" r="21" fill="none" strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 21} strokeDashoffset={2 * Math.PI * 21 * (1 - Math.min(1, Math.max(0.03, row.open ? row.memberCount / row.maxMembers : row.memberCount ? row.paidCount / row.memberCount : 0)))} /></svg></span>
                  <span className="s-recent-copy"><b>{row.name}</b><small>#{row.id.toString().padStart(3, '0')} Â· {row.completed ? 'completed' : row.cancelled ? 'cancelled' : row.open ? `${row.memberCount}/${row.maxMembers} seats` : `round ${row.round + 1} Â· ${row.paidCount}/${row.memberCount} paid`}</small></span>
                  <span className={`x-pill ${row.completed ? 'x-pill-done' : row.cancelled ? 'x-pill-cancelled' : row.open ? 'x-pill-open' : 'x-pill-live'}`}>{row.completed ? 'COMPLETED' : row.cancelled ? 'CANCELLED' : row.open ? 'FILLING' : 'RUNNING'}</span>
                  <strong className="s-recent-amt">{formatPot(row.contribution)} POT</strong>
                </button>)}
              </div>
            </section>
            <section className="x-panel" data-rise>
              <div className="x-panel-head"><div><span className="eyebrow">COMING TO YOU</span><h3 className="s-panel-title">Your payout forecast</h3></div><button className="text-link" onClick={() => setDashView('activity')}>Activity <ArrowRight size={13} /></button></div>
              <ForecastList circles={circles} address={address} onGoCircle={goCircle} />
              <SeatDonut circles={circles} roundsDone={roundsDone} />
            </section>
          </div>
        </>}

        {dashView === 'overview' && <section className="s-invite-card" data-rise>
          <span className="s-invite-icon"><UserPlus size={19} /></span>
          <div><strong>Money moves better with your people in it.</strong><p>Invite friends to CirclePot with your personal link. When they land, they can join your circles or start their own â€” you get credited as their inviter.</p></div>
          <button className="x-btn x-btn-dark" onClick={() => setInviteOpen(true)}><Share2 size={15} /> Invite to CirclePot</button>
        </section>}

        {dashView === 'circles' && (selectedCircle ? <CircleDetail row={selectedCircle} circles={circles} events={events} labels={labels} currentAddress={address} isConnected={isConnected} busyAction={busyAction} paidStates={paidStates} onRequestAction={requestAction} onConnectWallet={onConnectWallet} onBack={() => onSelect(null)} onShare={() => setShareRow(selectedCircle)} />
        : <section className="x-panel" data-rise>
          <div className="x-panel-head">
            <div className="x-chips">
              {([['all', 'All'], ['open', 'Filling'], ['active', 'Running'], ['mine', 'Mine']] as const).map(([value, label]) => <button key={value} className={`x-chip ${filter === value ? 'sel' : ''}`} onClick={() => setFilter(value)}>{label}</button>)}
            </div>
            <label className="s-sort">Sort <select value={sort} onChange={(event) => setSort(event.target.value as 'new' | 'pot' | 'filling')} aria-label="Sort circles"><option value="new">Newest</option><option value="pot">Biggest pot</option><option value="filling">Filling fast</option></select></label>
          </div>
          <div className="x-list">
            {loading && circles.length === 0 ? <><div className="x-skel" /><div className="x-skel" /><div className="x-skel" /></>
              : visibleCircles.length === 0 ? <div className="x-empty"><div className="x-empty-icon"><Users size={22} /></div><h3>{circles.length === 0 ? 'The first circle starts here.' : 'Nothing matches.'}</h3><p>{circles.length === 0 ? 'Create a circle, set the contribution, then invite your group to take their seats.' : 'Try a different search or filter â€” or start a new circle.'}</p><button className="x-btn x-btn-dark" onClick={onCreateClick}><Plus size={15} /> Start a circle</button></div>
              : visibleCircles.map((row) => <CircleCard key={row.id.toString()} row={row} labels={labels} currentAddress={address} onSelect={() => goCircle(row.id)} onShare={() => setShareRow(row)} />)}
          </div>
        </section>)}

        {dashView === 'activity' && <section className="x-panel" data-rise>
          <div className="x-panel-head">
            <div className="x-chips">
              {([['all', 'All events'], ['ContributionMade', 'Contributions'], ['RoundPaid', 'Payouts'], ['ReturnsClaimed', 'Claims'], ['MemberJoined', 'Joins'], ['CircleCreated', 'Created'], ['RoundRefunded', 'Refunds']] as const).map(([value, label]) => <button key={value} className={`x-chip ${actFilter === value ? 'sel' : ''}`} onClick={() => setActFilter(value)}>{label}</button>)}
              <button className={`x-chip ${actMine ? 'sel' : ''}`} onClick={() => setActMine(!actMine)} disabled={!isConnected}>Mine only</button>
            </div>
            <button className="x-chip" onClick={exportCsv}><Download size={12} /> Export CSV</button>
          </div>
          <ActivityFeed items={visibleFeed} circles={circles} />
        </section>}

        {dashView === 'settings' && <div className="s-settings">
          <section className="x-panel" data-rise>
            <div className="x-panel-head"><div><span className="eyebrow">CONNECTED CONTRACT</span><h3 className="s-panel-title">CirclePot on Portaldot V3</h3></div><span className="x-pill x-pill-open"><span className="status-dot" /> VERIFIED ON CHAIN</span></div>
            <div className="s-set-body">
              <div className="s-kv"><span>Contract address</span><code>{contractAddress}</code><button className="x-iconbtn" onClick={async () => { if (await copyText(contractAddress)) toast.success('Contract address copied'); else toast.error('Could not copy') }} aria-label="Copy contract address"><Copy size={14} /></button><a className="x-iconbtn" href={explorerAddressUrl(contractAddress)} target="_blank" rel="noreferrer" aria-label="View contract on explorer"><ExternalLink size={14} /></a></div>
              <div className="s-kv-grid">
                <div className="s-kv"><span>Network</span><strong>Portaldot V3 Testnet</strong></div>
                <div className="s-kv"><span>Chain ID</span><strong>420420777</strong></div>
                <div className="s-kv"><span>RPC</span><strong className="s-mono-sm">test-evm-rpc-v3.portaldot.dev</strong></div>
                <div className="s-kv"><span>Native asset</span><strong>POT Â· 14 decimals</strong></div>
              </div>
              <div className="s-set-actions">
                <button className="x-btn x-btn-ghost" onClick={() => setFaucetOpen(true)}><Coins size={15} /> Get test POT</button>
                <button className="x-btn x-btn-ghost" onClick={() => setShowContractForm(!showContractForm)}><Settings size={15} /> Use a different contract</button>
              </div>
              {showContractForm && <div className="x-contract-form s-set-form">
                <div className="row"><input value={contractInput} onChange={(event) => setContractInput(event.target.value)} placeholder="0xâ€¦" aria-label="CirclePot contract address" /><button className="use" onClick={() => void submitContract()}>Use</button></div>
                <button className="x-contract-reset" onClick={onDisconnectContract}>Disconnect this contract and return to setup</button>
              </div>}
            </div>
          </section>
          <section className="x-panel" data-rise>
            <div className="x-panel-head"><div><span className="eyebrow">ADDRESS LABELS</span><h3 className="s-panel-title">Name the wallets in your circles</h3></div></div>
            <div className="s-set-body">
              <p className="s-muted" style={{ padding: 0 }}>Labels live only in this browser and make seats, activity and payouts human-readable.</p>
              <div className="s-label-form">
                <input value={labelAddr} onChange={(e) => setLabelAddr(e.target.value)} placeholder="0xâ€¦ address" aria-label="Address to label" />
                <input value={labelName} onChange={(e) => setLabelName(e.target.value)} placeholder="Name (e.g. Maya)" aria-label="Label name" />
                <button className="x-btn x-btn-dark" onClick={() => { if (!isValidAddress(labelAddr)) { toast.error('Enter a valid 0x address'); return } if (!labelName.trim()) { toast.error('Enter a name'); return } saveLabels({ ...labels, [labelAddr.trim().toLowerCase()]: labelName.trim().slice(0, 24) }); setLabelAddr(''); setLabelName(''); toast.success('Label saved') }}>Save label</button>
              </div>
              <div className="s-label-list">
                {Object.entries(labels).length === 0 ? <p className="s-muted">No labels yet.</p> : Object.entries(labels).map(([addr, name]) => <div key={addr} className="s-label-row"><strong>{name}</strong><code>{addr}</code><button onClick={() => { const next = { ...labels }; delete next[addr]; saveLabels(next) }} aria-label={`Remove label for ${name}`}><X size={13} /></button></div>)}
              </div>
            </div>
          </section>
          <section className="x-panel" data-rise>
            <div className="x-panel-head"><div><span className="eyebrow">THE RULES, IN PLAIN TERMS</span><h3 className="s-panel-title">What the contract guarantees</h3></div></div>
            <div className="s-rules-list">
              <div><ShieldCheck size={16} /><p><b>Fixed in, fixed order.</b> Every member contributes the same POT amount; joining order is payout order, set on chain.</p></div>
              <div><HandCoins size={16} /><p><b>Credited, then claimed.</b> When a round completes, the pot is credited to the next seat, who withdraws it any time. No wallet can block a round.</p></div>
              <div><Clock size={16} /><p><b>Refund window.</b> A partially funded round older than its window (chosen at creation, 1â€“30 days) can be refunded by anyone; exact amounts become claimable.</p></div>
              <div><LockKeyhole size={16} /><p><b>No custodian.</b> No owner withdrawal, no fees, no admin keys. A circle completes when every seat has been paid once.</p></div>
            </div>
          </section>
        </div>}

        <div className="x-foot"><span className="wordmark wordmark-small"><span className="brand-mark brand-mark-small"><svg viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="15.5" stroke="currentColor" strokeWidth="2.2" /><path d="M20 4.5v8.1M35.5 20h-8.1M20 35.5v-8.1M4.5 20h8.1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><circle cx="20" cy="20" r="5.1" fill="currentColor" /></svg></span>circlepot</span><span>PORTALDOT V3 Â· CHAIN 420420777</span><button className="text-link" onClick={() => setFaucetOpen(true)}>GET TEST POT <ArrowUpRight size={11} /></button></div>
      </section>
      <CreateCircleDialog open={showCreate} onOpenChange={(open) => { if (open !== showCreate) onCreateClick() }} onCreate={onCreate} busy={busyAction === 'create'} userAddress={address} />
      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} onEstimate={onEstimate} />
      <ShareDialog row={shareRow} contractAddress={contractAddress} onClose={() => setShareRow(null)} />
      <FaucetDialog open={faucetOpen} onOpenChange={setFaucetOpen} address={address} />
      <InviteAppDialog open={inviteOpen} onOpenChange={setInviteOpen} contractAddress={contractAddress} address={address} />
    </div>}
  </main>
}

function NotificationsBell({ circles, events, address, claimable, onGoCircle, onClaim }: {
  circles: CircleRow[]; events: ChainEvent[]; address?: Address; claimable: bigint;
  onGoCircle: (id: bigint) => void; onClaim: () => void;
}) {
  const [seenBlock, setSeenBlock] = useState(() => Number(localStorage.getItem('circlepot.seenBlock') ?? 0))
  const mine = address?.toLowerCase()
  const actionCount = circles.filter((c) => c.joined && !c.open && !c.completed && !c.cancelled && !c.paid).length + (claimable > 0n ? 1 : 0)
  const fresh = events.filter((e) => e.block > seenBlock && mine && (e.actor.toLowerCase() === mine || e.kind === 'CircleCompleted'))
  const badge = actionCount + fresh.length
  const markRead = () => { const latest = events.reduce((m, e) => Math.max(m, e.block), seenBlock); setSeenBlock(latest); localStorage.setItem('circlepot.seenBlock', String(latest)) }
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button className="x-iconbtn s-bell" aria-label={`Notifications${badge ? `, ${badge} unread` : ''}`}><Bell size={16} />{badge > 0 && <span className="s-bell-badge">{badge > 9 ? '9+' : badge}</span>}</button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="ddm s-notif" sideOffset={8} align="end" onCloseAutoFocus={markRead}>
        <div className="ddm-head"><span>NOTIFICATIONS</span><strong>{badge ? `${badge} thing${badge === 1 ? '' : 's'} for you` : 'All quiet'}</strong></div>
        <div className="ddm-sep" />
        {claimable > 0n && <DropdownMenu.Item className="ddm-item" onSelect={onClaim}><Coins size={14} /> Claim {formatPot(claimable)} POT ready</DropdownMenu.Item>}
        {circles.filter((c) => c.joined && !c.open && !c.completed && !c.cancelled && !c.paid).slice(0, 4).map((c) => <DropdownMenu.Item key={c.id.toString()} className="ddm-item" onSelect={() => onGoCircle(c.id)}><Zap size={14} /> Contribute to {c.name} Â· round {c.round + 1}</DropdownMenu.Item>)}
        {fresh.slice(-5).reverse().map((e) => <DropdownMenu.Item key={e.key} className="ddm-item" onSelect={() => onGoCircle(e.circleId)}><Check size={14} /> {e.kind === 'RoundPaid' ? `Payout credited Â· ${formatPot(BigInt(e.amountWei || '0'))} POT` : e.kind.replace(/([A-Z])/g, ' $1').trim()} Â· circle #{e.circleId.toString()}</DropdownMenu.Item>)}
        {badge === 0 && <div className="s-notif-empty">No new payouts, refunds or turns waiting on you.</div>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function ActionCenter({ circles, address, isConnected, claimable, busyAction, onRequestAction, onClaim, onConnectWallet, onGoCircle, onCreateClick }: {
  circles: CircleRow[]; address?: Address; isConnected: boolean; claimable: bigint; busyAction: string;
  onRequestAction: (circle: CircleRow, action: CircleAction) => void;
  onClaim: () => void; onConnectWallet: () => Promise<void>; onGoCircle: (id: bigint) => void; onCreateClick: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  type Item = { key: string; tone: 'action' | 'refund' | 'next' | 'join' | 'claim'; title: string; detail: string; cta: string; run: () => void }
  const items: Item[] = []
  if (isConnected && claimable > 0n) items.push({ key: 'claim', tone: 'claim', title: 'POT ready to claim', detail: `${formatPot(claimable)} POT from completed rounds and refunds is sitting in the contract for you.`, cta: `Claim ${formatPot(claimable)} POT`, run: onClaim })
  for (const row of circles) {
    if (row.completed || row.cancelled) continue
    const stalled = row.roundStartedAt > 0n && now >= Number(row.roundStartedAt) + row.refundWindowSec
    if (stalled && row.paidCount > 0) items.push({ key: `refund-${row.id}`, tone: 'refund', title: `Refund ready Â· ${row.name}`, detail: `Round ${row.round + 1} stalled with ${formatPot(row.roundPot)} POT in. Anyone can release it.`, cta: 'Refund now', run: () => onRequestAction(row, 'refund') })
    else if (isConnected && row.joined && !row.open && !row.paid) items.push({ key: `pay-${row.id}`, tone: 'action', title: `Your turn to contribute Â· ${row.name}`, detail: `Round ${row.round + 1} is ${row.paidCount}/${row.memberCount} funded. Your ${formatPot(row.contribution)} POT keeps it moving.`, cta: `Contribute ${formatPot(row.contribution)} POT`, run: () => onRequestAction(row, 'contribute') })
    else if (isConnected && row.joined && !row.open && row.members.length && row.members[row.round % row.members.length]?.toLowerCase() === address?.toLowerCase()) items.push({ key: `next-${row.id}`, tone: 'next', title: `You receive next Â· ${row.name}`, detail: `When round ${row.round + 1} completes, ${formatPot(row.contribution * BigInt(row.memberCount))} POT is credited to you.`, cta: 'View circle', run: () => onGoCircle(row.id) })
    else if (isConnected && row.open && !row.joined && row.memberCount < row.maxMembers) items.push({ key: `join-${row.id}`, tone: 'join', title: `Seats open Â· ${row.name}`, detail: `${row.maxMembers - row.memberCount} of ${row.maxMembers} seats left at ${formatPot(row.contribution)} POT a round.`, cta: 'View & join', run: () => onGoCircle(row.id) })
  }
  const shown = items.slice(0, 5)
  return <section className="x-panel" data-rise>
    <div className="x-panel-head"><div><span className="eyebrow">ACTION CENTER</span><h3 className="s-panel-title">Needs your attention</h3></div><span className={`x-pill ${shown.length ? 'x-pill-live' : 'x-pill-open'}`}>{shown.length ? `${shown.length} OPEN` : 'ALL CLEAR'}</span></div>
    <div className="s-actions-list">
      {shown.length === 0 ? <div className="s-caughtup"><span className="x-empty-icon"><Check size={20} /></span><div><b>All caught up.</b><p>{isConnected ? 'Nothing needs your signature right now. Start a circle or wait for the next round.' : 'Connect a wallet and CirclePot will queue your contributions, payouts and refunds here.'}</p></div>{isConnected ? <button className="x-btn x-btn-dark" onClick={onCreateClick}><Plus size={14} /> New circle</button> : <button className="x-btn x-btn-dark" onClick={() => void onConnectWallet()}><Wallet size={14} /> Connect wallet</button>}</div>
        : shown.map((item) => <div key={item.key} className="s-action-row">
          <span className={`s-action-icon ${item.tone}`}>{item.tone === 'refund' ? <RefreshCw size={15} /> : item.tone === 'claim' ? <Coins size={15} /> : item.tone === 'next' ? <TrendingUp size={15} /> : item.tone === 'join' ? <Users size={15} /> : <Zap size={15} />}</span>
          <span className="s-action-copy"><b>{item.title}</b><small>{item.detail}</small></span>
          <button className={`x-btn ${item.tone === 'next' || item.tone === 'join' ? 'x-btn-ghost' : 'x-btn-dark'} s-action-btn`} disabled={busyAction !== '' && item.tone !== 'next' && item.tone !== 'join'} onClick={item.run}>{item.cta}</button>
        </div>)}
    </div>
  </section>
}

function FlowChart({ events }: { events: ChainEvent[] }) {
  const { buckets, peak } = useMemo(() => {
    const flow = events.filter((e) => e.kind === 'ContributionMade' || e.kind === 'RoundPaid' || e.kind === 'RoundRefunded')
    if (flow.length < 2) return { buckets: [] as { contrib: number; payout: number; net: number }[], peak: 1 }
    const min = Math.min(...flow.map((e) => e.block))
    const max = Math.max(...flow.map((e) => e.block))
    const span = Math.max(1, max - min + 1)
    const count = 14
    const out = Array.from({ length: count }, () => ({ contrib: 0, payout: 0, net: 0 }))
    let running = 0
    const sorted = [...flow].sort((a, b) => a.block - b.block)
    for (const e of sorted) {
      const idx = Math.min(count - 1, Math.floor(((e.block - min) / span) * count))
      const pot = Number(formatUnits(BigInt(e.amountWei || '0'), NATIVE_DECIMALS))
      if (e.kind === 'ContributionMade') { out[idx].contrib += pot; running += pot }
      else { out[idx].payout += pot; running -= pot }
      out[idx].net = Math.max(0, running)
    }
    let lastNet = 0
    for (const b of out) { if (b.contrib || b.payout) lastNet = b.net; else b.net = lastNet }
    return { buckets: out, peak: Math.max(1, ...out.map((b) => Math.max(b.contrib, b.payout, b.net))) }
  }, [events])
  return <section className="x-panel" data-rise>
    <div className="x-panel-head"><div><span className="eyebrow">POT FLOW</span><h3 className="s-panel-title">In, out, and still in play</h3></div><ActivityIcon size={15} className="s-muted-icon" /></div>
    {buckets.length === 0 ? <p className="s-muted s-chart-empty">Not enough on-chain flow yet to chart. Contributions and payouts will draw here as circles run.</p> : <>
      <div className="s-chart" role="img" aria-label="Bar chart of POT contributed, paid out, and net POT still in play">
        {buckets.map((b, i) => <div key={i} className="s-bar-pair" title={`In ${b.contrib.toFixed(2)} POT Â· Out ${b.payout.toFixed(2)} POT Â· In play ${b.net.toFixed(2)} POT`}>
          <span className="s-bar contrib" style={{ height: `${Math.max(b.contrib ? 6 : 0, (b.contrib / peak) * 100)}%` }} />
          <span className="s-bar payout" style={{ height: `${Math.max(b.payout ? 6 : 0, (b.payout / peak) * 100)}%` }} />
          <span className="s-bar net" style={{ height: `${Math.max(b.net ? 4 : 0, (b.net / peak) * 100)}%` }} />
        </div>)}
      </div>
      <div className="s-legend"><span><i className="dot contrib" /> Contributed</span><span><i className="dot payout" /> Paid out</span><span><i className="dot net" /> Still in play</span><span className="s-legend-peak">Peak {peak.toLocaleString('en-US', { maximumFractionDigits: 1 })} POT</span></div>
    </>}
  </section>
}

function SeatDonut({ circles, roundsDone }: { circles: CircleRow[]; roundsDone: number }) {
  const totalSeats = circles.reduce((s, c) => s + c.maxMembers, 0)
  const filled = circles.reduce((s, c) => s + c.memberCount, 0)
  const pct = totalSeats ? Math.round((filled / totalSeats) * 100) : 0
  const r = 34
  const circ = 2 * Math.PI * r
  return <div className="s-donut-wrap">
    <div className="s-donut" role="img" aria-label={`${pct}% of seats filled`}>
      <svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r={r} fill="none" stroke="#e9eae4" strokeWidth="10" /><circle cx="46" cy="46" r={r} fill="none" stroke="#8975f5" strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} transform="rotate(-90 46 46)" /></svg>
      <div className="s-donut-center"><strong>{pct}%</strong><span>SEATS FILLED</span></div>
    </div>
    <div className="s-donut-stats">
      <div><span>Seats taken</span><strong>{filled} / {totalSeats}</strong></div>
      <div><span>Rounds completed</span><strong>{roundsDone}</strong></div>
      <div><span>Circles live</span><strong>{circles.filter((c) => !c.completed && !c.cancelled).length}</strong></div>
    </div>
  </div>
}

function ForecastList({ circles, address, onGoCircle }: { circles: CircleRow[]; address?: Address; onGoCircle: (id: bigint) => void }) {
  const mine = address?.toLowerCase()
  const rows = circles.filter((c) => c.joined && !c.open && !c.completed && !c.cancelled && c.memberCount > 0).map((c) => {
    const mySeat = c.members.findIndex((m) => m.toLowerCase() === mine)
    if (mySeat < 0) return null
    const pos = c.round % c.memberCount
    const offset = (mySeat - pos + c.memberCount) % c.memberCount
    return { circle: c, offset, amount: c.contribution * BigInt(c.memberCount), roundLabel: offset === 0 ? `this round (${c.round + 1})` : `round ${c.round + offset + 1}` }
  }).filter(Boolean) as { circle: CircleRow; offset: number; amount: bigint; roundLabel: string }[]
  rows.sort((a, b) => a.offset - b.offset)
  const total = rows.reduce((s, r) => s + r.amount, 0n)
  if (!rows.length) return <p className="s-muted" style={{ padding: '12px 18px' }}>Join a running circle and your upcoming payouts will line up here.</p>
  return <div className="s-forecast">
    {rows.slice(0, 4).map((r) => <button key={r.circle.id.toString()} className="s-forecast-row" onClick={() => onGoCircle(r.circle.id)}>
      <span className="s-forecast-copy"><b>{r.circle.name}</b><small>{r.offset === 0 ? 'You receive when this round completes' : `Pays in ${r.roundLabel}`}</small></span>
      <strong>{formatPot(r.amount)} POT</strong>
    </button>)}
    <div className="s-forecast-total"><span>Expected across your circles</span><strong>{formatPot(total)} POT</strong></div>
  </div>
}

function CreateCircleDialog({ open, onOpenChange, onCreate, busy, userAddress }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  onCreate: (name: string, amount: string, maxMembers: number, refundDays: number, invited: Address[]) => Promise<void>; busy: boolean; userAddress?: Address;
}) {
  const [name, setName] = useState('Friday Circle')
  const [amount, setAmount] = useState('100')
  const [members, setMembers] = useState(4)
  const [refundDays, setRefundDays] = useState(7)
  const [invitedText, setInvitedText] = useState('')
  const [amountError, setAmountError] = useState('')
  const nameBytes = new TextEncoder().encode(name.trim()).length
  let fullPot = 'â€”'
  try { if (amount) fullPot = formatPot(amountToWei(amount) * BigInt(members)) } catch { /* still typing */ }
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!nameBytes || nameBytes > 48) { toast.error('Give your circle a name that fits within 48 UTF-8 bytes.'); return }
    if (!amount || /^0+(?:\.0*)?$/.test(amount)) { toast.error('Enter a contribution greater than zero.'); return }
    try { amountToWei(amount) } catch { toast.error('Enter a valid amount with up to 14 decimal places.'); return }
    const invited = invitedText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    if (invited.length > 12) { toast.error('At most 12 invited addresses.'); return }
    for (const addr of invited) if (!isValidAddress(addr)) { toast.error(`Invalid invited address: ${addr.slice(0, 14)}â€¦`); return }
    const unique = [...new Set(invited.map((a) => a.toLowerCase()))] as Address[]
    if (unique.length > members) { toast.error('You invited more addresses than there are seats.'); return }
    await onCreate(name, amount, members, refundDays, unique)
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dlg-overlay" />
      <Dialog.Content className="dlg" aria-describedby={undefined}>
        <div className="dlg-head">
          <div><span className="eyebrow">START SOMETHING GOOD</span><Dialog.Title asChild><h2>Set up a circle</h2></Dialog.Title><p className="dlg-desc">Pick a name, a fixed contribution, seats, and how long a stalled round waits before refunds unlock. Joining order becomes payout order.</p></div>
          <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
        </div>
        <form className="cf" onSubmit={submit}>
          <label>CIRCLE NAME<input className="cf-name" type="text" autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={48} placeholder="Friday Circle" aria-invalid={nameBytes > 48} /></label>
          <label>CONTRIBUTION PER PERSON, PER ROUND
            <div className="cf-amount"><input inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setAmountError('') }} onBlur={() => { try { if (amount && amountToWei(amount) <= 0n) setAmountError('Must be more than zero.') } catch { setAmountError('Use up to 14 decimal places.') } }} aria-invalid={!!amountError} placeholder="100" /><span>POT</span></div>
            {amountError && <small className="cf-error">{amountError}</small>}
          </label>
          <label>SEATS IN THE CIRCLE
            <div className="cf-seats">{[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((value) => <button type="button" key={value} className={members === value ? 'sel' : ''} onClick={() => setMembers(value)} aria-pressed={members === value}>{value}</button>)}</div>
          </label>
          <label>REFUND UNLOCKS AFTER A STALLED ROUND OF
            <div className="cf-seats cf-days">{[3, 7, 14, 30].map((value) => <button type="button" key={value} className={refundDays === value ? 'sel' : ''} onClick={() => setRefundDays(value)} aria-pressed={refundDays === value}>{value} days</button>)}</div>
          </label>
          <label>RESERVE SEATS (OPTIONAL, ONE ADDRESS PER LINE)
            <textarea className="cf-invited" value={invitedText} onChange={(e) => setInvitedText(e.target.value)} placeholder={'0xâ€¦ invited wallet\nLeave empty for an open circle'} rows={3} />
            <small className="cf-hint">With addresses listed, only they{userAddress ? ' (plus you)' : ''} can join. Leave empty and anyone with the link can take a seat.</small>
          </label>
          <div className="cf-preview"><div><span>EVERY FULL ROUND PAYS</span><br /><strong>{fullPot} <small>POT</small></strong></div><em>credited to the next seat<br />in joining order</em></div>
          <div className="cf-note"><LockKeyhole size={14} /><span>You take a seat by joining after creating. The circle completes when every seat has been paid once; pots are claimed, never pushed, so no wallet can block a round.</span></div>
          <div className="dlg-actions">
            <Dialog.Close asChild><button type="button" className="x-btn x-btn-ghost">Cancel</button></Dialog.Close>
            <button type="submit" className="x-btn x-btn-dark" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Plus size={15} />} Open circle <ArrowRight size={15} /></button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function ConfirmDialog({ spec, onClose, onEstimate }: {
  spec: ConfirmSpec | null;
  onClose: () => void;
  onEstimate: (circle: CircleRow, action: CircleAction) => Promise<{ feeText?: string; error?: string }>;
}) {
  const [estFor, setEstFor] = useState<{ spec: ConfirmSpec; result: { feeText?: string; error?: string } } | null>(null)
  const est = spec && estFor?.spec === spec ? estFor.result : null
  const [running, setRunning] = useState(false)
  useEffect(() => {
    if (!spec?.estimate) return
    let live = true
    void onEstimate(spec.estimate.row, spec.estimate.action).then((r) => { if (live) setEstFor({ spec, result: r }) }).catch(() => { if (live) setEstFor({ spec, result: { error: 'Could not simulate this transaction.' } }) })
    return () => { live = false }
  }, [spec, onEstimate])
  return <Dialog.Root open={!!spec} onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dlg-overlay" />
      <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
        {spec && <>
          <div className="dlg-head">
            <div><span className="eyebrow">REVIEW BEFORE SIGNING</span><Dialog.Title asChild><h2>{spec.title}</h2></Dialog.Title></div>
            <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
          </div>
          <div className="s-confirm-lines">
            {spec.lines.map((l) => <div key={l.label}><span>{l.label}</span><strong>{l.value}</strong></div>)}
            <div><span>Estimated network fee</span><strong>{spec.estimate ? (est === null ? 'Simulatingâ€¦' : est.error ? 'â€”' : est.feeText ?? 'â€”') : 'Wallet will quote it'}</strong></div>
          </div>
          {(spec.warning || est?.error) && <div className="s-confirm-warn"><CircleHelp size={15} /> {est?.error ? `Simulation failed: ${est.error}` : spec.warning}</div>}
          <p className="dlg-desc">Your wallet will ask you to approve the exact transaction. Nothing moves until you sign.</p>
          <div className="dlg-actions">
            <Dialog.Close asChild><button className="x-btn x-btn-ghost">Back</button></Dialog.Close>
            <button className="x-btn x-btn-dark" disabled={running || !!est?.error} onClick={async () => { setRunning(true); try { await spec.run(); onClose() } finally { setRunning(false) } }}>{running ? <LoaderCircle size={15} className="spin" /> : null} {spec.cta}</button>
          </div>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function ShareDialog({ row, contractAddress, onClose }: { row: CircleRow | null; contractAddress: string; onClose: () => void }) {
  const url = row ? `${location.origin}${location.pathname}?app=1&circle=${row.id}&contract=${contractAddress}` : ''
  // Callback ref: Radix mounts portal content after effects run, so draw when the canvas appears.
  const drawQr = (node: HTMLCanvasElement | null) => { if (node && url) void qrToCanvas(node, url, { width: 184, margin: 1, color: { dark: '#17191a', light: '#ffffff' } }).catch((e) => console.warn('QR render failed', e)) }
  return <Dialog.Root open={!!row} onOpenChange={(open) => { if (!open) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dlg-overlay" />
      <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
        {row && <>
          <div className="dlg-head">
            <div><span className="eyebrow">INVITE TO {row.name.toUpperCase()}</span><Dialog.Title asChild><h2>Share this circle</h2></Dialog.Title><p className="dlg-desc">Anyone with this link lands on the circle. {row.inviteOnly ? 'Only invited wallets can take a seat.' : 'First come, first seated â€” joining order is payout order.'}</p></div>
            <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
          </div>
          <div className="s-share-qr"><canvas ref={drawQr} width={184} height={184} aria-label="QR code for the invite link" /></div>
          <div className="s-share-link"><code>{url}</code></div>
          <div className="dlg-actions">
            <Dialog.Close asChild><button className="x-btn x-btn-ghost">Done</button></Dialog.Close>
            <button className="x-btn x-btn-dark" onClick={async () => { if (await copyText(url)) toast.success('Invite link copied'); else toast.error('Could not copy the invite link') }}><Copy size={15} /> Copy invite link</button>
          </div>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function FaucetDialog({ open, onOpenChange, address }: { open: boolean; onOpenChange: (open: boolean) => void; address?: Address }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dlg-overlay" />
      <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
        <div className="dlg-head">
          <div><span className="eyebrow">TEST POT</span><Dialog.Title asChild><h2>Get test POT</h2></Dialog.Title><p className="dlg-desc">Portaldot V3 testnet POT has no real value. It is distributed through the Portaldot community channels:</p></div>
          <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
        </div>
        <div className="s-faucet-steps">
          <div><i>1</i><p><b>Join the Portaldot Discord</b> and open the testnet/faucet channel.</p></div>
          <div><i>2</i><p><b>Share your wallet address</b>{address ? <> â€” yours is <code>{shortAddress(address)}</code> (copy below)</> : ' â€” connect a wallet first so you have one'}.</p></div>
          <div><i>3</i><p><b>Wait for the drip</b>, then check your balance in the sidebar. Deployment plus a few circles needs only a small amount.</p></div>
        </div>
        <div className="dlg-actions">
          {address && <button className="x-btn x-btn-ghost" onClick={async () => { if (await copyText(address)) toast.success('Wallet address copied'); else toast.error('Could not copy') }}><Copy size={14} /> Copy my address</button>}
          <a className="x-btn x-btn-dark" href="https://discord.gg/portaldot" target="_blank" rel="noreferrer">Open Discord <ArrowUpRight size={14} /></a>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}


function PortfolioCard({ userBalance, claimable, circles, events, address, isConnected, onClaim, onConnectWallet }: {
  userBalance?: bigint; claimable: bigint; circles: CircleRow[]; events: ChainEvent[]; address?: Address; isConnected: boolean;
  onClaim: () => void; onConnectWallet: () => Promise<void>;
}) {
  const mine = address?.toLowerCase()
  const locked = circles.filter((c) => c.joined && !c.open && c.paid && !c.completed && !c.cancelled).reduce((s, c) => s + c.contribution, 0n)
  const contributed = events.filter((e) => e.kind === 'ContributionMade' && e.actor.toLowerCase() === mine).reduce((s, e) => s + BigInt(e.amountWei || '0'), 0n)
  const received = events.filter((e) => e.kind === 'RoundPaid' && e.actor.toLowerCase() === mine).reduce((s, e) => s + BigInt(e.amountWei || '0'), 0n)
  const claimed = events.filter((e) => e.kind === 'ReturnsClaimed' && e.actor.toLowerCase() === mine).reduce((s, e) => s + BigInt(e.amountWei || '0'), 0n)
  const wallet = userBalance ?? 0n
  const total = wallet + claimable + locked
  const pct = (v: bigint) => (total > 0n ? Math.max(0, Number((v * 1000n) / total) / 10) : 0)
  return <section className="x-panel s-portfolio" data-rise>
    <div className="x-panel-head"><div><span className="eyebrow">YOUR BALANCE</span><h3 className="s-panel-title">Net position</h3></div><Wallet size={15} className="s-muted-icon" /></div>
    {!isConnected ? <div className="s-port-empty"><p>Connect a wallet to see your POT balance, claimable pots and what you have working in circles.</p><button className="x-btn x-btn-dark" onClick={() => void onConnectWallet()}><Wallet size={14} /> Connect wallet</button></div> : <>
      <div className="s-port-total"><span>TOTAL POSITION</span><strong>{formatPotShort(total)} <small>POT</small></strong><small>wallet + claimable + locked in rounds</small></div>
      <div className="s-alloc" role="img" aria-label={`Allocation: wallet ${pct(wallet)}%, claimable ${pct(claimable)}%, locked ${pct(locked)}%`}>
        <span className="seg wallet" style={{ width: `${pct(wallet)}%` }} />
        <span className="seg claim" style={{ width: `${pct(claimable)}%` }} />
        <span className="seg locked" style={{ width: `${pct(locked)}%` }} />
      </div>
      <div className="s-port-rows">
        <div><span><i className="dot wallet" /> In your wallet</span><strong>{formatPotShort(wallet)} POT</strong></div>
        <div><span><i className="dot claim" /> Ready to claim</span>{claimable > 0n ? <button className="text-link" onClick={onClaim}>{formatPotShort(claimable)} POT Â· Claim <ArrowRight size={12} /></button> : <strong>0 POT</strong>}</div>
        <div><span><i className="dot locked" /> Locked in open rounds</span><strong>{formatPotShort(locked)} POT</strong></div>
        <div className="s-port-life"><span>Contributed all-time</span><strong>{formatPotShort(contributed)} POT</strong></div>
        <div className="s-port-life"><span>Pots credited to you</span><strong>{formatPotShort(received)} POT</strong></div>
        <div className="s-port-life"><span>Claimed to wallet</span><strong>{formatPotShort(claimed)} POT</strong></div>
      </div>
    </>}
  </section>
}

function GrowthChart({ events, address }: { events: ChainEvent[]; address?: Address }) {
  const [show, setShow] = useState({ paid: true, contrib: true, mine: true })
  const mine = address?.toLowerCase()
  const model = useMemo(() => {
    const flow = events.filter((e) => e.kind === 'ContributionMade' || e.kind === 'RoundPaid' || e.kind === 'RoundRefunded').slice().sort((a, b) => a.block - b.block)
    if (flow.length < 2) return null
    const acc = { c: 0, paid: 0, my: 0 }
    const pts = flow.map((e) => {
      const v = Number(formatUnits(BigInt(e.amountWei || '0'), NATIVE_DECIMALS))
      if (e.kind === 'ContributionMade') acc.c += v
      if (e.kind === 'RoundPaid') { acc.paid += v; if (e.actor.toLowerCase() === mine) acc.my += v }
      return { block: e.block, c: acc.c, paid: acc.paid, my: acc.my }
    })
    const { c, paid, my } = acc
    const refunds = flow.filter((e) => e.kind === 'RoundRefunded').reduce((s, e) => s + Number(formatUnits(BigInt(e.amountWei || '0'), NATIVE_DECIMALS)), 0)
    const max = Math.max(1, ...pts.map((p) => Math.max(p.c, p.paid, p.my)))
    const minB = pts[0].block, maxB = pts[pts.length - 1].block
    const X = (b: number) => 8 + ((b - minB) / Math.max(1, maxB - minB)) * 604
    const Y = (v: number) => 196 - (v / max) * 178
    const line = (key: 'c' | 'paid' | 'my') => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p.block).toFixed(1)},${Y(p[key]).toFixed(1)}`).join(' ')
    const area = `${line('paid')} L${X(maxB).toFixed(1)},196 L${X(minB).toFixed(1)},196 Z`
    return { pts, max, line, area, totalPaid: paid, totalContrib: c, totalMine: my, refunds, last: pts[pts.length - 1] }
  }, [events, mine])
  return <section className="x-panel" data-rise>
    <div className="x-panel-head"><div><span className="eyebrow">GROWTH</span><h3 className="s-panel-title">POT over time</h3></div><TrendingUp size={15} className="s-muted-icon" /></div>
    {!model ? <p className="s-muted s-chart-empty">Your growth curve draws itself as POT moves â€” contributions in, pots out, your share growing.</p> : <>
      <div className="s-growth-stats">
        <div><span>PAID OUT</span><strong>{model.totalPaid.toLocaleString('en-US', { maximumFractionDigits: 2 })} POT</strong></div>
        <div><span>CONTRIBUTED</span><strong>{model.totalContrib.toLocaleString('en-US', { maximumFractionDigits: 2 })} POT</strong></div>
        <div><span>YOUR POTS</span><strong>{model.totalMine.toLocaleString('en-US', { maximumFractionDigits: 2 })} POT</strong></div>
      </div>
      <svg className="s-growth" viewBox="0 0 620 210" role="img" aria-label={`Cumulative growth chart. Paid out ${model.totalPaid} POT, contributed ${model.totalContrib} POT.`}>
        <defs><linearGradient id="growthFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8975f5" stopOpacity="0.32" /><stop offset="100%" stopColor="#8975f5" stopOpacity="0.02" /></linearGradient></defs>
        {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} x1="8" x2="612" y1={196 - 178 * f} y2={196 - 178 * f} stroke="#e9eae4" strokeDasharray="3 5" />)}
        {show.paid && <path d={model.area} fill="url(#growthFill)" />}
        {show.contrib && <path d={model.line('c')} fill="none" stroke="#9fbf3a" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />}
        {show.paid && <path d={model.line('paid')} fill="none" stroke="#8975f5" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />}
        {show.mine && model.totalMine > 0 && <path d={model.line('my')} fill="none" stroke="#17191a" strokeWidth="2" strokeDasharray="6 5" strokeLinejoin="round" strokeLinecap="round" />}
      </svg>
      <div className="s-legend s-growth-legend">
        <button className={show.paid ? 'on' : ''} onClick={() => setShow({ ...show, paid: !show.paid })}><i className="dot payout" /> Paid out</button>
        <button className={show.contrib ? 'on' : ''} onClick={() => setShow({ ...show, contrib: !show.contrib })}><i className="dot contrib" /> Contributed</button>
        <button className={show.mine ? 'on' : ''} onClick={() => setShow({ ...show, mine: !show.mine })}><i className="dot mine" /> Your pots</button>
        <span className="s-legend-peak">Peak {model.max.toLocaleString('en-US', { maximumFractionDigits: 1 })} POT</span>
      </div>
    </>}
  </section>
}

function InviteAppDialog({ open, onOpenChange, contractAddress, address }: { open: boolean; onOpenChange: (open: boolean) => void; contractAddress: string; address?: Address }) {
  const [sent, setSent] = useState(() => Number(localStorage.getItem('circlepot.invitesSent') ?? 0))
  const url = `${location.origin}${location.pathname}?app=1&contract=${contractAddress}${address ? `&ref=${address}` : ''}`
  const drawQr = (node: HTMLCanvasElement | null) => { if (node) void qrToCanvas(node, url, { width: 184, margin: 1, color: { dark: '#17191a', light: '#ffffff' } }).catch((e) => console.warn('QR render failed', e)) }
  const bump = () => { const next = sent + 1; setSent(next); localStorage.setItem('circlepot.invitesSent', String(next)) }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="dlg-overlay" />
      <Dialog.Content className="dlg dlg-sm" aria-describedby={undefined}>
        <div className="dlg-head">
          <div><span className="eyebrow">INVITE TO CIRCLEPOT</span><Dialog.Title asChild><h2>Bring your people in</h2></Dialog.Title><p className="dlg-desc">Your personal CirclePot link{sent > 0 ? ` â€” shared ${sent} time${sent === 1 ? '' : 's'} from this browser` : ''}. Friends land in the app with this contract attached and you as their inviter.</p></div>
          <Dialog.Close asChild><button className="dlg-x" aria-label="Close"><X size={16} /></button></Dialog.Close>
        </div>
        <div className="s-share-qr"><canvas ref={drawQr} width={184} height={184} aria-label="QR code for your CirclePot invite link" /></div>
        <div className="s-share-link"><code>{url}</code></div>
        <div className="dlg-actions">
          {typeof navigator !== 'undefined' && 'share' in navigator && <button className="x-btn x-btn-ghost" onClick={async () => { try { await navigator.share({ title: 'CirclePot', text: 'Join me on CirclePot â€” rotating savings circles on Portaldot.', url }); bump() } catch { /* user closed the share sheet */ } }}><Share2 size={14} /> Shareâ€¦</button>}
          <button className="x-btn x-btn-dark" onClick={async () => { if (await copyText(url)) { bump(); toast.success('Invite link copied', { description: 'Send it to the people in your circle.' }) } else toast.error('Could not copy the invite link') }}><Copy size={15} /> Copy invite link</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function statusPill(row: CircleRow) {
  if (row.completed) return <span className="x-pill x-pill-done">COMPLETED</span>
  if (row.cancelled) return <span className="x-pill x-pill-cancelled">CANCELLED</span>
  return <span className={`x-pill ${row.open ? 'x-pill-open' : 'x-pill-live'}`}><span className="status-dot" />{row.open ? 'FILLING' : 'RUNNING'}</span>
}

function CircleCard({ row, labels, currentAddress, onSelect, onShare }: {
  row: CircleRow; labels: Record<string, string>; currentAddress?: Address; onSelect: () => void; onShare: () => void;
}) {
  const progress = row.open ? row.memberCount / row.maxMembers : row.memberCount ? row.paidCount / row.memberCount : 0
  const nextSeat = row.memberCount ? (row.round % row.memberCount) + 1 : 1
  const circumference = 2 * Math.PI * 21
  return <article className="x-card">
    <div className="x-card-head" role="button" tabIndex={0} onClick={onSelect} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }} aria-label={`Open ${row.name} details`}>
      <span className="x-ring" aria-hidden="true">
        <svg width="52" height="52" viewBox="0 0 52 52"><circle className="ring-bg" cx="26" cy="26" r="21" fill="none" strokeWidth="4" /><circle className={`ring-fg ${row.open ? 'lime' : ''}`} cx="26" cy="26" r="21" fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0.03, progress)))} /></svg>
        <span className="x-ring-center">{row.open ? `${row.memberCount}/${row.maxMembers}` : `${row.paidCount}/${row.memberCount}`}</span>
      </span>
      <span className="x-card-titles">
        <span className="x-card-titleline"><h3>{row.name}</h3>{statusPill(row)}{row.inviteOnly && <span className="x-pill x-pill-you">INVITE ONLY</span>}{row.joined && <span className="x-pill x-pill-you">YOUR SEAT {row.members.findIndex((m) => m.toLowerCase() === currentAddress?.toLowerCase()) + 1}</span>}</span>
        <p className="x-card-meta">#{row.id.toString().padStart(3, '0')} Â· {row.completed ? `${row.memberCount} rounds Â· everyone paid` : row.cancelled ? 'cancelled by creator' : row.open ? `${row.maxMembers - row.memberCount} ${row.maxMembers - row.memberCount === 1 ? 'seat' : 'seats'} left` : `ROUND ${row.round + 1} Â· SEAT ${nextSeat} RECEIVES NEXT`}</p>
        <span className="x-avatars" aria-hidden="true">
          {Array.from({ length: Math.min(row.maxMembers, 6) }, (_, i) => { const m = row.members[i]; return <span key={i} className={`x-ava ${m ? (m.toLowerCase() === currentAddress?.toLowerCase() ? 'you' : '') : 'empty'}`}>{m ? (labels[m.toLowerCase()]?.slice(0, 1).toUpperCase() ?? m.slice(2, 3).toUpperCase()) : '+'}</span> })}
          {row.maxMembers > 6 && <span className="x-ava-more">+{row.maxMembers - 6} seats</span>}
        </span>
      </span>
      <span className="x-card-amount"><span>PER PERSON</span><strong>{formatPot(row.contribution)} <small>POT</small></strong><em>{row.open ? 'each round' : `pot ${formatPot(row.roundPot)} of ${formatPot(row.contribution * BigInt(Math.max(row.memberCount, 1)))}`}</em></span>
      <span className="s-card-actions" onClick={(e) => e.stopPropagation()}>
        <button className="x-iconbtn" onClick={onShare} aria-label={`Share ${row.name} invite`}><QrCode size={15} /></button>
        <ArrowRight className="x-chev" size={18} />
      </span>
    </div>
  </article>
}

function CircleDetail({ row, circles, events, labels, currentAddress, isConnected, busyAction, paidStates, onRequestAction, onConnectWallet, onBack, onShare }: {
  row: CircleRow; circles: CircleRow[]; events: ChainEvent[]; labels: Record<string, string>; currentAddress?: Address; isConnected: boolean; busyAction: string; paidStates: Record<string, boolean>;
  onRequestAction: (circle: CircleRow, action: CircleAction) => void; onConnectWallet: () => Promise<void>; onBack: () => void; onShare: () => void;
}) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const canContribute = row.joined && !row.open && !row.paid && !row.completed && !row.cancelled
  const stalled = row.roundStartedAt > 0n && now >= Number(row.roundStartedAt) + row.refundWindowSec
  const refundInSec = row.roundStartedAt > 0n ? Math.max(0, Number(row.roundStartedAt) + row.refundWindowSec - now) : 0
  const nextRecipient = row.members.length ? row.members[row.round % row.members.length] : undefined
  const nextSeat = row.memberCount ? (row.round % row.memberCount) + 1 : 1
  const isBusy = busyAction.endsWith(`-${row.id}`)
  const isCreator = row.creator.toLowerCase() === currentAddress?.toLowerCase()
  const paidOf = (member: string) => paidStates[`${row.id}:${member.toLowerCase()}`] ?? (member.toLowerCase() === currentAddress?.toLowerCase() ? row.paid : false)
  const contribCount = (member: string) => events.filter((e) => e.kind === 'ContributionMade' && e.circleId === row.id && e.actor.toLowerCase() === member.toLowerCase()).length
  const circleEvents = events.filter((e) => e.circleId === row.id).slice().reverse()
  const schedule = row.members.map((member, i) => {
    const pos = row.memberCount ? row.round % row.memberCount : 0
    const offset = row.memberCount ? (i - pos + row.memberCount) % row.memberCount : 0
    return { member, seat: i + 1, offset, roundLabel: offset === 0 ? 'this round' : `round ${row.round + offset + 1}` }
  })
  void circles

  return <section className="x-panel" data-rise>
    <div className="s-detail-head">
      <button className="x-back" onClick={onBack}><ArrowLeft size={15} /> All circles</button>
      <div className="s-detail-actions">
        <button className="x-btn x-btn-ghost" onClick={onShare}><QrCode size={15} /> Share invite</button>
        {row.open && !row.cancelled && !row.completed && (row.joined ? <button className="x-btn x-btn-ghost" disabled={isBusy} onClick={() => onRequestAction(row, 'leave')}>Leave circle</button> : null)}
        {row.open && isCreator && !row.cancelled && <button className="x-btn x-btn-ghost s-danger-btn" disabled={isBusy} onClick={() => onRequestAction(row, 'cancel')}>Cancel circle</button>}
      </div>
    </div>
    <div className="s-detail-stats">
      <div><span>CONTRIBUTION</span><strong>{formatPot(row.contribution)} POT</strong><small>per member, per round</small></div>
      <div><span>FULL POT</span><strong>{formatPot(row.contribution * BigInt(row.open ? row.maxMembers : Math.max(row.memberCount, 1)))} POT</strong><small>paid to one seat each round</small></div>
      <div><span>ROUND</span><strong>{row.completed ? `${row.memberCount} / ${row.memberCount}` : `${Math.min(row.round + 1, Math.max(row.memberCount, 1))} / ${Math.max(row.memberCount, 1)}`}</strong><small>{row.completed ? 'circle completed' : row.open ? 'waiting for seats' : `${row.paidCount} of ${row.memberCount} paid`}</small></div>
      <div><span>REFUND WINDOW</span><strong>{Math.round(row.refundWindowSec / DAY)} days</strong><small>then refunds unlock</small></div>
      <div><span>STATUS</span><strong className="s-detail-status">{statusPill(row)}</strong><small>{row.inviteOnly ? 'invite-only' : 'open invite'} Â· by {labelFor(labels, row.creator)}</small></div>
    </div>

    <div className="x-expand s-detail-body">
      <div className="x-expand-grid">
        <div>
          <div className="x-label">SEATS <span>Â· TAP AN ADDRESS TO COPY IT{!row.open ? ' Â· âœ“ = PAID THIS ROUND' : ''}</span></div>
          {!row.open && row.memberCount > 0 && <div className="x-timeline" aria-label="Payout order this cycle">
            {row.members.map((member, i) => <Fragment key={member}><div className={`x-tl-seat ${i < (row.round % row.memberCount) ? 'done' : i === (row.round % row.memberCount) ? 'now' : ''}`}><span className="x-tl-dot">{paidOf(member) ? <Check size={13} /> : i + 1}</span><span>{i === (row.round % row.memberCount) ? 'NEXT' : `SEAT ${i + 1}`}</span></div>{i < row.members.length - 1 && <span className={`x-tl-line ${i < (row.round % row.memberCount) ? 'done' : ''}`} />}</Fragment>)}
          </div>}
          <div className="x-seats">
            {Array.from({ length: row.maxMembers }, (_, index) => {
              const member = row.members[index]
              const isYou = member?.toLowerCase() === currentAddress?.toLowerCase()
              const isNext = !row.open && row.memberCount > 0 && (row.round % row.memberCount) === index
              const hasPaid = member ? paidOf(member) : false
              return <button type="button" key={index} className={`x-seat ${member ? 'filled' : ''} ${isYou ? 'is-you' : ''}`} onClick={async () => { if (member && await copyText(member)) toast.success('Address copied', { description: shortAddress(member) }) }} disabled={!member}>
                <span className="x-seat-idx">{String(index + 1).padStart(2, '0')}</span>
                <span className="x-seat-ava">{member ? (labels[member.toLowerCase()]?.slice(0, 1).toUpperCase() ?? member.slice(2, 3).toUpperCase()) : <Plus size={12} />}</span>
                <span className="x-seat-addr">{member ? (isYou ? `You Â· ${shortAddress(member)}` : labelFor(labels, member)) : 'Open seat'}{member && !row.open ? <small className="s-seat-sub"> Â· {contribCount(member)} contributions on record</small> : null}</span>
                {member && (!row.open && hasPaid ? <span className="x-seat-tag paid"><Check size={11} /> PAID</span> : <span className={`x-seat-tag ${isNext ? 'next' : ''}`}>{isNext ? 'NEXT UP' : isYou ? 'YOU' : `SEAT ${index + 1}`}</span>)}
              </button>
            })}
          </div>
          {!row.open && schedule.length > 0 && <div className="s-schedule">
            <div className="x-label">PAYOUT SCHEDULE <span>Â· {formatPot(row.contribution * BigInt(row.memberCount))} POT EACH</span></div>
            <div className="s-schedule-chips">
              {schedule.map((s) => <span key={s.seat} className={`s-sched ${s.offset === 0 ? 'now' : ''}`}>Seat {s.seat} Â· {s.roundLabel}{s.member.toLowerCase() === currentAddress?.toLowerCase() ? ' Â· you' : ''}</span>)}
            </div>
          </div>}
          {circleEvents.length > 0 && <div className="s-history">
            <div className="x-label">ROUND HISTORY <span>Â· ON CHAIN</span></div>
            <div className="s-history-list">
              {circleEvents.slice(0, 8).map((e) => <a key={e.key} href={explorerTxUrl(e.hash)} target="_blank" rel="noreferrer" className="s-history-row"><span>{e.kind === 'RoundPaid' ? `Round ${e.round + 1} paid ${formatPot(BigInt(e.amountWei || '0'))} POT to ${labelFor(labels, e.actor)}` : e.kind === 'RoundRefunded' ? `Round ${e.round + 1} refunded ${formatPot(BigInt(e.amountWei || '0'))} POT` : e.kind === 'CircleCompleted' ? 'Circle completed â€” every seat paid' : e.kind === 'ContributionMade' ? `${labelFor(labels, e.actor)} contributed Â· round ${e.round + 1}` : e.kind === 'MemberJoined' ? `${labelFor(labels, e.actor)} joined` : e.kind}</span><span className="x-act-block">BLOCK {e.block.toLocaleString('en-US')}</span><ExternalLink size={11} /></a>)}
            </div>
          </div>}
        </div>
        <div className="x-action">
          {row.completed ? <p><strong>This circle completed.</strong> Every seat was paid once. Pots and refunds stay claimable any time from the sidebar.</p>
            : row.cancelled ? <p><strong>This circle was cancelled</strong> by its creator while it was filling. No funds were ever held.</p>
            : row.open ? <>
              <p>{row.joined ? <><strong>You have seat {row.members.findIndex((m) => m.toLowerCase() === currentAddress?.toLowerCase()) + 1}.</strong> Share the invite â€” the round starts when all {row.maxMembers} seats are taken.</> : <>Take the next seat now. <strong>No deposit yet</strong> â€” contributions only start once the circle is full.</>}</p>
              {row.joined ? <button className="x-btn x-btn-ghost" disabled><Check size={15} /> You have a seat</button>
                : !isConnected ? <button className="x-btn x-btn-dark" onClick={() => void onConnectWallet()}><Wallet size={15} /> Connect wallet to join</button>
                : <button className="x-btn x-btn-dark" disabled={isBusy} onClick={() => onRequestAction(row, 'join')}>{isBusy ? <LoaderCircle size={15} className="spin" /> : <Users size={15} />} Join this circle <ArrowRight size={15} /></button>}
            </> : <>
              <p>{row.paid ? <><strong>Your share is in.</strong> The pot pays seat {nextSeat} when all {row.memberCount} members have contributed ({row.paidCount}/{row.memberCount} so far).</>
                : canContribute ? <>Round {row.round + 1} is collecting. Send your fixed share and seat {nextSeat}{nextRecipient ? ` (${labelFor(labels, nextRecipient)})` : ''} gets the full pot credited when it completes.</>
                : <>{row.paidCount} of {row.memberCount} members have contributed. {nextRecipient ? <><strong>{labelFor(labels, nextRecipient)}</strong> receives this round.</> : ''}</>}</p>
              {canContribute && <button className="x-btn x-btn-dark" disabled={isBusy} onClick={() => onRequestAction(row, 'contribute')}>{isBusy ? <LoaderCircle size={15} className="spin" /> : <HandCoins size={15} />} Contribute {formatPot(row.contribution)} POT</button>}
              {stalled ? <button className={`x-btn ${canContribute ? 'x-btn-ghost' : 'x-btn-dark'}`} disabled={isBusy} onClick={() => onRequestAction(row, 'refund')}>{isBusy ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Refund stalled round</button>
                : !canContribute && !row.paid && <button className="x-btn x-btn-ghost" disabled>{row.joined ? `Waiting Â· ${row.paidCount}/${row.memberCount} paid` : 'Seats are full'}</button>}
              {row.roundStartedAt > 0n && <span className="x-refund-note"><Clock size={13} /> {stalled ? 'Refund is available now â€” anyone can trigger it.' : `Refund unlocks in ${Math.floor(refundInSec / DAY)}d ${Math.floor((refundInSec % DAY) / 3600)}h if the round stalls.`}</span>}
            </>}
          <button className="x-invite" onClick={onShare}><QrCode size={14} /> Share invite with QR</button>
        </div>
      </div>
      <div className="x-rules"><ShieldCheck size={13} /><span>Contract rules: fixed contribution Â· joining order is payout order Â· pots credited and claimed (never pushed) Â· a round stuck past its refund window refunds every contributor Â· circle completes when every seat is paid once.</span></div>
    </div>
  </section>
}

function ActivityFeed({ items, circles }: { items: FeedItem[]; circles: CircleRow[] }) {
  void circles
  if (!items.length) return <div className="x-empty"><div className="x-empty-icon"><History size={21} /></div><h3>No activity matches.</h3><p>On-chain events for this contract will appear here, each linked to its explorer transaction.</p></div>
  return <div className="x-activity">{items.map((item) => <a key={item.key} className="x-act" href={explorerTxUrl(item.hash)} target="_blank" rel="noreferrer">
    <span className={`x-act-icon ${item.kind.toLowerCase()}`}>{item.kind === 'RoundPaid' ? <HandCoins size={15} /> : item.kind === 'MemberJoined' ? <Users size={15} /> : <Check size={15} />}</span>
    <span className="x-act-copy"><b>{item.title}</b><small>{item.detail}</small></span>
    <span className="x-act-block">BLOCK {item.block.toLocaleString('en-US')}</span>
    <ExternalLink size={13} />
  </a>)}</div>
}
