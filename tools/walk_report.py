"""The chapter report of a browser auto-play run (docs/superpowers/specs/2026-10-20-browser-walk-design.md §5.7).

    python3 -I tools/walk_report.py <run-dir>

reads <run-dir>/manifest.json and shots/*.png, makes thumbnails with macOS `sips` into thumbs/ (skipped when sips is missing),
and writes report.html (local: flagged frames first, then one thumbnail grid per chapter, each linking to its PNG) and
summary.html (self-contained for sharing: thumbnails and the flagged frames embedded, kept under 16 MB). Standard library only.
"""
import base64
import html
import json
import shutil
import subprocess
import sys
from pathlib import Path

SUMMARY_LIMIT = 16 * 1024 * 1024
FLAG_LABEL = {'error': '오류', 'warn': '경고', 'blank': '빈 화면', 'overflow': '창 밖', 'stuck': '멈춤'}


def load_manifest(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def chapters(shots):
    """Shots grouped by battle number (0 = the opening and the first town, n = the n-th battle and what follows it)."""
    out = {}
    for s in shots:
        out.setdefault(s['battle'], []).append(s)
    return out


def chapter_title(n):
    return '시작과 첫 마을' if n == 0 else f'전투 {n}'


def fmt_t(ms):
    s = ms // 1000
    return f'{s // 60}:{s % 60:02d}'


def make_thumbs(run, shots):
    """thumbs/<file>.jpg via sips -Z 160; None when sips is not available."""
    if not shutil.which('sips'):
        return None
    tdir = run / 'thumbs'; tdir.mkdir(exist_ok=True)
    out = {}
    for s in shots:
        src = run / 'shots' / s['file']
        if not src.is_file():
            continue
        dst = tdir / (Path(s['file']).stem + '.jpg')
        if not dst.is_file():
            r = subprocess.run(['sips', '-Z', '160', '-s', 'format', 'jpeg', '-s', 'formatOptions', '70', str(src), '--out', str(dst)], capture_output=True)
            if r.returncode != 0:
                continue
        out[s['file']] = f'thumbs/{dst.name}'
    return out


def data_url(path):
    p = Path(path)
    mime = 'image/jpeg' if p.suffix.lower() in ('.jpg', '.jpeg') else 'image/png'
    return f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode('ascii')


STYLE = """
:root { --bg: #f6f4ef; --fg: #1d1a16; --muted: #6b655c; --card: #fffdf8; --line: #d9d3c7; --accent: #8a3b12; --bad: #b3261e; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #15130f; --fg: #ede8df; --muted: #9b948a; --card: #1f1c17; --line: #3a352d; --accent: #e7a06a; --bad: #ff8a80; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #15130f; --fg: #ede8df; --muted: #9b948a; --card: #1f1c17; --line: #3a352d; --accent: #e7a06a; --bad: #ff8a80; color-scheme: dark; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; padding-block: 24px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
main { max-width: 1100px; margin: 0 auto; } h1 { font-size: 22px; margin: 0 0 4px; text-wrap: balance; } h2 { font-size: 16px; margin: 28px 0 8px; color: var(--accent); }
.sum { display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); } .sum b { color: var(--fg); }
.flags { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.flags figure { margin: 0; background: var(--card); border: 1px solid var(--line); padding: 6px; } .flags img { width: 100%; height: auto; display: block; image-rendering: pixelated; }
.lost { color: var(--bad); font-size: 12px; margin: 24px 0; text-align: center; }
.flags figcaption { color: var(--bad); font-size: 12px; margin-top: 4px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
.grid a { display: block; background: var(--card); border: 1px solid var(--line); padding: 3px; color: inherit; text-decoration: none; min-width: 0; }
.grid img { width: 100%; height: auto; display: block; } .grid small { display: block; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.grid a.flagged { border-color: var(--bad); } .ok { color: #2e7d32; } .bad { color: var(--bad); }
"""


def render_report(manifest, thumbs, inline, per_chapter=None):
    """The HTML. thumbs: file → relative thumbnail path (None = use the PNGs scaled). inline embeds images as data URLs (summary.html)."""
    run, shots, counts = manifest['run'], manifest['shots'], manifest.get('counts', {})
    flagged = [s for s in shots if s.get('flags')]
    errors = [c for c in manifest.get('console', []) if c['kind'] == 'error']
    def src(s, thumb):
        d = manifest.get('_dir')
        if d is not None and not (Path(d) / 'shots' / s['file']).is_file():
            return None                                                        # the harvester skipped this shot (a capture failed twice)
        rel = thumbs.get(s['file']) if (thumbs and thumb) else f"shots/{s['file']}"
        return data_url(Path(d) / rel) if inline else rel
    def img(s, thumb, lazy=False):
        u = src(s, thumb)
        return (f'<img src="{u}" alt="{html.escape(cap(s))}"' + (' loading="lazy"' if lazy else '') + '>') if u else '<p class="lost">사진 없음 (수집기가 건너뜀)</p>'
    def cap(s):
        return f"{s['tag']} · {fmt_t(s['t'])} · stage {s['stage']}" + (f" · turn {s['turn']}" if s['turn'] is not None else '')
    parts = ['<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>브라우저 워크 보고</title>',
             f'<style>{STYLE}</style></head><body><main>', '<h1>브라우저 자동 플레이 — 렌더링 검증</h1>']
    status = '끝까지 갔다' if run.get('done') and not run.get('stopped') else f"멈춤: {run.get('stopped')}"
    cls = 'ok' if run.get('done') and not run.get('stopped') and not errors else 'bad'
    parts.append('<div class="sum">' + ' '.join([
        f"<span>시작 <b>{html.escape(str(run.get('startedAt', '')))}</b></span>", f"<span>씨앗 <b>{run.get('seed')}</b></span>",
        f"<span>프레임 <b>{run.get('frames', 0):,}</b></span>", f"<span>가상 시간 <b>{fmt_t(run.get('simulatedMs', 0))}</b></span>",
        f"<span>사진 <b>{len(shots)}장</b></span>", f"<span>장 <b>{len(chapters(shots))}</b></span>",
        f"<span>걸린 프레임 <b>{len(flagged)}</b></span>", f"<span>오류 <b>{len(errors)}</b></span>", f'<span class="{cls}"><b>{status}</b></span>']) + '</div>')
    if counts:
        parts.append('<div class="sum">' + ' '.join(f"<span>{html.escape(k)} <b>{v}</b></span>" for k, v in sorted(counts.items())) + '</div>')
    parts.append(f'<h2>걸린 프레임 ({len(flagged)})</h2>')
    if flagged:
        parts.append('<div class="flags">' + ''.join(
            f'<figure>{img(s, False)}<figcaption>{html.escape(", ".join(FLAG_LABEL.get(f.replace("flag-", ""), f) for f in s["flags"]))} — {html.escape(cap(s))} — {html.escape(s["file"])}'
            + (f'<br><code>{html.escape(s["note"])}</code>' if s.get('note') else '') + '</figcaption></figure>'
            for s in flagged) + '</div>')
    else:
        parts.append('<p class="ok">없음</p>')
    if errors:
        parts.append('<h2>콘솔 오류</h2><ul>' + ''.join(f'<li>{html.escape(c["text"])}</li>' for c in errors[:50]) + '</ul>')
    for n, group in sorted(chapters(shots).items()):
        shown = group if per_chapter is None else group[:per_chapter]
        parts.append(f'<h2>{chapter_title(n)} <small>({len(group)}장)</small></h2><div class="grid">' + ''.join(
            f'<a href="shots/{s["file"]}" class="{"flagged" if s.get("flags") else ""}">{img(s, True, lazy=True)}<small>{html.escape(cap(s))}</small></a>'
            for s in shown) + '</div>' + (f'<p class="sum">… {len(group) - len(shown)}장 더 (report.html)</p>' if len(shown) < len(group) else ''))
    parts.append('</main></body></html>')
    return '\n'.join(parts)


def main(argv):
    if len(argv) != 1:
        print(__doc__); return 2
    run = Path(argv[0]).resolve()
    manifest = load_manifest(run / 'manifest.json'); manifest['_dir'] = str(run)
    thumbs = make_thumbs(run, manifest['shots'])
    (run / 'report.html').write_text(render_report(manifest, thumbs, inline=False), encoding='utf-8')
    for cap in (None, 12, 6, 3, 0):
        summary = render_report(manifest, thumbs, inline=True, per_chapter=cap)
        if len(summary.encode('utf-8')) <= SUMMARY_LIMIT:
            break
    (run / 'summary.html').write_text(summary, encoding='utf-8')
    flagged = sum(1 for s in manifest['shots'] if s.get('flags'))
    print(f"{run / 'report.html'}\n{run / 'summary.html'} ({len(summary) // 1024} KB)\n{len(manifest['shots'])} pictures, {flagged} flagged, thumbnails {'yes' if thumbs else 'no (sips missing)'}")
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
