#!/usr/bin/env python3
"""Export Farland Tactics 2 maps and sprites for the web renderer.

Usage: python3 -I tools/ft2_export.py GAME_DIR OUT_DIR
Writes OUT_DIR/index.json, OUT_DIR/map/<name>.json|.png, OUT_DIR/sprite/<name>.json|.png,
OUT_DIR/data/{race,item,magic}.json, data/roster/stageNNN.json, data/battles.json,
data/eventNN.json (decoded scripts), bmp/<name>.png (all bitmaps).
Names are lower-case stems. PNGs are 8-bit indexed with the palette and no transparency;
the renderer applies color keys (docs/superpowers/specs/2026-10-14-rendering-foundation-design.md §5, §6).
Exit code 1 when an error was reported. Missing referenced files are warnings.
"""
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # keep sibling imports working under -I
from ft2_apd import parse as parse_apd  # noqa: E402
from ft2_map import parse as parse_map  # noqa: E402
from ft2_event_disasm import decode_program, disassemble  # noqa: E402
from ft2_szdd import bmp8_to_png, szdd_decompress  # noqa: E402
from ft2_tables import item as parse_item, magic as parse_magic, race as parse_race, stage as parse_stage  # noqa: E402

FORMAT = 1
INSTR = re.compile(r'^\s+0x[0-9a-f]+: (\w+)(?: (.*))?$')
STRING = re.compile(r'"([^"]*)"')
ROSTER_FIELDS = ('unit_id', 'race', 'level', 'dir', 'c', 'r', 'status', 'side', 'weapon', 'armor', 'drop_item', 'drop_gold')


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
                layers=[normalize_name(s) for s in m['layers']], bgOrigin=[m['bg_offset'][0] * 32, m['bg_offset'][1] * 16], bgParallax=list(m['parallax']), origin=list(m['origin']),
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


def event_json(program: dict) -> dict:
    """Web form of a decoded event file: symbols by name, EXT instructions flattened to their sub-opcode name."""
    code = []
    for ins in program["code"]:
        code.append({"at": ins["at"], "op": ins.get("sub") or ins["op"], "args": ins["args"]})
    return {"symbols": {name: off for name, off in program["symbols"]}, "code": code}


def export_events(game: Path, out: Path, report: Report) -> list[int]:
    """DATA/EVENTnn.dat → data/eventnn.json (structured decode). Returns the stage numbers."""
    data_dir = next((p for p in game.iterdir() if p.is_dir() and p.name.lower() == 'data'), None)
    if data_dir is None:
        report.error('no DATA directory')
        return []
    (out / 'data').mkdir(parents=True, exist_ok=True)
    stages: list[int] = []
    for p in sorted(data_dir.iterdir()):
        m = re.fullmatch(r'event(\d\d)\.dat', p.name.lower())
        if not m:
            continue
        program = decode_program(p.read_bytes())
        for err in program['stats']['errors']:
            report.error(f'{p.name}: {err}')
        (out / 'data' / f'event{m.group(1)}.json').write_text(json.dumps(event_json(program), ensure_ascii=False), encoding='utf-8')
        stages.append(int(m.group(1)))
    return stages


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


