"""Audit events (spec section 12).

Every state change is written as one JSON event with sourcetype
``orchestrator:audit`` to the configured index, through the modular input's
``EventWriter`` (modular-input XML streaming). props.conf takes the timestamp
from the numeric ``_time`` field (TIME_PREFIX), so every event carries one.
Events never contain secrets, SPL results or parameter values beyond what
the run record already holds.
"""
import json
import logging
import time

SOURCETYPE = "orchestrator:audit"
SOURCE = "orchestrator_engine"

log = logging.getLogger(__name__)


class Audit:
    def __init__(self, writer, index=None, clock=time.time, source=SOURCE):
        self.writer = writer
        self.index = index
        self.clock = clock
        self.source = source

    def emit(self, event):
        """Write one audit event. Never raises: a lost event is logged."""
        from splunklib.modularinput import Event

        doc = {k: v for k, v in dict(event).items() if v is not None}
        doc["_time"] = int(doc.get("_time") if doc.get("_time") is not None else self.clock())
        try:
            data = json.dumps(doc, sort_keys=True, default=str)
            self.writer.write_event(Event(data=data, time="%d" % doc["_time"], index=self.index,
                                          sourcetype=SOURCETYPE, source=self.source))
        except Exception as err:  # stdout closed or similar: the engine must keep going
            log.error("audit event lost (%s): %s", err, doc.get("type"))
