from so import authz

RUN = ["orchestrator_run"]
BUILD = ["orchestrator_build", "orchestrator_run"]
ADMIN = ["orchestrator_admin", "orchestrator_build", "orchestrator_run"]
JOB = {"id": "daily", "owner": "alice", "run_roles": ["ops"]}


def test_owner_sees_edits_and_runs_own_job():
    assert authz.can_view("alice", JOB, ["builder"], BUILD)
    assert authz.can_edit("alice", JOB, ["builder"], BUILD)
    assert authz.can_run("alice", JOB, ["builder"], BUILD)


def test_owner_without_build_cannot_edit():
    assert not authz.can_edit("alice", JOB, ["user"], RUN)


def test_run_only_user_cannot_edit():
    assert authz.can_view("carol", JOB, ["ops"], RUN)
    assert authz.can_run("carol", JOB, ["ops"], RUN)
    assert not authz.can_edit("carol", JOB, ["ops"], RUN)


def test_build_user_cannot_see_others():
    assert not authz.can_view("bob", JOB, ["builder"], BUILD)
    assert not authz.can_run("bob", JOB, ["builder"], BUILD)
    assert not authz.can_edit("bob", JOB, ["builder"], BUILD)


def test_listed_role_needs_capability():
    assert not authz.can_view("dave", JOB, ["ops"], [])
    assert not authz.can_run("dave", JOB, ["ops"], [])
    assert authz.can_view("dave", JOB, ["ops"], RUN)


def test_admin_may_do_everything():
    assert authz.can_view("root", JOB, [], ADMIN)
    assert authz.can_edit("root", JOB, [], ADMIN)
    assert authz.can_run("root", JOB, [], ADMIN)
    assert authz.can_admin("root", None, [], ADMIN)
    assert not authz.can_admin("alice", None, ["builder"], BUILD)


def test_new_job_needs_build():
    assert authz.can_edit("bob", None, [], BUILD)
    assert not authz.can_edit("carol", None, ["ops"], RUN)
