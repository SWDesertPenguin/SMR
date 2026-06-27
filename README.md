# SMR — Standalone Markdown Reader

A simple desktop Markdown reader built with Electron. Open a `.md` file and read it with clean styling, syntax-highlighted code, a table of contents, and a dark mode. This file doubles as a sample document for testing the reader.

## Getting started

```bash
npm install
npm start
```

Then open a file with **File → Open…** (`Ctrl+O`), or drag a `.md` file onto the window.

## Features

- Open via menu, drag-and-drop, or a file path argument
- GitHub-flavored Markdown: tables, task lists, fenced code, autolinks
- Syntax highlighting via highlight.js
- Collapsible table of contents (`Ctrl+T`) that tracks your scroll position
- Dark mode toggle (`Ctrl+D`), remembered between sessions
- Live re-render when the open file changes on disk

## Keyboard shortcuts

| Action            | Shortcut   |
| ----------------- | ---------- |
| Open file         | `Ctrl+O`   |
| Reload file       | `Ctrl+R`   |
| Close file        | `Ctrl+W`   |
| Toggle dark mode  | `Ctrl+D`   |
| Toggle contents   | `Ctrl+T`   |

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
