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
               "so_commands", "so_locks", "so_settings", "so_selftest"]


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


def _stanzas(path):
    return re.findall(r"^\[([^\]]+)\]", path.read_text(), re.M)


def test_runs_are_indexed_for_newest_first_reads():
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(APP / "default" / "collections.conf")
    fields = {k: json.loads(v) for k, v in parser["so_runs"].items()
              if k.startswith("accelerated_fields.")}
    assert sorted(fields.values(), key=len) == [{"created_at": -1},
                                                {"job_id": 1, "created_at": -1}]


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
