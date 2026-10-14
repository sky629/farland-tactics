#!/usr/bin/env python3
"""Export Farland Tactics 2 maps and sprites for the web renderer.

Usage: python3 -I tools/ft2_export.py GAME_DIR OUT_DIR
Writes OUT_DIR/index.json, OUT_DIR/map/<name>.json|.png, OUT_DIR/sprite/<name>.json|.png.
Names are lower-case stems. PNGs are 8-bit indexed with the palette and no transparency;
the renderer applies color keys (docs/superpowers/specs/2026-10-14-rendering-foundation-design.md §5, §6).
Exit code 1 when an error was reported. Missing referenced files are warnings.
"""
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # keep sibling imports working under -I
from ft2_apd import parse as parse_apd  # noqa: E402
from ft2_map import parse as parse_map  # noqa: E402
from ft2_szdd import bmp8_to_png, szdd_decompress  # noqa: E402

FORMAT = 1


def normalize_name(raw: str) -> str:
    """'Char_01g.bmp..' -> 'char_01g'. Keeps the text before the first '.bmp'; garbage may follow it."""
    low = raw.lower()
    cut = low.find('.bmp')
    return low[:cut] if cut >= 0 else low


def map_json(m: dict) -> dict:
    n = m['w'] + m['h'] - 1
    cell_at = [-1] * (n * n)
    for key, idx in m['grid'].items():
        c, r = (int(v) for v in key.split(','))
        cell_at[c * n + r] = idx
    cells = [dict(h=c['height'], blocked=c['blocked'], flag2=c['flag2'], land=c['land'],
                  objs=[dict(layer=o['layer'], front=o['front'], left=o['left'], top=o['top'],
                             right=o['right'], bottom=o['bottom'], ox=o['ox'], oy=o['oy']) for o in c['objects']])
             for c in m['cells']]
    return dict(w=m['w'], h=m['h'], bg=normalize_name(m['bg']) if m['bg'] else None,
                layers=[normalize_name(s) for s in m['layers']], start=list(m['start']), origin=list(m['origin']),
                pixelSize=list(m['pixel_size']), cells=cells, cellAt=cell_at)


def apd_json(d: dict) -> dict:
    return dict(version=d['version'], sheets=[normalize_name(s) for s in d['sheets']],
                images=[dict(sheet=i['sheet'], key=i['key'], x=i['x'], y=i['y'], w=i['w'], h=i['h'], ox=i['ox'], oy=i['oy'])
                        for i in d['images']],
                patterns=[dict(yOffset=p['y_offset'], images=p['images']) for p in d['patterns']],
                anims=[dict(name=a['name'], script=a['script']) for a in d['anims']])


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, msg: str) -> None:
        self.errors.append(msg)

    def warn(self, msg: str) -> None:
        self.warnings.append(msg)


def load_bmp(path: Path) -> bytes:
    data = path.read_bytes()
    return szdd_decompress(data) if data[:4] == b'SZDD' else data


def export_bmps(src: Path, dst: Path, report: Report) -> dict[str, tuple[int, int]]:
    """Convert every BMP in src to dst/<lowercase stem>.png. Returns name -> (width, height)."""
    sizes: dict[str, tuple[int, int]] = {}
    dst.mkdir(parents=True, exist_ok=True)
    for p in sorted(src.iterdir()):
        if p.suffix.lower() != '.bmp':
            continue
        name = p.stem.lower()
        if name in sizes:
            report.error(f'{src.name}/{p.name}: name collision after lowercasing')
            continue
        bmp = load_bmp(p)
        try:
            png = bmp8_to_png(bmp)
        except ValueError as e:
            report.error(f'{src.name}/{p.name}: {e}')
            continue
        (dst / f'{name}.png').write_bytes(png)
        w, h = struct.unpack_from('<ii', bmp, 18)
        sizes[name] = (w, abs(h))
    return sizes


def rect_inside(left: int, top: int, right: int, bottom: int, size: tuple[int, int]) -> bool:
    return 0 <= left <= right <= size[0] and 0 <= top <= bottom <= size[1]


def export_maps(game: Path, out: Path, report: Report) -> list[str]:
    sizes = export_bmps(game / 'Map', out / 'map', report)
    names = []
    for p in sorted((game / 'Map').iterdir()):
        if p.suffix.lower() != '.map':
            continue
        j = map_json(parse_map(p.read_bytes()))
        name = p.stem.lower()
        if j['bg'] and j['bg'] not in sizes:
            report.warn(f'{p.name}: background {j["bg"]}.bmp not found')
        for layer in j['layers']:
            if layer not in sizes:
                report.warn(f'{p.name}: layer {layer}.bmp not found')
        for idx, cell in enumerate(j['cells']):
            for o in cell['objs']:
                if o['layer'] >= len(j['layers']):
                    report.error(f'{p.name}: cell {idx} object layer {o["layer"]} >= {len(j["layers"])}')
                    continue
                size = sizes.get(j['layers'][o['layer']])
                if size and not rect_inside(o['left'], o['top'], o['right'], o['bottom'], size):
                    report.error(f'{p.name}: cell {idx} object rect outside {j["layers"][o["layer"]]} {size}')
        (out / 'map' / f'{name}.json').write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
        names.append(name)
    return names


def export_sprites(game: Path, out: Path, report: Report) -> list[str]:
    sizes = export_bmps(game / 'Sprite', out / 'sprite', report)
    names = []
    for p in sorted((game / 'Sprite').iterdir()):
        if p.suffix.lower() != '.apd':
            continue
        j = apd_json(parse_apd(p.read_bytes()))
        name = p.stem.lower()
        if name in names:
            report.error(f'Sprite/{p.name}: name collision after lowercasing')
            continue
        for sheet in j['sheets']:
            if sheet not in sizes:
                report.warn(f'{p.name}: sheet {sheet}.bmp not found')
        for idx, im in enumerate(j['images']):
            if im['sheet'] >= len(j['sheets']):
                report.error(f'{p.name}: image {idx} sheet {im["sheet"]} >= {len(j["sheets"])}')
                continue
            size = sizes.get(j['sheets'][im['sheet']])
            if size and not rect_inside(im['x'], im['y'], im['x'] + im['w'], im['y'] + im['h'], size):
                report.error(f'{p.name}: image {idx} rect outside sheet {size}')
        for idx, pat in enumerate(j['patterns']):
            if any(i >= len(j['images']) for i in pat['images']):
                report.error(f'{p.name}: pattern {idx} image index >= {len(j["images"])}')
        (out / 'sprite' / f'{name}.json').write_text(json.dumps(j, ensure_ascii=False), encoding='utf-8')
        names.append(name)
    return names


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    game, out = Path(argv[1]), Path(argv[2])
    report = Report()
    maps = export_maps(game, out, report)
    sprites = export_sprites(game, out, report)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.json').write_text(json.dumps(dict(format=FORMAT, maps=maps, sprites=sprites)), encoding='utf-8')
    pngs = sum(1 for d in ('map', 'sprite') for _ in (out / d).glob('*.png'))
    print(f'maps {len(maps)}, sprites {len(sprites)}, pngs {pngs}, warnings {len(report.warnings)}, errors {len(report.errors)}')
    for w in report.warnings:
        print('warning:', w)
    for e in report.errors:
        print('error:', e)
    return 1 if report.errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
