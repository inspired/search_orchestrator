#!/usr/bin/env python3
"""Search Orchestrator REST handler (restmap.conf ``[script:orchestrator_api]``).

A thin adapter over ``so.api.handle``: splunkd passes each request as JSON
(``passSession`` gives the caller's session, ``passSystemAuth`` the system
session, ``passPayload`` the body). Two gateways are built from them: the
caller's own session for hidden saved searches and the caller's own access,
and the system session for KV Store and secrets. Audit events go to the
``orchestrator`` index through ``receivers/simple`` with the system session.
"""
import json
import logging
import os
import sys
import time

_BIN = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_BIN, "..", "lib"))
sys.path.insert(0, _BIN)

from so import api  # noqa: E402
from so.audit import SOURCETYPE  # noqa: E402
from so.gateway import SplunkGateway  # noqa: E402

try:
    from splunk.persistconn.application import PersistentServerConnectionApplication
except ImportError:  # outside splunkd (tests)
    class PersistentServerConnectionApplication(object):
        def __init__(self):
            pass

AUDIT_INDEX = "orchestrator"
AUDIT_SOURCE = "orchestrator_rest"
DEFAULT_URI = "https://127.0.0.1:8089"

log = logging.getLogger("so.rest")


class RestAudit:
    """Writes audit events with the system session. ``emit`` never raises; ``write``
    raises on failure (the self-test probe checks the write)."""

    def __init__(self, gateway, index=AUDIT_INDEX):
        self.gw = gateway
        self.index = index

    def write(self, event):
        doc = dict(event)
        doc["_time"] = int(doc.get("_time") if doc.get("_time") is not None else time.time())
        self.gw.service.post("receivers/simple", index=self.index, sourcetype=SOURCETYPE,
                             source=AUDIT_SOURCE,
                             body=json.dumps(doc, sort_keys=True, default=str))
        return doc

    def emit(self, event):
        try:
            self.write(event)
        except Exception as err:
            log.error("audit event lost (%s): %s", type(err).__name__, event.get("type"))


def _pairs(value):
    if isinstance(value, dict):
        return list(value.items())
    return [tuple(p) for p in value or [] if isinstance(p, (list, tuple)) and len(p) == 2]


def _body(request):
    raw = request.get("payload")
    body = {}
    if raw not in (None, ""):
        if isinstance(raw, (dict, list)):
            body = raw
        else:
            body = json.loads(raw)
    if (request.get("method") or "GET").upper() in ("GET", "DELETE") and isinstance(body, dict):
        for key, value in _pairs(request.get("query")):
            if key != "output_mode":
                body.setdefault(key, value)
    return body


def _reply(status, payload):
    return {"status": status, "payload": json.dumps(payload),
            "headers": {"Content-Type": "application/json"}}


def respond(request, build=SplunkGateway.from_session, audit_factory=RestAudit):
    """One splunkd request dict -> the persistent handler's response dict."""
    session = request.get("session") or {}
    user, user_token = session.get("user"), session.get("authtoken")
    system_token = request.get("system_authtoken")
    if not user or not user_token:
        return _reply(401, {"error": {"code": "unauthenticated", "message": "no user session",
                                      "issues": []}})
    if not system_token:
        return _reply(500, {"error": {"code": "misconfigured", "message": "the handler needs "
                                      "passSystemAuth", "issues": []}})
    try:
        body = _body(request)
    except ValueError:
        return _reply(400, {"error": {"code": "bad_request", "message": "the request body is "
                                      "not valid JSON", "issues": []}})
    uri = (request.get("server") or {}).get("rest_uri") or DEFAULT_URI
    try:
        system_gw = build(uri, system_token)
        deps = {"user_gateway": build(uri, user_token), "system_gateway": system_gw,
                "audit": audit_factory(system_gw), "secrets": [user_token, system_token]}
        status, payload = api.handle(user, request.get("method"), request.get("rest_path") or "",
                                     body, deps)
    except Exception as err:  # never leak a traceback to the caller
        log.exception("request failed")
        return _reply(500, {"error": {"code": "internal_error", "message": "internal error (%s)"
                                      % type(err).__name__, "issues": []}})
    return _reply(status, payload)


class Handler(PersistentServerConnectionApplication):
    def __init__(self, command_line=None, command_arg=None):
        PersistentServerConnectionApplication.__init__(self)

    def handle(self, in_string):
        if isinstance(in_string, bytes):
            in_string = in_string.decode("utf-8")
        try:
            request = json.loads(in_string)
        except ValueError:
            return _reply(400, {"error": {"code": "bad_request", "message": "bad request",
                                          "issues": []}})
        return respond(request)

    def handleStream(self, handle, in_string):
        raise NotImplementedError("streaming is not supported")

    def done(self):
        pass
