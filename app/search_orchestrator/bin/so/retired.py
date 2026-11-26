"""What 1.50.1 removed, cleaned up once: webhook destinations (the ``destinations``
document in ``so_settings``) with their URL, header and body secrets, and a fallback
notification that pointed at one. The engine calls ``forget_destinations`` with the system
session when it takes the lease; it does nothing when there is nothing left."""
from .gateway import GatewayError

SETTINGS = "so_settings"
DESTINATIONS = "destinations"
REFS = ("url_secret_ref", "headers_secret_ref", "body_secret_ref")


def forget_destinations(gw, emit):
    """Delete the stored destinations and their secrets, and clear a webhook fallback. True
    if anything was removed (one ``destinations_removed`` event says what)."""
    doc = gw.kv_get(SETTINGS, DESTINATIONS)
    settings = gw.kv_get(SETTINGS, "settings") or {}
    webhook_fallback = (settings.get("fallback") or {}).get("type") == "webhook"
    if not doc and not webhook_fallback:
        return False
    names, failed = [], []
    for dest in (doc or {}).get("destinations") or []:
        names.append(dest.get("name"))
        for ref in REFS:
            if dest.get(ref):
                try:
                    gw.delete_secret(dest[ref])
                except GatewayError:
                    failed.append(dest[ref])
    if failed:
        # Kept, so the next start tries again; the secrets are never read.
        emit({"type": "destinations_remove_failed", "secrets": failed})
        return False
    if doc:
        gw.kv_delete(SETTINGS, DESTINATIONS)
    if webhook_fallback:
        settings = dict(settings, fallback=None)
        gw.kv_update(SETTINGS, "settings", settings)
    emit({"type": "destinations_removed", "destinations": names,
          "fallback_cleared": webhook_fallback})
    return True
