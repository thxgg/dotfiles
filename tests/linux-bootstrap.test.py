"""Offline Linux bootstrap checks. Run: python3 tests/linux-bootstrap.test.py

Extract functions and selection blocks. Never source the Arch entrypoint.
All package, network, shell, runtime, and service commands are mocked.
"""

import os
from pathlib import Path
import re
import select
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "linux/setup.sh").read_text()
ZSH = shutil.which("zsh")
FUNCTIONS = dict(re.findall(r"^([a-zA-Z_][a-zA-Z_0-9]*)\(\) \{\n(.*?)^\}", SOURCE, re.M | re.S))
DEFINITIONS = "\n".join(f"{name}() {{\n{body}}}" for name, body in FUNCTIONS.items())
GUARDED_COMMANDS = (
    "sudo", "pacman", "systemctl", "yay", "curl", "bash", "fish", "chsh",
    "pipx", "vp", "getent", "install", "find", "kill",
)
GUARDS = "\n".join(
    f'{name}() {{ print -r -- "UNEXPECTED {name} $*" >&2; exit 90; }}'
    for name in GUARDED_COMMANDS
)


@unittest.skipUnless(ZSH, "zsh is required")
class LinuxBootstrapTests(unittest.TestCase):
    def run_zsh(self, body, *, tty=False):
        script = "\n".join((
            "set -euo pipefail", "DRY_RUN=0", "unique_packages=()",
            DEFINITIONS, GUARDS, body,
        ))
        with tempfile.TemporaryDirectory(prefix="linux-bootstrap-test-") as home:
            env = {
                "PATH": "/usr/bin:/bin", "HOME": home, "VP_HOME": f"{home}/.vite-plus",
                "USER": "bootstrap-test", "SHELL": "/bin/zsh",
            }
            if not tty:
                return subprocess.run(
                    [ZSH, "-f", "-c", script], env=env, text=True,
                    capture_output=True, timeout=10,
                )

            # Both descriptors must be terminals for the provider transition.
            master, slave = os.openpty()
            try:
                result = subprocess.run(
                    [ZSH, "-f", "-c", script], env=env, stdin=slave,
                    stdout=slave, stderr=slave, timeout=10,
                )
                # Keep the slave open while draining. macOS can discard queued
                # terminal output when the final slave descriptor closes.
                chunks = []
                while select.select([master], [], [], 0.1)[0]:
                    chunk = os.read(master, 4096)
                    if not chunk:
                        break
                    chunks.append(chunk)
                result.stdout = b"".join(chunks).decode().replace("\r\n", "\n")
                result.stderr = ""
                return result
            finally:
                os.close(slave)
                os.close(master)

    def assert_ok(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("UNEXPECTED", result.stdout + result.stderr)

    def test_missing_units_skip_enable_and_disable_on_empty_success(self):
        result = self.run_zsh('''
            systemctl() {
                [[ "$1" == list-unit-files ]] || exit 91
                return 0
            }
            enable_service absent.service
            disable_service absent.service
        ''')
        self.assert_ok(result)
        self.assertEqual(result.stdout.count("Service not found, skipping: absent.service"), 2)

    def test_existing_unit_is_disabled(self):
        result = self.run_zsh('''
            systemctl() { print 'tailscaled.service enabled enabled'; }
            sudo() { print -r -- "CALL sudo $*"; }
            disable_service tailscaled.service
        ''')
        self.assert_ok(result)
        self.assertIn("CALL sudo systemctl disable --now tailscaled.service", result.stdout)

    def test_existing_unit_is_enabled(self):
        result = self.run_zsh('''
            systemctl() {
                if [[ "$1" == list-unit-files ]]; then
                    print 'docker.service disabled disabled'
                else
                    print disabled
                    return 1
                fi
            }
            sudo() { print -r -- "CALL sudo $*"; }
            enable_service docker.service
        ''')
        self.assert_ok(result)
        self.assertIn("CALL sudo systemctl enable --now docker.service", result.stdout)

    def test_alias_is_started_without_enable(self):
        result = self.run_zsh('''
            systemctl() {
                if [[ "$1" == list-unit-files ]]; then
                    print 'redis.service alias -'
                else
                    print alias
                fi
            }
            sudo() { print -r -- "CALL sudo $*"; }
            enable_service redis.service
        ''')
        self.assert_ok(result)
        self.assertIn("CALL sudo systemctl start redis.service", result.stdout)
        self.assertNotIn("CALL sudo systemctl enable", result.stdout)

    def test_service_failure_stops_setup(self):
        for action in ("enable", "disable"):
            with self.subTest(action=action):
                result = self.run_zsh(f'''
                    systemctl() {{ print 'example.service enabled enabled'; }}
                    sudo() {{ return 7; }}
                    {action}_service example.service
                    print continued
                ''')
                self.assertEqual(result.returncode, 7)
                self.assertNotIn("continued", result.stdout)

    def test_service_changes_follow_selected_packages(self):
        cases = {
            "": [],
            "fish": [],
            "docker": ["enable docker.service"],
            "redis": ["enable redis.service"],
            "valkey": ["enable valkey.service"],
            "tailscale": ["disable tailscaled.service"],
            "postgresql18": ["init postgresql18", "enable postgresql18.service"],
            "postgresql": ["enable postgresql.service"],
            "docker redis valkey tailscale": [
                "enable docker.service", "enable valkey.service",
                "enable redis.service", "disable tailscaled.service",
            ],
        }
        for packages, expected in cases.items():
            with self.subTest(packages=packages):
                result = self.run_zsh(f'''
                    unique_packages=({packages})
                    enable_service() {{ print -r -- "CALL enable $1"; }}
                    disable_service() {{ print -r -- "CALL disable $1"; }}
                    initialize_postgresql18_cluster() {{ print 'CALL init postgresql18'; }}
                    configure_fish_shell() {{ :; }}
                    ensure_vite_plus_node() {{ :; }}
                    pipx() {{ [[ "$*" == ensurepath ]]; }}
                    run_postinstall_setup
                ''')
                self.assert_ok(result)
                calls = [line.removeprefix("CALL ") for line in result.stdout.splitlines() if line.startswith("CALL ")]
                self.assertEqual(calls, expected)

    def test_redis_alias_selection_only_starts_valkey(self):
        result = self.run_zsh('''
            packages=(redis)
            pacman() { [[ "$*" == '-Si valkey' ]]; }
            normalize_package_aliases
            unique_packages=(${(u)packages})
            DRY_RUN=1
            run_postinstall_setup
        ''')
        self.assert_ok(result)
        self.assertIn("sudo systemctl enable --now valkey.service", result.stdout)
        self.assertNotIn("redis.service", result.stdout)

    def node_conflict_script(self, sudo_result=0):
        return f'''
            unique_packages=(heroku-cli)
            pacman() {{
                case "$*" in
                    -Qq) print nodejs-lts-jod ;;
                    '-Q nodejs') return 1 ;;
                    *) print -r -- "UNEXPECTED pacman $*" >&2; exit 91 ;;
                esac
            }}
            sudo() {{ print -r -- "CALL sudo $*"; return {sudo_result}; }}
            reconcile_nodejs_provider_conflict
            print continued
        '''

    def test_node_provider_uses_one_interactive_transaction(self):
        result = self.run_zsh(self.node_conflict_script(), tty=True)
        self.assert_ok(result)
        calls = [line for line in result.stdout.splitlines() if line.startswith("CALL ")]
        self.assertEqual(calls, ["CALL sudo pacman -S --needed nodejs npm"], repr(result.stdout))
        self.assertIn("continued", result.stdout)
        self.assertNotIn("-Rdd", SOURCE)
        self.assertNotIn("--noconfirm", FUNCTIONS["reconcile_nodejs_provider_conflict"])

    def test_failed_node_transaction_stops_setup(self):
        result = self.run_zsh(self.node_conflict_script(sudo_result=8), tty=True)
        self.assertEqual(result.returncode, 8, result.stdout)
        self.assertNotIn("continued", result.stdout)
        self.assertEqual(result.stdout.count("CALL sudo"), 1, repr(result.stdout))

    def test_noninteractive_node_conflict_only_prints_safe_instructions(self):
        result = self.run_zsh(self.node_conflict_script())
        self.assertEqual(result.returncode, 1)
        self.assertIn("sudo pacman -S --needed nodejs npm", result.stderr)
        self.assertNotIn("CALL sudo", result.stdout)
        self.assertNotIn("continued", result.stdout)
        self.assertNotIn("-Rdd", result.stdout + result.stderr)

    def test_unselected_heroku_does_not_query_or_change_node(self):
        result = self.run_zsh('''
            unique_packages=(docker)
            reconcile_nodejs_provider_conflict
        ''')
        self.assert_ok(result)

    def test_node_transition_skips_when_no_lts_or_current_node_is_installed(self):
        for provider, current_installed in (("", False), ("nodejs-lts-jod", True)):
            with self.subTest(provider=provider, current_installed=current_installed):
                result = self.run_zsh(f'''
                    unique_packages=(heroku-cli)
                    pacman() {{
                        if [[ "$1" == -Qq ]]; then
                            print -r -- '{provider}'
                        else
                            return {0 if current_installed else 1}
                        fi
                    }}
                    reconcile_nodejs_provider_conflict
                ''')
                self.assert_ok(result)

    def test_virtualization_with_default_and_explicit_profiles(self):
        parser = SOURCE.split('while [[ $# -gt 0 ]]; do\n', 1)[1].split('\nif [[ ! -f /etc/arch-release ]]', 1)[0]
        parser = 'while [[ $# -gt 0 ]]; do\n' + parser
        resolution = SOURCE.split('if [[ ${#PROFILES[@]} -eq 0 ]]; then\n', 1)[1].split('\npackages=()', 1)[0]
        resolution = 'if [[ ${#PROFILES[@]} -eq 0 ]]; then\n' + resolution
        cases = {
            "": ["core-cli", "core-apps", "desktop-hyprland"],
            "--with-virtualization": ["core-cli", "core-apps", "desktop-hyprland", "virtualization"],
            "--profiles core-cli": ["core-cli"],
            "--profiles core-cli --with-virtualization": ["core-cli", "virtualization"],
            "--with-virtualization --profiles core-cli": ["core-cli", "virtualization"],
            "--profiles core-cli,virtualization --with-virtualization": ["core-cli", "virtualization"],
        }
        for args, expected in cases.items():
            with self.subTest(args=args):
                result = self.run_zsh(f'''
                    PROFILES=()
                    WITH_VIRTUALIZATION=0
                    set -- {args}
                    {parser}
                    {resolution}
                    printf '%s\\n' "${{PROFILES[@]}}"
                ''')
                self.assert_ok(result)
                self.assertEqual(result.stdout.splitlines(), expected)

    def test_dry_run_previews_all_postinstall_steps_without_commands(self):
        result = self.run_zsh('''
            DRY_RUN=1
            unique_packages=(docker redis valkey tailscale postgresql18 postgresql)
            run_postinstall_setup
        ''')
        self.assert_ok(result)
        for command in (
            "sudo systemctl enable --now docker.service",
            "sudo systemctl enable --now redis.service",
            "sudo systemctl enable --now valkey.service",
            "sudo systemctl disable --now tailscaled.service",
            "sudo install -d -m 700 -o postgres -g postgres /var/lib/postgres",
            "sudo -u postgres /opt/postgresql18/bin/initdb -D /var/lib/postgres/data18",
            "sudo systemctl enable --now postgresql18.service",
            "sudo systemctl enable --now postgresql.service",
            'chsh -s "$(command -v fish)"',
            "curl -fsSL https://vite.plus | env VP_NODE_MANAGER=yes bash",
            'vp_bin="$(command -v vp || printf \'%s\' "${VP_HOME:-$HOME/.vite-plus}/bin/vp")"',
            'VP_NODE_MANAGER=yes "$vp_bin" env setup --refresh',
            '"$vp_bin" env on',
            '"$vp_bin" env install 14',
            '"$vp_bin" env install lts',
            '"$vp_bin" env default lts',
            "pipx ensurepath",
        ):
            with self.subTest(command=command):
                self.assertIn(command, result.stdout)
        self.assertNotIn("env install 17", result.stdout)
        self.assertNotIn("open-computer-use", result.stdout)
        self.assertNotIn("ampcode.com/install.sh", result.stdout)

    def test_dry_run_unselected_services_are_not_previewed(self):
        result = self.run_zsh('''
            DRY_RUN=1
            unique_packages=(fish)
            run_postinstall_setup
        ''')
        self.assert_ok(result)
        self.assertNotIn("sudo systemctl", result.stdout)
        self.assertNotIn("initdb", result.stdout)
        self.assertIn("pipx ensurepath", result.stdout)

    def test_dry_run_entrypoint_exits_before_installation(self):
        # Run only the final execution block, without Arch checks or manifests.
        execution = SOURCE.rsplit('\nif [[ $DRY_RUN -eq 1 ]]; then\n', 1)[1]
        result = self.run_zsh('''
            DRY_RUN=1
            unique_packages=(fish)
        ''' + '\nif [[ $DRY_RUN -eq 1 ]]; then\n' + execution)
        self.assert_ok(result)
        self.assertIn("yay -S --needed --noconfirm --answerclean N --answerdiff N --answeredit N fish", result.stdout)
        self.assertIn("Dry run complete", result.stdout)
        self.assertNotIn("Linux setup complete", result.stdout)


if __name__ == "__main__":
    unittest.main()
