"""The Run health dashboard (Dashboard Studio v2): its JSON definition parses, every
reference resolves, and every search goes through the app's macros and the time picker."""
import configparser
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VIEW = ROOT / "ui" / "src" / "splunk" / "default" / "data" / "ui" / "views" / "run_health.xml"
NAV = ROOT / "ui" / "src" / "splunk" / "default" / "data" / "ui" / "nav" / "default.xml"
MACROS = ROOT / "app" / "search_orchestrator" / "default" / "macros.conf"

# Tokens Studio sets itself: the click context of a drilldown.
CONTEXT_TOKENS = re.compile(r"^(row|click)\.")


def _definition():
    root = ET.parse(VIEW).getroot()
    assert root.tag == "dashboard" and root.get("version") == "2" and root.get("theme") == "dark"
    assert root.findtext("label") == "Run health"
    return json.loads(root.findtext("definition"))


def _tokens(text):
    return {m.split("|")[0] for m in re.findall(r"\$([A-Za-z0-9_.|]+)\$", text)}


def test_definition_parses_and_every_reference_resolves():
    d = _definition()
    sources, vizs, inputs = d["dataSources"], d["visualizations"], d["inputs"]
    for vid, viz in list(vizs.items()) + list(inputs.items()):
        for ds in (viz.get("dataSources") or {}).values():
            assert ds in sources, (vid, ds)
    for sid, ds in sources.items():
        assert re.fullmatch(r"[A-Za-z0-9 \-_.]+", ds["name"]), sid
        if ds["type"] == "ds.chain":
            assert sources[ds["options"]["extend"]]["type"] == "ds.search", sid
    layout = d["layout"]
    assert set(layout["globalInputs"]) == set(inputs)
    placed = [i["item"] for lay in layout["layoutDefinitions"].values() for i in lay["structure"]]
    assert sorted(placed) == sorted(vizs), "every visualization placed exactly once"
    assert all(v.startswith("viz_") for v in vizs)


def test_every_token_is_defined():
    d = _definition()
    defined = set()
    for inp in d["inputs"].values():
        tok = inp["options"]["token"]
        defined.add(tok)
        if inp["type"] == "input.timerange":
            defined |= {tok + ".earliest", tok + ".latest"}
        assert inp["options"].get("defaultValue") not in (None, ""), "inputs have defaults"
    used = _tokens(json.dumps(d))
    missing = {t for t in used if t not in defined and not CONTEXT_TOKENS.match(t)}
    assert not missing, missing


def test_searches_use_the_macros_and_the_time_picker():
    d = _definition()
    params = d["defaults"]["dataSources"]["ds.search"]["options"]["queryParameters"]
    assert params == {"earliest": "$global_time.earliest$", "latest": "$global_time.latest$"}
    assert d["inputs"]["input_time"]["options"]["defaultValue"] == "-24h,now"
    for sid, ds in d["dataSources"].items():
        query = ds["options"]["query"]
        assert not re.search(r"\bindex\s*=", query), (sid, "search through the macros")
        if ds["type"] == "ds.search":
            assert "queryParameters" not in ds["options"], (sid, "the time picker bounds it")
            assert re.search(r"`orchestrator_(index|internal|engine_process)`", query), sid
            if "`orchestrator_index`" in query and sid not in ("ds_jobs", "ds_engine_last"):
                assert "job_id=$job|s$" in query, (sid, "the job filter applies")


def test_run_links_and_state_colours():
    d = _definition()
    links = [h["options"]["url"] for v in d["visualizations"].values() for h in v.get("eventHandlers", [])]
    assert links and all(u == "/app/search_orchestrator/run?run_id=$row.run_id.value|u$" for u in links)
    colours = d["visualizations"]["viz_runs_over_time"]["options"]["seriesColorsByField"]
    assert colours["succeeded"] == "#53A051" and colours["failed"] == "#DC4E41"
    last = d["visualizations"]["viz_engine_last"]["context"]["ageColors"]
    assert last == [{"to": 5, "value": "#53A051"}, {"from": 5, "value": "#DC4E41"}]


def test_macros_and_nav():
    conf = configparser.ConfigParser(interpolation=None)
    conf.read(MACROS)
    assert conf["orchestrator_index"]["definition"] == "index=orchestrator"
    internal = conf["orchestrator_internal"]["definition"]
    assert internal.startswith("index=_internal ") and '"orchestrator_engine.py"' in internal
    assert conf["orchestrator_engine_process"]["definition"].startswith("index=_introspection ")
    views = [v.get("name") for v in ET.parse(NAV).getroot().iter("view")]
    assert "run_health" in views
