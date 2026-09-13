"use client";

import { useState } from "react";
import { requestWalletAccount } from "@/lib/genlayer";

export function useWallet() {
  const [account, setAccount] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const addr = await requestWalletAccount();
      if (!addr) {
        setError("No wallet found. Install a browser wallet extension (e.g. MetaMask) and reload.");
        return;
      }
      setAccount(addr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  return { account, connecting, error, connect };
}
