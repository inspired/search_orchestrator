"""Built-in self-test jobs and the server probe (spec sections 10 and 14).

``| orchestrate selftest [scenario=...]`` (admin only) reaches
``api.run_selftest`` through the REST endpoint. Scenarios:

* ``basic``: ``definition()``, saved as job ``so_selftest`` and run once.
  ``a`` (makeresults, run tokens) -> ``b`` and ``c`` in parallel
  (``| loadjob $a.sid$``) -> ``d`` (``first`` and ``resultCount`` tokens of
  ``b`` and ``c``); ``skip_me`` after ``a`` with a ``run_when`` that never
  matches; ``flaky`` after ``a`` with ``retries = 1``, whose first attempt fails;
  ``merged`` (From previous steps) after ``b``, ``c`` and ``skip_me``, which
  gives one row exactly when both branches were loaded and the skipped step
  added nothing.
* ``rollup_late`` / ``rollup_fail``: ``rollup_definition(fail_first)``,
  daily -> weekly -> monthly, every step ending in ``addinfo`` so its
  ``info_min_time`` / ``info_max_time`` show the window it summarised. The late
  daily hashes ``slow_n`` values on each of 50,000 rows (the default 600 took
  38 seconds on the test server) with ``delayed_after`` 10 seconds by
  default. The failing daily fails its first attempt and passes on a re-run
  with the original definition. Rollups default to yesterday 01:00 UTC as the
  scheduled time, so a window taken from the start time would show.
* ``probe``: ``probe()`` exercises the real gateway against the server for
  shapes no unit test can prove, one ``{"check", "ok", "detail"}`` row each.
  The command adds ``rest_me`` (``me_check``) first, a loopback GET of
  ``/services/orchestrator/me`` with the caller's session.

"Fails its first attempt" without a webhook or a file write: the step looks
for its own earlier failed ``step_attempt`` audit event, and reads the shipped
lookup ``so_selftest.csv`` if there is one, else the missing
``so_selftest_missing.csv``, which fails the search. Actions are
``event`` actions into the audit index (``collect`` in a hidden search), so the
self-test needs no webhook and sends no email.

Every probe check catches its own errors and reports ``ok = 0`` with a detail
passed through ``scrub``, which removes the session keys it is given and
anything shaped like a credential. A probe never prints a secret.
"""
import re
import time
import uuid

from . import preview, tokens

AUDIT_INDEX = "orchestrator"
JOB_IDS = {"basic": "so_selftest", "rollup_late": "so_selftest_rollup_late",
           "rollup_fail": "so_selftest_rollup_fail"}
SCENARIOS = ("basic", "rollup_late", "rollup_fail", "probe")
DEFAULT_SLOW_N = 600
DEFAULT_DELAYED_AFTER = 10
SLOW_N_MAX = 100000
DELAYED_AFTER_MAX = 86400
OK_LOOKUP = "so_selftest.csv"
MISSING_LOOKUP = "so_selftest_missing.csv"
PROBE_RUN_ID = "selftest-probe"
PROBE_ROWS = 3
PREVIEW_ROWS = 2  # rows of the preview_as_caller probe search
NO_SUCH_USER = "so_selftest_no_such_user"
NO_SUCH_INDEX = "so_selftest_no_such_index"
FALLBACK_SEARCH = "_so_fallback_email"
SCRATCH = "so_selftest"  # its own collection, so the engine lease is never touched
POLL_SECONDS = 20
DETAIL_MAX = 400


def _event_action(hook):
    return {"hook": hook, "type": "event", "index": AUDIT_INDEX}


def _fail_first(step_id):
    """SPL that fails until this run has a failed attempt of ``step_id`` on record."""
    return ('| inputlookup [search earliest=-7d latest=+7d index=%s '
            'sourcetype="orchestrator:audit" type=step_attempt step_id=%s outcome=failed '
            'run_id="$run.id$" | stats count '
            '| eval lookup=if(count>0, "%s", "%s") | return $lookup]'
            % (AUDIT_INDEX, step_id, OK_LOOKUP, MISSING_LOOKUP))