def battles_from_listing(lines: list[str], event: int) -> tuple[list[dict], list[str]]:
    """One BattleEntry per BATTLE_START(_HEAL): the last LOAD_MAP/LOAD_UNITS/EPISODE/MESSAGE seen since the previous battle.

    The context deliberately survives label boundaries: EVENT01 sets the EPISODE and EVENT03 loads map and units in the
    label that then JUMPs to `battle_start`. It resets after every BATTLE_START."""
    entries, warnings = [], []
    label, ctx = '', {}
    for line in lines:
        if line.endswith(':') and not line.startswith(' '):
            label = line[:-1]
            continue
        m = INSTR.match(line)
        if not m:
            continue
        name, args = m.group(1), m.group(2) or ''
        if name in ('LOAD_MAP', 'LOAD_UNITS'):
            ctx[name] = int(args)
        elif name in ('EPISODE', 'MESSAGE'):
            s = STRING.search(args)
            ctx[name] = s.group(1).replace('_', ' ') if s else ''
        elif name in ('BATTLE_START', 'BATTLE_START_HEAL'):
            if 'LOAD_MAP' not in ctx or 'LOAD_UNITS' not in ctx:
                warnings.append(f'EVENT{event:02d} {label}: BATTLE_START without LOAD_MAP/LOAD_UNITS')
                continue
            entries.append(dict(event=event, label=label, map=f'stage{ctx["LOAD_MAP"]:02d}', roster=ctx['LOAD_UNITS'],
                                episode=ctx.get('EPISODE', ''), objective=ctx.get('MESSAGE', ''),
                                heal=name == 'BATTLE_START_HEAL'))
            ctx = {}
    return entries, warnings


def roster_json(records) -> list[dict]:
    return [{k: r[k] for k in ROSTER_FIELDS} for r in records]


def export_data(game: Path, out: Path, report: Report) -> dict:
    """Tables, rosters and the battle catalog -> OUT/data. Returns counts."""
    data_dir, roster_dir = out / 'data', out / 'data' / 'roster'
    roster_dir.mkdir(parents=True, exist_ok=True)
    tables = {}
    for name, parser in (('race', parse_race), ('item', parse_item), ('magic', parse_magic)):
        tables[name] = list(parser((game / 'DATA' / f'{name}.dat').read_bytes()))
        (data_dir / f'{name}.json').write_text(json.dumps(tables[name], ensure_ascii=False), encoding='utf-8')
    rosters = {}
    for p in sorted(game.joinpath('DATA').iterdir()):
        mm = re.fullmatch(r'stage(\d{3})\.dat', p.name.lower())
        if not mm:
            continue
        recs = roster_json(parse_stage(p.read_bytes()))
        for i, r in enumerate(recs):
            if not (0 <= r['race'] < len(tables['race'])):
                report.error(f'{p.name}: unit {i} race {r["race"]} out of range')
            for k in ('weapon', 'armor', 'drop_item'):
                if not (0 <= r[k] < len(tables['item'])):
                    report.error(f'{p.name}: unit {i} {k} {r[k]} out of range')
            if not (1 <= r['level'] <= 99) or not (0 <= r['side'] <= 7):
                report.error(f'{p.name}: unit {i} level {r["level"]} or side {r["side"]} out of range')
        n = int(mm.group(1))
        rosters[n] = recs
        (roster_dir / f'stage{n:03d}.json').write_text(json.dumps(recs), encoding='utf-8')
    battles = []
    for ev in range(0, 18):
        p = game / 'DATA' / f'EVENT{ev:02d}.dat'
        if not p.exists():
            continue
        _, _, lines, _, _ = disassemble(p.read_bytes())
        entries, warnings = battles_from_listing(lines, ev)
        for w in warnings:
            report.warn(w)
        for e in entries:
            if e['roster'] not in rosters:
                report.error(f'EVENT{ev:02d} {e["label"]}: roster {e["roster"]} missing')
            if not (game / 'Map' / f'{e["map"]}.map').exists() and not (game / 'Map' / f'{e["map"].upper()}.MAP').exists():
                report.error(f'EVENT{ev:02d} {e["label"]}: map {e["map"]} missing')
        battles.extend(entries)
    (data_dir / 'battles.json').write_text(json.dumps(battles, ensure_ascii=False), encoding='utf-8')
    return dict(race=len(tables['race']), item=len(tables['item']), magic=len(tables['magic']), rosters=len(rosters), battles=len(battles))


