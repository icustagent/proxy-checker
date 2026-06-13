from __future__ import annotations

import argparse
import json
import os
import time
import urllib.request
from typing import Any, Dict


EXPECTED_PROFILES = {"generic", "openai", "grok", "gemini", "claude"}
EXPECTED_PROXY_SOURCES = {
    "proxifly",
    "proxynova",
    "hidemn",
    "freeproxy",
    "checkerproxy",
    "spysme_http",
    "spysme_socks",
    "proxyscrape_http",
    "proxyscrape_socks5",
    "geonode",
    "my_proxy",
}
SMOKE_PROXY = "http://127.0.0.1:9"


def post_json(base_url: str, path: str, payload: Dict[str, Any], timeout: int = 15, token: str = "") -> Dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        base_url.rstrip("/") + path,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_text(base_url: str, path: str, timeout: int = 15, token: str = "") -> str:
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(base_url.rstrip("/") + path, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def login(base_url: str, password: str) -> str:
    status = post_json(base_url, "/api/auth/status", {})
    if not status.get("auth_required") or status.get("authenticated"):
        return ""
    result = post_json(base_url, "/api/auth/login", {"password": password})
    token = str(result.get("token") or "")
    if not token:
        raise AssertionError(f"login did not return a token: {result}")
    return token


def wait_for_result(base_url: str, session_id: str, token: str) -> Dict[str, Any]:
    for _ in range(30):
        status = post_json(base_url, "/api/status", {"session_id": session_id, "since": 0}, token=token)
        if status.get("finished"):
            return status
        time.sleep(0.5)
    raise RuntimeError(f"session {session_id} did not finish")


def check_profile(base_url: str, profile_id: str, token: str) -> None:
    started = post_json(
        base_url,
        "/api/start",
        {"proxies": [SMOKE_PROXY], "rounds": 1, "target_profile": profile_id},
        token=token,
    )
    if started.get("target_profile") != profile_id:
        raise AssertionError(f"profile mismatch: {started}")
    status = wait_for_result(base_url, started["session_id"], token)
    if status.get("total") != 1 or status.get("total_done") != 1:
        raise AssertionError(f"unexpected status for {profile_id}: {status}")
    result = status["new"][0]
    for key in ("target_profile", "target_name", "service_reachable", "country", "checks_detail"):
        if key not in result:
            raise AssertionError(f"{profile_id} missing {key}: {result}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--password", default=os.environ.get("AUTH_PASSWORD", "linux.do"))
    args = parser.parse_args()

    capabilities = post_json(args.base_url, "/api/capabilities", {})
    profile_ids = {item["id"] for item in capabilities.get("target_profiles", [])}
    if profile_ids != EXPECTED_PROFILES:
        raise AssertionError(f"unexpected target profiles: {profile_ids}")
    source_ids = {item["id"] for item in capabilities.get("proxy_sources", [])}
    if not EXPECTED_PROXY_SOURCES.issubset(source_ids):
        missing = EXPECTED_PROXY_SOURCES - source_ids
        raise AssertionError(f"missing proxy sources: {missing}")

    auth_required = bool(capabilities.get("auth_required"))
    login_html = get_text(args.base_url, "/index.html")
    if auth_required and 'id="password"' not in login_html:
        raise AssertionError("unauthenticated index.html should return login page")

    token = login(args.base_url, args.password)

    app_js = get_text(args.base_url, "/app.js", token=token)
    index_html = get_text(args.base_url, "/index.html", token=token)
    for expected in ("function restoreActiveSession()", "function recheckRepo()", "target_profile"):
        if expected not in app_js:
            raise AssertionError(f"app.js missing {expected}")
    if 'id="targetProfileDropdown"' not in index_html:
        raise AssertionError("index.html missing target profile dropdown")
    if 'id="authOverlay"' not in index_html:
        raise AssertionError("index.html missing auth overlay")

    default_started = post_json(args.base_url, "/api/start", {"proxies": [SMOKE_PROXY], "rounds": 1}, token=token)
    if default_started.get("target_profile") != "generic":
        raise AssertionError(f"default profile is not generic: {default_started}")
    wait_for_result(args.base_url, default_started["session_id"], token)

    for profile_id in sorted(EXPECTED_PROFILES):
        check_profile(args.base_url, profile_id, token)

    print("smoke ok")


if __name__ == "__main__":
    main()
