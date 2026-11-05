"""Splunk gateway: the engine's only door to splunkd (spec sections 8 and 9).

``Gateway`` is the Protocol the engine codes against. ``SplunkGateway`` is the
real implementation over ``splunklib`` REST calls. Parsing helpers are pure
functions so they can be tested with captured JSON.

Rulings proven on the real server (docs/m1-procedure.md):
* Dispatch only through saved/searches/<name>/dispatch in the job owner's
  namespace, with ``dispatch.now`` as integer epoch seconds. No ad hoc
  search/jobs route, and no workload_pool.
* ``upsert_saved_search`` never sends ``is_scheduled`` or ``dispatchAs``:
  restricted users get HTTP 400 for them.
* TLS policy: calls to the local splunkd management port are loopback, not
  outbound, and splunkd's default certificate is self-signed, so verification
  is off for them (``verify=False``). ``SplunkGateway.from_session`` therefore
  accepts only a loopback host (127.0.0.1, ::1, localhost) and raises
  otherwise. Outbound webhooks always verify TLS.
* KV Store: only the documented storage/collections/data REST (insert, update
  by key, query, delete, batch_save). A duplicate ``_key`` insert returns 409.
"""
import json
import re
import socket
import ssl
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional, Protocol
from urllib.parse import quote, urlsplit

APP = "search_orchestrator"
PASSWORD_REALM = "search_orchestrator"
LOOPBACK_HOSTS = ("127.0.0.1", "::1", "localhost")
WEBHOOK_TIMEOUT = 10
KV_PAGE = 1000
_TRUE = (True, 1, "1", "true", "True")


class GatewayError(Exception):
    """A call to splunkd failed. ``status`` is the HTTP status, if there was one."""

    def __init__(self, message, status=None, transient=False):
        Exception.__init__(self, message)
        self.status = status
        self.transient = transient


class DispatchError(GatewayError):
    def __init__(self, transient, message, status=None):
        GatewayError.__init__(self, message, status=status, transient=transient)


class KvError(GatewayError):
    """KV Store unavailable or rejecting a call (never a plain 404 or 409)."""


# Pure helpers.

def is_transient_status(status):
    """5xx and 429 are worth retrying. 4xx (bad search, no access, gone) is not."""
    return status is None or status == 429 or status >= 500


def _truthy(value):
    return value in _TRUE


def parse_sid(body):
    try:
        sid = json.loads(body).get("sid")
    except (ValueError, AttributeError):
        match = re.search(r"<sid>\s*([^<\s]+)\s*</sid>", body)
        sid = match.group(1) if match else None
    if not sid:
        raise GatewayError("no sid in dispatch response: " + body[:300])
    return sid


def _message_texts(messages):
    out = []
    for m in messages or []:
        if isinstance(m, dict):
            out.append((str(m.get("type", "")).upper(), str(m.get("text", ""))))
        elif m:
            out.append(("", str(m)))
    return out


def parse_job_status(body):
    """Job status JSON -> the gateway's job_status dict.

    Zombie jobs count as failed. A DONE job with zero results is a success.
    """
    entry = json.loads(body)["entry"][0]
    c = entry.get("content", {})
    texts = _message_texts(c.get("messages"))
    errors = [t for kind, t in texts if kind in ("ERROR", "FATAL")]
    detail = "; ".join(errors or [t for _, t in texts if t])
    zombie = _truthy(c.get("isZombie"))
    failed = _truthy(c.get("isFailed")) or c.get("dispatchState") == "FAILED"
    if zombie:
        state, error = "failed", detail or "search job is a zombie (its process died)"
    elif failed:
        state, error = "failed", detail or "search job failed"
    elif _truthy(c.get("isDone")) or c.get("dispatchState") == "DONE":
        state, error = "done", None
    else:
        state, error = "running", None
    try:
        count = int(c.get("resultCount", 0))
    except (TypeError, ValueError):
        count = 0
    try:
        ttl = int(c.get("ttl", 0))
    except (TypeError, ValueError):
        ttl = 0
    return {"state": state, "result_count": count, "error": error,
            "finalized": _truthy(c.get("isFinalized")), "zombie": zombie, "ttl": ttl}


MISSING_STATUS = {"state": "missing", "result_count": 0, "error": "search job not found",
                  "finalized": False, "zombie": False, "ttl": 0}


def parse_first_row(body):
    rows = json.loads(body).get("results") or []
    return rows[0] if rows else None


