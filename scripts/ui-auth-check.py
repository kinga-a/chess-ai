"""
UI check for the access gate.
Starts a protected server on 8797 and verifies the passphrase overlay.
Run: python3 scripts/ui-auth-check.py
"""
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8797
KEY = "ui-key-2026"
BASE = f"http://127.0.0.1:{PORT}"
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
OUT = ROOT / ".preview"
OUT.mkdir(exist_ok=True)


def wait_server():
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"{BASE}/api/health", timeout=1) as res:
                if res.status == 200:
                    return
        except Exception:
            time.sleep(0.1)
    raise RuntimeError("server not ready")


server = subprocess.Popen(
    ["node", "scripts/dev-server.mjs"],
    cwd=ROOT,
    env={**os.environ, "PORT": str(PORT), "ADMIN_PASS": KEY, "ACCESS_KEY": "mcp-side-key"},
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

errors = []
try:
    wait_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME if Path(CHROME).exists() else None)
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        page.on("pageerror", lambda err: errors.append(str(err)))

        page.goto(BASE, wait_until="networkidle")
        gate = page.locator("#accessGate")
        if not gate.is_visible():
            raise AssertionError("access gate should be visible")
        page.screenshot(path=str(OUT / "09-access-gate.png"))

        page.fill("#gateKey", "wrong-key")
        page.click("#gateSubmit")
        page.wait_for_timeout(600)
        message = page.locator("#gateError").inner_text().strip()
        if "不正确" not in message:
            raise AssertionError(f"expected wrong-key message, got: {message!r}")

        page.fill("#gateKey", KEY)
        page.click("#gateSubmit")
        page.wait_for_timeout(900)
        if gate.is_visible():
            raise AssertionError("gate should close after the right key")
        if not page.locator("#view-lobby.is-active").count():
            raise AssertionError("lobby should be active after unlock")
        if page.evaluate("document.documentElement.dataset.secure") != "on":
            raise AssertionError("secure mode flag should be on")
        page.screenshot(path=str(OUT / "10-access-granted.png"))

        page.click("#navMcp")
        page.wait_for_timeout(400)
        if "Authorization" not in page.locator("#mcpConfig").inner_text():
            raise AssertionError("MCP config should include the Authorization header")
        page.click("#mcpModal .modal-close")
        page.wait_for_timeout(300)

        page.reload(wait_until="load")
        page.wait_for_timeout(1200)
        if page.locator("#accessGate").is_visible():
            raise AssertionError("session key should survive a reload")

        page.evaluate("sessionStorage.clear(); localStorage.clear();")
        page.reload(wait_until="load")
        page.wait_for_timeout(1200)
        if not page.locator("#accessGate").is_visible():
            raise AssertionError("gate should return after clearing storage")

        browser.close()

    if errors:
        raise AssertionError(f"page errors: {errors}")
    print("access gate: locked → wrong key rejected → unlocked → session persists → relock works")
    print("page errors:", errors)
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()