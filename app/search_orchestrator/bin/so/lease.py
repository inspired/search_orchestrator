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
        2. If someone else holds it unexpired, we lose.
        3. Otherwise (ours, to renew, or expired, to take over) replace the
           *exact document we saw*: delete it with a query on _key, holder and
           expires, then insert. Renewal uses the same path as takeover, never
           an unconditional update: A could read its own unexpired lease, B
           (with a later clock) could take over, and A's update would then
           overwrite B's document so both lead. With delete-then-insert the
           conditional delete is a no-op once B's document replaced ours, and
           A's insert gets a duplicate-key error, so A knows it lost. Likewise
           a slow takeover contender cannot delete the winner's fresh lease.
           The only cost is a brief gap with no document, in which another
           contender may win; the renewer then simply loses, which is safe.
        """
        if self.gw.kv_insert(COLLECTION, self._doc(holder, now)):
            return True
        current = self.gw.kv_get(COLLECTION, KEY)
        if current is None:  # released between our insert and read
            return self.gw.kv_insert(COLLECTION, self._doc(holder, now))
        if current.get("expires", 0) > now and current.get("holder") != holder:
            return False
        self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": current.get("holder"),
                                             "expires": current.get("expires")})
        return self.gw.kv_insert(COLLECTION, self._doc(holder, now))

    def release(self, holder):
        """Give the lease up if we hold it (clean shutdown)."""
        current = self.gw.kv_get(COLLECTION, KEY)
        if current and current.get("holder") == holder:
            self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": holder})
