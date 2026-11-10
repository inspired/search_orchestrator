"""Engine leader lease in the so_locks collection (spec section 8).

Only insert, update and delete are used, with one semantic: inserting a
``_key`` that exists fails (HTTP 409, ``kv_insert`` returns False).
"""
COLLECTION = "so_locks"
KEY = "engine"
LEASE_SECONDS = 90  # well above the engine's 15 s per-call timeout (gateway.ENGINE_CALL_TIMEOUT)


class Lease:
    def __init__(self, gateway, seconds=LEASE_SECONDS):
        self.gw = gateway
        self.seconds = seconds
        self._mine = None  # the document this object last wrote

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

        A renewal already knows the document it wrote, so it starts at step 3 with
        that document and skips steps 1 and 2. If that insert fails, someone else
        wrote a lease, and the steps above decide who holds it.
        """
        mine, self._mine = self._mine, None
        if mine is not None and mine["holder"] == holder:
            self._delete_exact(mine)
            if self._insert(holder, now):
                return True
        if self._insert(holder, now):
            return True
        current = self.gw.kv_get(COLLECTION, KEY)
        if current is None:  # released between our insert and read
            return self._insert(holder, now)
        if current.get("expires", 0) > now and current.get("holder") != holder:
            return False
        self._delete_exact(current)
        return self._insert(holder, now)

    def _insert(self, holder, now):
        doc = self._doc(holder, now)
        if not self.gw.kv_insert(COLLECTION, doc):
            return False
        self._mine = doc
        return True

    def _delete_exact(self, doc):
        self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": doc.get("holder"),
                                             "expires": doc.get("expires")})

    def release(self, holder):
        """Give the lease up if we hold it (clean shutdown)."""
        self._mine = None
        current = self.gw.kv_get(COLLECTION, KEY)
        if current and current.get("holder") == holder:
            self.gw.kv_delete_query(COLLECTION, {"_key": KEY, "holder": holder})
