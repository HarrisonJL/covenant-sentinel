"use client";

import { useCallback, useEffect, useState } from "react";
import { CONTRACT_ADDRESS, chain } from "@/lib/genlayer";
import { useFacilityState, fetchCovenants, fetchPeriods, isConfigured, type Covenant, type Period } from "@/lib/useCovenantState";
import { truncateAddress, timeAgo, formatSeconds } from "@/lib/format";
import { Card, StatCard, StatusBadge } from "@/components/ui";
import CovenantsList from "@/components/CovenantsList";
import PeriodsTable from "@/components/PeriodsTable";
import AddCovenantForm from "@/components/AddCovenantForm";
import SubmitDisclosureForm from "@/components/SubmitDisclosureForm";

export default function Home() {
  const { state, error, loading, refresh } = useFacilityState();
  const [covenants, setCovenants] = useState<Covenant[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);

  const refreshDetail = useCallback(async () => {
    if (!isConfigured()) return;
    const [c, p] = await Promise.all([fetchCovenants(), fetchPeriods(0, 20)]);
    setCovenants(c);
    setPeriods(p);
  }, []);

  useEffect(() => {
    refreshDetail();
  }, [refreshDetail, state?.covenant_count, state?.period_count]);

  const refreshAll = useCallback(() => {
    refresh();
    refreshDetail();
  }, [refresh, refreshDetail]);

  if (!isConfigured()) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--breach)]">NEXT_PUBLIC_CONTRACT_ADDRESS is not set.</p>
      </Card>
    );
  }

  if (loading) {
    return <p className="text-sm text-[color:var(--muted)]">Loading facility state...</p>;
  }

  if (error || !state) {
    return (
      <Card>
        <p className="text-sm text-[color:var(--breach)]">{error ?? "Failed to load facility state."}</p>
      </Card>
    );
  }

  const nextPeriodId = state.period_count + 1;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold">Facility {truncateAddress(CONTRACT_ADDRESS)}</h1>
          <StatusBadge status={state.status} />
        </div>
        <p className="text-sm text-[color:var(--muted)]">
          A lender defines the covenants; each period the borrower submits a disclosure, and every validator
          independently extracts the figures and reaches consensus before the compliance check runs.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Owner (lender)" value={truncateAddress(state.owner)} />
        <StatCard label="Borrower" value={truncateAddress(state.borrower)} />
        <StatCard label="Covenants" value={String(state.covenant_count)} />
        <StatCard label="Periods reported" value={String(state.period_count)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Reporting deadline" value={formatSeconds(state.reporting_deadline_seconds)} hint="max gap between disclosures" />
        <StatCard label="Last report" value={timeAgo(state.last_report_time)} />
      </div>

      <Card title="Covenants" subtitle={`chain ${chain.id}`}>
        <CovenantsList covenants={covenants} />
      </Card>

      {state.status === "current" && (
        <Card title="Add a covenant" subtitle="owner only">
          <AddCovenantForm onSettled={refreshAll} />
        </Card>
      )}

      {state.status === "current" && (
        <Card title="Submit a disclosure" subtitle="borrower only">
          <SubmitDisclosureForm periodId={nextPeriodId} onSettled={refreshAll} />
        </Card>
      )}

      <Card title="Period history">
        <PeriodsTable periods={periods} />
      </Card>
    </div>
  );
}
