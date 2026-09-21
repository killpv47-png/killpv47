import asyncio, sys
from playwright.async_api import async_playwright
async def main():
    w,h = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv)>3 else (1440, 900)
    out = sys.argv[1] if len(sys.argv)>1 else '/tmp/shot.png'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':w,'height':h}, device_scale_factor=1)
        errs=[]; pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: errs.append(m.type+': '+m.text) if m.type in ('error',) else None)
        await pg.goto('http://localhost:3000', wait_until='networkidle', timeout=90000)
        for a in sys.argv[4:]:
            await pg.click(a); await pg.wait_for_timeout(600)
        await pg.wait_for_timeout(int(sys.argv[5]) if False else 6000)
        await pg.screenshot(path=out)
        print('errors:', errs[:10])
        await b.close()
asyncio.run(main())
