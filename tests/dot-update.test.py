"""Offline update tests with temporary Git repositories and mocked updaters."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'dot').read_text()
ZSH = shutil.which('zsh')
NVIM = 'common/.config/nvim/lazy-lock.json'
PI = 'common/.pi/agent/npm/package.json'


def function(name):
    return name + '() {' + SOURCE.split(name + '() {', 1)[1].split('\n}\n', 1)[0] + '\n}\n'


class UpdateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo with spaces'
        self.repo.mkdir()
        self.remote = self.root / 'remote.git'
        self.env = {
            'HOME': str(self.root), 'PATH': '/usr/bin:/bin',
            'TMPDIR': str(self.root), 'DOTFILES_DIR': str(self.repo),
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
            'GIT_TERMINAL_PROMPT': '0',
        }
        self.git('init', '-b', 'main')
        self.git('config', 'user.name', 'Update Test')
        self.git('config', 'user.email', 'update@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        for name in (NVIM, PI, 'unrelated.txt'):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('initial\n')
        self.git('add', '.')
        self.git('commit', '-m', 'test: initialize fixture')
        self.git('init', '--bare', str(self.remote))
        self.git('remote', 'add', 'origin', str(self.remote))
        self.git('push', '-u', 'origin', 'main')
        self.initial = self.git('rev-parse', 'HEAD')
        self.hooks = self.repo / '.githooks'
        self.hooks.mkdir()
        self.git('config', 'core.hooksPath', '.githooks')
        self.hook('pre-commit', 'printf "hook\\n" >> "$HOME/events"\n')

    def git(self, *args):
        result = subprocess.run(['git', '-C', str(self.repo), *args], env=self.env,
                                text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def hook(self, name, body):
        path = self.hooks / name
        path.write_text('#!/bin/sh\n' + body)
        path.chmod(0o755)

    def remote_head(self):
        return self.git('--git-dir=' + str(self.remote), 'rev-parse', 'main')

    def run_update(self, *args, fail='', overrides=''):
        names = ('check_update_git', 'commit_dependency_updates',
                 'push_update_commits', 'update_repo', 'run_update_step', 'cmd_update')
        body = '''set -euo pipefail
UPDATE_VERBOSE=0
SCRIPT_NAME=dot
header() { :; }; info() { :; }; success() { :; }
warn() { print -r -- "$1"; }; error() { print -ru2 -- "$1"; }
command_exists() { command -v "$1" >/dev/null 2>&1; }
record() { print -r -- "$1" >> "$HOME/events"; [[ "$1" != "$FAIL_STEP" ]]; }
update_packages() { record packages; }
update_global_js_packages() { record global-js; }
cmd_stow() { record stow; }
update_nvim() {
 record nvim || return
 [[ "$NO_CHANGE" == 1 ]] || print updated > "$DOTFILES_DIR/common/.config/nvim/lazy-lock.json"
 return 0
}
update_pi() {
 record pi || return
 [[ "$NO_CHANGE" == 1 ]] || print updated > "$DOTFILES_DIR/common/.pi/agent/npm/package.json"
 return 0
}
update_codex() { record codex; }
update_claude() { record claude; }
update_t3() { record t3; }
update_herdr() { record herdr; }
'''
        body += '\n'.join(function(name) for name in names)
        body += '\n' + overrides + '\ncmd_update "$@"'
        return subprocess.run([ZSH, '-f', '-c', body, 'test', *args],
                              env={**self.env, 'FAIL_STEP': fail, 'NO_CHANGE': self.env.get('NO_CHANGE', '0')},
                              text=True, capture_output=True)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_commits_only_dependencies_preserves_index_and_pushes_last(self):
        (self.repo / 'unrelated.txt').write_text('staged\n')
        self.git('add', 'unrelated.txt')
        (self.repo / 'unrelated.txt').write_text('unstaged\n')
        (self.repo / 'new.txt').write_text('untracked\n')
        # Even a configured broad push must not publish another branch.
        self.git('branch', 'private-work')
        self.git('config', 'remote.origin.push', 'refs/heads/*:refs/heads/*')
        self.git('config', 'push.default', 'matching')
        self.git('config', 'push.followTags', 'true')
        self.git('tag', '-a', 'private-tag', '-m', 'Keep this tag local')
        self.hook('pre-push', 'printf "push\\n" >> "$HOME/events"\n')
        self.assert_success(self.run_update())
        self.assertEqual(self.git('log', '--format=%s', '-2').splitlines(), [
            'chore(pi): update dependencies', 'chore(nvim): update dependencies'])
        self.assertEqual(self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), PI)
        self.assertEqual(self.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD~1'), NVIM)
        self.assertEqual(self.git('show', ':unrelated.txt'), 'staged')
        self.assertEqual((self.repo / 'unrelated.txt').read_text(), 'unstaged\n')
        self.assertEqual((self.repo / 'new.txt').read_text(), 'untracked\n')
        self.assertEqual(self.remote_head(), self.git('rev-parse', 'HEAD'))
        refs = self.git('--git-dir=' + str(self.remote), 'for-each-ref', '--format=%(refname)')
        self.assertEqual(refs, 'refs/heads/main')
        self.assertEqual((self.root / 'events').read_text().splitlines(), [
            'stow', 'packages', 'global-js', 'nvim', 'hook', 'pi', 'hook',
            'codex', 'claude', 't3', 'herdr', 'push'])

    def test_stow_runs_after_pull_and_before_package_updates(self):
        (self.repo / 'pulled.txt').write_text('new upstream file\n')
        self.git('add', 'pulled.txt')
        self.git('commit', '-m', 'test: add upstream file')
        self.git('push')
        self.git('reset', '--hard', self.initial)
        (self.root / 'events').unlink()
        self.assert_success(self.run_update(overrides='''cmd_stow() {
 [[ -f "$DOTFILES_DIR/pulled.txt" ]] || return 17
 record stow
}'''))
        self.assertEqual((self.root / 'events').read_text().splitlines()[:3],
                         ['stow', 'packages', 'global-js'])

    def test_skip_stow_still_runs_other_updates(self):
        self.assert_success(self.run_update('--skip-stow'))
        events = (self.root / 'events').read_text().splitlines()
        self.assertNotIn('stow', events)
        self.assertEqual(events[:2], ['packages', 'global-js'])
        self.assertIn('herdr', events)

    def test_stow_failure_continues_updates_but_suppresses_push(self):
        result = self.run_update(fail='stow')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('failed step(s): stow', result.stderr)
        self.assertEqual(self.remote_head(), self.initial)
        events = (self.root / 'events').read_text().splitlines()
        self.assertEqual(events[:3], ['stow', 'packages', 'global-js'])
        self.assertIn('herdr', events)

    def test_verbose_mode_also_commits_and_pushes(self):
        self.assert_success(self.run_update('--verbose'))
        self.assertEqual(self.remote_head(), self.git('rev-parse', 'HEAD'))
        self.assertEqual(self.git('rev-list', '--count', self.initial + '..HEAD'), '2')

    def test_partial_dependency_failure_leaves_changes_uncommitted(self):
        result = self.run_update(overrides='''update_nvim() {
 print partial > "$DOTFILES_DIR/common/.config/nvim/lazy-lock.json"
 return 17
}''')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git('show', 'HEAD:' + NVIM), 'initial')
        self.assertEqual((self.repo / NVIM).read_text(), 'partial\n')
        self.assertEqual(self.remote_head(), self.initial)

    def test_no_changes_create_no_commits(self):
        self.env['NO_CHANGE'] = '1'
        self.assert_success(self.run_update())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)
        self.assertNotIn('hook', (self.root / 'events').read_text())

    def test_dirty_dependency_aborts_before_updates(self):
        for name in (NVIM, PI):
            for staged in (False, True):
                with self.subTest(name=name, staged=staged):
                    target = self.repo / name
                    target.write_text('existing work\n')
                    if staged:
                        self.git('add', name)
                    result = self.run_update()
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn('Dependency files have local changes', result.stderr)
                    self.assertFalse((self.root / 'events').exists())
                    self.assertEqual(target.read_text(), 'existing work\n')
                    self.git('restore', '--staged', '--worktree', name)

    def test_skip_commit_allows_dirty_dependencies_without_committing(self):
        (self.repo / NVIM).write_text('existing\n')
        self.assert_success(self.run_update('--skip-commit', '--skip-push'))
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)
        self.assertEqual((self.repo / NVIM).read_text(), 'updated\n')

    def test_skip_push_keeps_commits_local(self):
        self.assert_success(self.run_update('--skip-push'))
        self.assertEqual(self.remote_head(), self.initial)
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), self.initial)

    def test_skip_selected_updates_leaves_their_dirty_files_alone(self):
        (self.repo / NVIM).write_text('existing\n')
        self.assert_success(self.run_update('--skip-nvim', '--skip-codex', '--skip-claude', '--skip-t3'))
        self.assertEqual((self.repo / NVIM).read_text(), 'existing\n')
        events = (self.root / 'events').read_text().splitlines()
        self.assertTrue(all(name not in events for name in ('nvim', 'codex', 'claude', 't3')))
        self.assertEqual(self.git('rev-list', '--count', self.initial + '..HEAD'), '1')

    def test_skip_packages_still_updates_native_clis(self):
        self.assert_success(self.run_update('--skip-packages'))
        events = (self.root / 'events').read_text().splitlines()
        self.assertNotIn('packages', events)
        self.assertNotIn('global-js', events)
        self.assertTrue(all(name in events for name in ('codex', 'claude', 't3')))

    def test_failed_updater_keeps_successful_commits_local(self):
        result = self.run_update(fail='nvim')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('failed step(s): nvim', result.stderr)
        self.assertEqual(self.remote_head(), self.initial)
        self.assertEqual(self.git('log', '-1', '--format=%s'), 'chore(pi): update dependencies')
        self.assertEqual((self.repo / NVIM).read_text(), 'initial\n')
        self.assertIn('herdr', (self.root / 'events').read_text())

    def test_quiet_mode_keeps_desktop_restart_notice(self):
        result = self.run_update(overrides='''update_t3() {
 record t3
 print 'T3 desktop: quit and relaunch with t3code to use the new version'
}''')
        self.assert_success(result)
        self.assertIn('T3 desktop: quit and relaunch', result.stdout)

    def test_t3_failure_suppresses_push_but_continues(self):
        result = self.run_update(fail='t3')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('failed step(s): t3', result.stderr)
        self.assertEqual(self.remote_head(), self.initial)
        self.assertIn('herdr', (self.root / 'events').read_text())

    def test_failed_cli_suppresses_push_but_continues(self):
        result = self.run_update(fail='codex')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('failed step(s): codex', result.stderr)
        self.assertEqual(self.remote_head(), self.initial)
        self.assertIn('herdr', (self.root / 'events').read_text())

    def test_hook_failure_is_not_bypassed_and_suppresses_push(self):
        self.hook('pre-commit', 'echo rejected >&2\nexit 1\n')
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('nvim-commit pi-commit', result.stderr)
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)
        self.assertEqual(self.remote_head(), self.initial)
        self.assertEqual((self.repo / NVIM).read_text(), 'updated\n')

    def test_pull_failure_stops_before_updates(self):
        result = self.run_update(overrides='update_repo() { return 17; }')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'events').exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)

    def test_missing_upstream_rejected_unless_push_disabled(self):
        self.git('branch', '--unset-upstream')
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('upstream', result.stderr)
        self.assertFalse((self.root / 'events').exists())
        # The existing pull still needs a remote; isolate the push preflight.
        self.assert_success(self.run_update('--skip-push', overrides='update_repo() { :; }'))

    def test_detached_head_and_unfinished_operation_rejected(self):
        self.git('checkout', '--detach')
        self.assertNotEqual(self.run_update().returncode, 0)
        self.git('checkout', 'main')
        (self.repo / '.git/MERGE_HEAD').write_text(self.initial + '\n')
        self.assertNotEqual(self.run_update().returncode, 0)
        self.assertFalse((self.root / 'events').exists())

    def test_jj_requires_explicit_opt_out(self):
        (self.repo / '.jj').mkdir()
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--skip-commit --skip-push', result.stderr)
        self.assert_success(self.run_update('--skip-commit', '--skip-push',
                                            overrides='update_repo() { :; }'))

    def test_push_failure_propagates_and_keeps_commits(self):
        hook = self.remote / 'hooks/pre-receive'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o755)
        result = self.run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.remote_head(), self.initial)
        self.assertNotEqual(self.git('rev-parse', 'HEAD'), self.initial)

    def test_invalid_option_and_help_have_no_side_effects(self):
        self.assertNotEqual(self.run_update('--invalid').returncode, 0)
        self.assert_success(self.run_update('--help'))
        self.assertFalse((self.root / 'events').exists())
        self.assertEqual(self.git('rev-parse', 'HEAD'), self.initial)


class CliTests(unittest.TestCase):
    def test_native_homebrew_missing_and_failure_paths(self):
        for mode in ('native', 'brew', 'missing', 'failure'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                body = '''set -euo pipefail
warn() { :; }
command_exists() {
 [[ "$MODE" != missing ]] && { [[ "$1" != brew ]] || [[ "$MODE" == brew ]]; }
}
brew() {
 [[ "$1" == list ]] && return 0
 print -r -- "brew $*"
}
codex() { print -r -- "codex $*"; [[ "$MODE" != failure ]]; }
claude() { print -r -- "claude $*"; [[ "$MODE" != failure ]]; }
t3() { print -r -- "t3 $*"; [[ "$MODE" != failure ]]; }
'''
                body += function('update_t3_desktop')
                body += ''.join(function('update_' + name) for name in ('codex', 'claude', 't3'))
                body += '\nfailed=0\nfor tool in codex claude t3; do "update_$tool" || failed=1; done\nexit $failed'
                result = subprocess.run([ZSH, '-f', '-c', body],
                                        env={'HOME': directory, 'PATH': '/usr/bin:/bin', 'MODE': mode},
                                        text=True, capture_output=True)
                self.assertEqual(result.returncode, int(mode == 'failure'), result.stderr)
                expected = [] if mode == 'missing' else [
                    'brew upgrade --cask codex' if mode == 'brew' else 'codex update',
                    'brew upgrade --cask claude-code' if mode == 'brew' else 'claude update',
                    't3 update --yes',
                ]
                self.assertEqual(result.stdout.splitlines(), expected)

    def test_completion_template_matches_checked_in_file(self):
        template = SOURCE.split("cat > \"$completions_file\" <<'EOF'\n", 1)[1].split('\nEOF', 1)[0] + '\n'
        self.assertEqual(template, (ROOT / 'common/.config/fish/completions/dot.fish').read_text())


if __name__ == '__main__':
    unittest.main()
