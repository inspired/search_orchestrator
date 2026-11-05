"""Authorization rules (spec section 9).

Every check takes ``(user, job, user_roles, user_caps)``; ``job`` may be None
where no job is involved (a new job, or an admin-only setting).

* ``orchestrator_admin`` may do everything.
* ``orchestrator_build`` may create jobs and edit the jobs it owns.
* Owners and members of a role listed in the job's ``run_roles`` who also
  hold ``orchestrator_run`` may run the job and see it (its SPL and runs).
"""
ADMIN = "orchestrator_admin"
BUILD = "orchestrator_build"
RUN = "orchestrator_run"


def _caps(user_caps):
    return set(user_caps or ())


def can_admin(user, job, user_roles, user_caps):
    """May ``user`` manage all jobs, settings and webhook destinations?"""
    return ADMIN in _caps(user_caps)


def can_run(user, job, user_roles, user_caps):
    """May ``user`` start ``job``?

    Yes for the job's owner, for ``orchestrator_admin`` users, and for members
    of a role listed in the job's ``run_roles`` who also hold ``orchestrator_run``.
    """
    if job is None:
        return False
    if user and user == job.get("owner"):
        return True
    caps = _caps(user_caps)
    if ADMIN in caps:
        return True
    listed = set(job.get("run_roles") or ())
    return bool(listed & set(user_roles or ())) and RUN in caps


def can_view(user, job, user_roles, user_caps):
    """May ``user`` see ``job``, its SPL and its runs? Admins, and anyone who may run it."""
    return can_run(user, job, user_roles, user_caps)


def can_edit(user, job, user_roles, user_caps):
    """May ``user`` save ``job`` (None: create a new job)?

    Admins always (saving another person's job makes the admin its owner);
    ``orchestrator_build`` users for new jobs and the jobs they own.
    """
    caps = _caps(user_caps)
    if ADMIN in caps:
        return True
    if BUILD not in caps:
        return False
    return job is None or (bool(user) and user == job.get("owner"))
