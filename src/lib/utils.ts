import { formatUnits, parseUnits, type Address, type Hash } from 'viem'
import { EVM_DECIMALS } from './web3'

export type CircleRow = {
  id: bigint
  name: string
  creator: Address
  contribution: bigint
  maxMembers: number
  memberCount: number
  round: number
  open: boolean
  paidCount: number
  roundPot: bigint
  roundStartedAt: bigint
  refundWindowSec: number
  completed: boolean
  cancelled: boolean
  inviteOnly: boolean
  members: readonly Address[]
  joined: boolean
  paid: boolean
}

export type Activity = { key: string; title: string; detail: string; circleId: bigint; hash: Hash; block: bigint; kind: string }

export type ChainEvent = {
  key: string
  kind: string
  circleId: bigint
  round: number
  amountWei: string
  actor: string
  hash: Hash
  block: number
}

export const shortAddress = (value?: string) => (value ? `${value.slice(0, 6)}…${value.slice(-4)}` : '—')

// Viem/wagmi errors carry a concise shortMessage; raw messages are multi-line walls of text.
export const errMsg = (error: unknown, fallback: string) => {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: string }).shortMessage
    if (short) return short
    const firstLine = error.message.split('\n')[0].trim()
    if (firstLine) return firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine
  }
  return fallback
}

export const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export const formatPot = (value: bigint, digits = 2) => {
  const [whole, fraction = ''] = formatUnits(value, EVM_DECIMALS).split('.')
  let precision = Math.min(digits, fraction.length)
  while (precision < fraction.length && /[1-9]/.test(fraction.slice(precision))) precision += 1
  const decimals = fraction.slice(0, precision).replace(/0+$/, '')
  return `${BigInt(whole).toLocaleString('en-US')}${decimals ? `.${decimals}` : ''}`
}

// viem's parseUnits silently truncates excess decimals, so enforce EVM POT's 18 explicitly.
/** Rounded balance-style display (2dp max) — formatPot keeps full precision for amounts owed. */
export const formatPotShort = (value: bigint) => {
  const n = Number(formatUnits(value, EVM_DECIMALS))
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export const amountToWei = (value: string) => {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) throw new Error('Invalid POT amount (max 18 decimal places)')
  return parseUnits(trimmed, EVM_DECIMALS)
}

export const isValidAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/.test(value.trim())
