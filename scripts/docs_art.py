"""Draws the figures in README.md and docs/*.md as SVG, each in a dark and a light version
(the page picks one with <picture> and prefers-color-scheme).

Usage: python3 scripts/docs_art.py docs/images
"""
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "docs/images")
OUT.mkdir(parents=True, exist_ok=True)
FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"

THEMES = {
    "dark": dict(bg1="#0A0E17", bg2="#151B2B", dot="#1F2738", ink="#F3F5F9", muted="#9AA3B2", card="#161D2C",
                 line="#2A3347", edge="#5B6478", pill="#1C2436", pillInk="#C9D1DE",
                 search="#4A9FE0", ok="#5DB35A", warn="#F2A33A", err="#E8473C", trig="#B58CF0", write="#2EC4B6"),
    "light": dict(bg1="#FFFFFF", bg2="#F1F4F9", dot="#E1E6EE", ink="#0F172A", muted="#4B5565", card="#FFFFFF",
                  line="#D5DBE5", edge="#9AA3B2", pill="#E8EDF5", pillInk="#334155",
                  search="#0B6FA4", ok="#2E7D32", warn="#C46A00", err="#B3263E", trig="#7A4FC9", write="#0F8C80"),
}


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def node(t, x, y, w, label, sub, color, status=None, h=58):
    """A card with a coloured accent bar, a title, a muted second line and a status badge."""
    s = [f'<g transform="translate({x},{y})">',
         f'<rect width="{w}" height="{h}" rx="12" fill="{t["card"]}" stroke="{t["line"]}"/>',
         f'<rect width="5" height="{h - 20}" x="10" y="10" rx="2.5" fill="{color}"/>',
         f'<text x="26" y="25" font-size="15" font-weight="600" fill="{t["ink"]}">{esc(label)}</text>',
         f'<text x="26" y="45" font-size="12.5" fill="{t["muted"]}">{esc(sub)}</text>']
    if status:
        kind, text = status
        c = t[kind]
        bw = 14 + 7.2 * len(text)
        s.append(f'<g transform="translate({w - bw - 12},{h / 2 - 11})"><rect width="{bw}" height="22" rx="11" fill="{c}" fill-opacity="0.16"/>'
                 f'<text x="{bw / 2}" y="15" font-size="11.5" font-weight="600" fill="{c}" text-anchor="middle">{esc(text)}</text></g>')
    s.append('</g>')
    return "".join(s)


def edge(t, x1, y1, x2, y2, color=None, dashed=False, label=None):
    c = color or t["edge"]
    mx = (x1 + x2) / 2
    d = f"M{x1},{y1} C{mx},{y1} {mx},{y2} {x2 - 6},{y2}"
    dash = ' stroke-dasharray="5 5"' if dashed else ''
    s = f'<path d="{d}" fill="none" stroke="{c}" stroke-width="2"{dash}/>'
    s += f'<path d="M{x2 - 8},{y2 - 5} L{x2},{y2} L{x2 - 8},{y2 + 5}" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    if label:
        s += f'<text x="{mx}" y="{(y1 + y2) / 2 - 8}" font-size="11.5" font-weight="600" fill="{c}" text-anchor="middle">{esc(label)}</text>'
    return s


def frame(t, w, h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" font-family="{FONT}">'
            f'<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{t["bg1"]}"/><stop offset="1" stop-color="{t["bg2"]}"/></linearGradient>'
            f'<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="{t["dot"]}"/></pattern>'
            f'<radialGradient id="glow" cx="0.78" cy="0.45" r="0.55"><stop offset="0" stop-color="{t["search"]}" stop-opacity="0.18"/><stop offset="1" stop-color="{t["search"]}" stop-opacity="0"/></radialGradient></defs>'
            f'<rect width="{w}" height="{h}" rx="18" fill="url(#bg)"/><rect width="{w}" height="{h}" rx="18" fill="url(#dots)"/>'
            f'<rect width="{w}" height="{h}" rx="18" fill="url(#glow)"/><rect x="0.5" y="0.5" width="{w - 1}" height="{h - 1}" rx="18" fill="none" stroke="{t["line"]}"/>'
            f'{body}</svg>')


