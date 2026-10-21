// The browser walk's picture harvester, run inside ego-browser's Node helper (docs/manual.md §7.10).
//
//   DIR=<run dir>; mkdir -p "$DIR/shots"
//   sed -e "s#__RUN_DIR__#$DIR#" -e "s#__WALK_URL__#http://localhost:5199/play.html?walk=1\&seed=7#" tools/walk_browser.mjs > "$DIR/round-01.mjs"
//   ego-browser nodejs < "$DIR/round-01.mjs"
//
// One harvester per page: the script keeps running inside ego's Node helper after the CLI exits, so a run is stopped by
// closing its tab, never by killing the CLI; two harvesters on one page would share its pictures. A shot that fails twice
// is skipped (the report shows "사진 없음"). The manifest is written every 100 shots and at the end.
const task = await taskSpace("ft2 browser walk");
const page = task.page("p1");
const fs = await import("node:fs/promises");
const DIR = "__RUN_DIR__";
await page.goto("__WALK_URL__");
const dpr = await page.evaluate(() => window.devicePixelRatio);
let n = 0, missed = 0, idle = 0; const t0 = Date.now();
for (let i = 0; i < 20000; i++) {
  await page.waitForFunction(() => window.__walk && (window.__walk.pending || window.__walk.done), undefined, { timeout: 1200000 });
  const p = await page.evaluate(() => window.__walk.pending ? { ...window.__walk.pending, rect: window.__walk.frameRect() } : null);
  if (!p) { const done = await page.evaluate(() => window.__walk.done); if (done || ++idle > 20) break; await page.waitForTimeout(200); continue; }
  idle = 0;
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    try {
      const shot = await page.cdp("Page.captureScreenshot", { format: "png", clip: { x: p.rect.x, y: p.rect.y, width: p.rect.width, height: p.rect.height, scale: 1 / dpr } });
      await fs.writeFile(`${DIR}/shots/${p.file}`, Buffer.from(shot.data, "base64")); ok = true; n++;
    } catch (e) { console.log(`shot ${p.file} attempt ${attempt + 1} failed: ${String(e).slice(0, 120)}`); }
  }
  if (!ok) missed++;
  if (n % 100 === 0) { const m = await page.evaluate(() => window.__walk.manifest()); await fs.writeFile(`${DIR}/manifest.json`, JSON.stringify(m, null, 1)); console.log(`${n} shots (${missed} missed), ${Math.round((Date.now() - t0) / 1000)} s, virtual ${Math.round(m.run.simulatedMs / 1000)} s, battle ${m.shots.at(-1)?.battle}, counts ${JSON.stringify(m.counts)}`); }
  await page.evaluate(() => window.__walk.resume());
}
const m = await page.evaluate(() => window.__walk.manifest());
await fs.writeFile(`${DIR}/manifest.json`, JSON.stringify(m, null, 1));
console.log({ saved: n, missed, shots: m.shots.length, done: m.run.done, stopped: m.run.stopped, counts: m.counts, frames: m.run.frames, simulatedMs: m.run.simulatedMs, errors: m.console.filter((c) => c.kind === "error").slice(0, 5), warns: m.console.filter((c) => c.kind === "warn").slice(0, 8), wall: Math.round((Date.now() - t0) / 1000) });
