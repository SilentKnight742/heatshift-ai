from __future__ import annotations


def supabase_admin_headers(secret_key: str) -> dict[str, str]:
    """Build PostgREST headers for current and legacy server-side keys.

    Supabase's current ``sb_secret_`` keys authenticate through the ``apikey``
    header and are not JWTs. Legacy ``service_role`` keys are JWTs and still
    need the Authorization header when used directly with PostgREST.
    """

    headers = {
        "apikey": secret_key,
        "content-type": "application/json",
    }
    if not secret_key.startswith("sb_secret_"):
        headers["authorization"] = f"Bearer {secret_key}"
    return headers
