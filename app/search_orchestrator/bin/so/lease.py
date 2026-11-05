"""Engine leader lease in the so_locks collection (spec section 8).

Only insert, update and delete are used, with one semantic: inserting a
``_key`` that exists fails (HTTP 409, ``kv_insert`` returns False).
"""
COLLECTION = "so_locks"
KEY = "engine"
LEASE_SECONDS = 30


class Lease:
    def __init__(self, gateway, seconds=LEASE_SECONDS):
        self.gw = gateway
        self.seconds = seconds

    def _doc(self, holder, now):
        return {"_key": KEY, "holder": holder, "expires": int(now) + self.seconds}

    def acquire(self, holder, now):
        """Take or renew the lease. True if ``holder`` is the leader after the call.

        1. Insert ``_key="engine"``. Exactly one concurrent insert succeeds; the
           others get a duplicate-key error and lose.
        2. If the document is ours and unexpired, renew it by updating it and
           re-reading it to confirm it is still ours.
        3. If someone else holds it unexpired, we lose.
        4. If it has expired, take over: delete the *exact expired document we
           saw* (a query on _key, holder and expires), then insert. Two
           contenders can both see the expiry, but only one insert wins, and
           the other gets a duplicate-key error. Because the delete is
           conditional on the observed holder and expiry, a slow contender
           cannot delete the winner's fresh lease and then insert its own.
        """
        if self.gw.kv_insert(COLLECTION, self._doc(holder, now)):
            return True
        current = self.gw.kv_get(COLLECTION, KEY)
        if current is None:  # released between our insert and read
            return self.gw.kv_insert(COLLECTION, self._doc(holder, now))
        if current.get("expires", 0) > now:
            if current.get("holder") != holder:
                return False
            self.gw.kv_update(COLLECTION, KEY, self._doc(holder, now))
            again = self.gw.kv_get(COLLECTION, KEY)
            return bool(again) and again.get("holder") == holder
        self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": current.get("holder"),
                                             "expires": current.get("expires")})
        return self.gw.kv_insert(COLLECTION, self._doc(holder, now))

    def release(self, holder):
        """Give the lease up if we hold it (clean shutdown)."""
        current = self.gw.kv_get(COLLECTION, KEY)
        if current and current.get("holder") == holder:
            self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": holder})
