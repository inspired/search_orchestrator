"""The example jobs bundled with the UI (ui/src/features/jobs/examples/*.json) are valid jobs."""
import glob
import json
import os

import pytest

from so import cron, model
from test_api import World

EXAMPLES = sorted(glob.glob(os.path.join(os.path.dirname(__file__), "..", "ui", "src", "features",
                                         "jobs", "examples", "*.json")))


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def test_ten_examples():
    assert len(EXAMPLES) == 10
    ids = [load(p)["id"] for p in EXAMPLES]
    assert len(set(ids)) == 10


@pytest.mark.parametrize("path", EXAMPLES, ids=os.path.basename)
def test_example_is_valid(path):
    job = load(path)
    assert model.JOB_ID_RE.fullmatch(job["id"]) and job["id"].startswith("example_")
    assert job["enabled"] is False
    assert "timezone" not in job
    crons = [t for t in job["triggers"] if t["type"] == "cron"]
    assert crons
    for t in crons:
        cron.parse(t["cron"])
    errors = [i for i in model.validate_job(job) if i["level"] == "error"]
    assert errors == []
    assert job["layout"]["nodes"]


def test_examples_save_through_the_api():
    """Add all examples: every one is created by the create-job route, turned off."""
    w = World()
    for path in EXAMPLES:
        job = load(path)
        status, out = w.call("alice", "POST", "/orchestrator/jobs", job)
        assert status == 201, (path, out)
        assert out["job"]["id"] == job["id"] and out["job"]["enabled"] is False
        assert not [i for i in out["issues"] if i["level"] == "error"]
