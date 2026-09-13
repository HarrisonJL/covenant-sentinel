"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTRACT_ADDRESS, getReadClient } from "@/lib/genlayer";

export type FacilityState = {
  owner: string;
  borrower: string;
  status: "current" | "breach" | "reporting_default";
  covenant_count: number;
  period_count: number;
  reporting_deadline_seconds: number;
  last_report_time: string;
};

export type Covenant = {
  name: string;
  metric: string;
  comparison: "gte" | "lte";
  threshold_bps: bigint;
};

export type Period = {
  period_id: number;
  disclosure_text: string;
  extracted_json: string;
  all_passed: boolean;
  submitted_at: string;
};

export function isConfigured(): boolean {
  return CONTRACT_ADDRESS.length > 0;
}

export function useFacilityState(pollMs = 8000) {
  const [state, setState] = useState<FacilityState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isConfigured()) {
      setError("NEXT_PUBLIC_CONTRACT_ADDRESS is not set.");
      setLoading(false);
      return;
    }
    try {
      const client = getReadClient();
      const raw = (await client.readContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: "get_state",
        args: [],
      })) as FacilityState;
      setState(raw);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read facility state.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { state, error, loading, refresh };
}

// u256 fields come back over JSON-RPC as decimal strings, not native
// bigints (confirmed the hard way in the sibling genlayer-vault project -
// a wallet's value.toString(16) silently reinterprets a decimal string as
// hex if this conversion is skipped). Convert explicitly at this boundary.
export async function fetchCovenants(): Promise<Covenant[]> {
  const client = getReadClient();
  const raw = (await client.readContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName: "get_covenants",
    args: [],
  })) as Record<string, unknown>[];
  return raw.map((c) => ({
    ...c,
    threshold_bps: BigInt(c.threshold_bps as string | number | bigint),
  })) as Covenant[];
}

export async function fetchPeriods(offset: number, limit: number): Promise<Period[]> {
  const client = getReadClient();
  return (await client.readContract({
    address: CONTRACT_ADDRESS as `0x${string}`,
    functionName: "get_periods",
    args: [offset, limit],
  })) as Period[];
}
