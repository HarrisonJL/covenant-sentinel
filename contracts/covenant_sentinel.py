# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

# Covenant Sentinel - Intelligent Contract.
# Header must end in a blank line (real GenVM v0.2.11 requirement).

from genlayer import *
import datetime
import json

COMPARISONS = ("gte", "lte")


def _now() -> datetime.datetime:
    return datetime.datetime.fromisoformat(gl.message_raw['datetime'])


def _extract_metrics(disclosure_text: str, metric_names: list[str]) -> dict:
    # The only non-deterministic step: pulling structured numbers out of a
    # messy, free-form disclosure. Every validator extracts independently
    # and must land on byte-identical normalized JSON (strict_eq) - if the
    # disclosure is too ambiguous for validators to agree on the numbers,
    # the transaction fails to reach consensus rather than silently
    # recording a guess. Threshold comparison itself is plain deterministic
    # Python below (see submit_disclosure) - no LLM judgment there at all.
    #
    # Values must be plain integers, not decimals: GenVM's calldata layer
    # cannot encode a Python float across the nondet/consensus boundary and
    # silently drops any field that comes back as one (confirmed against
    # the real genlayer.py.calldata source) - so metrics are extracted as
    # basis points (value * 10000) to stay integer end to end, matching how
    # covenant thresholds are already stored.
    metrics_list = ", ".join(metric_names)
    prompt = f"""You are extracting financial figures from a borrower's disclosure for a
debt covenant check. Read the disclosure below and extract ONLY these
metrics, if they are stated or directly computable from stated figures:
{metrics_list}

--- BEGIN DISCLOSURE ---
{disclosure_text}
--- END DISCLOSURE ---

Respond with ONLY a single JSON object, nothing else, no markdown fences:
a key for each requested metric name, mapped to an INTEGER equal to its
value multiplied by 10000 and rounded to the nearest whole number (for
example a DSCR of 1.25 becomes 12500). Every value must be a plain
integer with no decimal point, or null if that metric is not stated and
cannot be computed from what is stated. Do not guess or estimate a
figure that isn't actually supported by the text."""

    def nondet() -> str:
        result = gl.nondet.exec_prompt(prompt, response_format="json")
        if not isinstance(result, dict):
            return json.dumps({m: None for m in metric_names})
        out = {}
        for m in metric_names:
            v = result.get(m)
            valid = isinstance(v, int) and not isinstance(v, bool) and v >= 0
            out[m] = v if valid else None
        return json.dumps(out, sort_keys=True)

    raw = gl.eq_principle.strict_eq(nondet)
    assert isinstance(raw, str)
    return json.loads(raw)


@allow_storage
class Covenant:
    name: str
    metric: str
    comparison: str  # "gte" or "lte"
    threshold_bps: u256  # threshold * 10000, e.g. DSCR 1.25 -> 12500


@allow_storage
class PeriodResult:
    period_id: u32
    disclosure_text: str
    extracted_json: str
    all_passed: bool
    submitted_at: datetime.datetime


class CovenantSentinel(gl.Contract):
    owner: Address
    borrower: Address
    covenants: DynArray[Covenant]
    periods: DynArray[PeriodResult]
    reporting_deadline_seconds: u32
    last_report_time: datetime.datetime
    last_period_id: u32
    status: str  # "current" | "breach" | "reporting_default"

    def __init__(self, borrower: str, reporting_deadline_seconds: u32):
        self.owner = gl.message.sender_address
        self.borrower = Address(borrower)
        self.reporting_deadline_seconds = reporting_deadline_seconds
        self.last_report_time = _now()
        self.last_period_id = u32(0)
        self.status = "current"

    @gl.public.write
    def add_covenant(self, name: str, metric: str, comparison: str, threshold_bps: u256) -> None:
        assert gl.message.sender_address == self.owner, "only the owner can add covenants"
        assert self.status == "current", "facility is not in good standing"
        assert comparison in COMPARISONS, f"comparison must be one of {COMPARISONS}"
        c = self.covenants.append_new_get()
        c.name = name
        c.metric = metric
        c.comparison = comparison
        c.threshold_bps = threshold_bps

    @gl.public.write
    def submit_disclosure(self, period_id: u32, disclosure_text: str) -> None:
        assert gl.message.sender_address == self.borrower, "only the borrower can submit disclosures"
        assert self.status == "current", "facility is not in good standing"
        assert len(self.covenants) > 0, "no covenants defined yet"
        assert len(disclosure_text) > 0, "disclosure cannot be empty"
        assert len(disclosure_text) <= 4000, "disclosure too long (max 4000 chars)"
        # Reject duplicate or non-advancing period IDs before doing any
        # extraction work - replaying an old period (or resubmitting the
        # same one) must never reach the last_report_time update below,
        # otherwise a borrower could indefinitely stall
        # flag_reporting_default() without ever reporting a genuinely new
        # period. This check has to run before extraction, not just before
        # the state writes, since asserting after an LLM call would still
        # burn a real consensus round on a request that can never succeed.
        assert period_id > self.last_period_id, \
            f"period_id must advance past the last accepted period ({self.last_period_id})"

        metric_names = list({c.metric for c in self.covenants})
        extracted = _extract_metrics(disclosure_text, metric_names)

        all_passed = True
        for c in self.covenants:
            value = extracted.get(c.metric)
            if value is None:
                all_passed = False
                continue
            value_bps = u256(value)
            if c.comparison == "gte":
                if value_bps < c.threshold_bps:
                    all_passed = False
            else:
                if value_bps > c.threshold_bps:
                    all_passed = False

        record = self.periods.append_new_get()
        record.period_id = period_id
        record.disclosure_text = disclosure_text
        record.extracted_json = json.dumps(extracted, sort_keys=True)
        record.all_passed = all_passed
        record.submitted_at = _now()
        self.last_report_time = _now()
        self.last_period_id = period_id

        if not all_passed:
            self.status = "breach"

    @gl.public.write
    def flag_reporting_default(self) -> None:
        assert self.status == "current", "facility is not in good standing"
        elapsed = _now() - self.last_report_time
        assert elapsed.total_seconds() > self.reporting_deadline_seconds, \
            "reporting deadline has not elapsed yet"
        self.status = "reporting_default"

    @gl.public.view
    def get_state(self) -> dict:
        return {
            "owner": self.owner.as_hex,
            "borrower": self.borrower.as_hex,
            "status": self.status,
            "covenant_count": len(self.covenants),
            "period_count": len(self.periods),
            "reporting_deadline_seconds": self.reporting_deadline_seconds,
            "last_report_time": self.last_report_time.isoformat(),
            "last_period_id": self.last_period_id,
        }

    @gl.public.view
    def get_covenants(self) -> list:
        return [
            {
                "name": c.name,
                "metric": c.metric,
                "comparison": c.comparison,
                "threshold_bps": c.threshold_bps,
            }
            for c in self.covenants
        ]

    @gl.public.view
    def get_periods(self, offset: u32, limit: u32) -> list:
        total = len(self.periods)
        out = []
        i = total - 1 - offset
        count = 0
        while i >= 0 and count < limit:
            p = self.periods[i]
            out.append({
                "period_id": p.period_id,
                "disclosure_text": p.disclosure_text,
                "extracted_json": p.extracted_json,
                "all_passed": p.all_passed,
                "submitted_at": p.submitted_at.isoformat(),
            })
            i -= 1
            count += 1
        return out
