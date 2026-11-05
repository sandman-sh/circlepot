# CirclePot security notes

## Scope

- `contracts/CirclePot.sol` — the only value-holding component. Native POT only.
- The frontend holds no keys and cannot move funds; every write is signed in the user's wallet.

## Contract properties (by design)

- **No owner, admin, fee, pause, upgrade, or withdrawal function.** Funds leave the contract only as credited pots/refunds claimed by the member they belong to.
- **Pull payments.** Completed rounds and refunds credit `pendingReturns[member]`; members withdraw with `claimReturns()`. A member whose wallet rejects native currency cannot block a round or a refund for others (covered by a local test with a reverting member contract).
- **Checks-effects-interactions + reentrancy lock** on `contribute` and `claimReturns`. Credits are zeroed before the external call in `claimReturns`.
- **Fixed rules:** contribution is exact (`msg.value == contribution`), payout order is join order, a circle completes after each seat is paid once, stalled rounds refund exact contributions after the circle's refund window (1–30 days, set at creation).
- **Creator powers are narrow:** cancel only while the circle is still filling (no funds are held then). Members can leave only while filling.

## Known considerations for reviewers

1. `getUserCircles` and refund loops iterate at most 12 members / all circles for views — bounded and view-only except the refund loop (≤12 iterations).
2. Circle names are capped at 48 bytes; addresses in `invited` are capped at 12.
3. The frontend verifies a contract address has code and answers the CirclePot ABI before trusting it, and verifies deployed bytecode presence after deployment.
4. Event history in the app is best-effort (RPC `getLogs` + per-browser incremental cache); the chain is the source of truth.

## Before any mainnet use

- Independent audit of `CirclePot.sol` (this file is not an audit).
- Verify contract source on the explorer with: solc `0.8.38`, optimizer 300 runs, `viaIR`, EVM `paris` (see `scripts/compile-contract.mjs`).
- Re-run `npm run test:contract` against a fresh local node and complete a multi-wallet testnet cycle including a claim and a refund.

## Reporting

Open an issue in this repository with reproduction steps. Do not include seed phrases or private keys — CirclePot support will never ask for them.
