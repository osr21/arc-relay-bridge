# Technical Reference

  ## CCTP V2 contracts (same on all chains)

  | Contract | Address |
  |---|---|
  | TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
  | MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |

  ## USDC addresses

  | Chain | Address | Decimals |
  |---|---|---|
  | Arc Testnet | `0x3600000000000000000000000000000000000000` | 6 (ERC-20 interface) |
  | Ethereum Sepolia | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | 6 |
  | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |
  | Avalanche Fuji | `0x5425890298aed601595a70AB815c96711a31Bc65` | 6 |

  > Arc USDC is at a special system address. Always use the ERC-20 interface — never assume 18 decimals.

  ## Paymaster v5 (ERC-4337 v0.7)

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0xfD06D288d481515a986DF28030AF013De290D76C` |
  | Ethereum Sepolia | `0xC9E9ba0bfE58FA438B8B6f2182d3ADA3669F9Eb4` |
  | Base Sepolia | `0xe355E9dCdEAB37eA8fd81b9457Ad2C56d3eE9055` |
  | Avalanche Fuji | `0x7C75A75B59b63871e1Bb47fA63e541F0e5975f93` |

  ## FeeRouter v2

  | Chain | Address |
  |---|---|
  | Arc Testnet | `0x8256a1e1f8971448b49dA0F55b8A1BB6557eA8FC` |
  | Ethereum Sepolia | `0x5B1F511ed4dF76f369671BF1c4aCF0dD84CC0804` |
  | Base Sepolia | `0x8d4B57eD464df10414Dde3ADC2E403a01ebc50d8` |
  | Avalanche Fuji | `0x64D160b7E91e78e52dFc0e8829640E32A919164C` |

  Fee recipient: `0xdb5019b8DfbccEF8906C39B16a4870082eAbBc4C`

  ## ERC-4337 EntryPoint

  All chains: `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (v0.7, CREATE2)

  ## RPC endpoints

  | Chain | Endpoint |
  |---|---|
  | Arc Testnet | `https://rpc.testnet.arc.io` |
  | Ethereum Sepolia | `https://ethereum-sepolia-rpc.publicnode.com` |
  | Base Sepolia | `https://sepolia.base.org` |
  | Avalanche Fuji | `https://api.avax-test.network/ext/bc/C/rpc` |

  > Do not use `rpc.sepolia.org` — unreliable/down.

  ## CCTP domain map

  | Chain | Domain |
  |---|---|
  | Ethereum Sepolia | 0 |
  | Avalanche Fuji | 1 |
  | Base Sepolia | 6 |
  | Arc Testnet | 26 |

  ## depositForBurn V2 signature

  ```solidity
  function depositForBurn(
      uint256 amount,
      uint32  destinationDomain,
      bytes32 mintRecipient,        // 0x000...{20-byte address}
      address burnToken,
      bytes32 destinationCaller,    // bytes32(0) = anyone may relay
      uint256 maxFee,               // 0 = no fee cap
      uint32  minFinalityThreshold  // Arc=2000, others=1000
  ) external returns (uint64 nonce);
  ```

  Selector: `0x8e0250ee` — V1 selector `0x6fd3504e` will revert on these contracts.

  ## Circle Iris attestation API

  - Sandbox: `https://iris-api-sandbox.circle.com`
  - Poll: every 5 s | Timeout: 20 min
  - Success: `{ status: "complete", attestation: "0x..." }`

  ## Block explorers

  | Chain | Explorer | TX path |
  |---|---|---|
  | Arc Testnet | https://testnet.arcscan.app | /tx/{hash} |
  | Ethereum Sepolia | https://sepolia.etherscan.io | /tx/{hash} |
  | Base Sepolia | https://sepolia.basescan.org | /tx/{hash} |
  | Avalanche Fuji | https://testnet.snowtrace.io | /tx/{hash} |

  ## Library versions

  | Library | Version |
  |---|---|
  | ethers.js | v6 |
  | permissionless | v0.3.6 |
  | viem | v2.51.3 |
  | ERC-4337 EntryPoint | v0.7 |

  ## Paymaster key ABI

  ```json
  [
    "function deposit(uint256 amount)",
    "function withdraw(uint256 amount)",
    "function balances(address) view returns (uint256)",
    "function locked(address) view returns (uint256)",
    "function gasRate() view returns (uint256)",
    "event GasSponsored(address indexed user, uint256 usdcDeducted, uint256 remainingBalance)"
  ]
  ```
  