// Copies the highlight.js stylesheets the app links into src/vendor/, so index.html
// loads them from beside itself instead of reaching into node_modules. Runs from the
// postinstall hook, which `npm ci` and `npm install` trigger once dependencies are in
// place; src/vendor/ is gitignored and rebuilt every time.
import { copyFileSync, mkdirSync } from 'node:fs';

const STYLES = ['github.min.css', 'github-dark.min.css'];

const from = (name) => new URL(`../node_modules/highlight.js/styles/${name}`, import.meta.url);
const to = (name) => new URL(`../src/vendor/${name}`, import.meta.url);

try {
  mkdirSync(new URL('../src/vendor/', import.meta.url), { recursive: true });
  for (const name of STYLES) copyFileSync(from(name), to(name));
} catch (err) {
  console.error(`vendor: could not copy the highlight.js styles: ${err.message}`);
  process.exit(1);
}
