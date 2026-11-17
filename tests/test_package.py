import configparser
import json
import os
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app" / "search_orchestrator"
COLLECTIONS = ["so_jobs", "so_runs", "so_step_runs", "so_action_runs",
               "so_commands", "so_locks", "so_settings", "so_selftest", "so_job_versions",
               "so_backfills"]


def _fake_ui(tmp_path, build_script):
    """A stand-in ui/ whose ``npm run build`` runs ``build_script`` (no webpack in tests)."""
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "package.json").write_text(json.dumps({"name": "fake-ui", "private": True,
                                                 "scripts": {"build": build_script}}))
    return ui


def _package(ui, check=True):
    env = dict(os.environ, SO_UI_DIR=str(ui))
    return subprocess.run([str(ROOT / "scripts" / "package.sh"), "0.0.1"], env=env,
                          check=check, capture_output=True, text=True)


def build(tmp_path):
    ui = _fake_ui(tmp_path, "mkdir -p stage/appserver/static && echo ok > stage/appserver/static/built.txt")
    return tarfile.open(_package(ui).stdout.strip().splitlines()[-1])


def test_package_builds_the_ui_first(tmp_path):
    # Final review M10: a package from a clean checkout must carry the UI.
    names = build(tmp_path).getnames()
    assert "search_orchestrator/appserver/static/built.txt" in names


def test_package_fails_without_ui_stage(tmp_path):
    out = _package(_fake_ui(tmp_path, "true"), check=False)
    assert out.returncode != 0 and "ui/stage is missing" in out.stderr


def test_package_contains_required_files(tmp_path):
    names = set(build(tmp_path).getnames())
    for rel in ["app.manifest", "README.md", "default/app.conf", "default/authorize.conf",
                "default/collections.conf", "default/indexes.conf", "default/macros.conf",
                "default/props.conf", "default/inputs.conf", "README/inputs.conf.spec",
                "metadata/default.meta", "bin/orchestrator_engine.py",
                "default/restmap.conf", "default/web.conf", "default/savedsearches.conf",
                "bin/orchestrator_rest.py", "bin/orchestrate.py", "bin/start_orchestrator_job.py",
                "bin/so/selftest.py", "default/commands.conf", "default/searchbnf.conf",
                "default/alert_actions.conf", "README/alert_actions.conf.spec",
                "default/data/ui/alerts/start_orchestrator_job.html", "lookups/so_selftest.csv",
                "lib/splunklib/__init__.py", "LICENSE"]:
        assert "search_orchestrator/" + rel in names, rel
    assert all(n.split("/")[0] == "search_orchestrator" for n in names)


def test_no_pyc_or_dotfiles_in_package(tmp_path):
    for n in build(tmp_path).getnames():
        parts = n.split("/")
        assert "__pycache__" not in parts and not n.endswith(".pyc"), n
        assert not any(p.startswith(".") for p in parts), n


def _stanzas_text(text):
    return re.findall(r"^\[([^\]]+)\]", text, re.M)


def _stanzas(path):
    return _stanzas_text(path.read_text())


def test_all_collections_declared():
    assert _stanzas(APP / "default" / "collections.conf") == COLLECTIONS


def test_spike_removed():
    assert not (APP / "default" / "transforms.conf").exists()
    meta = (APP / "metadata" / "default.meta").read_text()
    assert "so_spike" not in meta and "transforms/" not in meta


def test_every_collection_restricted_in_meta():
    meta = {}
    current = None
    for line in (APP / "metadata" / "default.meta").read_text().splitlines():
        m = re.match(r"^\[(.*)\]$", line)
        if m:
            current = m.group(1)
            meta[current] = {}
        elif current is not None and "=" in line:
            k, v = line.split("=", 1)
            meta[current][k.strip()] = v.strip()
    for c in COLLECTIONS:
        assert meta["collections/" + c]["access"] == \
            "read : [ admin, sc_admin ], write : [ admin, sc_admin ]", c