def _step(step_id, name, spl, **extra):
    out = {"id": step_id, "name": name, "type": "inline", "spl": spl, "earliest": "-15m",
           "latest": "+15m", "actions": []}
    out.update(extra)
    return out


def definition():
    """The basic self-test job (without id and owner)."""
    return {
        "name": "Search Orchestrator self-test",
        "description": "Built by | orchestrate selftest. Safe to delete.",
        "enabled": True, "catchup": "none", "after_give_up": "continue", "triggers": [],
        "params": [], "run_roles": [],
        "defaults": {"delayed_after": 600, "give_up_after": 1800, "max_runtime": 600,
                     "retries": 0},
        "steps": [
            _step("a", "Make rows", '| makeresults count=%d | eval run_id="$run.id$", '
                  'scheduled="$run.scheduled_time$"' % PROBE_ROWS),
            _step("b", "Branch b", '| loadjob $a.sid$ | stats count AS rows | eval branch="b"'),
            _step("c", "Branch c", '| loadjob $a.sid$ | stats count AS rows | eval branch="c"'),
            _step("d", "Merge", '| makeresults | eval b_rows="$b.first.rows$", '
                  'c_rows="$c.first.rows$", a_count="$a.resultCount$"'),
            _step("skip_me", "Never runs", "| makeresults",
                  run_when={"kind": "expression", "value": "$a.resultCount$ < 0"}),
            _step("flaky", "Fails once", _fail_first("flaky") + " | stats count", retries=1),
            {"id": "merged", "name": "Merge inputs", "type": "previous",
             "spl": "| stats dc(branch) AS branches | where branches=2", "actions": []},
        ],
        "edges": [{"from": "a", "to": "b", "condition": "on_success"},
                  {"from": "a", "to": "c", "condition": "on_success"},
                  {"from": "b", "to": "d", "condition": "on_success"},
                  {"from": "c", "to": "d", "condition": "on_success"},
                  {"from": "a", "to": "skip_me", "condition": "on_success"},
                  {"from": "a", "to": "flaky", "condition": "on_success"},
                  {"from": "b", "to": "merged", "condition": "on_success"},
                  {"from": "c", "to": "merged", "condition": "on_success"},
                  {"from": "skip_me", "to": "merged", "condition": "on_success"}],
        "actions": [_event_action("on_failure")],
    }


def rollup_definition(fail_first, slow_n=DEFAULT_SLOW_N, delayed_after=DEFAULT_DELAYED_AFTER):
    """daily -> weekly -> monthly. ``fail_first``: the daily fails its first attempt."""
    if fail_first:
        daily = _fail_first("daily") + ' | stats count | addinfo | eval step="daily"'
        name = "Search Orchestrator self-test (rollup, failing daily)"
    else:
        # makeresults caps count at 50000 and mvexpand truncates at its memory limit, so
        # the work is slow_n hashes per row inside one eval, which holds one row at a time.
        # stats must use h: the optimizer drops an eval whose field nothing reads.
        daily = ('| makeresults count=50000 | eval r=mvrange(0,%d) '
                 '| eval h=mvcount(mvmap(r, sha512(tostring(random())))) | fields - r '
                 '| stats count sum(h) as hashes | addinfo '
                 '| eval step="daily"' % int(slow_n))
        name = "Search Orchestrator self-test (rollup, late daily)"
    return {
        "name": name, "description": "Built by | orchestrate selftest. Safe to delete.",
        "enabled": True, "catchup": "none", "after_give_up": "continue", "triggers": [],
        "params": [], "run_roles": [],
        "defaults": {"delayed_after": int(delayed_after), "give_up_after": 7200,
                     "max_runtime": 3600, "retries": 0},
        "steps": [
            _step("daily", "Daily summary", daily, earliest="-1d@d", latest="@d"),
            _step("weekly", "Weekly rollup", '| makeresults | addinfo | eval step="weekly"',
                  earliest="-7d@d", latest="@d"),
            _step("monthly", "Monthly rollup", '| makeresults | addinfo | eval step="monthly"',
                  earliest="-1mon@mon", latest="@mon"),
        ],
        "edges": [{"from": "daily", "to": "weekly", "condition": "on_success"},
                  {"from": "weekly", "to": "monthly", "condition": "on_success"}],
        "actions": [_event_action("on_delayed"), _event_action("on_failure")],
    }