def banner(t):
    left = [
        f'<g transform="translate(56,70)"><rect width="128" height="28" rx="14" fill="{t["pill"]}"/>'
        f'<circle cx="16" cy="14" r="4" fill="{t["ok"]}"/><text x="28" y="19" font-size="13" font-weight="600" fill="{t["pillInk"]}">App for Splunk</text></g>',
        f'<text x="54" y="160" font-size="52" font-weight="800" fill="{t["ink"]}" letter-spacing="-1.5">Search</text>',
        f'<text x="54" y="218" font-size="52" font-weight="800" fill="{t["ink"]}" letter-spacing="-1.5">Orchestrator</text>',
        f'<text x="56" y="262" font-size="18" fill="{t["muted"]}">Run dependent searches as one job.</text>',
        f'<text x="56" y="288" font-size="18" fill="{t["muted"]}">Schedules, conditions, retries and deadlines,</text>',
        f'<text x="56" y="314" font-size="18" fill="{t["muted"]}">drawn as a flow.</text>',
    ]
    chips = ["No external scheduler", "Splunk 9.4+ · Cloud", "AppInspect clean"]
    x = 56
    for c in chips:
        w = 18 + 7.3 * len(c)
        left.append(f'<g transform="translate({x},350)"><rect width="{w}" height="28" rx="8" fill="none" stroke="{t["line"]}"/>'
                    f'<text x="{w / 2}" y="19" font-size="12.5" fill="{t["muted"]}" text-anchor="middle">{esc(c)}</text></g>')
        x += w + 10
    flow = [
        node(t, 560, 175, 170, "Every day 06:00", "Schedule trigger", t["trig"]),
        node(t, 780, 85, 210, "Daily summary", "index=web | stats …", t["search"], ("ok", "✓ done")),
        node(t, 780, 265, 210, "Count errors", "index=_internal …", t["search"], ("ok", "✓ done")),
        node(t, 1040, 40, 222, "Weekly rollup", "after Daily summary", t["search"], ("search", "running")),
        node(t, 1040, 175, 222, "Save to lookup", "top_errors.csv", t["write"], ("warn", "waiting")),
        node(t, 1040, 310, 222, "Email ops", "only if it fails", t["err"]),
    ]
    edges = [
        edge(t, 730, 204, 780, 114), edge(t, 730, 204, 780, 294),
        edge(t, 990, 114, 1040, 69, t["ok"]), edge(t, 990, 294, 1040, 204, t["ok"]),
        edge(t, 990, 294, 1040, 339, t["err"], dashed=True),
    ]
    return frame(t, 1280, 420, "".join(left + edges + flow))


def anatomy(t):
    body = [
        node(t, 30, 150, 170, "After Ingest job", "Trigger: job finished", t["trig"]),
        node(t, 250, 150, 190, "Daily summary", "retries 3 × · 5 min apart", t["search"], ("ok", "✓")),
        f'<g transform="translate(490,150)"><rect width="190" height="58" rx="12" fill="{t["card"]}" stroke="{t["warn"]}" stroke-dasharray="4 4"/>'
        f'<text x="95" y="25" font-size="15" font-weight="600" fill="{t["ink"]}" text-anchor="middle">◇ If it found results</text>'
        f'<text x="95" y="45" font-size="12" fill="{t["muted"]}" text-anchor="middle">$daily.resultCount$ &gt; 0</text></g>',
        node(t, 740, 60, 200, "Investigate", "| loadjob $daily.sid$", t["search"]),
        node(t, 740, 240, 200, "Approve the write", "Approval · Beta", t["warn"]),
        node(t, 1000, 60, 190, "Webhook to on-call", "Action", t["err"]),
        node(t, 1000, 240, 190, "Write to summary", "index=summary", t["write"]),
        edge(t, 200, 179, 250, 179), edge(t, 440, 179, 490, 179),
        edge(t, 680, 179, 740, 89, t["warn"], label="true"), edge(t, 680, 179, 740, 269, t["muted"], label="false"),
        edge(t, 940, 89, 1000, 89), edge(t, 940, 269, 1000, 269, t["ok"], label="approved"),
        f'<g transform="translate(250,236)"><rect width="190" height="26" rx="8" fill="{t["pill"]}"/>'
        f'<text x="95" y="17.5" font-size="12" fill="{t["pillInk"]}" text-anchor="middle">⌛ Deadline 07:00 · alerts if late</text></g>',
        f'<text x="30" y="40" font-size="13" font-weight="700" fill="{t["muted"]}" letter-spacing="1.5">A JOB, STEP BY STEP</text>',
    ]
    return frame(t, 1220, 330, "".join(body))


