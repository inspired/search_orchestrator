"""Names of the hidden saved searches the app owns (spec section 5, "Re-run definition").

Hidden step searches are named by content, so old and new versions of a job
coexist while runs still use them. Task 8 writes each step's name into the job
definition (``steps[i].hidden_search``) at save time; the engine only reads it
from the run's definition snapshot.
"""


def step_search_name(job_id, step_id, compiled_hash):
    """``_so_<job>_<step>_<hash8>`` for a step's compiled search."""
    return "_so_%s_%s_%s" % (job_id, step_id, compiled_hash[:8])
