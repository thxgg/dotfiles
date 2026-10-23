#!/usr/bin/env python3
"""Update an existing Linux T3 Code AppImage without stopping the desktop."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import sys
import tempfile
from urllib.request import Request, urlopen

API = 'https://api.github.com/repos/pingdotgg/t3code/releases'
DOWNLOAD = 'https://github.com/pingdotgg/t3code/releases/download/'
VERSION = re.compile(r'(\d+)\.(\d+)\.(\d+)(?:-(nightly|preview)\.(\d+(?:\.\d+)*))?')


def version_key(version):
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError(f'Unsupported T3 version: {version}')
    major, minor, patch, channel, build = match.groups()
    return (int(major), int(minor), int(patch), channel is None,
            tuple(int(part) for part in build.split('.')) if build else ())


def channel_of(version):
    version_key(version)
    return VERSION.fullmatch(version).group(4) or 'stable'


def request(url):
    return urlopen(Request(url, headers={'User-Agent': 'dotfiles-t3-updater',
                                        'Accept': 'application/vnd.github+json'}), timeout=60)


def fetch_json(url):
    with request(url) as response:
        return json.load(response)


def latest_release(channel, fetch=fetch_json):
    if channel == 'stable':
        releases = [fetch(API + '/latest')]
    else:
        releases = []
        for page in range(1, 11):
            batch = fetch(f'{API}?per_page=30&page={page}')
            if not isinstance(batch, list):
                raise ValueError('Invalid GitHub release list')
            releases.extend(batch)
            if any(release_version(item, channel) for item in batch) or not batch:
                break
    candidates = [(release_version(item, channel), item) for item in releases]
    candidates = [(version, item) for version, item in candidates if version]
    if not candidates:
        raise ValueError(f'No published T3 desktop release found on {channel}')
    return max(candidates, key=lambda pair: version_key(pair[0]))


def release_version(item, channel):
    tag = item.get('tag_name', '')
    version = tag.removeprefix('v')
    if item.get('draft') or not VERSION.fullmatch(version):
        return None
    return version if channel_of(version) == channel else None


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def download(url, target):
    with request(url) as response, target.open('wb') as output:
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            output.write(chunk)


def update(home, machine=None, system=None, fetch=fetch_json, transfer=download):
    if (system or platform.system()) != 'Linux':
        return
    applications = home / 'Applications'
    machine = machine or platform.machine()
    arch = {'x86_64': 'x86_64', 'aarch64': 'arm64'}.get(machine)
    if not arch:
        raise ValueError(f'Unsupported T3 AppImage architecture: {machine}')
    pattern = re.compile(r'T3-Code-(.+)-' + arch + r'\.AppImage')
    installed = []
    for path in applications.glob(f'T3-Code-*-{arch}.AppImage'):
        match = pattern.fullmatch(path.name)
        if match and VERSION.fullmatch(match[1]) and path.is_file() and os.access(path, os.X_OK):
            installed.append((match[1], path))
    if not installed:
        print('T3 desktop: no supported AppImage installed; skipping')
        return
    # Lock the directory, without creating persistent state. Other dot updaters
    # use the same lock. Never overwrite a file created by the native updater.
    directory_fd = os.open(applications, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current, _ = max(installed, key=lambda pair: version_key(pair[0]))
        channel = channel_of(current)
        settings = Path(os.environ.get('T3CODE_HOME') or home / '.t3') / 'userdata/desktop-settings.json'
        if settings.exists():
            configured = json.loads(settings.read_text()).get('updateChannel')
            if configured is not None and configured != {'stable': 'latest'}.get(channel, channel):
                raise ValueError('T3 desktop channel differs from the installed AppImage; '
                                 'switch channels in the desktop app first')
        if channel == 'preview':
            raise ValueError('T3 preview builds require an explicit update in the desktop app')
        target_version, release = latest_release(channel, fetch)
        if version_key(target_version) < version_key(current):
            print(f'T3 desktop: keeping newer installed version {current}')
            return
        name = f'T3-Code-{target_version}-{arch}.AppImage'
        assets = [asset for asset in release.get('assets', []) if asset.get('name') == name]
        if len(assets) != 1:
            raise ValueError(f'Missing or ambiguous desktop asset: {name}')
        asset = assets[0]
        digest = asset.get('digest', '')
        if not isinstance(digest, str) or not re.fullmatch(r'sha256:[0-9a-f]{64}', digest):
            raise ValueError(f'Missing SHA-256 digest for {name}; refusing unverified download')
        url = asset.get('browser_download_url')
        if url != DOWNLOAD + release['tag_name'] + '/' + name:
            raise ValueError('Unexpected T3 desktop download URL')
        target = applications / name
        if target.exists() or target.is_symlink():
            if target.is_symlink() or not target.is_file() or sha256(target) != digest[7:]:
                raise ValueError(f'Existing target differs from the release; left unchanged: {target}')
            if not os.access(target, os.X_OK):
                raise ValueError(f'Existing target is not executable; left unchanged: {target}')
            print(f'T3 desktop: {target_version} is already installed')
            print('T3 desktop: restart the app if it is still running an older version')
            return
        print(f'T3 desktop: downloading {current} -> {target_version} ({channel})', flush=True)
        with tempfile.TemporaryDirectory(prefix='.dot-t3-', dir=applications) as directory:
            temporary = Path(directory) / name
            transfer(url, temporary)
            if sha256(temporary) != digest[7:]:
                raise ValueError('T3 desktop SHA-256 verification failed')
            if temporary.stat().st_size != asset.get('size'):
                raise ValueError('T3 desktop download size does not match the release')
            with temporary.open('rb') as source:
                header = source.read(11)
            if header[:4] != b'\x7fELF' or header[8:11] != b'AI\x02':
                raise ValueError('Downloaded file is not a type-2 AppImage')
            temporary.chmod(0o755)
            # Atomic publication, with no overwrite even if another updater won.
            os.link(temporary, target)
        print(f'T3 desktop: installed and verified {target}')
        print('T3 desktop: previous AppImages kept; running sessions were not stopped')
        print('T3 desktop: quit and relaunch with t3code to use the new version')
    finally:
        os.close(directory_fd)


if __name__ == '__main__':
    try:
        update(Path.home())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f'Error: T3 desktop update failed: {error}', file=sys.stderr)
        sys.exit(1)