def text(t, x, y, words, size=13, weight=400, color="muted", anchor="start"):
    return (f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{t[color]}" '
            f'text-anchor="{anchor}">{esc(words)}</text>')


def pill(t, x, y, words, color):
    w = 16 + 7.0 * len(words)
    return (f'<g transform="translate({x},{y})"><rect width="{w}" height="22" rx="11" fill="{t[color]}" fill-opacity="0.16"/>'
            f'<text x="{w / 2}" y="15" font-size="11.5" font-weight="600" fill="{t[color]}" text-anchor="middle">{esc(words)}</text></g>')


def doc_header(t, kicker, title, subtitle, motif):
    """A slim banner for a document: kicker pill, title, one line, and a small motif on the right."""
    body = [
        f'<g transform="translate(48,40)"><rect width="{20 + 7.3 * len(kicker)}" height="26" rx="13" fill="{t["pill"]}"/>'
        f'<text x="12" y="18" font-size="12.5" font-weight="600" fill="{t["pillInk"]}">{esc(kicker)}</text></g>',
        f'<text x="46" y="118" font-size="44" font-weight="800" fill="{t["ink"]}" letter-spacing="-1.2">{esc(title)}</text>',
        text(t, 48, 152, subtitle, 17),
        motif(t),
    ]
    return frame(t, 1280, 200, "".join(body))


def motif_steps(t):
    return "".join([
        node(t, 800, 40, 190, "Daily summary", "Search", t["search"], ("ok", "✓")),
        node(t, 1030, 110, 220, "Weekly rollup", "after Daily", t["search"], ("search", "running")),
        edge(t, 990, 69, 1030, 139, t["ok"]),
    ])


def motif_admin(t):
    rows = [("orchestrator_admin", "Settings, every job", "err"), ("orchestrator_build", "Build and save jobs", "search"),
            ("orchestrator_run", "Run jobs shared with them", "ok")]
    out = []
    for i, (cap, what, c) in enumerate(rows):
        y = 34 + i * 46
        out.append(f'<g transform="translate(850,{y})"><rect width="390" height="38" rx="10" fill="{t["card"]}" stroke="{t["line"]}"/>'
                   f'<rect x="10" y="9" width="5" height="20" rx="2.5" fill="{t[c]}"/>'
                   f'<text x="26" y="24" font-size="13.5" font-weight="600" fill="{t["ink"]}" font-family="ui-monospace, Menlo, monospace">{cap}</text>'
                   f'<text x="378" y="24" font-size="12.5" fill="{t["muted"]}" text-anchor="end">{esc(what)}</text></g>')
    return "".join(out)


def motif_changelog(t):
    out = [f'<line x1="880" y1="100" x2="1236" y2="100" stroke="{t["line"]}" stroke-width="2"/>']
    for i, (v, c) in enumerate([("1.46", "muted"), ("1.47", "search"), ("1.48", "ok")]):
        x = 900 + i * 150
        out.append(f'<circle cx="{x}" cy="100" r="9" fill="{t[c]}"/>')
        out.append(text(t, x, 132, v, 14, 700, "ink", "middle"))
    out.append(pill(t, 1150, 60, "latest", "ok"))
    return "".join(out)