def _epoch(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        pass
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def parse_history(body, since_epoch):
    """History JSON -> sids published or dispatched at or after since_epoch, newest first."""
    found = []
    for entry in json.loads(body).get("entry", []):
        c = entry.get("content", {})
        when = None
        for raw in (entry.get("published"), c.get("published"), c.get("dispatch_time"),
                    c.get("dispatch.now"), c.get("updated"), entry.get("updated")):
            when = _epoch(raw)
            if when is not None:
                break
        sid = entry.get("name") or c.get("sid")
        if sid and when is not None and when >= since_epoch:
            found.append((when, sid))
    found.sort(key=lambda p: p[0], reverse=True)
    return [sid for _, sid in found]


def dispatch_params(now_epoch, args, earliest=None, latest=None, trigger_actions=False):
    params = {"dispatch.now": int(now_epoch), "force_dispatch": 1,
              "trigger_actions": 1 if trigger_actions else 0}
    for key, value in (args or {}).items():
        params["args." + key] = value
    if earliest is not None:
        params["dispatch.earliest_time"] = earliest
    if latest is not None:
        params["dispatch.latest_time"] = latest
    return params


def saved_search_params(search, earliest, latest, description=""):
    """Never include is_scheduled or dispatchAs (HTTP 400 for restricted users)."""
    return {"search": search, "dispatch.earliest_time": earliest,
            "dispatch.latest_time": latest, "is_visible": 0, "description": description}


def parse_user_access(body):
    """User JSON -> ``{"roles": [...], "capabilities": [...]}`` (effective, from all roles)."""
    c = json.loads(body)["entry"][0].get("content", {})
    return {"roles": list(c.get("roles") or []), "capabilities": list(c.get("capabilities") or [])}


MISSING_SAVED_SEARCH = {"exists": False, "owner": None, "sharing": None, "dispatch_as": None}


def parse_saved_search_info(body):
    """Saved search JSON -> ``{"exists", "owner", "sharing", "dispatch_as"}``."""
    entry = json.loads(body)["entry"][0]
    acl = entry.get("acl") or {}
    content = entry.get("content") or {}
    return {"exists": True, "owner": acl.get("owner"), "sharing": acl.get("sharing"),
            "dispatch_as": content.get("dispatchAs")}


def encoded_path(*parts):
    """A splunkd path whose last parts are names (saved searches, indexes, KV keys).

    ``parts[0]`` is a fixed route such as ``saved/searches``; every later part is
    percent-encoded once, ``/`` included, and the result is marked as already
    encoded so splunklib does not encode it again.
    """
    from splunklib.binding import UrlEncoded

    def one(part):
        text = quote(str(part), safe="")
        return text.replace(".", "%2E") if text in (".", "..") else text  # no dot segments
    return UrlEncoded("/".join([parts[0]] + [one(p) for p in parts[1:]]), skip_encode=True)


def check_webhook_url(url):
    """https only. Errors name the scheme and host only: URLs often carry secrets."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise GatewayError("webhook URL must be https with a host (scheme {!r}, host {!r})".format(
            parts.scheme, parts.hostname or ""))


# The Protocol the engine and its tests code against.

class Gateway(Protocol):
    def dispatch(self, owner: str, name: str, now_epoch: int, args: Dict[str, str],
                 earliest: Optional[str] = None, latest: Optional[str] = None,
                 trigger_actions: bool = False) -> str: ...

    def job_status(self, sid: str) -> Dict[str, Any]: ...
    def first_row(self, sid: str) -> Optional[Dict[str, Any]]: ...
    def control(self, sid: str, action: str, **kw: Any) -> None: ...
    def history(self, owner: str, name: str, since_epoch: float) -> List[str]: ...
    def user_exists(self, name: str) -> bool: ...
    def user_access(self, name: str) -> Dict[str, List[str]]: ...
    def kv_get(self, collection: str, key: str) -> Optional[Dict[str, Any]]: ...
    def kv_insert(self, collection: str, doc: Dict[str, Any]) -> bool: ...
    def kv_update(self, collection: str, key: str, doc: Dict[str, Any]) -> bool: ...
    def kv_delete(self, collection: str, key: str) -> None: ...
    def kv_delete_query(self, collection: str, query: Dict[str, Any]) -> None: ...
    def kv_query(self, collection: str, query: Optional[Dict[str, Any]] = None,
                 sort: Optional[str] = None, limit: int = 0) -> List[Dict[str, Any]]: ...
    def kv_batch_save(self, collection: str, docs: List[Dict[str, Any]]) -> None: ...
    def upsert_saved_search(self, owner: str, name: str, search: str, earliest: str,
                            latest: str, description: str = "") -> None: ...
    def delete_saved_search(self, owner: str, name: str) -> None: ...
    def saved_search_info(self, owner: str, name: str) -> Dict[str, Any]: ...
    def index_exists(self, name: str) -> bool: ...
    def read_secret(self, name: str) -> Optional[str]: ...
    def write_secret(self, name: str, value: str) -> None: ...
    def delete_secret(self, name: str) -> None: ...
    def post_webhook(self, url: str, headers: Dict[str, str], body: str) -> int: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


# Real implementation.

class SplunkGateway:
    """Thin wrapper over a ``splunklib.client.Service``.

    A gateway is built around one session key: the engine's system session,
    or (for upsert_saved_search in Task 8) the job owner's own session.
    """

    def __init__(self, service):
        self.service = service

    @classmethod
    def from_session(cls, server_uri, session_key, timeout=60):
        from splunklib import client
        uri = urlsplit(server_uri, allow_fragments=False)
        if (uri.hostname or "").lower() not in LOOPBACK_HOSTS:
            raise GatewayError("refusing non-loopback splunkd host {!r}: certificate "
                               "verification is off for the management port".format(uri.hostname))
        return cls(client.Service(scheme=uri.scheme, host=uri.hostname, port=uri.port,
                                  token=session_key, owner="nobody", app=APP,
                                  autologin=False, timeout=timeout, verify=False))

    # Plumbing.

    def _call(self, method, path, owner="nobody", app=APP, **params):
        func = getattr(self.service, method)
        try:
            response = func(path, owner=owner, app=app, output_mode="json", **params)
        except (socket.error, ssl.SSLError) as err:
            raise GatewayError("connection error: {}".format(err), transient=True)
        return response.body.read().decode("utf-8")

    @staticmethod
    def _status(err):
        return getattr(err, "status", None)

    def _kv(self, method, path, expected=(), **params):
        """KV call returning (status, body).

        ``expected`` lists the error statuses this caller handles (returned as
        the status with an empty body). Any other failure raises KvError.
        """
        try:
            return 200, self._call(method, path, **params)
        except GatewayError as err:
            raise KvError(str(err), status=err.status, transient=True)
        except Exception as err:
            status = self._status(err)
            if status in expected:
                return status, ""
            raise KvError("KV Store error: {}".format(err), status=status,
                          transient=is_transient_status(status))

    @staticmethod
    def _json_headers():
        return [("Content-Type", "application/json")]

    # Searches.

    def dispatch(self, owner, name, now_epoch, args, earliest=None, latest=None,
                 trigger_actions=False):
        params = dispatch_params(now_epoch, args, earliest, latest, trigger_actions)
        try:
            body = self._call("post", encoded_path("saved/searches", name, "dispatch"), owner,
                              **params)
        except GatewayError as err:
            raise DispatchError(err.transient, str(err), err.status)
        except Exception as err:
            status = self._status(err)
            raise DispatchError(is_transient_status(status), str(err), status)
        try:
            return parse_sid(body)
        except GatewayError as err:
            raise DispatchError(False, str(err))

    def job_status(self, sid):
        try:
            return parse_job_status(self._call("get", "search/jobs/" + sid, "-", "-"))
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return dict(MISSING_STATUS)
            raise GatewayError("job status failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))

    def first_row(self, sid):
        try:
            return parse_first_row(self._call("get", "search/jobs/{}/results".format(sid),
                                              "-", "-", count=1))
        except GatewayError:
            raise
        except Exception as err:
            raise GatewayError("results failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))

    def control(self, sid, action, **kw):
        """A job that is already gone (404) is not an error for touch/cancel."""
        try:
            self._call("post", "search/jobs/{}/control".format(sid), "-", "-", action=action, **kw)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return
            raise GatewayError("control {} failed: {}".format(action, err), self._status(err),
                               is_transient_status(self._status(err)))

    def history(self, owner, name, since_epoch):
        try:
            body = self._call("get", encoded_path("saved/searches", name, "history"), owner, count=0)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return []
            raise GatewayError("history failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))
        return parse_history(body, since_epoch)

    def user_exists(self, name):
        """False only if splunkd says the user does not exist (404)."""
        try:
            self._call("get", "/services/authentication/users/" + name)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return False
            raise GatewayError("user lookup failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))
        return True

    def user_access(self, name):
        """``{"roles", "capabilities"}`` of a user; both empty if the user does not exist."""
        try:
            body = self._call("get", "/services/authentication/users/" + name)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return {"roles": [], "capabilities": []}
            raise GatewayError("user lookup failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))
        return parse_user_access(body)

    def upsert_saved_search(self, owner, name, search, earliest, latest, description=""):
        params = saved_search_params(search, earliest, latest, description)
        try:
            self._call("post", encoded_path("saved/searches", name), owner, **params)
            return
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) != 404:
                raise GatewayError("saved search update failed: {}".format(err), self._status(err))
        try:
            self._call("post", "saved/searches", owner, name=name, **params)
        except GatewayError:
            raise
        except Exception as err:
            raise GatewayError("saved search create failed: {}".format(err), self._status(err))

    def delete_saved_search(self, owner, name):
        try:
            self._call("delete", encoded_path("saved/searches", name), owner)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) != 404:
                raise GatewayError("saved search delete failed: {}".format(err), self._status(err))

    def saved_search_info(self, owner, name):
        """How ``name`` looks from ``owner``'s namespace in this app (spec section 9's
        two-mode rule). ``exists`` is False if it is missing or the session cannot read it."""
        try:
            body = self._call("get", encoded_path("saved/searches", name), owner)
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) in (403, 404):
                return dict(MISSING_SAVED_SEARCH)
            raise GatewayError("saved search lookup failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))
        return parse_saved_search_info(body)

    def index_exists(self, name):
        try:
            self._call("get", encoded_path("data/indexes", name))
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return False
            raise GatewayError("index lookup failed: {}".format(err), self._status(err),
                               is_transient_status(self._status(err)))
        return True

    # KV Store.

    def kv_get(self, collection, key):
        status, body = self._kv("get", encoded_path("storage/collections/data", collection, key),
                                 expected=(404,))
        return None if status == 404 else json.loads(body)

    def kv_insert(self, collection, doc):
        """True if inserted; False if the _key already exists (409)."""
        status, _ = self._kv("post", "storage/collections/data/{}".format(collection),
                             expected=(409,), headers=self._json_headers(), body=json.dumps(doc))
        return status != 409

    def kv_update(self, collection, key, doc):
        """True if updated; False if there is no such key (404)."""
        status, _ = self._kv("post", encoded_path("storage/collections/data", collection, key),
                             expected=(404,), headers=self._json_headers(), body=json.dumps(doc))
        return status != 404

    def kv_delete(self, collection, key):
        self._kv("delete", encoded_path("storage/collections/data", collection, key),
                 expected=(404,))

    def kv_delete_query(self, collection, query):
        self._kv("delete", "storage/collections/data/{}".format(collection),
                 query=json.dumps(query))

    def kv_query(self, collection, query=None, sort=None, limit=0):
        """All matching documents (paged), at most ``limit`` if limit > 0."""
        out, skip = [], 0
        while True:
            page = KV_PAGE if not limit else min(KV_PAGE, limit - len(out))
            params = {"limit": page, "skip": skip}
            if query:
                params["query"] = json.dumps(query)
            if sort:
                params["sort"] = sort
            _, body = self._kv("get", "storage/collections/data/{}".format(collection), **params)
            rows = json.loads(body)
            out.extend(rows)
            skip += len(rows)
            if len(rows) < page or (limit and len(out) >= limit):
                return out

    def kv_batch_save(self, collection, docs):
        for i in range(0, len(docs), 500):
            self._kv("post", "storage/collections/data/{}/batch_save".format(collection),
                     headers=self._json_headers(), body=json.dumps(docs[i:i + 500]))

    # Secrets (storage/passwords).

    @staticmethod
    def _password_id(name):
        return "{}:{}:".format(PASSWORD_REALM, name)

    def read_secret(self, name):
        try:
            body = self._call("get", "storage/passwords/" + self._password_id(name))
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) == 404:
                return None
            raise GatewayError("read secret failed: {}".format(err), self._status(err))
        return json.loads(body)["entry"][0]["content"].get("clear_password")

    def write_secret(self, name, value):
        try:
            self._call("post", "storage/passwords/" + self._password_id(name), password=value)
            return
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) != 404:
                raise GatewayError("write secret failed: {}".format(err), self._status(err))
        try:
            self._call("post", "storage/passwords", name=name, realm=PASSWORD_REALM, password=value)
        except GatewayError:
            raise
        except Exception as err:
            raise GatewayError("create secret failed: {}".format(err), self._status(err))

    def delete_secret(self, name):
        """A secret that is already gone (404) is not an error."""
        try:
            self._call("delete", "storage/passwords/" + self._password_id(name))
        except GatewayError:
            raise
        except Exception as err:
            if self._status(err) != 404:
                raise GatewayError("delete secret failed: {}".format(err), self._status(err))

    # Webhooks.

    def post_webhook(self, url, headers, body):
        """POST over https only, TLS verified, 10 s timeout, no redirects. Returns the status."""
        check_webhook_url(url)
        data = body.encode("utf-8") if isinstance(body, str) else body
        request = urllib.request.Request(url, data=data, method="POST")
        for key, value in (headers or {}).items():
            request.add_header(key, value)
        opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=ssl.create_default_context()), _NoRedirect())
        try:
            with opener.open(request, timeout=WEBHOOK_TIMEOUT) as response:
                return response.status
        except urllib.error.HTTPError as err:
            raise GatewayError("webhook returned HTTP {}".format(err.code), status=err.code,
                               transient=is_transient_status(err.code))
        except (urllib.error.URLError, socket.error) as err:
            raise GatewayError("webhook failed: {}".format(err), transient=True)
