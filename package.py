#!/usr/bin/env python3
"""
Package Lioden Hoard Organizer extension into a clean .zip for distribution & beta testing.
Excludes git files, development preview HTML files, and temporary assets.
"""

import os
import json
import zipfile

DIST_DIR = 'dist'
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

def main():
    with open('manifest.json', 'r') as f:
        manifest = json.load(f)

    version = manifest.get('version', '1.0.0')
    os.makedirs(DIST_DIR, exist_ok=True)
    zip_filename = os.path.join(DIST_DIR, f'lioden-hoard-organizer-v{version}.zip')

    print(f"Packaging Lioden Hoard Organizer v{version}...")

    total_uncompressed = 0
    with zipfile.ZipFile(zip_filename, 'w', compression=zipfile.ZIP_DEFLATED) as zipf:
        for file_path in FILES_TO_INCLUDE:
            if not os.path.exists(file_path):
                print(f"Missing required file: {file_path}")
                return 1
            file_size = os.path.getsize(file_path)
            total_uncompressed += file_size
            zipf.write(file_path, arcname=file_path)
            print(f"Added {file_path} ({file_size:,} bytes)")

    zip_size = os.path.getsize(zip_filename)
    print(f"\nPackage created successfully:")
    print(f"   File: {zip_filename}")
    print(f"   Zip Size: {zip_size:,} bytes ({zip_size / 1024:.1f} KB)")
    print(f"   Uncompressed: {total_uncompressed:,} bytes ({total_uncompressed / 1024:.1f} KB)")
    return 0

if __name__ == '__main__':
    exit(main())
