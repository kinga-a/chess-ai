"""
Web board ↔ AI bridge check: create a room in the browser, let the bridge
answer, and verify the page shows the AI move without refreshing.
Run: python3 scripts/ui-room-mcp-check.py
"""
import json
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8788"
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
OUT = Path(__file__).resolve().parent.parent / ".preview"
OUT.mkdir(exist_ok=True)
ROOT = Path(__file__).resolve().parent.parent

errors = []
bridge = None

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME)
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(f"{BASE}?game=gomoku", wait_until="load")
        page.wait_for_timeout(1200)
        page.click("#roomBtn")
        page.wait_for_timeout(300)
        page.click("#roomCreate")
        page.wait_for_timeout(1400)
        code = page.locator("#roomCodeValue").inner_text().strip()
        print("room:", code)

        bridge = subprocess.Popen(
            ["node", "scripts/mcp-bridge.mjs", "--room", code, "--level", "normal", "--quiet"],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        box = page.locator("#boardCanvas").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(600)
        print("after human move:", page.locator("#moveCount").inner_text())

        for _ in range(12):
            page.wait_for_timeout(500)
            if page.locator("#moveCount").inner_text().strip() == "2":
                break

        moves = page.locator("#moveCount").inner_text().strip()
        print("after bridge reply:", moves, "|", page.locator("#turnInfo").inner_text())
        assert moves == "2", f"AI did not answer in time (moves={moves})"

        page.screenshot(path=str(OUT / "13-room-vs-ai.png"))
        print("page errors:", errors)
        assert not errors, errors
        browser.close()
finally:
    if bridge:
        bridge.terminate()
        try:
            bridge.wait(timeout=5)
        except subprocess.TimeoutExpired:
            bridge.kill()

print("live room + MCP bridge: human move → AI answers → page updates automatically")