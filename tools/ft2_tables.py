#!/usr/bin/env python3
"""Dump the fixed-record data tables of Farland Tactics 2 (DATA\\*.dat) as JSON.

Record sizes come from the loader FUN_0041eab0 (race 86 B, item 56 B, magic 64 B) and
the stage loader FUN_0041fcf0 (28 B). Each record starts with a CP949 name padded to 20 B.
Field names marked f_N are not yet identified.

Usage: python3 -I ft2_tables.py GAME_DIR [race|item|magic|stage|desc] > out.json
"""
import json
import struct
import sys
from pathlib import Path

# climb_max / drop_max: height-step limits (FUN_00439b40); cost_land0..7: move cost per
# terrain `land` byte, 99 = impassable; the move budget is a fixed 30 (FUN_00439690/FUN_0041f410).
# exp_value, elem0..2, size, spell0..3: battle code (FUN_0043a2e0, FUN_0043b4a0, FUN_0041f7c0).
RACE_FIELDS = (['exp_value', 'hp', 'hp_up', 'mp', 'mp_up', 'str', 'str_up', 'def', 'def_up',
                'wis', 'wis_up', 'mgr', 'mgr_up', 'agi', 'agi_up', 'elem0', 'elem1', 'elem2',
                'size', 'climb_max', 'drop_max']
               + [f'cost_land{i}' for i in range(8)] + ['spell0', 'spell1', 'spell2', 'spell3'])
# item.dat layout from the equipment/use code (FUN_0043b4a0, FUN_00438d70):
ITEM_FIELDS = ['price', 'hp_heal', 'mp_heal', 'atk', 'def', 'wis', 'mgr', 'agi', 'elem0', 'elem1',
               'elem2', 'range_min', 'range_max', 'slot', 'use_effect', 'weapon_type', 'status_code',
               'race_mask']
# magic.dat numeric layout (FUN_0043b4a0, FUN_00438d70): learn level, MP cost (<= 0 → physical skill),
# three element powers, min/max range.
MAGIC_NUM_FIELDS = ['learn_level', 'mp_cost', 'elem0', 'elem1', 'elem2', 'range_min', 'range_max']
STAGE_FIELDS = ['unit_id', 'race', 'level', 'f_3', 'c', 'c_hi', 'r', 'r_hi', 'side', 'f_9',
                'f_10', 'f_11', 'f_12', 'f_13']  # c and r are i32 (FUN_0041fae0 copies them as dwords)


def name(b: bytes) -> str:
    return b.split(b'\0')[0].decode('cp949', 'replace')


def records(data: bytes, size: int):
    for i in range(len(data) // size):
        yield data[i * size:(i + 1) * size]


def race(data: bytes):
    for r in records(data, 86):
        vals = struct.unpack('<33h', r[20:])
        yield dict(name=name(r[:20]), **dict(zip(RACE_FIELDS, vals)))


def item(data: bytes):
    # slot: 0 weapon, 1 armor, 2 accessory, 3 consumable. weapon_type: 0 single, 1 line, 2 T-shape, 3 bow.
    for r in records(data, 56):
        vals = struct.unpack('<18h', r[20:])
        yield dict(name=name(r[:20]), **dict(zip(ITEM_FIELDS, vals)))


def magic(data: bytes):
    # target: 0 enemies, 1 allies, 2 all. shape (FUN_00438d70): 0 single cell, 1 radius by level,
    # 2 line, 3 all units within min..max of the caster, 4 whole map, 5 cross (unused).
    for r in records(data, 64):
        nums = struct.unpack('<7h', r[20:34])
        effect_no, target, shape, learn_mask = struct.unpack_from('<hhhH', r, 0x2e)
        yield dict(name=name(r[:20]), **dict(zip(MAGIC_NUM_FIELDS, nums)),
                   effect=name(r[0x22:0x2e]), effect_no=effect_no, target=target, shape=shape,
                   learn_mask=learn_mask, short=name(r[0x36:64]))


def stage(data: bytes):
    for r in records(data, 28):
        yield dict(zip(STAGE_FIELDS, struct.unpack('<14h', r)))


def descriptions(data: bytes):
    """*com.dat: 256 u32 offsets then CP949 texts (one per record of the matching table)."""
    offsets = struct.unpack_from('<256I', data, 0)
    out = []
    for i, o in enumerate(offsets):
        if not o:
            out.append('')
            continue
        end = next((x for x in offsets[i + 1:] if x), len(data))
        out.append(data[o:end].split(b'\0')[0].decode('cp949', 'replace'))
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        raise SystemExit(__doc__)
    game = Path(argv[1])
    which = argv[2] if len(argv) > 2 else 'all'
    data_dir = game / 'DATA'
    out = {}
    if which in ('race', 'all'):
        out['race'] = list(race((data_dir / 'race.dat').read_bytes()))
    if which in ('item', 'all'):
        out['item'] = list(item((data_dir / 'item.dat').read_bytes()))
    if which in ('magic', 'all'):
        out['magic'] = list(magic((data_dir / 'magic.dat').read_bytes()))
    if which in ('desc', 'all'):
        out['desc'] = {k: descriptions((data_dir / f'{k}com.dat').read_bytes()) for k in ('race', 'item', 'magic')}
    if which in ('stage', 'all'):
        out['stage'] = {p.stem: list(stage(p.read_bytes()))
                        for p in sorted(data_dir.glob('STAGE*.dat'))}
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
