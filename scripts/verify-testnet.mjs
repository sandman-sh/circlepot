// Read-only verification of a CirclePot deployment on Portaldot V3 Testnet.
// Usage: node scripts/verify-testnet.mjs 0xYourContractAddress [deploymentTxHash]
// Sends no transactions and needs no keys.
import { readFile } from 'node:fs/promises'
import { createPublicClient, defineChain, http } from 'viem'

const [, , address, deploymentHash] = process.argv
if (!/^0x[a-fA-F0-9]{40}$/.test(address ?? '')) {
  console.error('Usage: node scripts/verify-testnet.mjs 0xYourContractAddress [deploymentTxHash]')
  process.exit(1)
}
const chain = defineChain({
  id: 420420777,
  name: 'Portaldot V3 Testnet',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 14 },
  rpcUrls: { default: { http: ['https://test-evm-rpc-v3.portaldot.dev'] } },
})
const client = createPublicClient({ chain, transport: http() })
const { abi } = JSON.parse(await readFile(new URL('../src/generated/circlePotArtifact.json', import.meta.url), 'utf8'))

const fail = (msg) => { console.error(`FAIL  ${msg}`); process.exitCode = 1 }
const ok = (msg) => console.log(`OK    ${msg}`)

const chainId = await client.getChainId()
if (chainId === 420420777) ok(`chain id ${chainId}`)
else fail(`unexpected chain id ${chainId}`)

const code = await client.getCode({ address })
if (!code || code === '0x') fail('no code at address')
else ok(`deployed code present (${(code.length - 2) / 2} bytes runtime)`)

// Runtime code should end with the same metadata-free body family as the local build;
// exact match is not expected across deployments, so verify behavior instead.
try {
  const count = await client.readContract({ address, abi, functionName: 'circleCount' })
  ok(`ABI answers: circleCount = ${count}`)
  const page = await client.readContract({ address, abi, functionName: 'getCirclesPage', args: [0n, 1n] })
  ok(`getCirclesPage answers (${page.length} circle(s) in first page)`)
  const mine = await client.readContract({ address, abi, functionName: 'getUserCircles', args: ['0x0000000000000000000000000000000000000000'] })
  ok(`getUserCircles answers (${mine.length} for zero address)`)
} catch (error) {
  fail(`ABI check failed: ${error.shortMessage ?? error.message}`)
}

if (deploymentHash) {
  const receipt = await client.getTransactionReceipt({ hash: deploymentHash }).catch(() => null)
  if (!receipt) fail('deployment receipt not found')
  else {
    if (receipt.status === 'success') ok(`deployment tx ${receipt.status} in block ${receipt.blockNumber}`)
    else fail(`deployment tx status ${receipt.status}`)
    if (receipt.contractAddress?.toLowerCase() === address.toLowerCase()) ok('receipt contractAddress matches')
    else fail(`receipt contractAddress ${receipt.contractAddress} != ${address}`)
  }
} else {
  console.log('SKIP  deployment receipt check (no tx hash given)')
}
console.log(process.exitCode ? '\nVerification FAILED.' : '\nVerification passed. Safe to attach this address in the app.')
