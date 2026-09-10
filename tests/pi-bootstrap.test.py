"""Offline bootstrap checks. Run: python3 tests/pi-bootstrap.test.py"""

from pathlib import Path
import json
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://github.com/earendil-works/pi-transcribe@"


class PiBootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="pi bootstrap ")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.home = self.base / "home"
        self.home.mkdir()
        self.bin = self.base / "bin"
        self.bin.mkdir()
        # Do not inherit shell startup hooks or live Pi configuration.
        self.env = {
            "HOME": str(self.home),
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "PI_CODING_AGENT_DIR": str(self.home / ".pi/agent"),
            "PI_TRANSCRIBE_FFMPEG_PATH": str(self.bin / "ffmpeg"),
            "VP_HOME": str(self.home / ".vite-plus"),
            "CALL_LOG": str(self.base / "calls"),
        }
        for name in ("pi", "ffmpeg"):
            self.executable(self.bin / name, '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CALL_LOG"\n')
        self.helper = self.base / "install-pi-packages.zsh"
        shutil.copyfile(ROOT / "scripts/install-pi-packages.zsh", self.helper)
        self.manifest = self.base / "package.json"
        self.manifest.write_text(json.dumps({"piPackages": [SOURCE + "abc"],
                                             "dependencies": {"example": "^1.0.0"}}))
        jq = shutil.which("jq")
        if not jq:
            self.skipTest("jq is required")
        (self.bin / "jq").symlink_to(jq)

    def executable(self, path, content):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        path.chmod(0o755)

    def run_zsh(self, *args):
        return subprocess.run(["zsh", "-f", *map(str, args)], env=self.env,
                              text=True, capture_output=True, timeout=5)

    def test_manifest_registers_git_and_npm_dependencies(self):
        result = self.run_zsh(self.helper, self.manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(self.env["CALL_LOG"]).read_text().splitlines(),
                         ["install", SOURCE + "abc", "install", "npm:example@^1.0.0"])

    def test_invalid_manifest_has_no_install_side_effects(self):
        for data in ("invalid json", '{"piPackages": [], "dependencies": {}}',
                     '{"piPackages": ["https://example.test/repo@abc"], "dependencies": {"bad": false}}'):
            with self.subTest(data=data):
                self.manifest.write_text(data)
                result = self.run_zsh(self.helper, self.manifest)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(Path(self.env["CALL_LOG"]).exists())

    def test_vite_fallback(self):
        fallback = Path(self.env["VP_HOME"]) / "bin/pi"
        fallback.parent.mkdir(parents=True)
        shutil.move(self.bin / "pi", fallback)
        result = self.run_zsh(self.helper, self.manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(Path(self.env["CALL_LOG"]).read_text().splitlines(),
                         ["install", SOURCE + "abc", "install", "npm:example@^1.0.0"])

    def test_install_failure_stops_before_next_package(self):
        self.executable(self.bin / "pi", '#!/bin/sh\nprintf "%s\\n" "$@" >> "$CALL_LOG"\nexit 7\n')
        result = self.run_zsh(self.helper, self.manifest)
        self.assertEqual(result.returncode, 7)
        self.assertNotIn("npm:example", Path(self.env["CALL_LOG"]).read_text())
        self.assertNotIn("[OK]", result.stdout)

    def test_runtime_exclusions_do_not_hide_portable_files(self):
        result = self.run_zsh("-c", '''
            source "$1"
            for item in .pi/agent/pi-transcribe.json .pi/agent/git/github.com/example/index.ts .pi/.pi/agent/pi-transcribe.json; do
                dotfiles_is_pi_runtime_path "$item" || exit 1
                dotfiles_is_stow_ignored_path "$item" || exit 2
            done
            for item in .pi/agent/keybindings.json .pi/agent/extensions/example/index.ts .pi/agent/npm/package.json; do
                if dotfiles_is_pi_runtime_path "$item"; then exit 3; fi
            done
        ''', "test", ROOT / "scripts/lib/stow-roots.zsh")
        self.assertEqual(result.returncode, 0, result.stderr)

    def health(self):
        return self.run_zsh("-c", '''
            print_status() { printf '%s %s\\n' "$1" "$2"; }
            source "$1"
            dotfiles_check_pi_transcribe "$2"
        ''', "test", ROOT / "scripts/lib/pi-transcribe.zsh", self.manifest)

    def test_health_missing_package_and_configuration(self):
        result = self.health()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("FFmpeg is available", result.stdout)
        self.assertIn("package is missing", result.stdout)
        self.assertIn("not configured", result.stdout)

    def test_health_installed_package_and_model_states(self):
        import json
        agent = Path(self.env["PI_CODING_AGENT_DIR"])
        package = agent / "git/github.com/earendil-works/pi-transcribe"
        (package / "node_modules").mkdir(parents=True)
        (package / "package.json").write_text("{}")
        self.executable(self.bin / "git", '#!/bin/sh\nprintf "abc\\n"\n')
        self.manifest.write_text(json.dumps({"piPackages": [SOURCE + "abc"], "dependencies": {}}))
        (agent / "settings.json").write_text(json.dumps({"packages": [{"source": SOURCE + "abc"}]}))
        model = self.base / "local model.gguf"
        config = agent / "pi-transcribe.json"
        config.write_text(json.dumps({"model": {"path": str(model)}}))
        result = self.health()
        self.assertIn("installed at the declared commit", result.stdout)
        self.assertIn("model file is missing", result.stdout)
        model.touch()
        self.assertIn("model file exists", self.health().stdout)
        config.write_text("invalid json")
        self.assertIn("model path is invalid", self.health().stdout)
        (self.bin / "ffmpeg").unlink()
        self.assertIn("needs FFmpeg", self.health().stdout)


if __name__ == "__main__":
    unittest.main()
