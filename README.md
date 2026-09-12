# Lioden Hoard Organizer

A standalone browser extension (Manifest V3) for [Lioden](https://www.lioden.com) that allows you to organize your Hoard into user-created folders, aggregates all items across pages, and provides instant filtering, sorting, and drag-and-drop organization.

---

## Features

- **Custom Folders**: Create, rename, customize icons and colors, and delete folders (e.g. *Breeding Items*, *Decorations*, *Food to Sell*, *Hoard / Long Term*).
- **All Items Aggregated**: Displays all items from your hoard in one unified, responsive grid without being restricted to 20/40/60/100 pagination chunks.
- **Drag-and-Drop Sorting**: Pick up any item card and drop it onto a folder tab at the top to instantly categorize it.
- **Multi-Item Drag & Bulk Actions**: Select multiple items with checkboxes, then drag one to move all of them, or use the multi-select toolbar to batch move them to any folder.
- **Quick-Move Menu**: Click the `📁▾` button on any item card for a fast dropdown to move that item to any folder or create a new one on the fly.
- **Instant Search & Category Filters**: Search by item name or description in real time with instant filtering and sorting (Name, Uses, Quantity, Expiring Soonest).
- **Native Action Support**: Checkboxes and forms remain 100% compatible with Lioden's native actions (e.g. **Bury Checked**).
- **Backup & Restore**: Export your folder configuration and item assignments to a JSON file to transfer between browsers or restore anytime.
- **Classic View Toggle**: Switch back to Lioden's original unorganized layout at any time with a single click.

---

## Installation

### Chrome / Chromium / Edge / Brave / Opera

1. Open your browser and navigate to `chrome://extensions/` (or `edge://extensions/`).
2. Enable **Developer mode** (toggle switch in the top-right corner).
3. Click **Load unpacked**.
4. Select the `lioden-hoard-sorter` folder.
5. Navigate to [Lioden Hoard](https://www.lioden.com/hoard.php) to see your new Hoard Organizer!

### Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select the `manifest.json` file inside the `lioden-hoard-sorter` folder.
4. Navigate to [Lioden Hoard](https://www.lioden.com/hoard.php).

---

## Local Preview / Testing Without Login

A standalone test file [test_preview.html](file:///home/midbar/Projects/lioden-hoard-sorter/test_preview.html) is included with your saved hoard data. You can double-click or open `test_preview.html` directly in any web browser to test and interact with the extension immediately.

---

## Project Structure

- [`manifest.json`](file:///home/midbar/Projects/lioden-hoard-sorter/manifest.json) - Manifest V3 configuration
- [`content.js`](file:///home/midbar/Projects/lioden-hoard-sorter/content.js) - Content script that parses hoard data and powers the organizer
- [`content.css`](file:///home/midbar/Projects/lioden-hoard-sorter/content.css) - Lioden-matched styling, cards, tabs, and modals
- [`popup.html`](file:///home/midbar/Projects/lioden-hoard-sorter/popup.html) / [`popup.js`](file:///home/midbar/Projects/lioden-hoard-sorter/popup.js) - Extension popup for stats and backup
- [`icons/`](file:///home/midbar/Projects/lioden-hoard-sorter/icons) - Extension icons (16px, 48px, 128px)
- [`test_preview.html`](file:///home/midbar/Projects/lioden-hoard-sorter/test_preview.html) - Offline test preview of the hoard with organizer enabled
