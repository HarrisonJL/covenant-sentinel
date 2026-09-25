# Covenant Sentinel

A debt-covenant monitor for tokenized RWA / private-credit facilities, built as a [GenLayer](https://genlayer.com) Intelligent Contract. A lender defines the covenants (minimum DSCR, maximum leverage, minimum liquidity - anything expressible as a threshold on a named metric). Each reporting period, the borrower submits their disclosure as plain text. Every validator independently reads it, extracts the relevant figures, and the contract compares them against the covenant thresholds in plain deterministic code. If a covenant fails, the facility flips to `breach` - a state any downstream EVM contract can read and act on.

**Live on GenLayer's Bradbury testnet. Testnet only - no real value anywhere in this project.**

## Milestone: v2 is now the current version

**[`MILESTONE.md`](MILESTONE.md)** documents Covenant Sentinel v2, a Milestone update live on **GenLayer Studio Next** at [`0xeAfeD2A86317Db3Cd745ae2EbCB82549906bcDc7`](https://explorer-studio-dev.genlayer.com/address/0xeAfeD2A86317Db3Cd745ae2EbCB82549906bcDc7) - [`contracts/covenant_sentinel_v2.py`](contracts/covenant_sentinel_v2.py) / [`contracts/covenant_sentinel_v2_studio_next.py`](contracts/covenant_sentinel_v2_studio_next.py). It fixes the three things this README's own "Known limitations" named below: a lender-waiver + borrower-cure path out of a one-way breach, a tolerance-band validator replacing `strict_eq` (an ambiguous disclosure now reaches consensus as `INCONCLUSIVE` instead of failing to reach consensus at all), and `submit_disclosure_url` for a live-fetched disclosure. v1 below is kept exactly as originally submitted, for provenance - it is not being replaced, and its Bradbury deployment stays live as a separate, working instance.

## Why this needs GenLayer

Covenant monitoring today is a manual, off-chain spreadsheet exercise: someone on the lender's side reads a disclosure and decides, by hand, whether the borrower is still in compliance. A plain EVM contract can't do this - it can't read a disclosure, extract a DSCR figure that might be stated directly or need computing from EBITDA and debt service mentioned elsewhere in the text, or apply any of the interpretive judgment that real-world financial disclosures require. And a single off-chain oracle that does this reintroduces exactly the trusted third party a covenant check is supposed to remove - whoever controls that oracle controls whether a real credit facility is in default.

GenLayer's validator committee removes that single point of trust: every validator extracts the figures independently, and they must reach byte-identical agreement (`gl.eq_principle.strict_eq`) before the extraction is accepted. If the disclosure is too ambiguous for independent validators to agree on the same numbers, the transaction simply fails to reach consensus - it doesn't silently record a guess that one validator happened to produce.

## Design: only the extraction is non-deterministic

The one and only LLM call in this contract pulls structured figures out of free-form text. Everything downstream of that - comparing the extracted number against the covenant's threshold, deciding pass or fail, flipping the facility to `breach` - is plain, deterministic Python with no LLM judgment involved. This is a deliberately narrower use of the equivalence principle than wrapping a second "does this disclosure satisfy the covenant?" holistic judgment on top: pushing only the genuinely non-deterministic step (reading messy text) behind consensus, and keeping the actual decision auditable and reproducible by anyone reading the contract, is the correct scope for `strict_eq` here.

Extracted values are basis-points-scaled integers (a DSCR of 1.25 becomes `12500`), not decimals. This isn't a style choice: GenVM's calldata layer cannot encode a raw Python `float` across the nondet/consensus boundary at all, and silently drops any field that comes back as one - confirmed by reading `genlayer.py.calldata`'s actual source, not assumed. Keeping every value integer end to end avoids that failure mode entirely, and matches how the covenant thresholds are already stored.

## How a facility works

1. Owner (the lender) deploys the contract with the borrower's address and a reporting deadline.
2. Owner calls `add_covenant(name, metric, comparison, threshold_bps)` for each covenant, e.g. `add_covenant("min_dscr", "dscr", "gte", 12500)`.
3. Each period, the borrower calls `submit_disclosure(period_id, disclosure_text)` with their plain-text disclosure. `period_id` must strictly advance past the last accepted one - a duplicate or non-advancing ID reverts before any extraction work runs, so a borrower can't replay an old period to reset the reporting-deadline clock without ever actually reporting a new one. Every validator extracts the named metrics independently, and the contract checks each one against its threshold.
4. If every covenant passes, the facility stays `current`. If any fails, it flips to `breach` - permanently, for this version; see Known limitations.
5. If the borrower misses a reporting deadline entirely, anyone can call `flag_reporting_default()` once the deadline has elapsed, flipping the facility to `reporting_default`.

State is fully auditable: `get_periods()` returns every period's raw disclosure text alongside the exact extracted JSON and the pass/fail verdict, so anyone can check the contract's math against the original disclosure.

## v1 Contract (original Project submission, unchanged)

- **Address:** [`0x60989e9737295e17Dad7DD4AeEE47822634049B6`](https://explorer-bradbury.genlayer.com/address/0x60989e9737295e17Dad7DD4AeEE47822634049B6) on GenLayer Bradbury Testnet (chain id `4221`)
- Source: [`contracts/covenant_sentinel.py`](contracts/covenant_sentinel.py)
- The live instance already has one real covenant (`min_dscr`, DSCR ≥ 1.25x) and one real period submitted and passed through actual validator consensus - not seeded with mock data.
- Redeployed from the original submission to add replay/reporting-deadline-bypass protection (see Known limitations below) - the original address (`0x605cFCdc095D94951c0b9Ef16E769662Dd63253E`) is superseded.

## Frontend

A lender/borrower dashboard for this contract lives in a separate repo, submitted separately as a Project rather than bundled into this Intelligent Contract submission: [github.com/HarrisonJL/covenant-sentinel-dashboard](https://github.com/HarrisonJL/covenant-sentinel-dashboard).

## Development

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install "genlayer-test[sim]" genvm-linter==0.11.0

genvm-lint check contracts/covenant_sentinel.py
python -m pytest tests/ -v
```

Deploying a fresh instance: `npm install`, set `DEPLOYER_PRIVATE_KEY` and `BORROWER_ADDRESS` in `.env` (gitignored, never commit a private key), then `npm run deploy` (add `DEPLOY_CHAIN=localnet` to target a local GLSim network first).

## Known limitations (v1)

- **Testnet only.** No real value anywhere in this project.
- **v1 is a one-way breach.** Once a covenant fails, the facility stays in `breach` permanently - there's no cure/waiver path back to `current`. A real facility would need a lender-approved waiver method; left out of v1 to keep the primitive's state machine simple and auditable. **Fixed in v2 - see [`MILESTONE.md`](MILESTONE.md).**
- **Extraction quality depends on disclosure quality.** A well-structured disclosure with figures stated plainly extracts reliably. A disclosure that requires real inference to compute a metric (e.g. deriving DSCR from scattered EBITDA and debt-service figures elsewhere in a long document) is exactly the case `strict_eq` is meant to guard: if validators can't agree, the transaction fails rather than recording an unreliable number, but that also means a genuinely ambiguous disclosure can't be processed at all in this version. **Fixed in v2** with a tolerance-band custom validator - see [`MILESTONE.md`](MILESTONE.md).
- **Single borrower per instance.** Each deployment monitors one facility. A syndicated or multi-tranche facility would need either multiple instances or an extended data model - left out of v1.
- **GenVM version note:** confirmed that GenVM's calldata layer cannot encode Python `float` values across the nondet/consensus boundary (see Design above) - this shaped the basis-points integer design, not something to work around later.
- **Reporting-deadline replay (fixed).** The original submission let `submit_disclosure` accept any `period_id` and unconditionally bumped `last_report_time` on every call, so a borrower could resubmit a duplicate or out-of-order period indefinitely and never trip `flag_reporting_default()`. Fixed by requiring `period_id` to strictly advance past `self.last_period_id` before any extraction work runs; a rejected replay reverts the whole transaction, so `last_report_time` is provably untouched. Covered by four new tests (`test_submit_disclosure_rejects_duplicate_period_id`, `test_submit_disclosure_rejects_non_advancing_period_id`, `test_rejected_replay_does_not_update_last_report_time`, `test_submit_disclosure_accepts_strictly_advancing_period_ids`).

## Relationship to GenLayer's own examples

This is not a variant of GenLayer's "Wizard of Coin" tutorial. It targets a different, unaddressed whitespace (financial covenant compliance rather than an adversarial judgment game), uses a narrower equivalence-principle scope (extraction-only, with the actual pass/fail decision left fully deterministic), and the state model (covenant definitions, per-period audit trail, a breach/default state machine) is specific to debt-covenant monitoring.