def views(t):
    """Simple, Standard and Advanced side by side: the same job three ways."""
    cols = [("Simple", "Searches top to bottom", 30), ("Standard", "Steps only; the rest in tabs", 430), ("Advanced", "Every node on the canvas", 830)]
    out = []
    for name, sub, x in cols:
        out.append(f'<g transform="translate({x},28)"><rect width="370" height="300" rx="14" fill="{t["card"]}" fill-opacity="0.55" stroke="{t["line"]}"/></g>')
        out.append(text(t, x + 20, 62, name, 18, 800, "ink"))
        out.append(text(t, x + 20, 84, sub, 12.5))
    # Simple: a list.
    for i, (label, c) in enumerate([("1  Daily summary", "search"), ("→ Save to lookup", "write"), ("2  Weekly rollup", "search"), ("→ Email on failure", "err")]):
        y = 104 + i * 50
        indent = 20 if label.startswith("→") else 0
        out.append(f'<g transform="translate({50 + indent},{y})"><rect width="{310 - indent}" height="38" rx="9" fill="{t["card"]}" stroke="{t["line"]}"/>'
                   f'<rect x="9" y="9" width="4" height="20" rx="2" fill="{t[c]}"/>'
                   f'<text x="22" y="24" font-size="13" font-weight="600" fill="{t["ink"]}">{esc(label)}</text></g>')
    # Standard: steps and a condition label.
    out += [node(t, 450, 120, 150, "Daily", "⚡ · ✉ 1", t["search"]), node(t, 640, 120, 150, "Weekly", "Search", t["search"]),
            node(t, 640, 230, 150, "Save", "Lookup", t["write"]),
            edge(t, 600, 149, 640, 149, t["warn"]), edge(t, 600, 149, 640, 259),
            pill(t, 560, 98, "◇ found rows", "warn")]
    # Advanced: trigger, steps, condition and action nodes.
    out += [node(t, 850, 175, 105, "06:00", "Schedule", t["trig"], h=50), node(t, 990, 110, 110, "Daily", "Search", t["search"], h=50),
            f'<g transform="translate(1125,118)"><rect width="34" height="34" rx="5" transform="rotate(45 17 17)" fill="{t["card"]}" stroke="{t["warn"]}"/></g>',
            node(t, 1080, 230, 110, "Email", "on failure", t["err"], h=50),
            edge(t, 955, 200, 990, 135), edge(t, 1100, 135, 1122, 135, t["warn"]), edge(t, 1045, 160, 1080, 255, t["err"], dashed=True)]
    return frame(t, 1230, 356, "".join(out))


def lifecycle(t):
    """A run's states, left to right, with the side paths a run can take."""
    out = [
        node(t, 30, 140, 150, "Queued", "waits for its turn", t["muted"]),
        node(t, 240, 140, 170, "Running", "steps start in order", t["search"]),
        node(t, 480, 40, 170, "Succeeded", "every step done", t["ok"], ("ok", "✓")),
        node(t, 480, 140, 170, "Failed", "a step gave up", t["err"], ("err", "✗")),
        node(t, 480, 240, 170, "Cancelled", "stopped by hand", t["muted"]),
        node(t, 720, 140, 200, "Held", "later runs wait", t["warn"]),
        node(t, 990, 90, 200, "Re-run from a step", "same definition", t["search"]),
        node(t, 990, 190, 200, "Dismissed", "later runs go on", t["muted"]),
        edge(t, 180, 169, 240, 169), edge(t, 410, 169, 480, 69, t["ok"]), edge(t, 410, 169, 480, 169, t["err"]),
        edge(t, 410, 169, 480, 269, t["muted"], dashed=True), edge(t, 650, 169, 720, 169, t["warn"]),
        edge(t, 920, 169, 990, 119), edge(t, 920, 169, 990, 219, t["muted"]),
        pill(t, 214, 216, "↻ retries · ⏱ delay alert · ⌛ deadline", "warn"),
    ]
    return frame(t, 1220, 330, "".join(out))


