# SMR — Standalone Markdown Reader & Editor

A simple desktop Markdown reader and editor built with Electron, for Windows, macOS, and Linux. Open one or more `.md` files in tabs, edit them with a live side-by-side preview, and read them with clean styling, syntax-highlighted code, a table of contents, and a dark mode. SMR works with Markdown files only. This file doubles as a sample document for testing the app.

## Getting started

```bash
npm install
npm start
```

Then open a file with **File → Open…** (`Ctrl+O` / `⌘O`), start a new one with `Ctrl+N`, or drag `.md` files onto the window. Edit on the left, watch the preview update on the right, and save with `Ctrl+S`. New to the app? Press the **?** button in the toolbar (or **Help → Help & Keyboard Shortcuts**) for a quick tour.

macOS users: shortcuts use `⌘` in place of `Ctrl`, and the app shows them that way throughout.

## Features

- Multiple files open at once as tabs, with per-tab undo and unsaved-change markers
- Edit Markdown with a live preview that updates as you type
- Resizable panes: drag the dividers, or focus one and press the left and right arrow keys, to size the contents list and the editor/preview split; sizes are remembered
- Synchronized scrolling in split view — scroll either side and the other follows
- Cycle the layout (`Ctrl+E`) between split, preview-only, and editor-only
- Save (`Ctrl+S`) and Save As (`Ctrl+Shift+S`); new files default to a `.md` name
- Open via menu, drag-and-drop, or a file path argument — Markdown files only
- GitHub-flavored Markdown: tables, task lists, fenced code, autolinks
- Syntax highlighting via highlight.js
- Relative images (`![](img/a.png)`) load from beside the open file, and relative links to other Markdown files (`[next](other.md)`) open as tabs
- Remote images are blocked by default, since fetching one tells its host the document was opened; turn them on with the toolbar button or **View → Load Remote Images**
- Collapsible table of contents (`Ctrl+T`) that tracks your scroll position
- Dark mode toggle (`Ctrl+D`); it follows your system theme until you pick one, and your choice is remembered between sessions along with the window size and position
- Live re-render when an open file changes on disk; conflicting external edits are flagged instead of overwriting your changes
- Runs on Windows, macOS, and Linux, with platform-correct keyboard shortcuts

## Keyboard shortcuts

| Action               | Shortcut         |
| -------------------- | ---------------- |
| New file             | `Ctrl+N`         |
| Open file            | `Ctrl+O`         |
| Save                 | `Ctrl+S`         |
| Save As              | `Ctrl+Shift+S`   |
| Reload from disk     | `Ctrl+R`         |
| Close tab            | `Ctrl+W`         |
| Next / previous tab  | `Ctrl+PgDn/PgUp` |
| Cycle layout         | `Ctrl+E`         |
| Toggle dark mode     | `Ctrl+D`         |
| Toggle contents      | `Ctrl+T`         |
| Help                 | `Ctrl+/`         |

On macOS use `⌘` in place of `Ctrl`.

## Building

```bash
npm run dist          # installers for the current platform
npm run dist:portable # Windows portable .exe
npm run dist:mac      # macOS .dmg and .zip (must be run on macOS)
npm run dist:linux    # Linux AppImage, .deb, and .rpm (must be run on Linux)
```

macOS builds produce universal `x64` + `arm64` artifacts and must be built on a Mac; the app itself is unsigned, so first launch needs a right-click → Open.

Linux builds produce `x64` artifacts and must be built on Linux. The `.rpm` target shells out to `rpmbuild`, so install it first (`sudo apt install rpm` on Debian/Ubuntu); AppImage and `.deb` need nothing extra. The AppImage is the portable option — `chmod +x` it and run it. The `.deb` and `.rpm` install to `/opt/SMR` and add a `smr` command on your `PATH`.

Updates install in place: the AppImage replaces itself silently, while `.deb` asks for your password because `dpkg` does the work. An unsigned `.rpm` update may be refused depending on your distro's package-verification policy, in which case reinstall from the release page.

## Task list

- [x] Render headings and build a TOC
- [x] Highlight fenced code blocks
- [ ] Your next document

## Code sample

```javascript
function greet(name) {
  // A fenced block to exercise syntax highlighting.
  const message = `Hello, ${name}!`;
  console.log(message);
  return message;
}

greet('world');
```

```python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

## Blockquote

> Markdown is a lightweight markup language for creating formatted text using a plain-text editor.

## Inline elements

This paragraph has **bold**, *italic*, ~~strikethrough~~, `inline code`, and a [link](https://example.com).

---

That's the end of the sample.
