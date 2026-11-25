"""The Run health page: an html view of the app's own page (not a Dashboard Studio
dashboard), whose searches (bin/so/run_health_api.py) all go through the app's macros, with
the job filter on every audit search; and the macros and the app's nav."""
import configparser
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from so import run_health_api as rh

ROOT = Path(__file__).resolve().parent.parent
VIEW = ROOT / "ui" / "src" / "splunk" / "default" / "data" / "ui" / "views" / "run_health.xml"
NAV = ROOT / "ui" / "src" / "splunk" / "default" / "data" / "ui" / "nav" / "default.xml"
MACROS = ROOT / "app" / "search_orchestrator" / "default" / "macros.conf"

QUERIES = [n for n in dir(rh) if n.endswith("_query")]


def test_view_is_the_apps_own_page():
    root = ET.parse(VIEW).getroot()
    assert root.tag == "view" and root.get("type") == "html"
    assert root.get("template") == "search_orchestrator:/templates/run_health.html"
    assert root.findtext("label") == "Run health"
    assert (ROOT / "ui" / "src" / "pages" / "run_health" / "index.tsx").exists()


def test_every_search_goes_through_the_macros_with_the_job_filter():
    assert len(QUERIES) == 13
    f = {"job_id": "daily", "range": "7d"}
    for name in QUERIES:
        query = getattr(rh, name)(f)
        assert not re.search(r"\bindex\s*=", query), (name, "search through the macros")
        assert re.search(r"`orchestrator_(index|internal|engine_process|search_process)`", query), name
        if "`orchestrator_index`" in query and name != "engine_last_query":
            assert 'job_id="daily"' in query, (name, "the job filter applies")


def test_performance_searches_bucket_by_the_range():
    assert "span=1h" in rh.runtime_query({"job_id": None, "range": "24h"})
    assert "span=1d" in rh.scanned_query({"job_id": None, "range": "30d"})
    assert "`orchestrator_search_process`" in rh.peaks_query({"job_id": None, "range": "24h"})


def test_macros_and_nav():
    conf = configparser.ConfigParser(interpolation=None)
    conf.read(MACROS)
    assert conf["orchestrator_index"]["definition"] == 'index=_audit sourcetype="orchestrator:audit"'
    internal = conf["orchestrator_internal"]["definition"]
    assert internal.startswith("index=_internal ") and '"orchestrator_engine.py"' in internal
    assert conf["orchestrator_engine_process"]["definition"].startswith("index=_introspection ")
    assert conf["orchestrator_search_process"]["definition"] == (
        "index=_introspection sourcetype=splunk_resource_usage component=PerProcess "
        "data.search_props.sid=*")
    views = [v.get("name") for v in ET.parse(NAV).getroot().iter("view")]
    assert "run_health" in views