def straight(t, x1, y1, x2, y2, color=None, dashed=False):
    c = color or t["edge"]
    dash = ' stroke-dasharray="5 5"' if dashed else ''
    return (f'<path d="M{x1},{y1} L{x2},{y2 - 6}" stroke="{c}" stroke-width="2"{dash}/>'
            f'<path d="M{x2 - 5},{y2 - 9} L{x2},{y2 - 1} L{x2 + 5},{y2 - 9}" fill="none" stroke="{c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>')


def architecture2(t):
    def box(x, y, w, h, title, sub, c):
        return (f'<g transform="translate({x},{y})"><rect width="{w}" height="{h}" rx="12" fill="{t["card"]}" stroke="{t["line"]}"/>'
                f'<rect x="12" y="12" width="5" height="{h - 24}" rx="2.5" fill="{t[c]}"/>'
                f'<text x="28" y="30" font-size="15" font-weight="700" fill="{t["ink"]}">{esc(title)}</text>'
                f'<text x="28" y="50" font-size="12.5" fill="{t["muted"]}">{esc(sub)}</text></g>')
    out = [
        text(t, 40, 44, "BROWSER", 12, 700), text(t, 40, 164, "SPLUNKD", 12, 700), text(t, 40, 284, "STATE AND SEARCH", 12, 700),
        box(40, 56, 360, 64, "Jobs, builder, runs, calendar", "React pages (Splunk UI Toolkit)", "search"),
        box(430, 56, 360, 64, "Troubleshooting and help", "Dashboard Studio graphs, the guide", "search"),
        box(40, 176, 360, 64, "REST handler /orchestrator", "routes, permissions, validation", "trig"),
        box(430, 176, 360, 64, "Engine (modular input)", "every 5 s: schedules, steps, actions", "trig"),
        box(820, 176, 360, 64, "| orchestrate", "start, status and selftest from SPL", "trig"),
        box(40, 296, 360, 64, "KV Store", "jobs, runs, step runs, actions, settings", "write"),
        box(430, 296, 360, 64, "Hidden saved searches", "one per step, run as the job owner", "ok"),
        box(820, 296, 360, 64, "orchestrator index", "audit events; app logs in _internal", "write"),
        straight(t, 220, 120, 220, 176), straight(t, 610, 120, 330, 176),
        straight(t, 220, 240, 220, 296), straight(t, 560, 240, 330, 296), straight(t, 610, 240, 610, 296, t["ok"]),
        straight(t, 720, 240, 960, 296, t["muted"], dashed=True), straight(t, 1000, 240, 1000, 296, t["muted"], dashed=True),
    ]
    return frame(t, 1220, 390, "".join(out))


HEADERS = {
    "user": ("User guide", "Build and run jobs", "From a first job to retries, approvals and chained jobs.", motif_steps),
    "admin": ("Admin guide", "Install and run it", "Platforms, roles, settings, the engine and troubleshooting.", motif_admin),
    "changelog": ("Changelog", "What changed", "Every release, newest first.", motif_changelog),
}

for name, t in THEMES.items():
    (OUT / f"banner-{name}.svg").write_text(banner(t))
    (OUT / f"job-{name}.svg").write_text(anatomy(t))
    (OUT / f"views-{name}.svg").write_text(views(t))
    (OUT / f"run-lifecycle-{name}.svg").write_text(lifecycle(t))
    (OUT / f"architecture-{name}.svg").write_text(architecture2(t))
    for key, (kicker, title, sub, motif) in HEADERS.items():
        (OUT / f"header-{key}-{name}.svg").write_text(doc_header(t, kicker, title, sub, motif))
print("ok")
