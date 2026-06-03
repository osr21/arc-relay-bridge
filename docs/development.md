# Development Guide

  ## Prerequisites

  - Node.js 24+, pnpm 9+, MetaMask
  - Secrets: `PIMLICO_API_KEY`, `DEPLOYER_PRIVATE_KEY`, `FEE_RECIPIENT`, `SESSION_SECRET`

  ## Project structure

  ```
  artifacts/arc-bridge/src/
    lib/
      chains.ts           Chain configs, CCTP domains, contract addresses, ABIs
      bridge.ts           Standard CCTP flow (approve → burn → attest → mint)
      gaslessBridge.ts    ERC-4337 gasless flow + Paymaster deposit
      aa.ts               permissionless SimpleAccount + bundler clients
      paymaster.ts        Paymaster v5 addresses ← update after redeploy
      config.ts           FeeRouter config
      session.ts          Bridge session persistence (localStorage)
    pages/
      BridgePage.tsx      Main bridge UI (standard + gasless)
      PaymasterPage.tsx   Gasless setup UI

  artifacts/api-server/src/routes/
    paymaster.ts          Paymaster address registry ← also update after redeploy
    gasRelay.ts           Gasless mint relay
    oracle.ts             USDC price feed

  contracts/
    Paymaster.sol         ERC-4337 v0.7 USDC gas vault
    FeeRouter.sol         CCTP fee routing

  scripts/src/
    deployPaymaster.ts    Deploy + auto-fund Paymaster (all chains)
    fundPaymaster.ts      Top up EntryPoint ETH deposits
    compilePaymaster.ts   Compile Paymaster.sol → ABI + bytecode
    deployFeeRouter.ts    Deploy FeeRouter
  ```

  ## Running locally

  ```bash
  pnpm install
  pnpm --filter @workspace/arc-bridge run dev     # bridge frontend
  pnpm --filter @workspace/api-server run dev     # API server (gasless relay + oracle)
  pnpm run typecheck                              # full typecheck across all packages
  ```

  ## Deploying contracts

  ### Paymaster

  ```bash
  # Compile
  pnpm --filter @workspace/scripts run compile-paymaster

  # Deploy + auto-fund EntryPoint (0.05 ETH per chain)
  pnpm --filter @workspace/scripts run deploy-paymaster

  # Top up existing EntryPoint deposits
  pnpm --filter @workspace/scripts run fund-paymaster
  pnpm --filter @workspace/scripts run fund-paymaster -- --only sepolia --amount 0.05
  pnpm --filter @workspace/scripts run fund-paymaster -- --only base   --amount 0.02
  pnpm --filter @workspace/scripts run fund-paymaster -- --only fuji   --amount 0.05
  ```

  **After every deploy, update BOTH address files:**

  ```typescript
  // artifacts/arc-bridge/src/lib/paymaster.ts
  export const PAYMASTER_ADDRESSES: Record<number, string> = {
    5042002:  "0x...", // Arc Testnet
    11155111: "0x...", // Ethereum Sepolia
    84532:    "0x...", // Base Sepolia
    43113:    "0x...", // Avalanche Fuji
  };

  // artifacts/api-server/src/routes/paymaster.ts — same values
  ```

  Forgetting the API server file causes silent UserOp rejections (relay validates against old address).

  ### FeeRouter

  ```bash
  pnpm --filter @workspace/scripts run deploy
  ```

  ## Compilation constraints

  ```js
  // scripts/src/compilePaymaster.ts
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris",  // Arc Testnet + Fuji reject PUSH0 (Shanghai opcode)
  }
  ```

  In `contracts/Paymaster.sol`:
  - `entryPoint` must be `constant` (not `immutable`) — 2-immutable 0x60c0 init silently reverts on Arc/Base/Fuji
  - No `nonReentrant` on `validatePaymasterUserOp` — ERC-7562 forbids global storage writes for unstaked paymasters

  ## ERC-4337 client (permissionless v0.3.6 + viem v2.51.3)

  ```typescript
  // artifacts/arc-bridge/src/lib/aa.ts
  const account = await toSimpleSmartAccount({
    client: publicClient,
    owner: walletClient,
    entryPoint: { address: ENTRY_POINT, version: "0.7" },
  });
  // Smart account address is deterministic — same EOA → same address on every chain
  ```

  ## Known gotchas

  | Gotcha | Detail |
  |---|---|
  | PUSH0 on Arc/Fuji | Always compile with `evmVersion: "paris"` |
  | 2-immutable init revert | Keep `entryPoint` as `constant` in Paymaster.sol |
  | ERC-7562 validation | No global storage writes in `validatePaymasterUserOp` |
  | EntryPoint needs ETH | Run `fund-paymaster` after every deploy |
  | Two address files | Update both `lib/paymaster.ts` AND `api-server/routes/paymaster.ts` |
  | Arc USDC decimals | ERC-20 interface = 6 dec; native gas token = 18 dec |
  | Sepolia RPC | Use `publicnode.com` — `rpc.sepolia.org` is unreliable |
  | Gas vault ≠ smart acct wallet | Gas vault covers bundler fees only, not the bridge amount |
  