def scenario_job(scenario, slow_n=DEFAULT_SLOW_N, delayed_after=DEFAULT_DELAYED_AFTER):
    """``(job_id, definition)`` for a run scenario. Raises ValueError for an unknown one."""
    if scenario == "basic":
        return JOB_IDS["basic"], definition()
    if scenario in ("rollup_late", "rollup_fail"):
        return JOB_IDS[scenario], rollup_definition(scenario == "rollup_fail", slow_n,
                                                    delayed_after)
    raise ValueError("unknown scenario %r; use one of %s" % (scenario, ", ".join(SCENARIOS)))


def default_scheduled_time(scenario, now):
    """Now for ``basic``; yesterday 01:00 UTC for the rollups."""
    now = int(now)
    if scenario in ("rollup_late", "rollup_fail"):
        return now - now % 86400 - 86400 + 3600
    return now


# Probe.

_CREDENTIAL_RES = [
    # A scheme word, then a token with a digit or symbol in it (not an ordinary word).
    re.compile(r"(?i)\b(splunk|bearer|basic)\s+(?=[^\s\"',;]*[0-9^=+/])[^\s\"',;]{8,}"),
    re.compile(r"(?i)\b(session_?key|authtoken|auth_?token|token|password|secret)"
               r"(\"?'?\s*[:=]\s*\"?'?)[^\s\"',;}]+"),
]


def scrub(text, secrets):
    """``text`` without the given secrets or anything shaped like a credential."""
    text = str(text)
    for secret in sorted((s for s in secrets or () if s and len(s) >= 6), key=len, reverse=True):
        text = text.replace(secret, "[redacted]")
    text = _CREDENTIAL_RES[0].sub(lambda m: m.group(1) + " [redacted]", text)
    text = _CREDENTIAL_RES[1].sub(lambda m: m.group(1) + m.group(2) + "[redacted]", text)
    return text if len(text) <= DETAIL_MAX else text[:DETAIL_MAX - 3] + "..."


class _Skip(Exception):
    """A check that cannot run because an earlier one failed."""


def me_check(call, secrets=()):
    """``rest_me``: GET /services/orchestrator/me with the caller's session."""
    try:
        status, payload = call("GET", "me", None)
        ok = status == 200 and bool(payload.get("user"))
        detail = "HTTP %s user=%s can_admin=%s" % (status, payload.get("user"),
                                                   payload.get("can_admin"))
        if not ok and isinstance(payload.get("error"), dict):
            detail += " %s" % payload["error"].get("message")
    except Exception as err:
        ok, detail = False, "%s: %s" % (type(err).__name__, err)
    return {"check": "rest_me", "ok": 1 if ok else 0, "detail": scrub(detail, secrets)}


