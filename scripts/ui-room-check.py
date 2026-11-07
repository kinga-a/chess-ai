"""
Two-browser live-room check: create, join, exchange moves, see them sync.
Run: python3 scripts/ui-room-check.py
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8788"
CHROME = "/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome"
OUT = Path(__file__).resolve().parent.parent / ".preview"
OUT.mkdir(exist_ok=True)

errors = []


def click_board(page, fx=0.5, fy=0.5):
    box = page.locator("#boardCanvas").bounding_box()
    page.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)
    host = browser.new_context(viewport={"width": 1280, "height": 860}).new_page()
    guest = browser.new_context(viewport={"width": 1280, "height": 860}).new_page()
    host.on("pageerror", lambda e: errors.append(f"host: {e}"))
    guest.on("pageerror", lambda e: errors.append(f"guest: {e}"))

    host.goto(f"{BASE}?game=gomoku", wait_until="load")
    host.wait_for_timeout(1200)
    host.click("#roomBtn")
    host.wait_for_timeout(300)
    host.click("#roomCreate")
    host.wait_for_timeout(1400)
    code = host.locator("#roomCodeValue").inner_text().strip()
    assert len(code) == 6, f"bad room code: {code!r}"
    print("room code:", code)

    guest.goto(f"{BASE}?game=gomoku", wait_until="load")
    guest.wait_for_timeout(1200)
    guest.click("#roomBtn")
    guest.wait_for_timeout(300)
    guest.fill("#roomCodeInput", code)
    guest.click("#roomJoin")
    guest.wait_for_timeout(1600)
    assert guest.locator("#roomBadge").inner_text().find(code) >= 0, "guest should see the room badge"

    click_board(host)
    host.wait_for_timeout(800)
    guest.wait_for_timeout(2400)
    host_moves = host.locator("#moveCount").inner_text().strip()
    guest_moves = guest.locator("#moveCount").inner_text().strip()
    print("after host move:", host_moves, guest_moves)
    assert host_moves == guest_moves == "1", f"guest did not sync: {host_moves}/{guest_moves}"

    click_board(guest, 0.55)
    guest.wait_for_timeout(800)
    host.wait_for_timeout(2400)
    host_moves = host.locator("#moveCount").inner_text().strip()
    guest_moves = guest.locator("#moveCount").inner_text().strip()
    print("after guest move:", host_moves, guest_moves)
    assert host_moves == guest_moves == "2", f"host did not sync: {host_moves}/{guest_moves}"

    host.screenshot(path=str(OUT / "11-room-host.png"))
    guest.screenshot(path=str(OUT / "12-room-guest.png"))

    print("page errors:", errors)
    assert not errors, errors
    browser.close()

print("live room: create → join → host move → guest sees it → guest move → host sees it")