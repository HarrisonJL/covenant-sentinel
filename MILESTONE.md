# Milestone: Covenant Sentinel v2

A Milestone update to the accepted [Covenant Sentinel](README.md) Project, adding three
things v1's own README named as Known limitations, plus one prompt-hardening fix found
along the way. v1 (`contracts/covenant_sentinel.py`) is kept untouched for provenance -
this is a new, separate contract, not a migration in place.

## Limitation-to-fix table

| v1's own "Known limitations" (quoted from [README.md](README.md)) | v2 fix |
|---|---|
| *"v1 is a one-way breach. Once a covenant fails, the facility stays in `breach` permanently - there's no cure/waiver path back to `current`."* | `request_waiver(covenant, period_id, rationale)` (borrower) + `grant_waiver`/`reject_waiver` (lender) move a specific failed covenant to a decided state; the facility only reaches `waived` once **every** covenant that failed in the active breach period has an individually granted waiver. `cure(period_id)` then requires a genuinely **later** period that passed every covenant before returning the facility to `current`. Every transition is recorded in an append-only `audit_log`. |
| *"Extraction quality depends on disclosure quality... a genuinely ambiguous disclosure can't be processed at all in this version"* (v1 used `gl.eq_principle.strict_eq`: validators had to extract byte-identical JSON or the transaction failed to reach consensus) | Replaced `strict_eq` with a custom `run_nondet` validator using the same decision-margin equivalence already proven in the sibling [QuoteKeeper](https://github.com/HarrisonJL/quotekeeper) contract: each validator extracts independently, and consensus is reached on the **decision** (`PASS`/`FAIL`/`INCONCLUSIVE`), not the raw number. A metric within `tolerance_bps` of its covenant threshold is `INCONCLUSIVE` rather than forced to a side - an ambiguous disclosure now reaches consensus instead of failing to reach it at all. |
| *(implicit - v1 only accepted disclosures pasted directly as `disclosure_text`)* | `submit_disclosure_url(period_id, url)` fetches the disclosure live via `gl.nondet.web.render` **inside** the consensus block - every validator, not just the leader, does its own independent fetch. The fetched content's hash is recorded as audit evidence only, never a consensus input (matching this account's established "evidence, not a gate" pattern for source hashes elsewhere) - the actual equivalence check is on the extracted decision, which is what tolerates the ordinary variance a live fetch can introduce. |
| *(not a listed limitation, found during this build)* - v1's extraction prompt had no explicit prompt-injection fencing around the disclosure text, unlike this account's other GenLayer contracts. | v2's prompt explicitly fences the disclosure as `--- BEGIN UNTRUSTED DISCLOSURE ---` / untrusted data, never instructions - matching the defensive pattern already used in SolvencyOracle, QuoteKeeper and AuditScope. |
| *(not listed, a deliberate v2 design change)* - v1 treated a metric the LLM couldn't find as an automatic `FAIL` ("fails conservatively"). | v2 treats a missing metric as `INCONCLUSIVE`, matching the same "don't manufacture a breach out of missing data" direction the tolerance band already uses, and the sibling QuoteKeeper contract's own missing-metric handling. Failing a real facility because an LLM didn't happen to find a stated figure was punishing ambiguity as if it were confirmed evidence of a problem - see "Design notes" in the README. |
| *"Single borrower per instance."* | **Not addressed in this milestone** - out of scope; a natural v3 extension (factory pattern or keyed facilities), not attempted here to keep this update's scope to the three limitations actually named as the highest-value fixes. |