def _poll(fn, done, sleep, seconds=POLL_SECONDS, every=1):
    """Call ``fn`` until ``done(value)``, at most ``seconds / every`` times."""
    value = None
    for attempt in range(max(1, int(seconds // every))):
        if attempt:
            sleep(every)
        value = fn()
        if done(value):
            break
    return value


def probe(user, user_gw, sys_gw, write_audit, job, clock=time.time, sleep=time.sleep,
          secrets=()):
    """Run every probe check; returns ``[{"check", "ok", "detail"}]``.

    ``job`` is the saved basic self-test job: its step ``a`` hidden search is
    dispatched in ``user``'s namespace as the engine does (system session). The
    caller's own access is read with ``user_gw``, as the REST API does.
    ``write_audit(event)`` must raise if the write fails. The last check,
    ``preview_as_caller``, starts a step preview search with ``user_gw`` as the REST
    preview route does and checks that splunkd reports the caller as its owner.
    """
    checks = []
    found = {}
    tag = uuid.uuid4().hex[:12]

    def check(name, fn):
        try:
            ok, detail = fn()
        except _Skip as err:
            ok, detail = False, "skipped: %s" % err
        except Exception as err:
            ok, detail = False, "%s: %s" % (type(err).__name__, err)
        checks.append({"check": name, "ok": 1 if ok else 0, "detail": scrub(detail, secrets)})

    def need_sid():
        if not found.get("sid"):
            raise _Skip("no probe search (dispatch_as_owner failed)")
        return found["sid"]

    steps = {s["id"]: s for s in job.get("steps") or []}
    step = steps.get("a") or {}
    ids = list(steps)
    since = int(clock()) - 5

    def dispatch():
        name = step.get("hidden_search")
        if not name:
            raise _Skip("the self-test job has no hidden search for step a")
        _, names = tokens.compile_spl(step.get("spl") or "", ids)
        args = {n: (PROBE_RUN_ID if n == "run__id" else str(int(clock()))) for n in names}
        found["name"] = name
        found["sid"] = sys_gw.dispatch(user, name, int(clock()),
                                       {k: tokens.escape_spl_string(v) for k, v in args.items()})
        return True, "dispatched %s as %s: sid %s" % (name, user, found["sid"])

    def history():
        sid = need_sid()
        sids = _poll(lambda: sys_gw.history(user, found["name"], since), lambda v: sid in v,
                     sleep, seconds=10)
        return sid in sids, "history since %d lists %d job(s); probe sid %s" % (
            since, len(sids), "found" if sid in sids else "missing")

    def status():
        sid = need_sid()
        st = _poll(lambda: sys_gw.job_status(sid), lambda v: v.get("state") != "running",
                   sleep)
        found["status"] = st
        ok = st.get("state") == "done" and st.get("result_count") == PROBE_ROWS
        return ok, "state=%s result_count=%s (want %d) finalized=%s ttl=%s error=%s" % (
            st.get("state"), st.get("result_count"), PROBE_ROWS, st.get("finalized"),
            st.get("ttl"), st.get("error"))

    def results():
        row = sys_gw.first_row(need_sid()) or {}
        value = row.get("run_id")
        value = value[0] if isinstance(value, list) and value else value
        return value == PROBE_RUN_ID, "first row run_id=%r (want %r), %d field(s)" % (
            value, PROBE_RUN_ID, len(row))

    def setttl():
        sid = need_sid()
        sys_gw.control(sid, "touch")
        sys_gw.control(sid, "setttl", ttl=120)
        ttl = sys_gw.job_status(sid).get("ttl")
        return isinstance(ttl, int) and 0 < ttl <= 120, "touch ok; after setttl 120 ttl=%s" % ttl

    def cancel():
        sid = need_sid()
        sys_gw.control(sid, "cancel")
        st = _poll(lambda: sys_gw.job_status(sid), lambda v: v.get("state") == "missing",
                   sleep, seconds=10)
        return st.get("state") == "missing", "after cancel state=%s" % st.get("state")

    def kv_delete_query():
        a = {"_key": "selftest_%s_a" % tag, "selftest_probe": tag + "a"}
        b = {"_key": "selftest_%s_b" % tag, "selftest_probe": tag + "b"}
        before = len(sys_gw.kv_query(SCRATCH))
        try:
            sys_gw.kv_insert(SCRATCH, a)
            sys_gw.kv_insert(SCRATCH, b)
            sys_gw.kv_delete_query(SCRATCH, {"selftest_probe": tag + "a"})
            gone = sys_gw.kv_get(SCRATCH, a["_key"]) is None
            kept = sys_gw.kv_get(SCRATCH, b["_key"]) is not None
        finally:
            for doc in (a, b):
                try:
                    sys_gw.kv_delete(SCRATCH, doc["_key"])
                except Exception:
                    pass
        after = len(sys_gw.kv_query(SCRATCH))
        return gone and kept and after == before, (
            "%s: matching doc %s, other doc %s; docs before=%d after cleanup=%d"
            % (SCRATCH, "deleted" if gone else "NOT deleted", "kept" if kept else "DELETED",
               before, after))

    def user_exists():
        me, nobody = sys_gw.user_exists(user), sys_gw.user_exists(NO_SUCH_USER)
        return me is True and nobody is False, "%s=%s %s=%s" % (user, me, NO_SUCH_USER, nobody)

    def user_access():
        access = user_gw.user_access(user)
        caps = sorted(c for c in access.get("capabilities") or [] if c.startswith("orchestrator_"))
        return "orchestrator_admin" in caps, "roles=%s; %d capabilities; orchestrator: %s" % (
            ",".join(access.get("roles") or []), len(access.get("capabilities") or []),
            ",".join(caps) or "none")

    def saved_search_info():
        info = user_gw.saved_search_info("nobody", FALLBACK_SEARCH)
        ok = bool(info.get("exists")) and info.get("owner") == "nobody"
        return ok, "%s: exists=%s owner=%s sharing=%s dispatch_as=%s" % (
            FALLBACK_SEARCH, info.get("exists"), info.get("owner"), info.get("sharing"),
            info.get("dispatch_as"))

    def index_exists():
        mine, other = sys_gw.index_exists(AUDIT_INDEX), sys_gw.index_exists(NO_SUCH_INDEX)
        return mine is True and other is False, "%s=%s %s=%s" % (AUDIT_INDEX, mine,
                                                                 NO_SUCH_INDEX, other)

    def audit():
        probe_id = "selftest_probe_" + tag
        started = clock()
        write_audit({"_time": int(started), "type": "selftest_probe", "probe_id": probe_id,
                     "user": user})
        query = 'search index=%s "%s" | head 1' % (AUDIT_INDEX, probe_id)
        rows = _poll(lambda: user_gw.search_oneshot(user, query, "-1h", "+1h"), bool,
                     sleep, every=2)
        if not rows:
            return False, "wrote %s; not found by a search within %ds" % (probe_id, POLL_SECONDS)
        return True, "wrote %s; found by a search after %ds (sourcetype=%s)" % (
            probe_id, int(clock() - started), rows[0].get("sourcetype"))

    def preview_as_caller():
        sid = preview.make_sid(user, "new", "probe", uuid.uuid4().hex[:16])
        sid = user_gw.preview_dispatch(user, "| makeresults count=%d" % PREVIEW_ROWS, None, None,
                                       int(clock()), sid)
        try:
            info = _poll(lambda: user_gw.preview_info(sid),
                         lambda v: v.get("state") != "running", sleep)
            rows = user_gw.preview_results(sid, preview.TABLE_ROWS).get("rows") or []
        finally:
            user_gw.control(sid, "cancel")
        ok = (info.get("state") == "done" and info.get("owner") == user
              and info.get("result_count") == PREVIEW_ROWS and len(rows) == PREVIEW_ROWS)
        return ok, "sid %s state=%s owner=%s (want %s) result_count=%s rows=%d (want %d)" % (
            sid, info.get("state"), info.get("owner"), user, info.get("result_count"), len(rows),
            PREVIEW_ROWS)

    for name, fn in (("dispatch_as_owner", dispatch), ("history_json", history),
                     ("job_status_system", status), ("job_results_system", results),
                     ("job_setttl_system", setttl), ("job_cancel_system", cancel),
                     ("kv_delete_query", kv_delete_query), ("user_exists", user_exists),
                     ("user_access", user_access), ("saved_search_info", saved_search_info),
                     ("index_exists", index_exists), ("audit_receivers_simple", audit),
                     ("preview_as_caller", preview_as_caller)):
        check(name, fn)
    return checks
