from fakes import FakeGateway
from so.lease import Lease


def test_lease_single_holder():
    gw = FakeGateway()
    a, b = Lease(gw), Lease(gw)
    assert a.acquire("A", 1000) is True
    assert b.acquire("B", 1001) is False
    assert a.acquire("A", 1010) is True   # renew
    assert b.acquire("B", 1020) is False  # renewed to 1040


def test_lease_takeover_after_30s():
    gw = FakeGateway()
    a, b = Lease(gw), Lease(gw)
    assert a.acquire("A", 1000)
    assert not b.acquire("B", 1029)
    assert b.acquire("B", 1030)
    assert not a.acquire("A", 1031)


def test_lease_race_only_one_wins():
    """B reads the expired doc, then A completes a takeover before B deletes."""
    gw = FakeGateway()
    Lease(gw).acquire("OLD", 1000)
    a, b = Lease(gw), Lease(gw)
    real = gw.kv_delete_query
    state = {"armed": True}

    def delete_after_a_wins(collection, query):
        if state["armed"]:
            state["armed"] = False
            assert a.acquire("A", 1100)  # A runs its whole takeover inside B's gap
        real(collection, query)

    gw.kv_delete_query = delete_after_a_wins
    assert b.acquire("B", 1100) is False
    assert gw.kv_get("so_locks", "engine")["holder"] == "A"


def test_lease_simultaneous_takeover_one_winner():
    gw = FakeGateway()
    Lease(gw).acquire("OLD", 1000)
    results = [Lease(gw).acquire(h, 1100) for h in ("A", "B", "C")]
    assert results.count(True) == 1


def test_renew_interleaved_with_takeover_single_leader():
    """A reads its own unexpired lease; B (later clock) takes over before A writes."""
    gw = FakeGateway()
    a, b = Lease(gw), Lease(gw)
    assert a.acquire("A", 1000)  # expires 1030
    real = gw.kv_delete_query
    state = {"armed": True}

    def b_takes_over_first(collection, query):
        if state["armed"]:
            state["armed"] = False
            assert b.acquire("B", 1031)  # sees it expired
        real(collection, query)

    gw.kv_delete_query = b_takes_over_first
    assert a.acquire("A", 1029) is False
    assert gw.kv_get("so_locks", "engine")["holder"] == "B"


def test_renew_extends_expiry():
    gw = FakeGateway()
    lease = Lease(gw)
    lease.acquire("A", 1000)
    assert lease.acquire("A", 1020)
    assert gw.kv_get("so_locks", "engine")["expires"] == 1050