One more thing worth naming explicitly: combining multiple covenants into one period verdict needs an ordering decision - does a confirmed `FAIL` on one covenant win over an `INCONCLUSIVE` on another, or the reverse? v2 checks `FAIL` before `INCONCLUSIVE` from the start. This is the exact ordering mistake a later self-audit found **already shipped and wrong** in the sibling QuoteKeeper contract (see [its own CONTRACT.md](https://github.com/HarrisonJL/quotekeeper/blob/main/CONTRACT.md)) - getting it right here from day one, with a dedicated regression test (`test_fail_beats_inconclusive_when_combining_two_covenants`), is a direct, applied lesson from that earlier finding.

## Deployment

- **Address:** [`0xeAfeD2A86317Db3Cd745ae2EbCB82549906bcDc7`](https://explorer-studio-dev.genlayer.com/address/0xeAfeD2A86317Db3Cd745ae2EbCB82549906bcDc7)
- **Network:** GenLayer Studio Next (chain id `61997`)
- **Deploy tx:** `0xd811a86491e3b2d024f6d4843903ca004eadcbe454b5a4acad14c254cd67035b`
- **Owner/lender:** `0x5cdb5699bc1038e115A973bb91A646f7E98C075b`
- **Borrower:** `0x547A9403cFAdd7E3abE77a777cE0f05D102655C7`
- **Contract source:** [`contracts/covenant_sentinel_v2_studio_next.py`](contracts/covenant_sentinel_v2_studio_next.py) - the mechanical Studio Next port of [`contracts/covenant_sentinel_v2.py`](contracts/covenant_sentinel_v2.py) (the locally-tested, GenVM v0.2.11 source of truth), using the same import/decorator conventions already proven on SolvencyOracle, QuoteKeeper and AuditScope. Passed its live schema check on the first try.

Local Direct Mode testing (`genlayer-test`) only supports the v0.2.11 generation, the same reason every sibling project in this account's work keeps its actually-tested source on that generation and validates the Studio Next port live only. (One real rough edge found while building this: pointing Direct Mode at a v0.3.0-syntax file doesn't produce a clean error - it hangs the test process indefinitely. Confirmed by bisecting down to a minimal two-line reproduction before concluding it was a tooling mismatch, not a bug in this contract.)

## Live proof: the full state machine in one run, first try

One continuous live run exercises every new v2 feature in sequence - full transcript in [`studio-next/demo.ts`](studio-next/demo.ts):

1. `add_covenant("min_dscr", "dscr", "gte", 12500, 500)` - tx [`0x7d2b8b20...4fcd2a289`](https://explorer-studio-dev.genlayer.com/tx/0x7d2b8b20b204ee2eb5137ab384f12ec18f8742c62759c326d60a1496fcd2a289) - DSCR >= 1.25x, 5% tolerance band.
2. `submit_disclosure(1, "...DSCR was 1.50x...")` - tx [`0xd764b3a4...951b0eb1`](https://explorer-studio-dev.genlayer.com/tx/0xd764b3a4a14e9de0ac5d226aa2fb1217e6085fd0beabfc361969a601951b0eb1) - extracted `dscr: 15000`, decisively above the band -> **PASS**.
3. `submit_disclosure_url(2, ".../demo/disclosure_q2_borderline.md")` - tx [`0xb0078959...5e416953`](https://explorer-studio-dev.genlayer.com/tx/0xb0078959a8b7ed05b4d94f31d000c78dadcc174151f2e2826100dff05e416953) - a **real live fetch** of a page saying DSCR was "approximately 1.26x"; extracted `dscr: 12600`, inside the `[11875, 13125]` tolerance band around the 12500 threshold -> **INCONCLUSIVE**, correctly, and the facility stayed `current` rather than manufacturing a breach out of the ambiguity.
4. `submit_disclosure(3, "...DSCR fell sharply to 0.80x...")` - tx [`0x1cf1b2ce...770ff41f8`](https://explorer-studio-dev.genlayer.com/tx/0x1cf1b2cee31bd5f9b58ba15afee05a191f47c90f468500dc1660867770ff41f8) - extracted `dscr: 8000`, decisively below the band -> **FAIL**. Facility flips to **breach**, `active_breach_period_id = 3`.
5. `request_waiver("min_dscr", 3, "One-time unplanned expense...")` - tx [`0x7aa35263...12ee08e0cb`](https://explorer-studio-dev.genlayer.com/tx/0x7aa35263e53b74ba9de5c0529db7523ff8745e22b6ea86949a900d12ee08e0cb) - borrower requests a waiver for the exact covenant that failed.
6. `grant_waiver(0)` - tx [`0xc1bc701b...0a48e40549`](https://explorer-studio-dev.genlayer.com/tx/0xc1bc701b534cca03050d92f6cf0bafa3974545fba7b77e1a282a520a48e40549) - lender grants it. Since this was the only covenant that failed in period 3, the facility moves to **waived**.
7. `submit_disclosure(4, "...DSCR recovered to 1.50x...")` - tx [`0xaa0731e7...0ba86ead54`](https://explorer-studio-dev.genlayer.com/tx/0xaa0731e790786f09af306ca0980eed281ebfc09b42e37a8727cdac0ba86ead54) - extracted `dscr: 15000` -> **PASS**. Facility stays `waived` - cure is explicit, not automatic.
8. `cure(4)` - tx [`0x84633f7e...d18188cf4e`](https://explorer-studio-dev.genlayer.com/tx/0x84633f7eb19365df6fbf9b09f6df1857e707e102120a98b3f76741d18188cf4e) - period 4 is genuinely later than the period-3 breach and passed every covenant, so the facility returns to **current**, `active_breach_period_id` resets to `0`.

Final `get_state()`: `{"status": "current", "period_count": 4, "waiver_count": 1, "audit_log_count": 9, "active_breach_period_id": 0}`.

`get_audit_log(0, 20)` (oldest first) reads exactly as designed - a legible, append-only record for a steward or a lender to review without touching the contract's code:

```
period_submitted (1, PASS) -> period_submitted (2, INCONCLUSIVE) -> period_submitted (3, FAIL)
-> breach -> waiver_requested -> waiver_granted -> waived -> period_submitted (4, PASS) -> cured
```

Every step reached consensus on the first attempt (`result_name: MAJORITY_AGREE`, `status_name: FINALIZED`) - no retries, no rate-limit waits, no flaky-network caveats to document this time.

## Testing

| | Before (v1 only) | After (v1 + v2) |
|---|---|---|
| `tests/test_covenant_sentinel.py` (v1, untouched) | 12 tests (1 skipped - see its own skip reason) | unchanged, still 12 (1 skipped) |
| `tests/test_covenant_sentinel_v2.py` (new) | - | 29 tests, all passing |
| **Total** | **12 (11 passing, 1 skipped)** | **41 passing, 1 skipped** |

v2's 29 tests cover: basic PASS/FAIL/INCONCLUSIVE via the tolerance band and the missing-metric change; all four v1 replay-protection scenarios re-verified against v2; `submit_disclosure_url`'s live-fetch path including a fetch-failure case proven to revert with no partial state (no mock registered for the URL - Direct Mode's stand-in for a dead link or a failed request); the full waiver request/grant/reject flow including access control; a multi-covenant breach proven to require **every** failed covenant individually waived before the facility reaches `waived`; `cure()`'s two guard conditions (must be `waived`, must reference a genuinely later passing period); the full breach -> waiver -> cure cycle including the exact audit-log sequence; and the consensus-boundary tests proving the tolerance-band decision-margin equivalence (agreement across different-but-decisive numbers, rejection of a leader's claimed clean `PASS` on a validator's own borderline reading, exact-band-edge agreement) plus the FAIL-before-INCONCLUSIVE combination ordering.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install "genlayer-test[sim]" genvm-linter==0.11.0
genvm-lint check contracts/covenant_sentinel_v2.py
python -m pytest tests/ -v
```

## Relationship to this account's other self-audit work

This milestone was built with the QuoteKeeper self-audit's lesson already in hand, not learned the hard way a second time: the FAIL-before-INCONCLUSIVE combination ordering that a self-audit found broken *after* QuoteKeeper had already shipped is implemented correctly here from the first line, with its own dedicated regression test rather than being discovered later. The other AuditScope self-audit lesson - never truncate evidence before comparing/hashing it with a cap sized for an unrelated purpose - didn't have a direct analogue to misapply here, since `submit_disclosure_url`'s content hash is explicitly evidence-only, not a consensus input, so there was no equivalent cap-reuse trap to fall into.