def export_audio(src: Path, dst: Path, report: Report) -> dict:
    """Wave/*.wav → wave/<lower>.wav and Midi/bgm%02d.mid (GM only; the _gs variants and back.lzh are skipped) → midi/.
    Returns {'wave': [names], 'midi': [numbers]} for index.json."""
    def find_dir(name: str) -> Path | None:
        if not src.is_dir():
            return None
        return next((p for p in src.iterdir() if p.is_dir() and p.name.lower() == name), None)
    waves: list[str] = []
    midis: list[int] = []
    wave_dir, midi_dir = find_dir('wave'), find_dir('midi')
    if wave_dir is None:
        report.error('no Wave directory')
    else:
        (dst / 'wave').mkdir(parents=True, exist_ok=True)
        for f in sorted(wave_dir.iterdir()):
            if f.suffix.lower() != '.wav':
                continue
            name = f.stem.lower()
            (dst / 'wave' / f'{name}.wav').write_bytes(f.read_bytes())
            waves.append(name)
    if midi_dir is None:
        report.error('no Midi directory')
    else:
        (dst / 'midi').mkdir(parents=True, exist_ok=True)
        for f in sorted(midi_dir.iterdir()):
            m = re.fullmatch(r'bgm(\d\d)\.mid', f.name.lower())
            if not m:
                continue
            (dst / 'midi' / f'bgm{m.group(1)}.mid').write_bytes(f.read_bytes())
            midis.append(int(m.group(1)))
    return {'wave': sorted(waves), 'midi': sorted(midis)}


def export_visual(src: Path, dst: Path, report: Report) -> int:
    """DATA/vsllst.dat (30-B records: u16 scene, u16 step, u16 slot, char[16] name, u16 loaded, u16[3] palette params)
    → data/visual.json [{scene, step, slot, name(lower), pal}]. Returns the record count."""
    data_dir = src / 'DATA'
    lst = next((p for p in data_dir.iterdir() if p.name.lower() == 'vsllst.dat'), None) if data_dir.is_dir() else None
    if lst is None:
        report.error('no DATA/vsllst.dat')
        return 0
    raw = lst.read_bytes()
    records = []
    for i in range(len(raw) // 30):
        r = raw[i * 30:(i + 1) * 30]
        scene, step, slot = struct.unpack_from('<HHH', r, 0)
        name = r[6:22].split(b'\0')[0].decode('ascii', 'replace').lower()
        records.append(dict(scene=scene, step=step, slot=slot, name=name, pal=list(struct.unpack_from('<HHH', r, 24))))
    (dst / 'data').mkdir(parents=True, exist_ok=True)
    (dst / 'data' / 'visual.json').write_text(json.dumps(records), encoding='utf-8')
    return len(records)


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit(__doc__)
    game, out = Path(argv[1]), Path(argv[2])
    report = Report()
    maps = export_maps(game, out, report)
    sprites = export_sprites(game, out, report)
    counts = export_data(game, out, report)
    events = export_events(game, out, report)
    bmp_dir = next((p for p in game.iterdir() if p.is_dir() and p.name.lower() == 'bmp'), None)
    bmps = sorted(export_bmps(bmp_dir, out / 'bmp', report)) if bmp_dir else []
    if bmp_dir is None:
        report.error('no bmp directory')
    audio = export_audio(game, out, report)
    visual = export_visual(game, out, report)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.json').write_text(json.dumps(dict(format=FORMAT, maps=maps, sprites=sprites, data=True, events=events, bmp=bmps, wave=audio['wave'], midi=audio['midi'])), encoding='utf-8')
    pngs = sum(1 for d in ('map', 'sprite', 'bmp') for _ in (out / d).glob('*.png'))
    print(f'maps {len(maps)}, sprites {len(sprites)}, events {len(events)}, bmp {len(bmps)}, pngs {pngs}, wave {len(audio["wave"])}, midi {len(audio["midi"])}, visual {visual}, warnings {len(report.warnings)}, errors {len(report.errors)}')
    print(f'tables race {counts["race"]}, item {counts["item"]}, magic {counts["magic"]}, rosters {counts["rosters"]}, battles {counts["battles"]}')
    for w in report.warnings:
        print('warning:', w)
    for e in report.errors:
        print('error:', e)
    return 1 if report.errors else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv))
