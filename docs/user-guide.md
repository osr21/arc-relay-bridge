# User Guide

  ## Prerequisites

  - [MetaMask](https://metamask.io) installed
  - Testnet USDC on the source chain — [Circle Faucet](https://faucet.circle.com)
  - For gasless bridging: USDC in your smart account wallet (see below)

  ---

  ## Standard bridge

  1. **Connect wallet** — click "Connect Wallet", approve in MetaMask.
  2. **Select source chain** — where your USDC currently is.
  3. **Select destination chain** — where you want USDC to arrive.
  4. **Enter amount** — or click MAX.
  5. **Click Bridge** — MetaMask prompts for two txs:
     - **Approve** — allow TokenMessenger to spend USDC
     - **Burn** — `depositForBurn` on source chain
  6. **Wait for attestation** — Circle Iris confirms the burn (~1–5 min).
  7. **Switch network** — MetaMask switches to destination automatically.
  8. **Mint** — `receiveMessage` mints USDC natively on destination.

  ### Gasless relay (optional, 1 USDC fee)

  Toggle "Gasless relay" to skip the manual network-switch and mint step. A relayer pays destination gas and deducts 1 USDC from the bridged amount. Useful when you have no ETH/AVAX on the destination.

  ---

  ## ERC-4337 gasless bridge (no ETH or AVAX needed on source)

  Gasless bridging replaces native gas with USDC deducted from a pre-funded Paymaster vault.

  ### Two separate USDC pools

  > **Important:** The smart account has two separate USDC balances. Confusing them is the #1 source of "Insufficient USDC" errors.

  | Pool | What it pays for | Where to see it |
  |---|---|---|
  | **Smart account wallet** | The USDC being bridged (burned) | Bridge page → "Smart account wallet" label |
  | **Paymaster gas vault** | Bundler gas fees (~0.5–2 USDC per bridge) | Paymaster page → chain card |

  The gas vault **cannot** be used for the bridge amount. A 17 USDC gas vault doesn't let you bridge 17 USDC — you need USDC in the smart account wallet too.

  ### One-time setup per chain

  **1. Connect wallet**
  Your SimpleAccount address is deterministically derived from your MetaMask EOA — same address on every chain. Find it on the Paymaster page.

  **2. Fund the smart account wallet**
  Send USDC from MetaMask to the SimpleAccount address. This is a regular ERC-20 transfer that costs a tiny amount of native gas — done only once.

  **3. Deposit USDC to the gas vault**
  On the Paymaster page → select chain → enter amount → Deposit. Pimlico sponsors this UserOp; no native gas needed.

  ### Bridging gaslessly

  1. Go to Bridge page → toggle **ERC-4337 gasless burn** (Beta).
  2. FROM section shows **"Smart account wallet: X USDC"** — this is your bridgeable balance.
  3. Enter amount ≤ smart account wallet balance.
  4. Click Bridge → MetaMask shows a UserOperation signature (no gas fee prompt).
  5. Wait for attestation, then sign the mint on destination as normal.

  ### Current balances (as of 2026-06-03)

  | Chain | Smart acct wallet | Gas vault | Can bridge? |
  |---|---|---|---|
  | Ethereum Sepolia | ~20 USDC | ~17 USDC | ✅ |
  | Avalanche Fuji | ~6 USDC | ~17 USDC | ✅ |
  | Base Sepolia | ~25 USDC | **0 USDC** | ❌ needs gas vault deposit |

  ---

  ## Resuming an interrupted bridge

  If the browser closed after a successful burn but before mint:

  1. The Bridge page shows a **Resume** button automatically (session is saved locally).
  2. Or paste the burn tx hash into the Resume field and click Resume.

  ---

  ## Troubleshooting

  | Error | Cause | Fix |
  |---|---|---|
  | "Insufficient USDC in your smart account" | Smart account wallet has less USDC than entered | Send USDC to smart account wallet |
  | "Insufficient Paymaster balance" | Gas vault < 1.8 USDC | Deposit USDC via Paymaster page |
  | `AA31 paymaster deposit too low` | Paymaster has no ETH at EntryPoint | Admin must run fund-paymaster script |
  | Attestation timeout | Circle Iris slow or chain finality delayed | Use Resume after burn tx appears on-chain |
  | Wrong network after mint | MetaMask didn't switch | Switch network manually |
  