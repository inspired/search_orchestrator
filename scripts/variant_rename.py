#!/usr/bin/env python3
"""Rename a staged copy of the app so it installs next to the normal one.

Usage: variant_rename.py <staged app dir> <suffix>   (called by package.sh when
SO_VARIANT_SUFFIX is set; see scripts/package_variant.sh).

Every name that is global on a Splunk instance, or that ties the app to its id,
gets ``_<suffix>``: the app id, the /orchestrator REST endpoint and its web.conf
exposure, the capabilities and roles, the index, sourcetype and macro, the
modular input scheme, the alert action, the search command and its searchbnf
stanzas. The search command alone takes the bare suffix (``orchestrate<suffix>``):
SPL command names are letters and digits only. Script files are renamed to match their stanzas. KV Store collections,
the lookup, the fallback saved search and the private step searches live in the
app's own namespace, so they keep their names.

Each rule is anchored to one file and states how many matches it expects. A
mismatch stops the build, so a source change that moves or adds a name has to be
reviewed here rather than slipping through half renamed.
"""
import os
import re
import sys


def rules(s, label):
    """``(file, regex, replacement, expected count)``; ``s`` is ``_<suffix>``. A callable
    replacement is used as is (no backslash or group processing)."""
    caps = r"orchestrator_(admin|build|run)"
    # Search command names are letters and digits only: SPL splits `orchestrate_x` into the
    # command `orchestrate` and an argument `_x`. So the command takes the bare suffix.
    cmd = command_name(s)
    return [
        # App id, label and manifest.
        ("default/app.conf", r"^name = search_orchestrator$", "name = search_orchestrator" + s, 1),
        ("default/app.conf", r"^id = search_orchestrator$", "id = search_orchestrator" + s, 1),
        ("default/app.conf", r"^label = Search Orchestrator$", "label = " + label, 1),
        ("app.manifest", r'"name": "search_orchestrator"', '"name": "search_orchestrator%s"' % s, 1),
        ("app.manifest", r'"title": "Search Orchestrator"', '"title": "%s"' % label, 1),
        # Capabilities and roles.
        ("default/authorize.conf", r"^\[capability::" + caps + r"\]$", r"[capability::orchestrator_\1" + s + "]", 3),
        ("default/authorize.conf", r"^\[role_orchestrator_(admin|builder|user)_role\]$",
         r"[role_orchestrator_\1_role" + s + "]", 3),
        ("default/authorize.conf", r"^" + caps + r" = enabled$", r"orchestrator_\1" + s + " = enabled", 12),
        ("bin/so/authz.py", r'^(ADMIN|BUILD|RUN) = "' + caps + '"$', r'\1 = "orchestrator_\2' + s + '"', 3),
        # Index, sourcetype, macro.
        ("default/indexes.conf", r"^\[orchestrator\]$", "[orchestrator%s]" % s, 1),
        ("default/indexes.conf", r"\$SPLUNK_DB/orchestrator/", "$SPLUNK_DB/orchestrator%s/" % s, 3),
        ("default/macros.conf", r"^\[orchestrator_index\]$", "[orchestrator_index%s]" % s, 1),
        ("default/macros.conf", r"^definition = index=orchestrator$", "definition = index=orchestrator" + s, 1),
        # The _internal and _introspection macros of the Run health dashboard: their stanzas,
        # and the exact script and command names that tell this copy's splunkd.log lines apart.
        ("default/macros.conf", r"^\[orchestrator_(internal|engine_process)\]$", r"[orchestrator_\1%s]" % s, 2),
        ("default/macros.conf", r'"orchestrator_engine\.py"', '"orchestrator_engine%s.py"' % s, 2),
        ("default/macros.conf", r'"orchestrator_rest"', '"orchestrator_rest%s"' % s, 1),
        ("default/macros.conf", r'"start_orchestrator_job"', '"start_orchestrator_job%s"' % s, 1),
        ("default/macros.conf", r'"orchestrate"', '"%s"' % cmd, 1),
        # The dashboard: its macros, and its links to the Run page (the app id).
        ("default/data/ui/views/run_health.xml", r"`orchestrator_(index|internal|engine_process)`",
         r"`orchestrator_\1%s`" % s, 12),
        ("default/data/ui/views/run_health.xml", r"/app/search_orchestrator/run\?",
         "/app/search_orchestrator%s/run?" % s, 3),
        ("default/props.conf", r"^\[orchestrator:audit\]$", "[orchestrator:audit%s]" % s, 1),
        ("bin/so/audit.py", r'^SOURCETYPE = "orchestrator:audit"$', 'SOURCETYPE = "orchestrator:audit%s"' % s, 1),
        ("bin/so/audit.py", r'^SOURCE = "orchestrator_engine"$', 'SOURCE = "orchestrator_engine%s"' % s, 1),
        ("bin/so/api.py", r'^AUDIT_INDEX = "orchestrator"$', 'AUDIT_INDEX = "orchestrator%s"' % s, 1),
        ("bin/so/selftest.py", r'^AUDIT_INDEX = "orchestrator"$', 'AUDIT_INDEX = "orchestrator%s"' % s, 1),
        ("bin/so/selftest.py", r'sourcetype="orchestrator:audit"', 'sourcetype="orchestrator:audit%s"' % s, 1),
        ("bin/orchestrator_rest.py", r'^AUDIT_INDEX = "orchestrator"$', 'AUDIT_INDEX = "orchestrator%s"' % s, 1),
        ("bin/orchestrator_rest.py", r'^AUDIT_SOURCE = "orchestrator_rest"$', 'AUDIT_SOURCE = "orchestrator_rest%s"' % s, 1),
        ("bin/orchestrator_engine.py", r'^DEFAULT_INDEX = "orchestrator"$', 'DEFAULT_INDEX = "orchestrator%s"' % s, 1),
        # Modular input scheme (the script name is the scheme).
        ("default/inputs.conf", r"^\[orchestrator_engine(://main)?\]$", r"[orchestrator_engine%s\1]" % s, 2),
        ("default/inputs.conf", r"^index = orchestrator$", "index = orchestrator" + s, 1),
        ("default/inputs.conf", r"^sourcetype = orchestrator:audit$", "sourcetype = orchestrator:audit" + s, 1),
        ("README/inputs.conf.spec", r"^\[orchestrator_engine://", "[orchestrator_engine%s://" % s, 1),
        ("bin/orchestrator_engine.py", r'^MAIN_STANZA = "orchestrator_engine://main"$',
         'MAIN_STANZA = "orchestrator_engine%s://main"' % s, 1),
        # REST endpoint, its handler and its Splunk Web exposure.
        ("default/restmap.conf", r"^\[script:orchestrator_api\]$", "[script:orchestrator_api%s]" % s, 1),
        ("default/restmap.conf", r"^match = /orchestrator$", "match = /orchestrator" + s, 1),
        ("default/restmap.conf", r"^script = orchestrator_rest\.py$", "script = orchestrator_rest%s.py" % s, 1),
        ("default/restmap.conf", r"^handler = orchestrator_rest\.Handler$", "handler = orchestrator_rest%s.Handler" % s, 1),
        ("default/web.conf", r"^\[expose:orchestrator(_\d)?\]$", r"[expose:orchestrator%s\1]" % s, 4),
        ("default/web.conf", r"^pattern = orchestrator(/|$)", r"pattern = orchestrator%s\1" % s, 4),
        ("bin/so/gateway.py", r'"/services/orchestrator/"', '"/services/orchestrator%s/"' % s, 1),
        ("bin/so/api.py", r'"orchestrator" in parts', '"orchestrator%s" in parts' % s, 1),
        ("bin/so/api.py", r'parts\.index\("orchestrator"\)', 'parts.index("orchestrator%s")' % s, 1),
        # App id in code and pages.
        ("bin/so/gateway.py", r'^APP = "search_orchestrator"$', 'APP = "search_orchestrator%s"' % s, 1),
        ("bin/so/gateway.py", r'^PASSWORD_REALM = "search_orchestrator"$', 'PASSWORD_REALM = "search_orchestrator%s"' % s, 1),
        ("bin/so/actions.py", r'/app/search_orchestrator/run\?', "/app/search_orchestrator%s/run?" % s, 1),
    ] + [
        ("default/data/ui/views/%s.xml" % p, r'template="search_orchestrator:/templates/',
         'template="search_orchestrator%s:/templates/' % s, 1) for p in PAGES
    ] + [
        ("appserver/templates/%s.html" % p, r"/static/app/search_orchestrator/pages/",
         "/static/app/search_orchestrator%s/pages/" % s, 1) for p in PAGES
    ] + [
        # Alert action.
        ("default/alert_actions.conf", r"^\[start_orchestrator_job\]$", "[start_orchestrator_job%s]" % s, 1),
        ("default/alert_actions.conf", r"^label = Start orchestrator job$", "label = Start orchestrator job (%s)"
         % label[label.index("(") + 1:-1], 1),
        ("README/alert_actions.conf.spec", r"^\[start_orchestrator_job\]$", "[start_orchestrator_job%s]" % s, 1),
        # The form's element ids too: both apps' forms can share the alert editor page.
        ("default/data/ui/alerts/start_orchestrator_job.html", r"\bstart_orchestrator_job",
         "start_orchestrator_job" + s, 9),
        ("bin/start_orchestrator_job.py", r"\bstart_orchestrator_job\b", "start_orchestrator_job" + s, 10),
        ("metadata/default.meta", r"^\[alert_actions/start_orchestrator_job\]$", "[alert_actions/start_orchestrator_job%s]" % s, 1),
        # Search command: stanzas, searchbnf, and SPL that emits or matches it.
        ("default/commands.conf", r"^\[orchestrate\]$", "[%s]" % cmd, 1),
        ("default/commands.conf", r"^filename = orchestrate\.py$", "filename = %s.py" % cmd, 1),
        ("default/searchbnf.conf", r"\borchestrate\b", cmd, 13),
        ("metadata/default.meta", r"^\[commands/orchestrate\]$", "[commands/%s]" % cmd, 1),
        ("metadata/default.meta", r"^\[searchbnf/orchestrate-(command|action|option)\]$",
         r"[searchbnf/%s-\1]" % cmd, 3),
        ("metadata/default.meta", r"^# \| orchestrate and", "# | %s and" % cmd, 1),
        ("bin/so/model.py", r'^_ORCHESTRATE_RE = re\.compile\(r"\\\|\\s\*orchestrate\\b", re\.IGNORECASE\)$',
         # Refuse both this copy's command and the normal app's.
         lambda m: '_ORCHESTRATE_RE = re.compile(r"\\|\\s*orchestrate(%s)?\\b", re.IGNORECASE)' % cmd[len("orchestrate"):], 1),
        ("bin/so/model.py", r"\| orchestrate\b", "| " + cmd, 2),  # steps and conditions
        ("bin/so/selftest.py", r"\| orchestrate\b", "| " + cmd, 3),
        ("bin/orchestrate.py", r"\| orchestrate\b", "| " + cmd, 11),
        ("default/data/ui/alerts/start_orchestrator_job.html", r'search="\| orchestrate jobs"',
         'search="| %s jobs"' % cmd, 1),
    ]


