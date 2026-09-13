"use client";

import { useRef, useState } from "react";
import { CONTRACT_ADDRESS, getWriteClient } from "@/lib/genlayer";
import { useWallet } from "@/lib/useWallet";
import { pollTransaction, STATUS_COPY, type Progress } from "@/lib/pollTransaction";
import { fetchPeriods, type Period } from "@/lib/useCovenantState";
import { Button, Field, inputClass, PassBadge } from "@/components/ui";

const MAX_LEN = 4000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLatestPeriod(): Promise<Period | null> {
  for (let i = 0; i < 4; i++) {
    const periods = await fetchPeriods(0, 1);
    if (periods[0]) return periods[0];
    await sleep(1500);
  }
  return null;
}

export default function SubmitDisclosureForm({
  periodId,
  onSettled,
}: {
  periodId: number;
  onSettled: () => void;
}) {
  const { account, connecting, error: walletError, connect } = useWallet();
  const [text, setText] = useState("");
  const [stage, setStage] = useState<"idle" | "submitting" | "waiting" | "done">("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Period | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  async function submit() {
    if (!account) return;
    if (!text.trim()) {
      setError("Disclosure text can't be empty.");
      return;
    }
    if (text.length > MAX_LEN) {
      setError(`Disclosure is too long (max ${MAX_LEN} characters).`);
      return;
    }
    setStage("submitting");
    setError(null);
    setResult(null);
    cancelledRef.current = false;
    try {
      const client = getWriteClient(account);
      const txHash = await client.writeContract({
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: "submit_disclosure",
        args: [periodId, text.trim()],
        value: 0n,
      });
      setStage("waiting");
      await pollTransaction(client, txHash, "ACCEPTED", setProgress, () => cancelledRef.current);
      const latest = await fetchLatestPeriod();
      setResult(latest);
      setText("");
      setStage("done");
      onSettled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit disclosure.");
      setStage("idle");
    } finally {
      setProgress(null);
    }
  }

  if (!account) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-[color:var(--muted)]">Connect the borrower&apos;s wallet to submit a disclosure.</p>
        <Button onClick={connect} loading={connecting}>
          Connect wallet
        </Button>
        {walletError && <p className="text-sm text-[color:var(--breach)]">{walletError}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Field label={`Disclosure text for period ${periodId}`}>
        <textarea
          className={`${inputClass} min-h-32 resize-y`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Q1 2026 disclosure: EBITDA was $4.2M this quarter, total debt service was $2.8M, giving a debt service coverage ratio of 1.5x..."
          disabled={stage === "submitting" || stage === "waiting"}
        />
        <span className="mt-1 block text-right text-xs text-[color:var(--muted)]">
          {text.length}/{MAX_LEN}
        </span>
      </Field>
      <Button onClick={submit} loading={stage === "submitting" || stage === "waiting"} disabled={stage === "submitting" || stage === "waiting"}>
        Submit disclosure
      </Button>
      {progress && stage === "waiting" && (
        <div className="rounded-lg border border-[color:var(--surface-border)] p-3 text-xs">
          <p className="text-[color:var(--muted)]">{STATUS_COPY[progress.statusName] ?? progress.statusName}</p>
          {progress.validators.length > 0 && (
            <p className="mono mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[color:var(--muted)]">
              {progress.validators.map((v, i) => (
                <span key={v} className={v === progress.leader ? "text-[color:var(--accent)]" : undefined}>
                  {progress.votes[i] === "AGREE" ? "✓" : progress.votes[i] === "DISAGREE" ? "✗" : "…"} {v.slice(0, 8)}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
      {error && <p className="text-sm text-[color:var(--breach)]">{error}</p>}
      {result && stage === "done" && (
        <div className="rounded-lg border border-[color:var(--surface-border)] p-3 text-sm">
          <div className="mb-1 flex items-center gap-2">
            <PassBadge passed={result.all_passed} />
            <span className="mono text-xs text-[color:var(--muted)]">extracted: {result.extracted_json}</span>
          </div>
        </div>
      )}
    </div>
  );
}
