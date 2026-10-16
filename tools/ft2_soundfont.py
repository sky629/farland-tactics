"""Download a General MIDI SoundFont for the web remake's music (spessasynth_lib plays SF2/SF3).

    python3 -I tools/ft2_soundfont.py web/public/assets [--url URL] [--sha256 HEX]

Default: FluidR3Mono_GM.sf3 (MIT, 13.9 MiB) from the MuseScore 2.1 git tag → <assets>/sf2/gm.sf3, verified by SHA-256.
An existing copy with the right hash is kept; a copy with a wrong hash is fetched again. --sha256 '' skips the check.
The file lives outside the repository (web/public/assets is git-ignored). Nothing else is installed.
"""
import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

DEFAULT_URL = 'https://github.com/musescore/MuseScore/raw/2.1/share/sound/FluidR3Mono_GM.sf3'
DEFAULT_SHA256 = 'cfcd66d89e8386823400eca64934b14fbea7bf48ba1f00d21189af1262794ec2'   # the 2.1 tag is immutable; confirmed by two downloads


class SoundfontError(Exception):
    pass


def _matches(path: Path, sha256: str | None) -> bool:
    return not sha256 or hashlib.sha256(path.read_bytes()).hexdigest().lower() == sha256.lower()


def fetch_soundfont(url: str, assets: Path, sha256: str | None) -> Path:
    """Fetch `url` into <assets>/sf2/gm.sf3 unless a copy with the expected hash is already there (mismatch removes the file)."""
    dest = assets / 'sf2' / 'gm.sf3'
    if dest.exists() and _matches(dest, sha256):
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix('.part')
    with urllib.request.urlopen(url) as r, tmp.open('wb') as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    if not _matches(tmp, sha256):
        tmp.unlink()
        raise SoundfontError('sha256 mismatch: the downloaded file is not the expected soundfont')
    tmp.replace(dest)
    return dest


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('assets', type=Path, help='web/public/assets')
    ap.add_argument('--url', default=DEFAULT_URL)
    ap.add_argument('--sha256', default=DEFAULT_SHA256, help="expected hash; '' to skip the check")
    a = ap.parse_args(argv[1:])
    try:
        out = fetch_soundfont(a.url, a.assets, a.sha256 or None)
    except (SoundfontError, OSError) as e:                                     # URLError/HTTPError are OSErrors
        print(f'error: {e}', file=sys.stderr)
        return 1
    print(f'{out} ({out.stat().st_size} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
