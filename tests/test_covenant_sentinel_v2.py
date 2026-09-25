"""
Deterministic tests for Covenant Sentinel v2 using genlayer-test's Direct
Mode, mirroring the structure already proven across this account's sibling
GenLayer projects:

1. Registration / basic disclosure flow - PASS/FAIL/INCONCLUSIVE via the
   new tolerance band, replacing v1's strict_eq (v1's own tests stay in
   tests/test_covenant_sentinel.py, untouched, covering the original
   contract).
2. Replay protections - the same four scenarios v1 was fixed for, ported
   to confirm v2 didn't regress them.
3. submit_disclosure_url - live fetch path, including a fetch-failure
   case reverting cleanly with no partial state.
4. Waiver / cure state machine - request/grant/reject, multi-covenant
   breaches needing every failed covenant individually waived, and cure()
   requiring a genuinely later passing period.
5. Consensus-boundary tests via direct_vm.run_validator(leader_result=...)
   - the tolerance-band INCONCLUSIVE straddle case, and the FAIL-beats-
   INCONCLUSIVE combination ordering (the exact bug a self-audit found and
   fixed in the sibling QuoteKeeper contract after it had already shipped
   - proactively tested here from the start).
"""

import json

import pytest

DSCR_METRIC = "dscr"
URL = "https://example.com/disclosure"


def _hex(addr) -> str:
    return addr if isinstance(addr, str) else "0x" + addr.hex()


def _deploy(direct_vm, direct_deploy, owner, borrower, **overrides):
    direct_vm.sender = owner
    params = dict(
        borrower=_hex(borrower),
        reporting_deadline_seconds=7 * 24 * 60 * 60,
    )
    params.update(overrides)
    return direct_deploy("contracts/covenant_sentinel_v2.py", **params)


def _add_dscr_covenant(direct_vm, sentinel, owner, threshold_bps=12500, tolerance_bps=500):
    direct_vm.sender = owner
    sentinel.add_covenant("min_dscr", DSCR_METRIC, "gte", threshold_bps, tolerance_bps)


def _mock_dscr(direct_vm, dscr_bps):
    direct_vm.mock_llm("debt covenant check", json.dumps({DSCR_METRIC: dscr_bps}))


def _mock_page(direct_vm, url, body):
    direct_vm.mock_web(url, {"method": "GET", "status": 200, "body": body})


# --- Basic flow: PASS / FAIL / INCONCLUSIVE via tolerance -------------------


def test_initial_state(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    state = sentinel.get_state()
    assert state["status"] == "current"
    assert state["covenant_count"] == 0
    assert state["period_count"] == 0
    assert state["waiver_count"] == 0
    assert state["active_breach_period_id"] == 0


def test_submit_disclosure_pass_when_decisively_above_threshold(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 15000)  # decisively above 1.25x

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was 1.5x this period.")

    assert sentinel.get_state()["status"] == "current"
    p = sentinel.get_periods(0, 10)[0]
    assert p["verdict"] == "PASS"
    assert json.loads(p["per_covenant_json"]) == {"min_dscr": "PASS"}


def test_submit_disclosure_fails_when_decisively_below_threshold(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 8000)  # decisively below 1.25x

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR fell to 0.8x.")

    state = sentinel.get_state()
    assert state["status"] == "breach"
    assert state["active_breach_period_id"] == 1
    p = sentinel.get_periods(0, 10)[0]
    assert p["verdict"] == "FAIL"


def test_submit_disclosure_inconclusive_when_within_tolerance_band(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    # threshold 12500, tolerance 500bps (5%) -> band = 12500*500//10000 = 625
    # -> [11875, 13125] is INCONCLUSIVE
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 12600)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was right around 1.26x.")

    state = sentinel.get_state()
    assert state["status"] == "current"  # INCONCLUSIVE must not manufacture a breach
    p = sentinel.get_periods(0, 10)[0]
    assert p["verdict"] == "INCONCLUSIVE"


def test_submit_disclosure_inconclusive_when_metric_not_found(direct_vm, direct_deploy, direct_owner, direct_alice):
    # v1 treated a missing metric as an automatic FAIL ("fails conservatively").
    # v2 deliberately changes this to INCONCLUSIVE: failing a facility over a
    # number the LLM didn't happen to find manufactures a breach out of
    # missing data, not out of evidence of one - see README.
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, None)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: strong quarter, no specific figures given.")

    state = sentinel.get_state()
    assert state["status"] == "current"
    assert sentinel.get_periods(0, 10)[0]["verdict"] == "INCONCLUSIVE"


