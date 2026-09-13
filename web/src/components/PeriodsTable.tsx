import type { Period } from "@/lib/useCovenantState";
import { timeAgo } from "@/lib/format";
import { PassBadge } from "@/components/ui";

export default function PeriodsTable({ periods }: { periods: Period[] }) {
  if (periods.length === 0) {
    return <p className="text-sm text-[color:var(--muted)]">No disclosures submitted yet.</p>;
  }
  return (
    <div className="space-y-3">
      {periods.map((p) => (
        <div key={p.period_id} className="rounded-lg border border-[color:var(--surface-border)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Period {p.period_id}</span>
              <PassBadge passed={p.all_passed} />
            </div>
            <span className="text-xs text-[color:var(--muted)]">{timeAgo(p.submitted_at)}</span>
          </div>
          <p className="mb-2 text-sm text-[color:var(--foreground)]">{p.disclosure_text}</p>
          <p className="mono text-xs text-[color:var(--muted)]">extracted: {p.extracted_json}</p>
        </div>
      ))}
    </div>
  );
}
