"""Performance route (features-2 spec section 10), dispatched from ``api.handle``.

``GET runs/<id>/performance``: the numbers the engine stored on each step (``perf``), plus
CPU and memory from ``_introspection`` and, for steps from before 1.23.0, run time and
counts from ``_audit``. Both searches run read-only as the caller, so a caller without
access to an index gets a note instead of an error. Splunk answers a search of an index
the caller may not read with no rows rather than an error, so when the CPU and memory search
finds nothing a count of ``_introspection`` tells "no access" from "no samples".
``searches`` lists the searches that ran (label, runnable SPL, time range) so the page can
open them in Search.
"""
import re

from .api import _visible_run
from .gateway import GatewayError, oneshot_search

SID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")
MAX_SIDS = 50
SEARCH_SECONDS = 30
NOTE_INTROSPECTION = "CPU and memory need read access to _introspection; ask an admin."
NOTE_AUDIT = "Some steps ran before 1.23.0 and their numbers come from _audit."
NOTE_MAX = "Only the first 50 searches are shown."
NOTE_NO_SAMPLES = ("Splunk has no CPU or memory samples for these searches. It samples search "
                   "processes about every 10 seconds, so shorter searches have none, and it "
                   "records none while resource usage introspection is off (server.conf "
                   "[introspection:generator:resource_usage]).")
INTRO_FIELDS = ("cpu_peak", "cpu_avg", "mem_peak_mb")
AUDIT_FIELDS = ("run_duration", "scan_count", "event_count", "result_count")


def _checked(sids):
    return [s for s in sids if isinstance(s, str) and SID_RE.fullmatch(s)]


def introspection_query(sids):
    return ("index=_introspection sourcetype=splunk_resource_usage component=PerProcess "
            "data.search_props.sid IN (%s) "
            "| stats max(data.pct_cpu) AS cpu_peak avg(data.pct_cpu) AS cpu_avg "
            "max(data.mem_used) AS mem_peak_mb BY data.search_props.sid "
            "| rename data.search_props.sid AS sid" % ", ".join(_checked(sids)))


def audit_query(sids):
    # _audit stores search_id with single quotes ('<sid>'): match both forms.
    quoted = ", ".join('"%s", "\'%s\'"' % (s, s) for s in _checked(sids))
    return ("index=_audit action=search info=completed search_id IN (%s) "
            "| eval sid=trim(search_id, \"'\") "
            "| stats latest(total_run_time) AS run_duration latest(scan_count) AS scan_count "
            "latest(event_count) AS event_count latest(result_count) AS result_count BY sid"
            % quoted)


# Any events at all in _introspection the last day: Splunk writes some (disk objects,
# scripted inputs) even while resource usage sampling is off, so none means no access.
ACCESS_PROBE = "| tstats count where index=_introspection"


def _numbers(rows, fields):
    out = {}
    for row in rows or []:
        numbers = {}
        for field in fields:
            try:
                numbers[field] = float(row[field])
            except (KeyError, TypeError, ValueError):
                pass
        sid = (row.get("sid") or row.get("search_id") or "").strip("'")
        if sid and numbers:
            out[sid] = numbers
    return out


def _search(ctx, query, earliest, latest, notes, note):
    """``(rows, ok)``: ``ok`` is False when Splunk refused or failed the search, which adds
    ``note`` (no access) or the failure to ``notes``."""
    try:
        return ctx.user_gw.search_oneshot(ctx.user, query, earliest, latest, count=MAX_SIDS,
                                          max_time=SEARCH_SECONDS), True
    except GatewayError as err:
        if err.status not in (401, 403):  # a failing search is not a failing request either
            detail = str(err).strip()
            note = ("Splunk could not run the search for CPU, memory or audit numbers (%s); "
                    "try again." % detail[:200] if detail else
                    "Splunk could not run the search for CPU, memory or audit numbers; try again.")
        if note and note not in notes:
            notes.append(note)
        return [], False


def _can_read_introspection(ctx, notes):
    """True or False, or None when the probe itself failed (its note is already added)."""
    rows, ok = _search(ctx, ACCESS_PROBE, "-24h", "now", notes, NOTE_INTROSPECTION)
    if not ok:
        return None
    try:
        return any(float(r.get("count") or 0) > 0 for r in rows)
    except (TypeError, ValueError):
        return True


def _listed(label, spl, earliest, latest):
    return {"label": label, "spl": oneshot_search(spl), "earliest": earliest, "latest": latest}


def performance(ctx, body, run_id):
    run = _visible_run(ctx, run_id)
    steps = {}
    for step_id, st in (run.get("steps") or {}).items():
        sid = st.get("sid") if SID_RE.fullmatch(st.get("sid") or "") else None
        if sid or st.get("perf"):
            steps[step_id] = (sid, st.get("perf"))
    notes = []
    searched = [sid for sid, _ in steps.values() if sid]
    if len(searched) > MAX_SIDS:
        notes.append(NOTE_MAX)
        keep = set(searched[:MAX_SIDS])
        steps = {k: v for k, v in steps.items() if v[0] in keep}
        searched = searched[:MAX_SIDS]
    intro, audit = {}, {}
    searches = []
    if searched:
        earliest = str(int(run.get("started_at") or ctx.now) - 60)
        latest = str(int(run.get("ended_at") or ctx.now) + 300)
        spl = introspection_query(searched)
        searches.append(_listed("CPU and memory", spl, earliest, latest))
        rows, ok = _search(ctx, spl, earliest, latest, notes, NOTE_INTROSPECTION)
        intro = _numbers(rows, INTRO_FIELDS)
        if ok and not intro:  # no rows: no samples, or no access (Splunk gives no error)
            readable = _can_read_introspection(ctx, notes)
            if readable is False:
                notes.append(NOTE_INTROSPECTION)
            elif readable:
                notes.append(NOTE_NO_SAMPLES)
        if any(not perf for _, perf in steps.values()):
            spl = audit_query(searched)
            searches.append(_listed("Audit", spl, earliest, latest))
            rows, _ = _search(ctx, spl, earliest, latest, notes, None)
            audit = _numbers(rows, AUDIT_FIELDS)
    out = {}
    for step_id, (sid, perf) in steps.items():
        entry = dict(perf, source="engine") if perf else {}
        if not perf and sid in audit:
            entry = dict(audit[sid], source="audit")
            if NOTE_AUDIT not in notes:
                notes.append(NOTE_AUDIT)
        entry.update(intro.get(sid) or {})
        if entry:
            out[step_id] = entry
    return 200, {"steps": out, "notes": notes, "searches": searches}
