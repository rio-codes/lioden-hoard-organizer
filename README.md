# Lioden Hoard Organizer

A standalone browser extension (Manifest V3) for [Lioden](https://www.lioden.com) that allows you to organize your Hoard into user-created folders, aggregates all items across pages, and provides instant filtering, sorting, and drag-and-drop organization.

<a href="https://chromewebstore.google.com/detail/lioden-hoard-organizer/fdmjabicepnhibpcmabbkejhhaehhcgo?authuser=0&hl=en">Official Chrome Extension</a>


<a href="https://addons.mozilla.org/en-US/firefox/addon/lioden-hoard-organizer/">Official Firefox Extension</a>

![Lioden Hoard Organizer Preview](lioden-hoard-sorter-screenshot.png)

---

## Features

- **Custom Folders**: Create, rename, customize icons and colors, and delete folders (e.g. *Breeding Items*, *Decorations*, *Food to Sell*, *Hoard / Long Term*).
- **All Items Aggregated**: Displays all items from your hoard in one unified, responsive grid without being restricted to 20/40/60/100 pagination chunks.
- **Drag-and-Drop Sorting**: Pick up any item card and drop it onto a folder tab at the top to instantly categorize it.
- **Multi-Item Drag & Bulk Actions**: Select multiple items with checkboxes, then drag one to move all of them, or use the multi-select toolbar to batch move them to any folder.
- **Quick-Move Menu**: Click the `📁▾` button on any item card for a fast dropdown to move that item to any folder or create a new one on the fly.
- **Instant Search & Category Filters**: Search by item name in real time with instant filtering and sorting (Name, Uses, Quantity, Expiring Soonest).
- **Native Action Support**: Checkboxes and forms remain 100% compatible with Lioden's native actions (e.g. **Bury Checked**).
- **Linked Accounts Support**: Choose in settings whether your main and side accounts share the same folders or keep separate, independent folder setups with quick one-click folder copying between accounts.
- **Backup & Restore**: Export your folder configuration and item assignments to a JSON file to transfer between browsers or restore anytime.
- **Classic View Toggle**: Switch back to Lioden's original unorganized layout at any time with a single click.

---

## Packaging & Versioning

To package the extension into clean distribution `.zip` archives (`dist/lioden-hoard-organizer-v{version}.zip` and `dist/lioden-hoard-organizer-latest.zip`):

```bash
python3 package.py
```

### Version Bumping

You can bump the version automatically:

```bash
python3 package.py --bump patch   # e.g., 1.0.2 -> 1.0.3
python3 package.py --bump minor   # e.g., 1.0.2 -> 1.1.0
python3 package.py --bump major   # e.g., 1.0.2 -> 2.0.0
python3 package.py --set-version 1.2.0
```

### Automatic Git Pre-Commit Hook

A Git pre-commit hook is provided in `.githooks/pre-commit` that automatically bumps the patch version and packages the zip upon every commit:

```bash
git config core.hooksPath .githooks
```

To skip the bump for a specific commit:

```bash
NO_BUMP=1 git commit -m "commit message"
```

---

## Local Preview / Testing Without Login

A standalone test file [test_preview.html](file:///home/midbar/Projects/lioden-hoard-sorter/test_preview.html) is included with your saved hoard data. You can double-click or open `test_preview.html` directly in any web browser to test and interact with the extension immediately.

---

## Project Structure

- [`manifest.json`](file:///home/midbar/Projects/lioden-hoard-sorter/manifest.json) - Manifest V3 configuration
- [`content.js`](file:///home/midbar/Projects/lioden-hoard-sorter/content.js) - Content script that parses hoard data and powers the organizer
- [`content.css`](file:///home/midbar/Projects/lioden-hoard-sorter/content.css) - Lioden-matched styling, cards, tabs, and modals
- [`popup.html`](file:///home/midbar/Projects/lioden-hoard-sorter/popup.html) / [`popup.js`](file:///home/midbar/Projects/lioden-hoard-sorter/popup.js) - Extension popup for stats and backup
- [`package.py`](file:///home/midbar/Projects/lioden-hoard-sorter/package.py) - Extension packaging & version bumping script
- [`.githooks/`](file:///home/midbar/Projects/lioden-hoard-sorter/.githooks) - Git hooks (automatic version bumper)
- [`icons/`](file:///home/midbar/Projects/lioden-hoard-sorter/icons) - Extension icons (16px, 48px, 128px)
- [`test_preview.html`](file:///home/midbar/Projects/lioden-hoard-sorter/test_preview.html) - Offline test preview of the hoard with organizer enabled
