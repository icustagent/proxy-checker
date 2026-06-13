import json
import time
import os
import sys
import threading
import asyncio
import logging
import hashlib
import hmac
from http import cookies
from http.server import HTTPServer
from socketserver import ThreadingMixIn

from proxy_check import CheckConfig, DEFAULT_TARGET_CHAT, ProxyCheckEngine, TARGET_PROFILE_OPTIONS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_config():
    config = {}
    for name in ("config.json", "config.local.json"):
        path = os.path.join(BASE_DIR, name)
        if not os.path.isfile(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        if isinstance(loaded, dict):
            config.update(loaded)
    return config


CONFIG = load_config()


def get_config_value(key, env_name, default):
    if env_name in os.environ:
        return os.environ[env_name]
    return CONFIG.get(key, default)


def get_config_int(key, env_name, default):
    try:
        return int(get_config_value(key, env_name, default))
    except (TypeError, ValueError):
        return default

# ============================================================
# My Repository — save/retrieve repo proxies as txt
# ============================================================
REPO_DIR = os.path.join(BASE_DIR, 'repo_data')
os.makedirs(REPO_DIR, exist_ok=True)

# Checked proxies persistence — per-token checked history
CHECKED_DIR = os.path.join(BASE_DIR, 'checked_data')
os.makedirs(CHECKED_DIR, exist_ok=True)

# === Fetch free proxies from external sources ===
try:
    from fetch_proxies import fetch_proxies, PROXY_SOURCES
    FETCH_PROXIES_AVAILABLE = True
except ImportError:
    FETCH_PROXIES_AVAILABLE = False

# === Try to import nodriver for deep check ===
NODRIVER_AVAILABLE = False
try:
    import nodriver
    NODRIVER_AVAILABLE = True
except ImportError:
    pass

# === Try to install Xvfb for headless Chrome ===
XVFB_AVAILABLE = False
try:
    import subprocess
    _xvfb_check = subprocess.run(["which", "Xvfb"], capture_output=True, timeout=3)
    XVFB_AVAILABLE = _xvfb_check.returncode == 0
except Exception:
    pass

LOG_FILE_PATH = str(get_config_value("log_file", "LOG_FILE", os.path.join(BASE_DIR, "server.log")))
if not os.path.isabs(LOG_FILE_PATH):
    LOG_FILE_PATH = os.path.join(BASE_DIR, LOG_FILE_PATH)

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(LOG_FILE_PATH, encoding='utf-8')
    ]
)
log = logging.getLogger('vpntest')

# ============================================================
# Configuration
# ============================================================
TIMEOUT = 12
DETECT_TIMEOUT = 8
MAX_CONCURRENT = get_config_int("max_concurrent", "MAX_CONCURRENT", 30)
MAX_CONCURRENT_LIMIT = get_config_int("max_concurrent_limit", "MAX_CONCURRENT_LIMIT", 200)
CHECK_ROUNDS = 2
PORT = get_config_int("port", "PORT", 8888)
AUTH_PASSWORD = str(get_config_value("auth_password", "AUTH_PASSWORD", "linux.do"))
AUTH_SESSION_DAYS = get_config_int("auth_session_days", "AUTH_SESSION_DAYS", 7)
AUTH_COOKIE_NAME = "proxy_checker_auth"
AUTH_SESSION_SECONDS = max(1, AUTH_SESSION_DAYS) * 86400
AUTH_SESSION_SECRET = str(get_config_value("auth_session_secret", "AUTH_SESSION_SECRET", AUTH_PASSWORD))

TARGET_CHAT = DEFAULT_TARGET_CHAT
check_engine = ProxyCheckEngine(
    CheckConfig(
        timeout=TIMEOUT,
        detect_timeout=DETECT_TIMEOUT,
        check_rounds=CHECK_ROUNDS,
    )
)

sessions = {}
sessions_lock = threading.Lock()
TARGET_PROFILE_IDS = {str(item["id"]) for item in TARGET_PROFILE_OPTIONS}


def normalize_target_profile(value):
    profile_id = str(value or "generic")
    return profile_id if profile_id in TARGET_PROFILE_IDS else "generic"


