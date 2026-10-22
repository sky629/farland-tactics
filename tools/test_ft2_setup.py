"""Tests for ft2_setup.py: where the game comes from and which steps a fresh clone needs."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ft2_setup as setup  # noqa: E402


class DetectSource(unittest.TestCase):
    def test_a_folder_of_egg_archives_names_its_first_volume(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for n in (1, 2, 3): (root / f'파랜드택틱스2.vol{n}.egg').write_bytes(b'')
            self.assertEqual(setup.detect_source(root, root), ('egg', root / '파랜드택틱스2.vol1.egg'))

    def test_any_volume_of_the_set_points_at_the_first(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for n in (1, 7): (root / f'game.vol{n}.egg').write_bytes(b'')
            self.assertEqual(setup.detect_source(root / 'game.vol7.egg', root), ('egg', root / 'game.vol1.egg'))

    def test_an_installed_game_folder_is_used_as_it_is(self):
        with tempfile.TemporaryDirectory() as d:
            game = Path(d) / 'FT2'; (game / 'DATA').mkdir(parents=True); (game / 'FT2.exe').write_bytes(b'')
            self.assertEqual(setup.detect_source(game, Path(d)), ('game', game))

    def test_nothing_given_looks_in_the_repo_root_then_in_extracted(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with self.assertRaises(setup.SetupError): setup.detect_source(None, root)
            game = root / 'extracted' / 'FarlandTactics2'; (game / 'DATA').mkdir(parents=True)
            self.assertEqual(setup.detect_source(None, root), ('game', game))
            (root / 'x.vol1.egg').write_bytes(b'')
            self.assertEqual(setup.detect_source(None, root), ('egg', root / 'x.vol1.egg'))


class Plan(unittest.TestCase):
    root = Path('/repo')

    def names(self, **kw):
        return [s.name for s in setup.plan(root=self.root, **kw)]

    def test_a_fresh_clone_with_the_archives_extracts_exports_fetches_the_soundfont_and_installs(self):
        self.assertEqual(self.names(kind='egg', source=Path('/eggs/a.vol1.egg'), have_game=False, have_assets=False, force=False, run=False),
                         ['extract', 'export', 'soundfont', 'npm install'])

    def test_an_existing_extraction_or_a_game_folder_skips_the_extraction(self):
        self.assertEqual(self.names(kind='egg', source=Path('/eggs/a.vol1.egg'), have_game=True, have_assets=False, force=False, run=False), ['export', 'soundfont', 'npm install'])
        self.assertEqual(self.names(kind='game', source=Path('/FT2'), have_game=True, have_assets=False, force=False, run=False), ['export', 'soundfont', 'npm install'])

    def test_exported_assets_are_kept_unless_forced(self):
        self.assertEqual(self.names(kind='game', source=Path('/FT2'), have_game=True, have_assets=True, force=False, run=False), ['soundfont', 'npm install'])
        self.assertEqual(self.names(kind='game', source=Path('/FT2'), have_game=True, have_assets=True, force=True, run=False), ['export', 'soundfont', 'npm install'])

    def test_run_starts_the_dev_server_last_and_the_steps_name_their_paths(self):
        steps = setup.plan(root=self.root, kind='egg', source=Path('/eggs/a.vol1.egg'), have_game=False, have_assets=False, force=False, run=True)
        self.assertEqual(steps[-1].name, 'npm run dev')
        self.assertEqual(steps[-1].cwd, self.root / 'web')
        self.assertEqual(steps[0].argv[-2:], ('/eggs/a.vol1.egg', str(self.root / 'extracted')))
        self.assertEqual(steps[1].argv[-2:], (str(self.root / 'extracted' / 'FarlandTactics2'), str(self.root / 'web' / 'public' / 'assets')))


if __name__ == '__main__':
    unittest.main()
