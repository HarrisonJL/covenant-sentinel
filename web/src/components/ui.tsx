import type { FacilityState } from "@/lib/useCovenantState";

export function Card({
  title,
  subtitle,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-5 ${className}`}>
      {title && (
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-[color:var(--foreground)]">{title}</h2>
          {subtitle && <span className="mono text-xs text-[color:var(--muted)]">{subtitle}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-[color:var(--muted)]">{label}</div>
      <div className="mono mt-1 text-lg font-medium">{value}</div>
      {hint && <div className="mt-1 text-xs text-[color:var(--muted)]">{hint}</div>}
    </div>
  );
}

const STATUS_LABEL: Record<FacilityState["status"], string> = {
  current: "Current",
  breach: "Breach",
  reporting_default: "Reporting default",
};

export function StatusBadge({ status }: { status: FacilityState["status"] }) {
  return (
    <span className={`status-${status} inline-flex items-center rounded-full px-3 py-1 text-xs font-medium`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function PassBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <span className="status-current inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
      Pass
    </span>
  ) : (
    <span className="status-breach inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
      Fail
    </span>
  );
}

export function Button({
  children,
  disabled,
  loading,
  variant = "primary",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: "primary" | "secondary";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-[color:var(--accent)] text-white hover:brightness-110"
      : "border border-[color:var(--surface-border)] text-[color:var(--foreground)] hover:bg-white/5";
  return (
    <button className={`${base} ${styles}`} disabled={disabled || loading} {...rest}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[color:var(--muted)]">{label}</span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--background)] px-3 py-2 text-sm text-[color:var(--foreground)] outline-none focus:border-[color:var(--accent)]";