def normalize_max_concurrent(value):
    try:
        concurrent = int(value)
    except (TypeError, ValueError):
        concurrent = MAX_CONCURRENT
    return max(1, min(MAX_CONCURRENT_LIMIT, concurrent))


def is_auth_enabled():
    return bool(AUTH_PASSWORD)


def make_auth_token():
    issued_at = str(int(time.time()))
    signature = hmac.new(
        AUTH_SESSION_SECRET.encode("utf-8"),
        issued_at.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{issued_at}:{signature}"


def verify_auth_token(token):
    if not is_auth_enabled():
        return True
    try:
        issued_at, signature = str(token or "").split(":", 1)
        issued_at_int = int(issued_at)
    except (TypeError, ValueError):
        return False
    if time.time() - issued_at_int > AUTH_SESSION_SECONDS:
        return False
    expected = hmac.new(
        AUTH_SESSION_SECRET.encode("utf-8"),
        issued_at.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(signature, expected)


def get_bearer_token(headers):
    auth_header = headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:].strip()
    return headers.get("X-Proxy-Auth", "").strip()


def get_cookie_token(cookie_header):
    parsed = cookies.SimpleCookie()
    try:
        parsed.load(cookie_header or "")
    except cookies.CookieError:
        return ""
    morsel = parsed.get(AUTH_COOKIE_NAME)
    return morsel.value if morsel else ""


def is_request_authenticated(headers):
    return verify_auth_token(get_bearer_token(headers) or get_cookie_token(headers.get("Cookie", "")))


def make_auth_cookie(token, max_age=AUTH_SESSION_SECONDS):
    return f"{AUTH_COOKIE_NAME}={token}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax"

# ============================================================
# Session cleanup
# ============================================================
def cleanup_sessions():
    while True:
        time.sleep(120)
        now = time.time()
        with sessions_lock:
            to_del = [k for k, v in sessions.items()
                      if v.get("finished") and now - v.get("created", now) > 600]
            for k in to_del:
                del sessions[k]
            if to_del:
                log.info(f"Cleaned up {len(to_del)} stale sessions, {len(sessions)} remaining")

threading.Thread(target=cleanup_sessions, daemon=True).start()

# ============================================================
# Deep Check (optional, requires nodriver + Chrome)
# ============================================================
async def deep_check_nodriver(proxy_str, target_url, timeout=20):
    """
    Use nodriver (real browser) to verify proxy can bypass CF.
    Returns: (success, details)
    """
    if not NODRIVER_AVAILABLE:
        return False, {"error": "nodriver not installed"}

    browser = None
    try:
        # Configure nodriver with proxy
        config = nodriver.Config()
        config.add_argument(f"--proxy-server={proxy_str}")
        config.add_argument("--no-sandbox")
        config.add_argument("--disable-dev-shm-usage")
        config.headless = True

        browser = await nodriver.start(config=config)
        page = await browser.get(target_url)

        # Wait for page to load
        await asyncio.sleep(5)

        # Check page content
        title = await page.evaluate("document.title")
        body_text = await page.evaluate("document.body.innerText.substring(0, 2000)")

        # Check for CF challenge
        cf_detected = False
        cf_type = None
        for indicator in ["Just a moment", "Checking your browser", "Verify you are human", "challenge-platform"]:
            if indicator.lower() in body_text.lower():
                cf_detected = True
                if "turnstile" in body_text.lower():
                    cf_type = "turnstile"
                elif "just a moment" in body_text.lower():
                    cf_type = "js"
                else:
                    cf_type = "managed"
                break

        has_content = any(kw in body_text.lower() for kw in ["chatgpt", "chat.openai.com", "log in", "sign up"])

        return True, {
            "title": title,
            "body_preview": body_text[:500],
            "cf_detected": cf_detected,
            "cf_type": cf_type,
            "has_real_content": has_content,
            "success": has_content and not cf_detected,
        }

    except Exception as e:
        return False, {"error": str(e)[:200]}
    finally:
        if browser:
            try:
                await browser.stop()
            except Exception:
                pass

def run_deep_check(proxy_str, target_url=None):
    """Synchronous wrapper for deep check."""
    if not NODRIVER_AVAILABLE:
        return {"error": "nodriver not installed", "success": False}

    target = target_url or TARGET_CHAT
    loop = asyncio.new_event_loop()
    try:
        ok, details = loop.run_until_complete(
            deep_check_nodriver(proxy_str, target, timeout=20)
        )
        return {"success": ok, **details}
    finally:
        loop.close()

# ============================================================
# Main Check Runner
# ============================================================
def run_check(session_id, proxies, rounds=None, target_profile=None, max_concurrent=None):
    if rounds is None:
        rounds = CHECK_ROUNDS
    max_concurrent = normalize_max_concurrent(max_concurrent)
    with sessions_lock:
        sessions[session_id]["stop"] = threading.Event()
    stop_event = sessions[session_id]["stop"]

    def publish_result(result):
        if result:
            with sessions_lock:
                s = sessions.get(session_id)
                if s:
                    s["results"].append(result)
                    s["done"] += 1

    async def run_async():
        await check_engine.check_many_async(
            proxies=proxies,
            stop_event=stop_event,
            rounds=rounds,
            max_concurrent=max_concurrent,
            on_result=publish_result,
            target_profile=target_profile,
        )

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run_async())
    finally:
        loop.close()

    with sessions_lock:
        s = sessions.get(session_id)
        if s:
            s["finished"] = True

