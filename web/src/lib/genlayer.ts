import { createClient } from "genlayer-js";
import { localnet, testnetBradbury } from "genlayer-js/chains";

type GenLayerClient = ReturnType<typeof createClient>;

const CHAIN_NAME = process.env.NEXT_PUBLIC_GENLAYER_CHAIN ?? "bradbury";

export const chain = CHAIN_NAME === "localnet" ? localnet : testnetBradbury;

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";

export function getReadClient(): GenLayerClient {
  return createClient({ chain });
}

type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function getBrowserProvider(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export function getWriteClient(account: `0x${string}`): GenLayerClient {
  const provider = getBrowserProvider();
  return createClient({ chain, account, provider: provider ?? undefined });
}

export async function requestWalletAccount(): Promise<`0x${string}` | null> {
  const provider = getBrowserProvider();
  if (!provider) return null;
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  return (accounts[0] as `0x${string}`) ?? null;
}