def test_only_borrower_can_submit_disclosure(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception):
        sentinel.submit_disclosure(1, "not the real borrower")


def test_only_owner_can_add_covenant(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.add_covenant("min_dscr", DSCR_METRIC, "gte", 12500, 500)


def test_add_covenant_rejects_tolerance_over_cap(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_owner
    with pytest.raises(Exception):
        sentinel.add_covenant("min_dscr", DSCR_METRIC, "gte", 12500, 2001)


# --- Replay protections (ported from v1, must still hold in v2) ------------


def test_submit_disclosure_accepts_strictly_advancing_period_ids(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was 1.5x.")
    sentinel.submit_disclosure(2, "Q2 disclosure: DSCR was 1.5x.")

    state = sentinel.get_state()
    assert state["period_count"] == 2
    assert state["last_period_id"] == 2


def test_submit_disclosure_rejects_duplicate_period_id(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was 1.5x.")

    with pytest.raises(Exception):
        sentinel.submit_disclosure(1, "Q1 disclosure again: still 1.5x.")

    assert sentinel.get_state()["period_count"] == 1


def test_submit_disclosure_rejects_non_advancing_period_id(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(5, "Q5 disclosure: DSCR was 1.5x.")

    with pytest.raises(Exception):
        sentinel.submit_disclosure(3, "an earlier period, replayed out of order")

    assert sentinel.get_state()["period_count"] == 1
    assert sentinel.get_state()["last_period_id"] == 5


def test_rejected_replay_does_not_update_last_report_time(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was 1.5x.")
    report_time_after_valid_submit = sentinel.get_state()["last_report_time"]

    with pytest.raises(Exception):
        sentinel.submit_disclosure(1, "replaying period 1 to try to reset the clock")

    state = sentinel.get_state()
    assert state["last_report_time"] == report_time_after_valid_submit
    assert state["last_period_id"] == 1
    assert state["period_count"] == 1


# --- submit_disclosure_url: live fetch, including failure ------------------


def test_submit_disclosure_url_fetches_and_extracts(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_page(direct_vm, URL, "Q1 disclosure: DSCR was 1.5x this period.")
    _mock_dscr(direct_vm, 15000)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure_url(1, URL)

    state = sentinel.get_state()
    assert state["status"] == "current"
    assert state["period_count"] == 1
    p = sentinel.get_periods(0, 10)[0]
    assert p["verdict"] == "PASS"
    assert p["disclosure_url"] == URL
    assert p["disclosure_text"] == ""
    assert len(p["content_hash"]) == 64  # sha256 hex digest, evidence only


def test_submit_disclosure_url_rejects_non_https(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.submit_disclosure_url(1, "http://example.com/disclosure")


def test_submit_disclosure_url_fetch_failure_reverts_cleanly(direct_vm, direct_deploy, direct_owner, direct_alice):
    # No mock registered for this URL at all: Direct Mode's strict mock
    # mode raises MockNotFoundError, simulating a fetch that never returns
    # (the real-world analogue of a dead link, a timeout, or a non-2xx
    # response). The whole call must revert with no partial state - the
    # same "state provably untouched by a failed call" bar already proven
    # for the replay-protection tests above, now applied to the new
    # failure point this version introduces.
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)

    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.submit_disclosure_url(1, "https://example.com/never-mocked")

    state = sentinel.get_state()
    assert state["period_count"] == 0
    assert state["last_period_id"] == 0
    assert state["status"] == "current"


# --- Waiver / cure state machine --------------------------------------------


def _breach(direct_vm, sentinel, owner, alice, dscr_bps=8000, period_id=1, threshold_bps=12500, tolerance_bps=500):
    _add_dscr_covenant(direct_vm, sentinel, owner, threshold_bps=threshold_bps, tolerance_bps=tolerance_bps)
    _mock_dscr(direct_vm, dscr_bps)
    direct_vm.sender = alice
    sentinel.submit_disclosure(period_id, f"Disclosure: DSCR was {dscr_bps / 10000}x.")


def test_request_waiver_requires_breach_status(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.request_waiver("min_dscr", 1, "nothing has breached yet")


def test_request_waiver_rejects_covenant_that_did_not_fail(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.request_waiver("not_a_real_covenant", 1, "made up covenant name")


def test_only_borrower_can_request_waiver(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice)
    direct_vm.sender = direct_bob
    with pytest.raises(Exception):
        sentinel.request_waiver("min_dscr", 1, "not the real borrower")


def test_grant_single_covenant_waiver_moves_facility_to_waived(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice)

    direct_vm.sender = direct_alice
    sentinel.request_waiver("min_dscr", 1, "temporary liquidity crunch, resolving next quarter")
    assert sentinel.get_state()["status"] == "breach"  # still pending

    direct_vm.sender = direct_owner
    sentinel.grant_waiver(0)

    state = sentinel.get_state()
    assert state["status"] == "waived"
    w = sentinel.get_waiver(0)
    assert w["status"] == "granted"
    assert w["decided_by"].lower() == _hex(direct_owner).lower()


def test_only_owner_can_decide_a_waiver(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    sentinel.request_waiver("min_dscr", 1, "rationale")

    direct_vm.sender = direct_bob
    with pytest.raises(Exception):
        sentinel.grant_waiver(0)


def test_reject_waiver_keeps_facility_in_breach(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    sentinel.request_waiver("min_dscr", 1, "rationale")

    direct_vm.sender = direct_owner
    sentinel.reject_waiver(0, "not convincing, please cure organically")

    state = sentinel.get_state()
    assert state["status"] == "breach"
    w = sentinel.get_waiver(0)
    assert w["status"] == "rejected"
    assert w["decision_note"] == "not convincing, please cure organically"


def test_multi_covenant_breach_needs_every_covenant_waived(direct_vm, direct_deploy, direct_owner, direct_alice):
    # Two covenants, both failing in the same period: the facility must
    # only move to "waived" once BOTH have an individually granted waiver
    # - granting just one must not be enough.
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_owner
    sentinel.add_covenant("min_dscr", "dscr", "gte", 12500, 500)
    sentinel.add_covenant("max_leverage", "leverage", "lte", 40000, 500)
    direct_vm.mock_llm(
        "debt covenant check",
        json.dumps({"dscr": 8000, "leverage": 60000}),  # both decisively breach
    )

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Both DSCR and leverage breached this period.")
    assert sentinel.get_state()["status"] == "breach"

    sentinel.request_waiver("min_dscr", 1, "dscr rationale")
    sentinel.request_waiver("max_leverage", 1, "leverage rationale")

    direct_vm.sender = direct_owner
    sentinel.grant_waiver(0)
    assert sentinel.get_state()["status"] == "breach"  # only one of two granted so far

    sentinel.grant_waiver(1)
    assert sentinel.get_state()["status"] == "waived"  # now both are granted


def test_cure_requires_waived_status(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    _mock_dscr(direct_vm, 15000)
    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "fine")

    with pytest.raises(Exception):
        sentinel.cure(1)  # never breached, nothing to cure


def test_cure_requires_a_later_passing_period(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice, period_id=1)
    direct_vm.sender = direct_alice
    sentinel.request_waiver("min_dscr", 1, "rationale")
    direct_vm.sender = direct_owner
    sentinel.grant_waiver(0)
    assert sentinel.get_state()["status"] == "waived"

    with pytest.raises(Exception):
        sentinel.cure(1)  # period 1 is the breach itself, not a later passing period


def test_full_breach_waiver_cure_cycle(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _breach(direct_vm, sentinel, direct_owner, direct_alice, period_id=1)

    direct_vm.sender = direct_alice
    sentinel.request_waiver("min_dscr", 1, "temporary shortfall")
    direct_vm.sender = direct_owner
    sentinel.grant_waiver(0)
    assert sentinel.get_state()["status"] == "waived"

    direct_vm.clear_mocks()
    _mock_dscr(direct_vm, 15000)  # a later period, back in compliance
    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(2, "Q2 disclosure: back to 1.5x DSCR.")
    assert sentinel.get_periods(0, 1)[0]["verdict"] == "PASS"
    assert sentinel.get_state()["status"] == "waived"  # cure is explicit, not automatic

    sentinel.cure(2)
    state = sentinel.get_state()
    assert state["status"] == "current"
    assert state["active_breach_period_id"] == 0

    log = sentinel.get_audit_log(0, 20)
    event_types = [e["event_type"] for e in reversed(log)]
    assert event_types == [
        "period_submitted", "breach", "waiver_requested", "waiver_granted",
        "waived", "period_submitted", "cured",
    ]


# --- Consensus boundary: tolerance equivalence + FAIL/INCONCLUSIVE order ---


def test_validator_agrees_when_both_decisively_pass_different_numbers(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 15000)
    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "disclosure")  # captures validator_fn

    direct_vm.clear_mocks()
    _mock_dscr(direct_vm, 16000)  # different number, still decisively PASS
    leader_result = json.dumps({"extracted": {"dscr": 15000}, "content_hash": "x"})
    assert direct_vm.run_validator(leader_result=leader_result) is True


def test_validator_rejects_leader_pass_on_borderline_reading(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    # threshold 12500, tolerance 500bps -> band 625 -> [11875,13125] INCONCLUSIVE
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 15000)
    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "disclosure")  # captures validator_fn

    direct_vm.clear_mocks()
    _mock_dscr(direct_vm, 12600)  # inside the band -> INCONCLUSIVE for this validator
    leader_result = json.dumps({"extracted": {"dscr": 15000}, "content_hash": "x"})  # leader claims clean PASS
    assert direct_vm.run_validator(leader_result=leader_result) is False


def test_validator_agrees_at_exact_tolerance_band_edge(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    # band = 625 -> value 13125 is exactly on the INCONCLUSIVE boundary;
    # 13126 is one past it -> decisive PASS for both.
    _add_dscr_covenant(direct_vm, sentinel, direct_owner, threshold_bps=12500, tolerance_bps=500)
    _mock_dscr(direct_vm, 13126)
    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "disclosure")

    direct_vm.clear_mocks()
    _mock_dscr(direct_vm, 13200)  # also decisively PASS, different number
    leader_result = json.dumps({"extracted": {"dscr": 13126}, "content_hash": "x"})
    assert direct_vm.run_validator(leader_result=leader_result) is True


def test_fail_beats_inconclusive_when_combining_two_covenants(direct_vm, direct_deploy, direct_owner, direct_alice):
    # The exact ordering a self-audit later found broken in the sibling
    # QuoteKeeper contract, tested here from the start: a decisive breach
    # on one covenant must not be masked into INCONCLUSIVE just because
    # another covenant's reading happens to be borderline.
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_owner
    sentinel.add_covenant("min_dscr", "dscr", "gte", 12500, 500)  # band 625
    sentinel.add_covenant("max_leverage", "leverage", "lte", 40000, 500)  # band 2000
    direct_vm.mock_llm(
        "debt covenant check",
        json.dumps({"dscr": 8000, "leverage": 40500}),  # dscr decisive FAIL, leverage borderline INCONCLUSIVE
    )

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "dscr breached, leverage borderline")

    p = sentinel.get_periods(0, 1)[0]
    assert p["verdict"] == "FAIL"
    assert json.loads(p["per_covenant_json"]) == {"min_dscr": "FAIL", "max_leverage": "INCONCLUSIVE"}
    assert sentinel.get_state()["status"] == "breach"
