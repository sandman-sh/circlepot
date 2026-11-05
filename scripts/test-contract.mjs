import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import solc from 'solc'
import { createPublicClient, createWalletClient, defineChain, http, parseEventLogs, parseUnits } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'

const rpcUrl = process.env.CIRCLEPOT_TEST_RPC ?? 'http://127.0.0.1:8545'
const request = async (method, params = []) => {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const payload = await response.json()
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`)
  return payload.result
}

let rpcAccounts
try {
  rpcAccounts = await request('eth_accounts')
} catch (error) {
  throw new Error(`No local EVM answered at ${rpcUrl}. Start an unlocked test RPC first.`, { cause: error })
}
assert.ok(rpcAccounts.length >= 4, 'The local EVM must expose at least four test accounts.')

const mnemonic = process.env.CIRCLEPOT_TEST_MNEMONIC ?? 'test test test test test test test test test test test junk'
const localAccounts = Array.from({ length: 4 }, (_, addressIndex) => mnemonicToAccount(mnemonic, { addressIndex }))
const accounts = localAccounts.map((account) => account.address)
assert.deepEqual(rpcAccounts.slice(0, 4).map((account) => account.toLowerCase()), accounts.map((account) => account.toLowerCase()), 'Use the local test mnemonic so the script can sign transactions without an unlocked remote signer.')

const chainId = Number(BigInt(await request('eth_chainId')))
const chain = defineChain({
  id: chainId,
  name: 'CirclePot local contract test',
  nativeCurrency: { name: 'POT', symbol: 'POT', decimals: 14 },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
const wallets = localAccounts.map((account) => createWalletClient({ account, chain, transport: http(rpcUrl) }))
const { abi, bytecode } = JSON.parse(await readFile(new URL('../src/generated/circlePotArtifact.json', import.meta.url), 'utf8'))

const deploymentHash = await wallets[0].deployContract({ abi, bytecode, args: [] })
const deployment = await publicClient.waitForTransactionReceipt({ hash: deploymentHash })
assert.equal(deployment.status, 'success', 'CirclePot deployment should succeed.')
assert.ok(deployment.contractAddress, 'The deployment receipt should include the contract address.')
const address = deployment.contractAddress
assert.notEqual(await publicClient.getCode({ address }), '0x', 'Deployed bytecode should be present.')

const transact = async (wallet, functionName, args, value) => {
  const hash = await wallet.writeContract({ address, abi, functionName, args, ...(value === undefined ? {} : { value }) })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  assert.equal(receipt.status, 'success', `${functionName} should succeed.`)
  return receipt
}
const readCircle = (circleId) => publicClient.readContract({ address, abi, functionName: 'getCircle', args: [circleId] })
const pendingOf = (account) => publicClient.readContract({ address, abi, functionName: 'pendingReturns', args: [account] })
const create = (wallet, name, contribution, maxMembers, days = 7, invited = []) => transact(wallet, 'createCircle', [name, contribution, maxMembers, days, invited])
const lastCircleId = async () => (await publicClient.readContract({ address, abi, functionName: 'circleCount' })) - 1n
const contribution = parseUnits('10', 14)

// --- Ordered payouts are credited (pull), then claimed; the circle completes after one full cycle. ---
await create(wallets[0], 'Round trip', contribution, 3)
const firstCircle = await lastCircleId()
for (const wallet of wallets.slice(0, 3)) await transact(wallet, 'joinCircle', [firstCircle])
let state = await readCircle(firstCircle)
assert.equal(state[0], 'Round trip')
assert.equal(state[4], 3)
assert.equal(state[6], false, 'The circle should close to new members when full.')

await assert.rejects(
  publicClient.simulateContract({ account: accounts[0], address, abi, functionName: 'contribute', args: [firstCircle], value: contribution - 1n }),
  /exact contribution/i,
  'The contract should reject a contribution with the wrong amount.',
)

const claimAndMeasure = async (wallet, account) => {
  const before = await publicClient.getBalance({ address: account })
  await transact(wallet, 'claimReturns', [])
  return (await publicClient.getBalance({ address: account })) - before
}

for (let round = 0; round < 3; round++) {
  for (const wallet of wallets.slice(0, 3)) await transact(wallet, 'contribute', [firstCircle], contribution)
  state = await readCircle(firstCircle)
  assert.equal(state[5], BigInt(round + 1), `Round ${round + 1} should advance the payout order.`)
  assert.equal(state[7], 0, 'A completed round should clear the contribution count.')
  assert.equal(state[8], 0n, 'A completed round should clear the held pot.')
  assert.equal(await pendingOf(accounts[round]), contribution * 3n, `Seat ${round + 1} should be credited the full pot.`)
  const gained = await claimAndMeasure(wallets[round], accounts[round])
  assert.ok(gained > contribution * 3n - contribution / 10n, 'Claiming should deliver the pot (minus claim gas).')
  assert.equal(await pendingOf(accounts[round]), 0n, 'Claiming should zero the credit.')
}
state = await readCircle(firstCircle)
assert.equal(state[11], true, 'The circle should complete after every seat has been paid once.')
await assert.rejects(
  publicClient.simulateContract({ account: accounts[0], address, abi, functionName: 'contribute', args: [firstCircle], value: contribution }),
  /closed/i,
  'Contributing to a completed circle should be rejected.',
)
const paidEventsAll = parseEventLogs({ abi, logs: (await publicClient.getLogs({ address, fromBlock: deployment.blockNumber, toBlock: 'latest' })), strict: false }).filter((event) => event.eventName === 'RoundPaid')
assert.equal(paidEventsAll.length, 3, 'Three completed rounds should emit three payouts.')
assert.deepEqual(paidEventsAll.map((e) => e.args.recipient.toLowerCase()), accounts.slice(0, 3).map((a) => a.toLowerCase()), 'Payouts should follow joining order.')

// --- Stalled rounds credit exact refunds, claimable by each contributor; the circle still finishes. ---
const refundContribution = parseUnits('5', 14)
await create(wallets[0], 'Stalled round', refundContribution, 2)
const refundCircle = await lastCircleId()
await transact(wallets[0], 'joinCircle', [refundCircle])
await transact(wallets[1], 'joinCircle', [refundCircle])
await transact(wallets[0], 'contribute', [refundCircle], refundContribution)
await assert.rejects(
  publicClient.simulateContract({ account: accounts[3], address, abi, functionName: 'refundExpiredRound', args: [refundCircle] }),
  /has not expired/i,
  'Refunding before the refund window should be rejected.',
)
await request('evm_increaseTime', [7 * 24 * 60 * 60 + 1])
await request('evm_mine')
const refundReceipt = await transact(wallets[3], 'refundExpiredRound', [refundCircle])
const refundEvents = parseEventLogs({ abi, logs: refundReceipt.logs, strict: false }).filter((event) => event.eventName === 'RoundRefunded')
assert.equal(refundEvents.length, 1, 'A stalled round should emit a refund event.')
assert.equal(refundEvents[0].args.amount, refundContribution, 'The refund should credit the exact amount held.')
assert.equal(await pendingOf(accounts[0]), refundContribution, 'The contributor should be credited the exact contribution.')
assert.equal(await publicClient.readContract({ address, abi, functionName: 'getContributionState', args: [refundCircle, accounts[0]] }), false)
state = await readCircle(refundCircle)
assert.equal(state[5], 0n, 'A refund should leave the payout order where it was.')
await transact(wallets[0], 'contribute', [refundCircle], refundContribution)
await transact(wallets[1], 'contribute', [refundCircle], refundContribution)
state = await readCircle(refundCircle)
assert.equal(state[5], 1n, 'A circle should still pay out after one of its rounds was refunded.')

// --- Input, membership, invite, cancel and leave rules. ---
const rejects = (functionName, args, value, pattern, label, account = accounts[0]) => assert.rejects(
  publicClient.simulateContract({ account, address, abi, functionName, args, ...(value === undefined ? {} : { value }) }),
  pattern,
  label,
)
await rejects('createCircle', ['', contribution, 2, 7, []], undefined, /1-48 bytes/i, 'Empty circle names should be rejected.')
await rejects('createCircle', ['x'.repeat(49), contribution, 2, 7, []], undefined, /1-48 bytes/i, 'Oversized circle names should be rejected.')
await rejects('createCircle', ['Valid name', 0n, 2, 7, []], undefined, /positive/i, 'Zero contributions should be rejected.')
await rejects('createCircle', ['Valid name', contribution, 1, 7, []], undefined, /2-12/, 'One-member circles should be rejected.')
await rejects('createCircle', ['Valid name', contribution, 13, 7, []], undefined, /2-12/, 'Thirteen-member circles should be rejected.')
await rejects('createCircle', ['Valid name', contribution, 2, 0, []], undefined, /1-30 days/i, 'Zero-day refund windows should be rejected.')
await rejects('createCircle', ['Valid name', contribution, 2, 31, []], undefined, /1-30 days/i, '31-day refund windows should be rejected.')
await rejects('joinCircle', [999n], undefined, /not found/i, 'Joining a missing circle should be rejected.')
await rejects('joinCircle', [firstCircle], undefined, /closed|full/i, 'Joining a completed circle should be rejected.')
await rejects('claimReturns', [], undefined, /Nothing to claim/i, 'Claiming with no credit should be rejected.', accounts[3])

await create(wallets[0], 'Guest list', contribution, 2, 3, [accounts[1]])
const inviteCircle = await lastCircleId()
await rejects('joinCircle', [inviteCircle], undefined, /invite-only/i, 'Uninvited wallets should not join an invite-only circle.', accounts[2])
await transact(wallets[0], 'joinCircle', [inviteCircle]) // creator is implicitly invited
await transact(wallets[1], 'joinCircle', [inviteCircle]) // explicitly invited
await rejects('leaveCircle', [inviteCircle], undefined, /locked/i, 'Leaving after the circle fills should be rejected.', accounts[1])

await create(wallets[0], 'Change of plans', contribution, 3)
const flexCircle = await lastCircleId()
await transact(wallets[0], 'joinCircle', [flexCircle])
await transact(wallets[1], 'joinCircle', [flexCircle])
await transact(wallets[1], 'leaveCircle', [flexCircle])
assert.deepEqual((await publicClient.readContract({ address, abi, functionName: 'getMembers', args: [flexCircle] })).map((a) => a.toLowerCase()), [accounts[0].toLowerCase()], 'Leaving while filling should remove only that seat.')
await transact(wallets[1], 'joinCircle', [flexCircle]) // can rejoin after leaving
await rejects('cancelCircle', [flexCircle], undefined, /Only the creator/i, 'Non-creators should not cancel a circle.', accounts[1])
await transact(wallets[0], 'cancelCircle', [flexCircle])
await rejects('joinCircle', [flexCircle], undefined, /closed/i, 'Joining a cancelled circle should be rejected.', accounts[2])

// --- Pagination and per-user lookups agree with the sequential reads. ---
const page = await publicClient.readContract({ address, abi, functionName: 'getCirclesPage', args: [0n, 2n] })
assert.equal(page.length, 2, 'The first page should return two circles.')
assert.ok(page[0].id > page[1].id, 'Pages should be newest-first.')
assert.deepEqual((await publicClient.readContract({ address, abi, functionName: 'getUserCircles', args: [accounts[0]] })).includes(firstCircle), true, 'User circles should include joined circles.')

// --- A member whose wallet rejects POT can no longer block anyone (pull-pattern proof). ---
const rejectorSource = `
contract RejectingMember {
    receive() external payable { revert("no thanks"); }
    function join(address pot, uint256 id) external { (bool ok,) = pot.call(abi.encodeWithSignature("joinCircle(uint256)", id)); require(ok, "join failed"); }
    function contribute(address pot, uint256 id, uint96 amount) external payable { (bool ok,) = pot.call{value: amount}(abi.encodeWithSignature("contribute(uint256)", id)); require(ok, "contribute failed"); }
    function claim(address pot) external { (bool ok,) = pot.call(abi.encodeWithSignature("claimReturns()")); require(ok, "claim failed"); }
}
`
const rejectorOut = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'RejectingMember.sol': { content: rejectorSource } },
  settings: { evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
})))
const rejectorContract = rejectorOut.contracts['RejectingMember.sol'].RejectingMember
const rejectorHash = await wallets[2].deployContract({ abi: rejectorContract.abi, bytecode: `0x${rejectorContract.evm.bytecode.object}`, args: [] })
const rejectorAddress = (await publicClient.waitForTransactionReceipt({ hash: rejectorHash })).contractAddress
const callRejector = async (functionName, args, value) => {
  const hash = await wallets[2].writeContract({ address: rejectorAddress, abi: rejectorContract.abi, functionName, args, ...(value === undefined ? {} : { value }) })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  assert.equal(receipt.status, 'success', `RejectingMember.${functionName} should succeed.`)
}
await create(wallets[0], 'Unblockable', refundContribution, 2)
const toughCircle = await lastCircleId()
await transact(wallets[0], 'joinCircle', [toughCircle])
await callRejector('join', [address, toughCircle])
const pendingBefore = await pendingOf(accounts[0])
await transact(wallets[0], 'contribute', [toughCircle], refundContribution)
await callRejector('contribute', [address, toughCircle, refundContribution], refundContribution) // completes the round; seat 1 (creator) is credited
assert.equal((await pendingOf(accounts[0])) - pendingBefore, refundContribution * 2n, 'The round should complete even with a rejecting member.')
await callRejector('contribute', [address, toughCircle, refundContribution], refundContribution) // round 2: creator contributes below, rejector is the recipient
await transact(wallets[0], 'contribute', [toughCircle], refundContribution)
assert.equal(await pendingOf(rejectorAddress), refundContribution * 2n, 'The rejecting member should hold a claimable credit instead of blocking the payout.')
await assert.rejects(callRejector('claim', [address]).catch((e) => { throw e }), /.+/, 'The rejecting member cannot claim until its wallet accepts POT, but its credit stays put.')

console.log(`CirclePot v2 contract flow passed on local chain ${chainId}: deploy, ordered credited payouts, claims, completion, refunds, invite/cancel/leave rules, pagination, and rejecting-member isolation.`)
