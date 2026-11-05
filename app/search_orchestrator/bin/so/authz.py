"""Authorization rules (spec section 9). Task 8 extends this module."""


def can_run(user, job, user_roles, user_caps):
    """May ``user`` start ``job``?

    Yes for the job's owner, for ``orchestrator_admin`` users, and for members
    of a role listed in the job's ``run_roles`` who also hold ``orchestrator_run``.
    """
    if user and user == job.get("owner"):
        return True
    caps = set(user_caps or ())
    if "orchestrator_admin" in caps:
        return True
    listed = set(job.get("run_roles") or ())
    return bool(listed & set(user_roles or ())) and "orchestrator_run" in caps