def test_license_and_roles_import_user():
    # Final review M17.
    text = (APP / "LICENSE").read_text()
    assert "Apache License" in text and "Version 2.0, January 2004" in text
    assert "@" not in text.splitlines()[0]
    manifest = json.loads((APP / "app.manifest").read_text())
    assert manifest["info"]["license"]["name"] == "Apache-2.0"
    assert manifest["info"]["license"]["text"] == "LICENSE"
    conf = configparser.ConfigParser(interpolation=None)
    conf.read(APP / "default" / "authorize.conf")
    for role in ("role_orchestrator_user_role", "role_orchestrator_builder_role"):
        assert conf[role]["importRoles"] == "user", role


def test_variant_package_renames_every_global_name(tmp_path):
    # scripts/package_variant.sh: a copy that installs next to the normal app. A source change
    # that moves a name breaks scripts/variant_rename.py's expected counts, and so this test.
    splunk = ROOT / "ui" / "src" / "splunk"
    ui = _fake_ui(tmp_path, "mkdir -p stage && cp -R '%s/.' stage/" % splunk)
    out = subprocess.run([str(ROOT / "scripts" / "package_variant.sh"), "t1", "0.0.1"],
                         env=dict(os.environ, SO_UI_DIR=str(ui)), check=True, capture_output=True, text=True)
    path = out.stdout.strip().splitlines()[-1]
    assert path.endswith("dist/search_orchestrator_t1-0.0.1.tgz")
    tar = tarfile.open(path)
    names = set(tar.getnames())
    assert all(n.split("/")[0] == "search_orchestrator_t1" for n in names)
    for rel in ["bin/orchestrator_engine_t1.py", "bin/orchestrator_rest_t1.py", "bin/orchestratet1.py",
                "bin/start_orchestrator_job_t1.py", "default/data/ui/alerts/start_orchestrator_job_t1.html"]:
        assert "search_orchestrator_t1/" + rel in names, rel

    def read(rel):
        return tar.extractfile("search_orchestrator_t1/" + rel).read().decode()
    assert "label = Search Orchestrator (T1)" in read("default/app.conf")
    assert "match = /orchestrator_t1\n" in read("default/restmap.conf")
    assert "[role_orchestrator_user_role_t1]" in read("default/authorize.conf")
    assert "index = orchestrator_t1\n" in read("default/inputs.conf")
    assert "[commands/orchestratet1]" in read("metadata/default.meta")
    # SPL splits `orchestrate_t1` into `orchestrate` + `_t1`: command names are letters and digits.
    commands = _stanzas_text(read("default/commands.conf"))
    assert commands == ["orchestratet1"] and all(re.fullmatch(r"[a-z0-9]+", c) for c in commands)
    assert read("bin/orchestratet1.py") and "filename = orchestratet1.py" in read("default/commands.conf")
    bnf = _stanzas_text(read("default/searchbnf.conf"))
    assert bnf == ["orchestratet1-command", "orchestratet1-action", "orchestratet1-option"]
    assert "| orchestratet1 start" in read("default/searchbnf.conf")
    assert "| orchestrate_t1" not in "".join(read(n.split("/", 1)[1]) for n in names
                                             if n.endswith((".py", ".conf", ".html", ".meta", ".md")))
    assert "search_orchestrator_t1:/templates/run.html" in read("default/data/ui/views/run.xml")
    # The Run health dashboard reads this copy's index and splunkd.log lines, and links here.
    macros = read("default/macros.conf")
    for stanza in ("orchestrator_index_t1", "orchestrator_internal_t1", "orchestrator_engine_process_t1"):
        assert "[%s]" % stanza in macros, stanza
    assert '"orchestrator_engine_t1.py"' in macros and '"orchestrator_rest_t1"' in macros
    assert '"start_orchestrator_job_t1"' in macros and '"orchestratet1"' in macros
    dash = read("default/data/ui/views/run_health.xml")
    assert "/app/search_orchestrator_t1/run?run_id=" in dash and "/app/search_orchestrator/" not in dash
    assert not re.search(r"`orchestrator_(index|internal|engine_process)`", dash)
    os.remove(path)
