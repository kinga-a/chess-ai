"""Browser smoke test + screenshots for the chess hall. Run: python3 scripts/ui-check.py"""
import asyncio
import json
import os
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE", "http://localhost:8788")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".preview")
os.makedirs(OUT, exist_ok=True)

errors = []
console = []


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path='/root/.cache/ms-playwright/chromium-1243/chrome-linux/chrome', args=['--no-sandbox'])
        page = await browser.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("console", lambda msg: console.append((msg.type, msg.text)) if msg.type in ("error", "warning") else None)

        await page.goto(BASE + "/", wait_until="networkidle")
        await page.wait_for_timeout(2200)
        await page.screenshot(path=os.path.join(OUT, "01-lobby-desktop.png"), full_page=True)

        title = await page.title()
        cards = await page.locator(".game-card").count()
        hero_visible = await page.locator(".hero-copy h1").is_visible()
        print(f"lobby: title={title!r} cards={cards} hero={hero_visible}")

        # Enter Gomoku
        await page.locator('.game-card[data-open="gomoku"]').click()
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "02-gomoku-start.png"))

        box = await page.locator("#boardCanvas").bounding_box()
        pad = box["width"] * 0.082
        grid = (box["width"] - pad * 2) / 14
        cx = box["x"] + pad + 7 * grid
        cy = box["y"] + pad + 7 * grid
        await page.mouse.click(cx, cy)
        await page.wait_for_timeout(1800)
        moves = await page.locator("#moveCount").inner_text()
        turn = await page.locator("#turnSide b").inner_text()
        info = await page.locator("#turnInfo").inner_text()
        print(f"gomoku after click: moves={moves} turn={turn!r} info={info!r}")
        await page.screenshot(path=os.path.join(OUT, "03-gomoku-playing.png"))

        # Back to lobby, enter Chess
        await page.locator("#backBtn").click()
        await page.wait_for_timeout(600)
        await page.locator('.game-card[data-open="chess"]').click()
        await page.wait_for_timeout(900)
        await page.screenshot(path=os.path.join(OUT, "04-chess-start.png"))

        box = await page.locator("#boardCanvas").bounding_box()
        cell = min(box["width"] / 9.8, box["height"] / 11.4)
        mx = (box["width"] - 8 * cell) / 2
        my = (box["height"] - 9 * cell) / 2

        def pt(r, c):
            return box["x"] + mx + c * cell, box["y"] + my + r * cell

        # Red cannon b2 (row 7, col 1) -> b1 (row 8, col 1)
        x, y = pt(7, 1)
        await page.mouse.click(x, y)
        await page.wait_for_timeout(350)
        x, y = pt(8, 1)
        await page.mouse.click(x, y)
        await page.wait_for_timeout(2200)
        moves = await page.locator("#moveCount").inner_text()
        turn = await page.locator("#turnSide b").inner_text()
        ev = await page.locator("#evalText").inner_text()
        print(f"chess after move: moves={moves} turn={turn!r} eval={ev!r}")
        await page.screenshot(path=os.path.join(OUT, "05-chess-playing.png"))

        # MCP modal
        await page.locator("#openMcp").click()
        await page.wait_for_timeout(500)
        await page.screenshot(path=os.path.join(OUT, "06-mcp-modal.png"))
        modal_visible = await page.locator("#mcpModal").evaluate("el => el.classList.contains('open')")
        endpoint = await page.locator("#mcpEndpointFull").inner_text()
        print(f"mcp modal open={modal_visible} endpoint={endpoint}")
        await page.keyboard.press("Escape")

        # Mobile layout
        mobile = await browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        mobile.on("pageerror", lambda exc: errors.append("mobile: " + str(exc)))
        await mobile.goto(BASE + "/", wait_until="networkidle")
        await mobile.wait_for_timeout(1800)
        await mobile.screenshot(path=os.path.join(OUT, "07-lobby-mobile.png"), full_page=True)
        await mobile.locator('.game-card[data-open="chess"]').click()
        await mobile.wait_for_timeout(900)
        await mobile.screenshot(path=os.path.join(OUT, "08-chess-mobile.png"))

        # URL deep link
        deep = await browser.new_page(viewport={"width": 1280, "height": 900})
        await deep.goto(BASE + "/?game=gomoku", wait_until="networkidle")
        await deep.wait_for_timeout(1200)
        deep_ok = await deep.locator("#view-game").evaluate("el => el.classList.contains('is-active')")
        print(f"deep link ?game=gomoku active={deep_ok}")

        await browser.close()

    print("\nconsole warnings/errors:", json.dumps(console[:20], ensure_ascii=False, indent=2))
    print("page errors:", errors)
    if errors:
        raise SystemExit(1)


asyncio.run(main())