def command_name(s):
    """``orchestrate<suffix>`` for ``s`` = ``_<suffix>``; refuses anything but letters and digits."""
    name = "orchestrate" + s.lstrip("_")
    if not re.fullmatch(r"[a-z0-9]+", name):
        sys.exit("variant_rename: search command %r must be lowercase letters and digits" % name)
    return name


PAGES = ("builder", "dependencies", "help", "jobs", "run", "runs", "settings")

# Script files whose name is part of a stanza (modular input scheme, command
# filename, alert action, REST handler module), applied after the text rules.
RENAMES = ["bin/orchestrator_engine.py", "bin/orchestrator_rest.py",
           "bin/start_orchestrator_job.py", "default/data/ui/alerts/start_orchestrator_job.html"]


def main(app_dir, suffix):
    if not re.fullmatch(r"[a-z0-9]+", suffix):
        sys.exit("variant_rename: the suffix must be lowercase letters and digits, got %r" % suffix)
    s = "_" + suffix
    label = "Search Orchestrator (%s)" % suffix.upper()
    failures = []
    for rel, pattern, repl, expected in rules(s, label):
        path = os.path.join(app_dir, rel)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        new, n = re.subn(pattern, repl, text, flags=re.M)
        if n != expected:
            failures.append("%s: %r matched %d times, expected %d" % (rel, pattern, n, expected))
            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
    if failures:
        sys.exit("variant_rename: the rename map is out of date:\n  " + "\n  ".join(failures))
    for rel in RENAMES:
        stem, ext = os.path.splitext(rel)
        os.rename(os.path.join(app_dir, rel), os.path.join(app_dir, stem + s + ext))
    os.rename(os.path.join(app_dir, "bin/orchestrate.py"),
              os.path.join(app_dir, "bin/%s.py" % command_name(s)))
    readme = os.path.join(app_dir, "README.md")
    with open(readme, encoding="utf-8") as f:
        body = f.read()
    with open(readme, "w", encoding="utf-8") as f:
        f.write("> **Test copy `search_orchestrator%s`** (%s). It installs next to Search Orchestrator; "
                "every Splunk-wide name below carries `%s`: the `/orchestrator%s` endpoint, the "
                "`orchestrator_*%s` capabilities, the `orchestrator_*_role%s` roles, the `orchestrator%s` "
                "index, sourcetype `orchestrator:audit%s` and the `start_orchestrator_job%s` alert "
                "action. The search command is `| %s` (command names can't contain `_`).\n\n"
                % (s, label, s, s, s, s, s, s, s, command_name(s)) + body)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: variant_rename.py <staged app dir> <suffix>")
    main(sys.argv[1], sys.argv[2])
