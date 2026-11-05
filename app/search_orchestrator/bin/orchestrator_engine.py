#!/usr/bin/env python3
"""Search Orchestrator engine: the persistent modular input (spec section 8).

splunkd starts one process for the ``orchestrator_engine://main`` stanza
(``use_single_instance = false`` with ``interval = 0``, so it runs
continuously and is restarted if it exits). The process ticks the engine
every ``tick_seconds`` (default 5). It talks to splunkd with the session key
from its input definition and writes audit events as modular-input XML
events with sourcetype ``orchestrator:audit`` to the stanza's index.

Session expiry: an HTTP 401 never fails a run (the engine raises
``AuthExpired``). The loop reloads the session key from the input definition,
rebuilds the gateway and retries the tick once. If splunkd still rejects it,
the process exits, and splunkd restarts it with a fresh key.
"""
import logging
import os
import signal
import socket
import sys
import time

_BIN = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_BIN, "..", "lib"))
sys.path.insert(0, _BIN)

from splunklib.modularinput import Argument, EventWriter, Scheme, Script  # noqa: E402

from so.actions import ActionRunner  # noqa: E402
from so.audit import Audit  # noqa: E402
from so.engine import AuthExpired, Engine  # noqa: E402
from so.gateway import SplunkGateway  # noqa: E402
from so.store import Store  # noqa: E402

MAIN_STANZA = "orchestrator_engine://main"
DEFAULT_TICK = 5
DEFAULT_INDEX = "orchestrator"


def tick_seconds(value):
    try:
        return max(1, int(float(value)))
    except (TypeError, ValueError):
        return DEFAULT_TICK


class EngineLoop:
    """Ticks an engine, rebuilding it with a reloaded session key on HTTP 401."""

    def __init__(self, build, session_source, log, sleep=time.sleep, tick=DEFAULT_TICK):
        self.build = build
        self.session_source = session_source
        self.log = log
        self.sleep = sleep
        self.tick = tick
        self.engine = None
        self.stopping = False

    def run_once(self):
        """One tick. False if the session key is still rejected after a reload."""
        try:
            if self.engine is None:
                self.engine = self.build(self.session_source())
            try:
                self.engine.tick()
            except AuthExpired:
                self.log(EventWriter.WARN, "session key rejected (HTTP 401); reloading it and "
                                           "retrying the tick once")
                self.engine = self.build(self.session_source())
                self.engine.tick()
        except AuthExpired:
            self.log(EventWriter.ERROR, "session key still rejected after reloading it; exiting "
                                        "so that splunkd restarts the engine with a fresh key")
            return False
        except Exception as err:  # never let one bad tick stop the engine
            self.log(EventWriter.ERROR, "tick failed: {}: {}".format(type(err).__name__, err))
        return True

    def run_forever(self):
        while not self.stopping and self.run_once():
            self.sleep(self.tick)


class _EventWriterHandler(logging.Handler):
    def __init__(self, ew):
        logging.Handler.__init__(self)
        self.ew = ew

    def emit(self, record):
        severity = {logging.DEBUG: EventWriter.DEBUG, logging.INFO: EventWriter.INFO,
                    logging.WARNING: EventWriter.WARN}.get(record.levelno, EventWriter.ERROR)
        try:
            self.ew.log(severity, "{}: {}".format(record.name, self.format(record)))
        except Exception:
            pass


class OrchestratorEngine(Script):
    def get_scheme(self):
        scheme = Scheme("Search Orchestrator engine")
        scheme.description = "Advances Search Orchestrator runs."
        scheme.use_external_validation = False
        # One process per stanza, so that interval = 0 keeps it running.
        scheme.use_single_instance = False
        scheme.streaming_mode = Scheme.streaming_mode_xml
        # splunkd does not register a scheme without arguments (Milestone 1).
        scheme.add_argument(Argument("tick_seconds", title="Tick seconds",
                                     description="How often, in seconds, the engine advances runs.",
                                     data_type=Argument.data_type_number,
                                     required_on_create=False))
        return scheme

    def stream_events(self, inputs, ew):
        handler = _EventWriterHandler(ew)
        logger = logging.getLogger("so")
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        stanza = MAIN_STANZA if MAIN_STANZA in inputs.inputs else next(iter(inputs.inputs), None)
        if stanza != MAIN_STANZA:
            ew.log(EventWriter.WARN, "only {} runs the engine; {} stays idle".format(
                MAIN_STANZA, stanza))
            while True:  # exiting would make splunkd relaunch this stanza at once
                time.sleep(3600)
        params = inputs.inputs[stanza]
        meta = inputs.metadata
        holder = meta.get("server_host") or socket.gethostname()
        audit = Audit(ew, index=params.get("index") or DEFAULT_INDEX)

        def build(session_key):
            gateway = SplunkGateway.from_session(meta["server_uri"], session_key)
            store = Store(gateway)
            return Engine(gateway, store, audit, ActionRunner(gateway, store, audit),
                          time.time, holder)

        def session_source():
            return inputs.metadata["session_key"]

        loop = EngineLoop(build, session_source, ew.log, tick=tick_seconds(params.get("tick_seconds")))

        def stop(signum, frame):
            loop.stopping = True

        signal.signal(signal.SIGTERM, stop)
        ew.log(EventWriter.INFO, "engine starting as {} (tick {}s)".format(holder, loop.tick))
        loop.run_forever()
        if loop.stopping and loop.engine is not None:
            try:
                loop.engine.lease.release(holder)
            except Exception as err:
                ew.log(EventWriter.WARN, "could not release the lease: {}".format(err))
        ew.log(EventWriter.INFO, "engine stopped")


if __name__ == "__main__":
    sys.exit(OrchestratorEngine().run(sys.argv))
