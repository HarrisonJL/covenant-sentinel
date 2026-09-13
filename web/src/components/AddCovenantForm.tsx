"use client";

import { useRef, useState } from "react";
import { CONTRACT_ADDRESS, getWriteClient } from "@/lib/genlayer";
import { useWallet } from "@/lib/useWallet";
import { pollTransaction, STATUS_COPY, type Progress } from "@/lib/pollTransaction";
import { Button, Field, inputClass } from "@/components/ui";

export default function AddCovenantForm({ onSettled }: { onSettled: () => void }) {
  const { account, connecting, error: walletError, connect } = useWallet();
  const [name, setName] = useState("");
  const [metric, setMetric] = useState("");
  const [comparison, setComparison] = useState<"gte" | "lte">("gte");
  const [thresholdDecimal, setThresholdDecimal] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const cancelledRef = useRef(false);

  async function submit() {
    if (!account) return;
    const threshold = Number(thresholdDecimal);
    if (!name.trim() || !metric.trim() || !Number.isFinite(threshold) || threshold < 0) {
      setError("Fill in a name, a metric key, and a non-negative threshold.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setDone(false);
    cancelledRef.current = false;
    try {
      const client = getWriteClient(account);
      const thresholdBps = Math.round(threshold * 10000);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: "add_covenant",
        args: [name.trim(), metric.trim(), comparison, thresholdBps],
        value: 0n,
      });
      await pollTransaction(client, txHash, "ACCEPTED", setProgress, () => cancelledRef.current);
      setName("");
      setMetric("");
      setThresholdDecimal("");
      setDone(true);
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add covenant.");
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  if (!account) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-[color:var(--muted)]">Connect the owner&apos;s wallet to define covenants.</p>
        <Button onClick={connect} loading={connecting}>
          Connect wallet
        </Button>
        {walletError && <p className="text-sm text-[color:var(--breach)]">{walletError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Covenant name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="min_dscr" disabled={submitting} />
        </Field>
        <Field label="Metric key">
          <input className={inputClass} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="dscr" disabled={submitting} />
        </Field>
        <Field label="Comparison">
          <select
            className={inputClass}
            value={comparison}
            onChange={(e) => setComparison(e.target.value as "gte" | "lte")}
            disabled={submitting}
          >
            <option value="gte">at least (≥)</option>
            <option value="lte">at most (≤)</option>
          </select>
        </Field>
        <Field label="Threshold">
          <input
            className={inputClass}
            value={thresholdDecimal}
            onChange={(e) => setThresholdDecimal(e.target.value)}
            placeholder="1.25"
            inputMode="decimal"
            disabled={submitting}
          />
        </Field>
      </div>
      <Button onClick={submit} loading={submitting} disabled={submitting}>
        Add covenant
      </Button>
      {progress && (
        <p className="mono text-xs text-[color:var(--muted)]">{STATUS_COPY[progress.statusName] ?? progress.statusName}</p>
      )}
      {error && <p className="text-sm text-[color:var(--breach)]">{error}</p>}
      {done && !submitting && <p className="text-sm text-[color:var(--current)]">Covenant added.</p>}
    </div>
  );
}