# ============================================================
# HTTP Server
# ============================================================
class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc_type, exc, _ = sys.exc_info()
        if isinstance(exc, (ConnectionResetError, BrokenPipeError, TimeoutError)):
            log.warning("Client disconnected early", extra={"client_address": client_address})
            return
        super().handle_error(request, client_address)

from http.server import SimpleHTTPRequestHandler

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?")[0]

        # Serve repo as txt: /api/repo/<token>.txt
        # Serve repo as JSON: /api/repo/<token>.json
        if path.startswith("/api/repo/") and path.endswith(".json"):
            token = path.split("/")[-1].replace(".json", "")
            json_file = os.path.join(REPO_DIR, f"{token}.json")
            if os.path.isfile(json_file):
                with open(json_file, "r") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"[]")
            return

        # Serve repo as txt: /api/repo/<token>.txt
        if path.startswith("/api/repo/") and path.endswith(".txt"):
            token = path.split("/")[-1].replace(".txt", "")
            repo_file = os.path.join(REPO_DIR, f"{token}.txt")
            if os.path.isfile(repo_file):
                with open(repo_file, "r") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"Repository not found")
            return
        # Serve checked proxies as txt: /api/checked/<token>.txt
        if path.startswith("/api/checked/") and path.endswith(".txt"):
            token = path.split("/")[-1].replace(".txt", "")
            checked_file = os.path.join(CHECKED_DIR, f"{token}.txt")
            if os.path.isfile(checked_file):
                with open(checked_file, "r") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(b"")
            return

        if path == "/login.html":
            self._send_static_file("login.html")
            return

        if path in ("/", "/index.html") and is_auth_enabled() and not is_request_authenticated(self.headers):
            self._send_static_file("login.html")
            return

        if path == "/app.js" and is_auth_enabled() and not is_request_authenticated(self.headers):
            self._json(401, {"error": "请先输入登录密码", "auth_required": True})
            return

        static_files = {
            "/": "index.html",
            "/index.html": "index.html",
            "/app.js": "app.js",
        }
        file_name = static_files.get(path)
        if file_name is None:
            self.send_response(404); self.end_headers(); return
        self._send_static_file(file_name)

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}

            if self.path == "/api/auth/status":
                self._json(200, {
                    "authenticated": is_request_authenticated(self.headers),
                    "auth_required": is_auth_enabled(),
                })

            elif self.path == "/api/auth/login":
                password = str(body.get("password", ""))
                if not hmac.compare_digest(password, AUTH_PASSWORD):
                    self._json(401, {"error": "密码不正确", "auth_required": True})
                    return
                token = make_auth_token()
                self._json(200, {
                    "ok": True,
                    "token": token,
                    "expires_in": AUTH_SESSION_SECONDS,
                    "auth_required": is_auth_enabled(),
                }, [("Set-Cookie", make_auth_cookie(token))])

            elif self.path == "/api/auth/logout":
                self._json(200, {"ok": True}, [("Set-Cookie", make_auth_cookie("", 0))])

            elif self.path == "/api/capabilities":
                # Return server capabilities
                self._json(200, {
                    "nodriver": NODRIVER_AVAILABLE,
                    "xvfb": XVFB_AVAILABLE,
                    "deep_check": NODRIVER_AVAILABLE,
                    "fetch_proxies": FETCH_PROXIES_AVAILABLE,
                    "target_profiles": list(TARGET_PROFILE_OPTIONS),
                    "max_concurrent": MAX_CONCURRENT,
                    "max_concurrent_limit": MAX_CONCURRENT_LIMIT,
                    "auth_required": is_auth_enabled(),
                    "authenticated": is_request_authenticated(self.headers),
                    "proxy_sources": [{"id": s["id"], "name": s["name"]} for s in (PROXY_SOURCES if FETCH_PROXIES_AVAILABLE else [])],
                })

            elif not is_request_authenticated(self.headers):
                self._json(401, {"error": "请先输入登录密码", "auth_required": True})

            elif self.path == "/api/start":
                proxies = body.get("proxies", [])
                rounds = body.get("rounds", CHECK_ROUNDS)
                rounds = max(1, min(5, int(rounds)))  # clamp 1-5
                target_profile = normalize_target_profile(body.get("target_profile", "generic"))
                max_concurrent = normalize_max_concurrent(body.get("max_concurrent", MAX_CONCURRENT))
                sid = str(time.time()) + str(id(proxies))
                with sessions_lock:
                    sessions[sid] = {
                        "results": [], "done": 0, "finished": False,
                        "stop": None, "total": len(proxies), "created": time.time(),
                        "rounds": rounds, "target_profile": target_profile,
                        "max_concurrent": max_concurrent,
                    }
                threading.Thread(target=run_check, args=(sid, proxies, rounds, target_profile, max_concurrent), daemon=True).start()
                log.info(f"Start check: session={sid}, proxies={len(proxies)}, rounds={rounds}, target_profile={target_profile}, max_concurrent={max_concurrent}")
                self._json(200, {"session_id": sid, "total": len(proxies), "rounds": rounds, "target_profile": target_profile, "max_concurrent": max_concurrent})

            elif self.path == "/api/status":
                sid = body.get("session_id", "")
                since = body.get("since", 0)
                with sessions_lock:
                    s = sessions.get(sid)
                    if not s:
                        self._json(200, {"error": "not found"}); return
                    all_r = s["results"]
                    new_r = all_r[since:]
                    self._json(200, {
                        "new": new_r,
                        "total_done": s["done"],
                        "total": s["total"],
                        "finished": s["finished"],
                        "target_profile": s.get("target_profile", "generic"),
                        "max_concurrent": s.get("max_concurrent", MAX_CONCURRENT),
                        "valid_count": sum(1 for r in all_r if r.get("valid")),
                        "unstable_count": sum(1 for r in all_r if r.get("unstable")),
                        "invalid_count": sum(1 for r in all_r if not r.get("valid") and not r.get("unstable")),
                        "cf_bypass_count": sum(1 for r in all_r if r.get("cf_bypass")),
                        "registration_count": sum(1 for r in all_r if r.get("registration_ready")),
                    })

            elif self.path == "/api/stop":
                sid = body.get("session_id", "")
                with sessions_lock:
                    s = sessions.get(sid)
                    if s and s.get("stop"):
                        s["stop"].set()
                self._json(200, {"ok": True})

            elif self.path == "/api/deep-check":
                # Optional deep check using nodriver
                proxy = body.get("proxy", "")
                if not proxy:
                    self._json(400, {"error": "proxy required"}); return
                if not NODRIVER_AVAILABLE:
                    self._json(200, {"success": False, "error": "nodriver not installed", "hint": "pip install nodriver"})
                    return
                target = body.get("target", TARGET_CHAT)
                result = run_deep_check(proxy, target)
                self._json(200, result)

            elif self.path == "/api/repo/save":
                # Accept full repo data (JSON array of objects) or legacy proxy list
                repo_data = body.get("repo", None)
                proxies = body.get("proxies", [])
                token = body.get("token", "default")
                if not token.replace("_","").isalnum():
                    token = "default"

                if repo_data is not None:
                    # Full JSON data — save as .json
                    json_file = os.path.join(REPO_DIR, f"{token}.json")
                    with open(json_file, "w") as f:
                        json.dump(repo_data, f, ensure_ascii=False)
                    # Also save txt for backwards compat
                    txt_file = os.path.join(REPO_DIR, f"{token}.txt")
                    proxy_list = [p.get("proxy","") if isinstance(p,dict) else str(p) for p in repo_data]
                    with open(txt_file, "w") as f:
                        f.write("\n".join(proxy_list))
                    log.info(f"Repo saved (JSON): token={token}, proxies={len(repo_data)}")
                    self._json(200, {"ok": True, "url": f"/api/repo/{token}.json", "count": len(repo_data)})
                else:
                    # Legacy txt-only
                    repo_file = os.path.join(REPO_DIR, f"{token}.txt")
                    with open(repo_file, "w") as f:
                        f.write("\n".join(proxies))
                    log.info(f"Repo saved (txt): token={token}, proxies={len(proxies)}")
                    self._json(200, {"ok": True, "url": f"/api/repo/{token}.txt", "count": len(proxies)})

            elif self.path == "/api/fetch-proxies":
                # Fetch proxies from external sources
                if not FETCH_PROXIES_AVAILABLE:
                    self._json(200, {"error": "fetch_proxies 模块不可用"})
                    return
                source_id = body.get("source", "proxifly")
                limit = min(int(body.get("limit", 999999)), 999999)
                proxies, source_name, err = fetch_proxies(source_id, limit)
                if err:
                    self._json(200, {"error": err, "source": source_name})
                else:
                    self._json(200, {
                        "proxies": proxies,
                        "count": len(proxies),
                        "source": source_name,
                        "source_id": source_id,
                    })

            elif self.path == "/api/checked/save":
                proxies = body.get("proxies", [])
                token = body.get("token", "default")
                if not token.replace("_","").isalnum():
                    token = "default"
                checked_file = os.path.join(CHECKED_DIR, f"{token}.txt")
                with open(checked_file, "w") as f:
                    f.write("\n".join(proxies))
                log.info(f"Checked proxies saved: token={token}, count={len(proxies)}")
                self._json(200, {"ok": True, "count": len(proxies)})

            elif self.path == "/api/checked/filter":
                # Given a list of proxies, return which ones are NOT yet checked
                proxies = body.get("proxies", [])
                token = body.get("token", "default")
                if not token.replace("_","").isalnum():
                    token = "default"
                checked_file = os.path.join(CHECKED_DIR, f"{token}.txt")
                checked_set = set()
                if os.path.isfile(checked_file):
                    with open(checked_file, "r") as f:
                        for line in f:
                            line = line.strip()
                            if line:
                                checked_set.add(line.lower())
                unchecked = [p for p in proxies if p.lower() not in checked_set]
                skipped = len(proxies) - len(unchecked)
                self._json(200, {
                    "unchecked": unchecked,
                    "skipped": skipped,
                    "total": len(proxies),
                    "checked_count": len(checked_set),
                })

            else:
                self.send_response(404); self.end_headers()

        except Exception as e:
            log.error(f"POST error: {e}")
            try:
                self._json(500, {"error": str(e)})
            except:
                pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Proxy-Auth")
        self.end_headers()

    def _json(self, code, data, headers=None):
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        for key, value in headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def _send_static_file(self, file_name):
        fp = os.path.join(BASE_DIR, file_name)
        ext = os.path.splitext(fp)[1]
        ct = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8", ".json": "application/json"}.get(ext, "application/octet-stream")
        if os.path.isfile(fp):
            self.send_response(200)
            self.send_header("Content-Type", ct)
            self.end_headers()
            with open(fp, "rb") as f:
                self.wfile.write(f.read())
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log.info(f"Proxy Checker running at http://0.0.0.0:{PORT}")
    log.info(f"Deep check (nodriver): {'available' if NODRIVER_AVAILABLE else 'not installed'}")
    log.info(f"Concurrency: {MAX_CONCURRENT} | Rounds: {CHECK_ROUNDS}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Stopped.")
        server.server_close()
    except Exception as e:
        log.critical(f"Server crashed: {e}", exc_info=True)
