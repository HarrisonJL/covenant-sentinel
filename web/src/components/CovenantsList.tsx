import type { Covenant } from "@/lib/useCovenantState";
import { formatBps } from "@/lib/format";

export default function CovenantsList({ covenants }: { covenants: Covenant[] }) {
  if (covenants.length === 0) {
    return <p className="text-sm text-[color:var(--muted)]">No covenants defined yet.</p>;
  }
  return (
    <div className="space-y-2">
      {covenants.map((c) => (
        <div key={c.name} className="flex items-center justify-between rounded-lg border border-[color:var(--surface-border)] px-3 py-2 text-sm">
          <span>{c.name}</span>
          <span className="mono text-[color:var(--muted)]">
            {c.metric} {c.comparison === "gte" ? "≥" : "≤"} {formatBps(c.threshold_bps)}
          </span>
        </div>
      ))}
    </div>
  );
}
