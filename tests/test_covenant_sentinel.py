"""
Deterministic unit tests for Covenant Sentinel using genlayer-test's Direct
Mode, with the extraction LLM call mocked out. These test the mechanical
logic (threshold comparison, access control, state transitions) - not
whether real-world LLM extraction is accurate, which needs a live key and
real disclosures to properly evaluate.
"""

import pytest

DSCR_OK = '{"dscr": 15000}'
DSCR_BREACH = '{"dscr": 10000}'
DSCR_MISSING = '{"dscr": null}'


def _hex(addr) -> str:
    return addr if isinstance(addr, str) else "0x" + addr.hex()


def _deploy(direct_vm, direct_deploy, owner, borrower, **overrides):
    direct_vm.sender = owner
    params = dict(
        borrower=_hex(borrower),
        reporting_deadline_seconds=7 * 24 * 60 * 60,
    )
    params.update(overrides)
    return direct_deploy("contracts/covenant_sentinel.py", **params)


def _add_dscr_covenant(direct_vm, sentinel, owner):
    direct_vm.sender = owner
    sentinel.add_covenant("min_dscr", "dscr", "gte", 12500)  # DSCR >= 1.25


def test_initial_state(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    state = sentinel.get_state()
    assert state["status"] == "current"
    assert state["covenant_count"] == 0
    assert state["period_count"] == 0
    assert state["borrower"].lower() == _hex(direct_alice).lower()


def test_only_owner_can_add_covenant(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    direct_vm.sender = direct_alice
    with pytest.raises(Exception):
        sentinel.add_covenant("min_dscr", "dscr", "gte", 12500)


def test_submit_disclosure_passes_covenant(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.mock_llm("debt covenant check", DSCR_OK)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR was 1.5x this period.")

    state = sentinel.get_state()
    assert state["status"] == "current"
    assert state["period_count"] == 1
    periods = sentinel.get_periods(0, 10)
    assert periods[0]["all_passed"] is True


def test_submit_disclosure_breaches_covenant(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.mock_llm("debt covenant check", DSCR_BREACH)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: DSCR fell to 1.0x this period.")

    state = sentinel.get_state()
    assert state["status"] == "breach"
    periods = sentinel.get_periods(0, 10)
    assert periods[0]["all_passed"] is False


def test_submit_disclosure_missing_metric_fails_conservatively(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.mock_llm("debt covenant check", DSCR_MISSING)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "Q1 disclosure: strong quarter, no specific figures given.")

    state = sentinel.get_state()
    assert state["status"] == "breach"


def test_only_borrower_can_submit_disclosure(direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.mock_llm("debt covenant check", DSCR_OK)

    direct_vm.sender = direct_bob
    with pytest.raises(Exception):
        sentinel.submit_disclosure(1, "not the real borrower")


def test_cannot_submit_after_breach(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice)
    _add_dscr_covenant(direct_vm, sentinel, direct_owner)
    direct_vm.mock_llm("debt covenant check", DSCR_BREACH)

    direct_vm.sender = direct_alice
    sentinel.submit_disclosure(1, "DSCR fell to 1.0x.")
    assert sentinel.get_state()["status"] == "breach"

    with pytest.raises(Exception):
        sentinel.submit_disclosure(2, "another period")


def test_flag_reporting_default_before_deadline_fails(direct_vm, direct_deploy, direct_owner, direct_alice):
    sentinel = _deploy(direct_vm, direct_deploy, direct_owner, direct_alice, reporting_deadline_seconds=60)
    with pytest.raises(Exception):
        sentinel.flag_reporting_default()


@pytest.mark.skip(
    reason=(
        "gltest 0.29.2's Direct Mode `direct_vm.warp()` never actually "
        "reaches gl.message_raw['datetime'] (see genlayer-vault's "
        "test_vault_logic.py for the same documented limitation, confirmed "
        "by reading gltest/direct/vm.py directly), and _datetime is fixed "
        "at fixture creation rather than read from wall-clock per call, so "
        "there is no way to genuinely advance time in this test mode. The "
        "'has NOT elapsed yet' path is covered by "
        "test_flag_reporting_default_before_deadline_fails. Re-verify this "
        "specific case once warp() is fixed upstream."
    )
)
def test_flag_reporting_default_after_deadline(direct_vm, direct_deploy, direct_owner, direct_alice):
    pass
