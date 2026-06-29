# SMR — Standalone Markdown Reader & Editor

A simple desktop Markdown reader and editor built with Electron. Open one or more `.md` files in tabs, edit them with a live side-by-side preview, and read them with clean styling, syntax-highlighted code, a table of contents, and a dark mode. SMR works with Markdown files only. This file doubles as a sample document for testing the app.

## Getting started

```bash
npm install
npm start
```

Then open a file with **File → Open…** (`Ctrl+O`), start a new one with `Ctrl+N`, or drag `.md` files onto the window. Edit on the left, watch the preview update on the right, and save with `Ctrl+S`.

## Features

- Multiple files open at once as tabs, with per-tab undo and unsaved-change markers
- Edit Markdown with a live preview that updates as you type
- Cycle the layout (`Ctrl+E`) between split, preview-only, and editor-only
- Save (`Ctrl+S`) and Save As (`Ctrl+Shift+S`); new files default to a `.md` name
- Open via menu, drag-and-drop, or a file path argument — Markdown files only
- GitHub-flavored Markdown: tables, task lists, fenced code, autolinks
- Syntax highlighting via highlight.js
- Collapsible table of contents (`Ctrl+T`) that tracks your scroll position
- Dark mode toggle (`Ctrl+D`), remembered between sessions
- Live re-render when an open file changes on disk; conflicting external edits are flagged instead of overwriting your changes

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
