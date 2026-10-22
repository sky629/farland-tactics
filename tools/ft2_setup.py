#!/usr/bin/env python3
"""One command from the original game files to a running web remake: extract the .egg archives (when given), export the web
assets, fetch the GM soundfont, install the web dependencies and, with --run, start the dev server.

Usage: python3 -I tools/ft2_setup.py [SOURCE] [--force] [--run]
  SOURCE   a volume of the .egg set (any volume, or the folder holding them), or an installed / extracted game folder
           (FT2.exe + DATA). Without it: *.vol1.egg in the repository root, else extracted/FarlandTactics2.
  --force  export the assets again even though web/public/assets/index.json exists
  --run    start `npm run dev` at the end (http://localhost:5173/play.html)

The exported assets are committed in this repository, so a plain clone needs only `cd web && npm install && npm run dev`.
This tool makes them again from the original files, or completes a clone that has none. Standard library only.
"""
from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

GAME_DIR = Path('extracted') / 'FarlandTactics2'          # where ft2_unegg.py's output is renamed to
UNEGG_DIR = Path('extracted') / 'FarlandTactics2_Package.vol1'
ASSETS = Path('web') / 'public' / 'assets'
WEB = Path('web')
MIN_NODE = 22                                            # Vite 8 / Vitest 5 (docs/manual.md §2)


class SetupError(Exception):
    pass


@dataclass(frozen=True)
class Step:
    name: str
    argv: tuple[str, ...]
    cwd: Path | None = None


def _looks_like_game(d: Path) -> bool:
    return d.is_dir() and ((d / 'DATA').is_dir() or any(f.name.lower() == 'ft2.exe' for f in d.iterdir()))


def _first_volume(egg: Path) -> Path:
    m = re.match(r'(.*)\.vol\d+\.egg$', egg.name, re.IGNORECASE)
    first = egg.parent / f'{m.group(1)}.vol1.egg' if m else egg
    if not first.exists():
        raise SetupError(f'{egg} 와 같은 묶음의 첫 권({first.name})이 없습니다. .egg 18권이 한 폴더에 있어야 합니다.')
    return first


def detect_source(path: Path | None, root: Path) -> tuple[str, Path]:
    """('egg', first volume) or ('game', folder) from what the user pointed at, else from the repository root."""
    if path is None:
        eggs = sorted(root.glob('*.vol1.egg'))
        if eggs:
            return 'egg', eggs[0]
        if _looks_like_game(root / GAME_DIR):
            return 'game', root / GAME_DIR
        raise SetupError('원작 파일을 찾지 못했습니다. .egg 첫 권이나 게임 폴더(FT2.exe + DATA)의 경로를 주십시오.')
    if path.is_file():
        if path.suffix.lower() != '.egg':
            raise SetupError(f'{path} 는 .egg 아카이브가 아닙니다.')
        return 'egg', _first_volume(path)
    if path.is_dir():
        eggs = sorted(path.glob('*.vol1.egg'))
        if eggs:
            return 'egg', eggs[0]
        if _looks_like_game(path):
            return 'game', path
        if _looks_like_game(path / 'FarlandTactics2'):
            return 'game', path / 'FarlandTactics2'
        raise SetupError(f'{path} 에서 .egg 묶음도 게임 폴더(FT2.exe + DATA)도 찾지 못했습니다.')
    raise SetupError(f'{path} 가 없습니다.')


def plan(*, root: Path, kind: str, source: Path, have_game: bool, have_assets: bool, force: bool, run: bool) -> list[Step]:
    py = (sys.executable, '-I')
    tools = root / 'tools'
    steps: list[Step] = []
    game = source if kind == 'game' else root / GAME_DIR
    if kind == 'egg' and not have_game:
        steps.append(Step('extract', (*py, str(tools / 'ft2_unegg.py'), str(source), str(root / 'extracted'))))
    if force or not have_assets:
        steps.append(Step('export', (*py, str(tools / 'ft2_export.py'), str(game), str(root / ASSETS))))
    steps.append(Step('soundfont', (*py, str(tools / 'ft2_soundfont.py'), str(root / ASSETS))))
    steps.append(Step('npm install', ('npm', 'install'), root / WEB))
    if run:
        steps.append(Step('npm run dev', ('npm', 'run', 'dev'), root / WEB))
    return steps


def _check_node() -> None:
    if shutil.which('node') is None or shutil.which('npm') is None:
        raise SetupError(f'Node.js {MIN_NODE} 이상과 npm 이 필요합니다 (https://nodejs.org).')
    out = subprocess.run(['node', '--version'], capture_output=True, text=True, check=False).stdout.strip()
    m = re.match(r'v(\d+)', out)
    if not m or int(m.group(1)) < MIN_NODE:
        raise SetupError(f'Node.js {MIN_NODE} 이상이 필요합니다 (지금 {out or "없음"}).')


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('source', nargs='?', type=Path, help='.egg 권(또는 그 폴더) 또는 게임 폴더')
    ap.add_argument('--force', action='store_true', help='자산을 다시 내보낸다')
    ap.add_argument('--run', action='store_true', help='끝나면 npm run dev 를 실행한다')
    a = ap.parse_args(argv[1:])
    root = Path(__file__).resolve().parents[1]
    try:
        _check_node()
        kind, source = detect_source(a.source, root)
        have_game = kind == 'game' or _looks_like_game(root / GAME_DIR)
        have_assets = (root / ASSETS / 'index.json').exists()
        steps = plan(root=root, kind=kind, source=source, have_game=have_game, have_assets=have_assets, force=a.force, run=a.run)
    except SetupError as e:
        print(f'오류: {e}', file=sys.stderr)
        return 2
    print(f'원작: {kind} {source}')
    print('단계: ' + ' → '.join(s.name for s in steps))
    for s in steps:
        print(f'\n▶ {s.name}: {" ".join(s.argv)}' + (f'  (cwd {s.cwd})' if s.cwd else ''), flush=True)
        r = subprocess.run(list(s.argv), cwd=s.cwd, check=False)
        if r.returncode != 0:
            print(f'오류: {s.name} 단계가 코드 {r.returncode} 로 끝났습니다.', file=sys.stderr)
            return r.returncode
        if s.name == 'extract' and (root / UNEGG_DIR).is_dir() and not (root / GAME_DIR).exists():
            (root / UNEGG_DIR).rename(root / GAME_DIR)
            print(f'{UNEGG_DIR} → {GAME_DIR}')
    if not a.run:
        print(f'\n준비가 끝났습니다. 실행: cd {WEB} && npm run dev   →  http://localhost:5173/play.html')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
