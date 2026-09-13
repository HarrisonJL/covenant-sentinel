import { getWriteClient } from "@/lib/genlayer";

// Mirrors genlayer-js's internal status numbering (not exported from its
// public entry point - confirmed against a real Bradbury transaction in
// the sibling genlayer-vault project, status 3 really is COMMITTING).
export const STATUS_NAMES: Record<string, string> = {
  "0": "UNINITIALIZED",
  "1": "PENDING",
  "2": "PROPOSING",
  "3": "COMMITTING",
  "4": "REVEALING",
  "5": "ACCEPTED",
  "6": "UNDETERMINED",
  "7": "FINALIZED",
  "8": "CANCELED",
  "9": "APPEAL_REVEALING",
  "10": "APPEAL_COMMITTING",
  "11": "READY_TO_FINALIZE",
  "12": "VALIDATORS_TIMEOUT",
  "13": "LEADER_TIMEOUT",
};
const DECIDED = new Set(["5", "6", "7", "8", "12", "13"]);

export const STATUS_COPY: Record<string, string> = {
  UNINITIALIZED: "Submitting...",
  PENDING: "Waiting for the network to pick up the transaction...",
  PROPOSING: "A leader validator is being assigned...",
  COMMITTING: "Validators are independently extracting the figures - this is the real work, it can take a bit.",
  REVEALING: "Validators are revealing their results...",
  ACCEPTED: "Consensus reached.",
  UNDETERMINED: "Validators couldn't reach a clear majority - may need a retry.",
  FINALIZED: "Confirmed final.",
  CANCELED: "Transaction was canceled.",
  APPEAL_REVEALING: "Under appeal - a fresh, larger committee is revealing results.",
  APPEAL_COMMITTING: "Under appeal - a fresh, larger committee is voting.",
  READY_TO_FINALIZE: "Consensus reached, wrapping up...",
  VALIDATORS_TIMEOUT: "Validators timed out - may need a retry.",
  LEADER_TIMEOUT: "The leader timed out - may need a retry.",
};

export type Progress = { statusName: string; validators: string[]; votes: string[]; leader: string | null };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Polls a transaction's live status instead of trusting genlayer-js's
// waitForTransactionReceipt default (10 retries x 3s = 30s - nowhere near
// enough once every validator has to run a real LLM extraction before
// COMMITTING can finish; the same timeout was hit for real against a
// wallet-submitted write in the sibling genlayer-vault project). Reports
// live status on every poll and keeps going while consensus is genuinely
// still in progress - there's no reliable SLA to bound it by.
export async function pollTransaction(
  client: ReturnType<typeof getWriteClient>,
  hash: `0x${string}`,
  target: "ACCEPTED" | "FINALIZED",
  onUpdate: (p: Progress) => void,
  cancelled: () => boolean
) {
  const targetNum = target === "FINALIZED" ? "7" : "5";
  while (!cancelled()) {
    try {
      const tx = (await client.getTransaction({ hash: hash as `0x${string}` & { length: 66 } })) as any;
      if (tx) {
        const statusNum = String(tx.status);
        onUpdate({
          statusName: STATUS_NAMES[statusNum] ?? statusNum,
          validators: tx.lastRound?.roundValidators ?? [],
          votes: tx.lastRound?.validatorVotesName ?? [],
          leader: tx.lastLeader ?? null,
        });
        if (statusNum === targetNum || (target === "ACCEPTED" && DECIDED.has(statusNum))) {
          return tx;
        }
      }
    } catch {
      // Transient RPC hiccup (e.g. not indexed yet right after submission) -
      // keep polling rather than failing outright.
    }
    await sleep(4000);
  }
  throw new Error("cancelled");
}
