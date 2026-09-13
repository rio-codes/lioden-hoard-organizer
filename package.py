#!/usr/bin/env python3
"""
Package Lioden Hoard Organizer extension into a clean .zip for distribution & beta testing.
Excludes git files, development preview HTML files, and temporary assets.
Supports automatic version bumping (patch, minor, major).
"""

import os
import sys
import json
import shutil
import zipfile
import argparse

DIST_DIR = 'dist'
MANIFEST_FILE = 'manifest.json'
FILES_TO_INCLUDE = [
    'manifest.json',
    'content.js',
    'content.css',
    'emojis.js',
    'popup.html',
    'popup.js',
    'icons/icon-16.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
]

def bump_version_string(current_version: str, part: str = 'patch') -> str:
    """Increment semantic version string: major, minor, or patch."""
    parts = [int(p) for p in current_version.split('.')]
    while len(parts) < 3:
        parts.append(0)

    if part == 'major':
        parts[0] += 1
        parts[1] = 0
        parts[2] = 0
    elif part == 'minor':
        parts[1] += 1
        parts[2] = 0
    elif part == 'patch':
        parts[2] += 1
    else:
        raise ValueError(f"Unknown version part '{part}'. Must be 'major', 'minor', or 'patch'.")

    return '.'.join(str(p) for p in parts)

def update_manifest_version(new_version: str) -> None:
    """Update version field in manifest.json preserving 2-space indentation."""
    with open(MANIFEST_FILE, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    manifest['version'] = new_version

    with open(MANIFEST_FILE, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')

def build_package(version: str) -> int:
    """Create versioned .zip archive and latest.zip in dist/ directory."""
    os.makedirs(DIST_DIR, exist_ok=True)
    zip_filename = os.path.join(DIST_DIR, f'lioden-hoard-organizer-v{version}.zip')
    latest_filename = os.path.join(DIST_DIR, 'lioden-hoard-organizer-latest.zip')

    print(f"Packaging Lioden Hoard Organizer v{version}...")

    total_uncompressed = 0
    with zipfile.ZipFile(zip_filename, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
        for file_path in FILES_TO_INCLUDE:
            if not os.path.exists(file_path):
                print(f"Error: Missing required file: {file_path}", file=sys.stderr)
                return 1
            file_size = os.path.getsize(file_path)
            total_uncompressed += file_size
            zipf.write(file_path, arcname=file_path)
            print(f"  Added {file_path} ({file_size:,} bytes)")

    # Also create a copy as 'latest.zip'
    shutil.copyfile(zip_filename, latest_filename)

    zip_size = os.path.getsize(zip_filename)
    print(f"\nPackage created successfully:")
    print(f"   Versioned: {zip_filename} ({zip_size:,} bytes / {zip_size / 1024:.1f} KB)")
    print(f"   Latest:    {latest_filename}")
    print(f"   Uncompressed: {total_uncompressed:,} bytes ({total_uncompressed / 1024:.1f} KB)")
    return 0

def main():
    parser = argparse.ArgumentParser(description="Package Lioden Hoard Organizer extension.")
    parser.add_argument(
        '--bump',
        nargs='?',
        const='patch',
        choices=['patch', 'minor', 'major'],
        help="Bump the version in manifest.json before packaging (default: patch)."
    )
    parser.add_argument(
        '--set-version',
        type=str,
        help="Set an explicit version string in manifest.json before packaging."
    )

    args = parser.parse_args()

    if not os.path.exists(MANIFEST_FILE):
        print(f"Error: {MANIFEST_FILE} not found.", file=sys.stderr)
        return 1

    with open(MANIFEST_FILE, 'r', encoding='utf-8') as f:
        manifest = json.load(f)

    current_version = manifest.get('version', '1.0.0')

    if args.set_version:
        new_version = args.set_version
        print(f"Setting version: {current_version} -> {new_version}")
        update_manifest_version(new_version)
        current_version = new_version
    elif args.bump:
        new_version = bump_version_string(current_version, args.bump)
        print(f"Bumping {args.bump} version: {current_version} -> {new_version}")
        update_manifest_version(new_version)
        current_version = new_version

    return build_package(current_version)

if __name__ == '__main__':
    sys.exit(main())
