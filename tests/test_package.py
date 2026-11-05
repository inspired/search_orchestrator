import configparser
import re
import subprocess
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app" / "search_orchestrator"
COLLECTIONS = ["so_jobs", "so_runs", "so_step_runs", "so_action_runs",
               "so_commands", "so_locks", "so_settings"]


def build(tmp_path):
    out = subprocess.run([str(ROOT / "scripts" / "package.sh"), "0.0.1"],
                         check=True, capture_output=True, text=True).stdout.strip()
    return tarfile.open(out)


def test_package_contains_required_files():
    names = set(build(None).getnames())
    for rel in ["app.manifest", "README.md", "default/app.conf", "default/authorize.conf",
                "default/collections.conf", "default/indexes.conf", "default/macros.conf",
                "default/props.conf", "default/inputs.conf", "README/inputs.conf.spec",
                "metadata/default.meta", "bin/orchestrator_engine.py",
                "lib/splunklib/__init__.py"]:
        assert "search_orchestrator/" + rel in names, rel
    assert all(n.split("/")[0] == "search_orchestrator" for n in names)


def test_no_pyc_or_dotfiles_in_package():
    for n in build(None).getnames():
        parts = n.split("/")
        assert "__pycache__" not in parts and not n.endswith(".pyc"), n
        assert not any(p.startswith(".") for p in parts), n


def _stanzas(path):
    return re.findall(r"^\[([^\]]+)\]", path.read_text(), re.M)


def test_all_collections_declared():
    assert _stanzas(APP / "default" / "collections.conf") == COLLECTIONS


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
        assert meta["collections/" + c]["access"] == "read : [ admin ], write : [ admin ]", c
