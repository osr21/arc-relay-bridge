import {
  createPublicClient,
  http,
  type Chain,
  type Hex,
} from "viem";
import { sepolia, baseSepolia, avalancheFuji } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless/clients";
import { SimpleSmartAccount } from "permissionless/accounts/simple";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { PAYMASTER_ADDRESSES } from "./paymaster";

const AA_CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532:    baseSepolia,
  43113:    avalancheFuji,
};

const CHAIN_RPC: Record<number, string> = {
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  84532:    "https://sepolia.base.org",
  43113:    "https://api.avax-test.network/ext/bc/C/rpc",
};

const PIMLICO_SLUG: Record<number, string> = {
  11155111: "sepolia",
  84532:    "base-sepolia",
  43113:    "avalanche-fuji",
};

export const ENTRY_POINT = {
  address: entryPoint07Address as Hex,
  version: "0.7" as const,
};

export function isAASupported(chainId: number): boolean {
  return chainId in AA_CHAIN_MAP;
}

export function bundlerUrl(chainId: number): string {
  const slug = PIMLICO_SLUG[chainId];
  if (!slug) throw new Error(`No bundler for chain ${chainId}`);
  return `/api/bundler/${slug}`;
}

function getViemChain(chainId: number): Chain {
  const chain = AA_CHAIN_MAP[chainId];
  if (!chain) throw new Error(`AA not supported on chain ${chainId}`);
  return chain;
}

function getPublicClient(chainId: number) {
  return createPublicClient({
    chain: getViemChain(chainId),
    transport: http(CHAIN_RPC[chainId]),
  });
}

async function getSimpleAccount(chainId: number) {
  if (!window.ethereum) throw new Error("No wallet detected");
  const pc = getPublicClient(chainId);
  // window.ethereum has `on?` as optional which confuses permissionless's
  // OneOf<EthereumProvider> union. Casting to the minimal `request` interface
  // satisfies the first branch and avoids the type mismatch at runtime.
  const provider = window.ethereum as unknown as { request(...args: unknown[]): Promise<unknown> };
  return SimpleSmartAccount.toSimpleSmartAccount({
    client: pc,
    owner: provider,
    entryPoint: ENTRY_POINT,
  });
}

/** Counterfactual SimpleAccount address for the connected MetaMask EOA on a given chain. */
export async function getSmartAccountAddress(chainId: number): Promise<Hex> {
  const account = await getSimpleAccount(chainId);
  return account.address;
}

/**
 * SmartAccountClient that pays gas via our deployed USDC Paymaster.
 * The smart account's USDC balance in the Paymaster is consumed per UserOp.
 */
export async function createBridgeClient(chainId: number) {
  const chain = getViemChain(chainId);
  const paymasterAddr = (PAYMASTER_ADDRESSES as Record<number, string | undefined>)[chainId] as Hex | undefined;
  if (!paymasterAddr) throw new Error(`No paymaster deployed for chain ${chainId}`);

  const account = await getSimpleAccount(chainId);
  const url = bundlerUrl(chainId);

  return createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(url),
    paymaster: {
      async getPaymasterStubData() {
        return {
          paymaster: paymasterAddr,
          paymasterData: "0x" as Hex,
          paymasterVerificationGasLimit: 200_000n,
          paymasterPostOpGasLimit: 150_000n,
        };
      },
      async getPaymasterData() {
        return {
          paymaster: paymasterAddr,
          paymasterData: "0x" as Hex,
          paymasterVerificationGasLimit: 200_000n,
          paymasterPostOpGasLimit: 150_000n,
        };
      },
    },
  });
}

/**
 * SmartAccountClient sponsored by Pimlico (free on testnet).
 * Used for the bootstrap deposit: smart account approves and deposits USDC
 * to our Paymaster with Pimlico covering the gas.
 */
export async function createSponsoredClient(chainId: number) {
  const chain = getViemChain(chainId);
  const account = await getSimpleAccount(chainId);
  const url = bundlerUrl(chainId);

  const pimlico = createPimlicoClient({
    transport: http(url),
    entryPoint: ENTRY_POINT,
  });

  return createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(url),
    paymaster: pimlico,
  });
}
