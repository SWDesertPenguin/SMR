const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
// pure.mjs is an ES module shared with the renderer; Electron's Node can require() it.
const { MD_EXTS, isMarkdown, toLocalPath, isExternalUrl, ensureMdExt } = require('./src/pure.mjs');

// A rejected promise nobody handles would otherwise vanish; surface it in the log.
process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));

// smr-doc:// serves the images a document references by relative path. The
// renderer is sandboxed and has no file: access, so main reads them on its behalf.
// Schemes have to be registered before the app is ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'smr-doc', privileges: { standard: true, secure: true } }]);

let mainWindow = null;
let forceClose = false;      // set true once the user confirms quitting with unsaved work
let dirtyCount = 0;          // mirrored from the renderer so the close handler stays synchronous
let pendingInstall = false;  // "Restart Now" was chosen with unsaved tabs; install once the quit flow finishes
let rendererReady = false;   // true once the window's page has finished loading and can take tabs:open
let pendingOpenPaths = [];   // files asked for before the window could show them (Finder launch, argv)

const watchers = new Map();      // path -> fs.FSWatcher
const watchDebounce = new Map(); // path -> timeout handle
const openDocs = new Set();      // paths the renderer has open; smr-doc:// only serves beside these

// The reader only deals in Markdown; MD_EXTS (src/pure.mjs) drives both these dialog
// filters and the per-path extension check used at every entry point.
const FILE_FILTERS = [{ name: 'Markdown', extensions: MD_EXTS }];

const REPO_URL = 'https://github.com/SWDesertPenguin/SMR';

// --- Settings --------------------------------------------------------------

// User preferences live in one JSON file in userData. Everything here is
// synchronous and best-effort: a missing, unreadable or malformed file reads as {}
// and a failed write is logged, so a bad settings file never stops the app starting.
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

// Merge `partial` into what is on disk. Written beside the target and renamed over
// it so a crash mid-write can't leave a half-written settings file.
function writeSettings(partial) {
  try {
    const file = settingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...readSettings(), ...partial }, null, 2));
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('writing settings failed:', err);
  }
}

// Every existing Markdown file named in an argv, as absolute paths. Skips the
// '.' app-dir argument of `electron .` and any flag, and keeps all matches so
// `smr a.md b.md` opens both.
function markdownArgs(argv, cwd) {
  return argv
    .map((a) => toLocalPath(a, fileURLToPath))
    .filter((a) => a && a !== '.' && !a.startsWith('-'))
    .map((a) => path.resolve(cwd, a))
    .filter((p) => isMarkdown(p) && fs.existsSync(p));
}

// Open http(s)/mailto links in the system browser; ignore anything else.
function openExternalUrl(url) {
  if (isExternalUrl(url)) {
    shell.openExternal(url).catch((err) => console.error('openExternal failed:', err));
  }
}

// The --bg values from styles.css. The window shows this color until the page
// paints, so it has to match the theme or dark users get a white flash.
const BG_LIGHT = '#ffffff';
const BG_DARK = '#0d1117';

const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;

// The saved window rectangle if it is still usable, otherwise null. A display that
// was unplugged or rearranged since the last run can leave it off screen.
// getDisplayMatching always answers (with the nearest display when nothing
// overlaps), so the overlap with that display's work area has to be checked here.
function usableBounds(saved) {
  if (!saved || typeof saved !== 'object') return null;
  const { x, y, width, height } = saved;
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
  const wa = screen.getDisplayMatching({ x, y, width, height }).workArea;
  const overlaps = x < wa.x + wa.width && x + width > wa.x && y < wa.y + wa.height && y + height > wa.y;
  return overlaps ? { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) } : null;
}

// Remember where the window was (its restored size if it is maximized) and whether
// it was maximized, for the next launch.
function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  writeSettings({ windowBounds: mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() });
}

function createWindow() {
  forceClose = false; // a fresh window starts with no pending force-quit
  const settings = readSettings();
  // Same order the renderer uses, minus localStorage, which main can't see: a user
  // migrating from it gets the OS color for one launch, then the saved theme.
  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors);
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    // Saved bounds go to the constructor so the window opens in place, not after a jump.
    ...usableBounds(settings.windowBounds),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    backgroundColor: dark ? BG_DARK : BG_LIGHT,
    title: 'SMR',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon-dark.ico' : 'icon-dark.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  if (settings.maximized === true) mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // tabs:open sent before the page loads is dropped (the renderer has not
  // registered its listener yet), so queued paths are flushed once it has.
  mainWindow.webContents.on('did-start-loading', () => { rendererReady = false; });
  mainWindow.webContents.on('did-finish-load', () => {
    rendererReady = true;
    pendingOpenPaths.splice(0).forEach(pushOpen);
  });

  // Open external links in the system browser instead of replacing the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });

  // A dead renderer leaves a blank window with the user's tabs gone. Say why
  // instead of failing silently, then reload so the window is usable again.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('render-process-gone:', details);
    dialog.showErrorBox('SMR stopped unexpectedly', `The window's process exited (${details.reason}). SMR will reload it; unsaved changes in open tabs are lost.`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });

  // Intercept close when tabs are unsaved. dirtyCount (mirrored from the renderer
  // via app:dirty) lets us decide synchronously whether to intercept at all; the
  // renderer then drives the Save All / Don't Save / Cancel flow and calls back
  // via app:force-quit so it can reuse the same save logic the tabs already use.
  mainWindow.on('close', (event) => {
    saveWindowState(); // first, so a cancelled or intercepted close still records it
    if (forceClose || dirtyCount === 0) return;
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send('app:quit-requested');
  });

  mainWindow.on('closed', () => {
    stopAllWatching();
    openDocs.clear();
    mainWindow = null;
    rendererReady = false;
    dirtyCount = 0; // the tabs went with the window; a stale count would block a later install
    pendingInstall = false;
  });
}

// --- Reading -------------------------------------------------------------

// Read a file for display in a tab. The md-only rule is enforced here so every
// entry point (dialog, drag-drop, launch arg, recent docs) is covered, not just
// the open dialog's filter.
function readForTab(filePath) {
  if (!isMarkdown(filePath)) {
    return { error: `Not a Markdown file: ${path.basename(filePath)}` };
  }
  // Resolve once here so every path the renderer sees is absolute and normalized;
  // the renderer dedupes tabs and matches watcher events by comparing these.
  const abs = path.resolve(filePath);
  try {
    const content = fs.readFileSync(abs, 'utf8');
    app.addRecentDocument(abs);
    // The renderer's watch:set arrives separately and can land after its first
    // image request, so the doc is registered here as well, where it is handed out.
    openDocs.add(abs);
    return { path: abs, name: path.basename(abs), content };
  } catch (err) {
    return { error: err.message };
  }
}

function pushOpen(filePath) {
  const r = readForTab(filePath);
  if (r.error) {
    dialog.showErrorBox('Could not open file', `${filePath}\n\n${r.error}`);
    return;
  }
  if (mainWindow) mainWindow.webContents.send('tabs:open', [r]);
}

// Open files now if the window can take them, otherwise queue them for the
// did-finish-load flush. On macOS the app can outlive its last window, so a
// request that arrives then also has to bring a window back.
function openPaths(paths) {
  if (paths.length === 0) return;
  if (mainWindow && rendererReady) {
    paths.forEach(pushOpen);
    return;
  }
  pendingOpenPaths.push(...paths);
  if (!mainWindow && app.isReady()) createWindow();
}

// --- Watching ------------------------------------------------------------

function stopWatching(filePath) {
  const w = watchers.get(filePath);
  if (w) {
    w.close();
    watchers.delete(filePath);
  }
  const t = watchDebounce.get(filePath);
  if (t) {
    clearTimeout(t);
    watchDebounce.delete(filePath);
  }
}

function stopAllWatching() {
  for (const filePath of [...watchers.keys()]) stopWatching(filePath);
}

const WATCH_DEBOUNCE_MS = 120;
const GONE_RETRIES = 5;
const GONE_RETRY_MS = 200;

// Look at a watched file once the burst of events has settled. A save that
// replaces the file leaves nothing at the path for a moment, so a miss is retried
// before the file is reported gone. The pending timer lives in watchDebounce, so
// a new event or stopWatching() cancels it.
function scheduleCheck(filePath, eventType, delay, attempt) {
  const prev = watchDebounce.get(filePath);
  if (prev) clearTimeout(prev);
  watchDebounce.set(filePath, setTimeout(() => {
    watchDebounce.delete(filePath);
    if (!fs.existsSync(filePath)) {
      if (attempt < GONE_RETRIES) {
        scheduleCheck(filePath, eventType, GONE_RETRY_MS, attempt + 1);
        return;
      }
      // Gone for good: drop the stale watcher and tell the renderer so the tab
      // can say so. A later save re-arms watching through watch:set.
      stopWatching(filePath);
      if (mainWindow) mainWindow.webContents.send('file:gone', { path: filePath });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (mainWindow) mainWindow.webContents.send('file:changed', { path: filePath, content });
    } catch (_) { /* transient read error during save; ignore */ }
    // Atomic saves replace the inode, and a file that vanished and came back is a
    // new one, so in both cases the original watch is now stale.
    if (eventType === 'rename' || attempt > 0) {
      stopWatching(filePath);
      if (fs.existsSync(filePath)) startWatching(filePath);
    }
  }, delay));
}

function startWatching(filePath) {
  try {
    // Debounce: editors often fire several events per save.
    const w = fs.watch(filePath, (eventType) => {
      scheduleCheck(filePath, eventType, WATCH_DEBOUNCE_MS, 0);
    });
    watchers.set(filePath, w);
  } catch (err) {
    // Non-fatal: watching just won't work for this file.
    console.error('watch failed:', err);
  }
}

// Reconcile the watcher set to exactly the paths the renderer has open.
function setWatched(paths) {
  const wanted = new Set(paths.filter((p) => typeof p === 'string' && p && isMarkdown(p)));
  openDocs.clear();
  wanted.forEach((p) => openDocs.add(p));
  for (const filePath of [...watchers.keys()]) {
    if (!wanted.has(filePath)) stopWatching(filePath);
  }
  for (const filePath of wanted) {
    if (!watchers.has(filePath)) startWatching(filePath);
  }
}

// --- Local assets --------------------------------------------------------

const ASSET_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

// True when target is strictly below dir. path.relative compares case-insensitively
// on win32, and testing the relative form (rather than a string prefix) keeps a
// sibling like `docs-evil` from passing as being inside `docs`.
function isInside(dir, target) {
  const rel = path.relative(dir, target);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

// Map an smr-doc request to an image file on disk, or null if it must be refused.
// `doc` has to be a document the renderer has open and `rel` is the src exactly as
// written in the Markdown, so it is still percent-encoded and may carry a query or
// fragment. Containment is decided on the resolved string before any fs access, so
// a //host/share reference never makes the OS reach out.
function resolveDocAsset(doc, rel) {
  if (typeof doc !== 'string' || typeof rel !== 'string' || !openDocs.has(doc)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(rel.replace(/[?#][\s\S]*$/, ''));
  } catch (_) {
    return null;
  }
  const dir = path.dirname(doc);
  const target = path.resolve(dir, decoded);
  if (!isInside(dir, target)) return null;
  if (!ASSET_EXTS.has(path.extname(target).slice(1).toLowerCase())) return null;
  return target;
}

async function handleDocAsset(request) {
  const refuse = () => new Response('', { status: 403 });
  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return refuse();
  }
  if (url.hostname !== 'local') return refuse();
  const file = resolveDocAsset(url.searchParams.get('doc'), url.searchParams.get('rel'));
  if (!file) return refuse();
  try {
    return await net.fetch(pathToFileURL(file).toString());
  } catch (_) {
    return new Response('', { status: 404 }); // missing or unreadable: a broken image, not an error
  }
}

// --- IPC from renderer ---------------------------------------------------

// Electron 43+ opens dialogs in Downloads unless defaultPath is set, so the last folder is kept here.
let lastDialogDir;

ipcMain.handle('dialog:open', async () => {
  if (!mainWindow) return { files: [] };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    defaultPath: lastDialogDir,
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS
  });
  if (canceled) return { files: [] };
  lastDialogDir = path.dirname(filePaths[0]);
  const files = [];
  for (const p of filePaths) {
    const r = readForTab(p);
    if (r.error) dialog.showErrorBox('Could not open file', `${p}\n\n${r.error}`);
    else files.push(r);
  }
  return { files };
});

// Drag-and-drop hands us a path; we centralize read + the md-only check here.
ipcMain.handle('file:open-path', (_evt, filePath) => {
  if (typeof filePath !== 'string' || !filePath) return { error: 'Invalid path' };
  const r = readForTab(filePath);
  if (r.error) dialog.showErrorBox('Could not open file', `${filePath}\n\n${r.error}`);
  return r;
});

// A relative Markdown link clicked in the preview. The target resolves against the
// folder of the document that holds the link and goes through readForTab, so the
// md-only rule and the payload shape are the same as every other way of opening a
// file. Failures get the same dialog as a bad drop, since a dead link that does
// nothing looks like a broken button.
ipcMain.handle('file:open-relative', (_evt, req) => {
  const { docPath, href } = req || {};
  if (typeof docPath !== 'string' || !path.isAbsolute(docPath) || typeof href !== 'string') {
    return { error: 'Invalid link' };
  }
  const fail = (message) => {
    dialog.showErrorBox('Could not open link', `${href}\n\n${message}`);
    return { error: message };
  };
  let target;
  try {
    target = decodeURIComponent(href.replace(/[?#][\s\S]*$/, ''));
  } catch (_) {
    return fail('The link is not a valid path.');
  }
  // //host/share (or \\host\share) would have the OS contact that host to read it.
  if (/^[\\/]{2}/.test(target)) return fail('Links to network paths are not opened.');
  const abs = path.resolve(path.dirname(docPath), target);
  if (!isMarkdown(abs)) return fail(`Not a Markdown file: ${path.basename(abs)}`);
  if (!fs.existsSync(abs)) return fail(`File not found: ${abs}`);
  const r = readForTab(abs);
  if (r.error) return fail(r.error);
  return r;
});

// Same md-only invariant as readForTab: never read or write a non-Markdown path,
// even though the renderer only ever passes paths it already opened.
ipcMain.handle('file:read', (_evt, filePath) => {
  if (!isMarkdown(filePath)) return { error: `Not a Markdown file: ${filePath}` };
  try {
    return { content: fs.readFileSync(filePath, 'utf8') };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('file:save', (_evt, { path: filePath, content }) => {
  if (!isMarkdown(filePath) || typeof content !== 'string') return { error: 'Invalid save request' };
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return { ok: true };
  } catch (err) {
    dialog.showErrorBox('Could not save file', `${filePath}\n\n${err.message}`);
    return { error: err.message };
  }
});

ipcMain.handle('dialog:save', async (_evt, { content, name }) => {
  if (!mainWindow) return { canceled: true };
  const fileName = name || 'Untitled.md';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown File',
    defaultPath: path.isAbsolute(fileName) ? fileName : path.join(lastDialogDir || '', fileName),
    filters: FILE_FILTERS
  });
  if (canceled || !filePath) return { canceled: true };
  lastDialogDir = path.dirname(filePath);
  // Enforce a Markdown extension even if the user typed a bare name.
  const out = path.resolve(ensureMdExt(filePath));
  try {
    fs.writeFileSync(out, content, 'utf8');
    app.addRecentDocument(out);
    openDocs.add(out); // the tab re-renders with this path before watch:set lands
    return { path: out, name: path.basename(out) };
  } catch (err) {
    dialog.showErrorBox('Could not save file', `${out}\n\n${err.message}`);
    return { error: err.message };
  }
});

ipcMain.handle('watch:set', (_evt, paths) => {
  setWatched(Array.isArray(paths) ? paths : []);
});

// Both unsaved-changes prompts list their buttons in this order (Save, Don't Save,
// Cancel); the clicked index is mapped to the name the renderer switches on.
const CHOICES = ['save', 'discard', 'cancel'];

ipcMain.handle('dialog:confirm-close', async (_evt, name) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them."
  });
  return CHOICES[response];
});

// Reload throws away the tab's unsaved edits, so Cancel is the default and the Esc
// answer. The renderer used window.confirm, which blocks the whole page.
ipcMain.handle('dialog:confirm-reload', async (_evt, name) => {
  if (!mainWindow) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Reload', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `Reload ${String(name)} from disk?`,
    detail: 'Your unsaved changes will be discarded.'
  });
  return response === 0;
});

ipcMain.handle('dialog:confirm-quit', async (_evt, n) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save All', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: 'You have unsaved changes.',
    detail: `${n} file(s) have unsaved changes. Save before quitting?`
  });
  return CHOICES[response];
});

ipcMain.handle('shell:open-external', (_evt, url) => openExternalUrl(url));

// The one synchronous IPC in the app. The preload asks once at load so the page
// knows its theme before it first paints. systemDark, repoUrl and version ride along
// in the payload but are never stored, and they follow the spread so a hand-edited
// settings file can't override them. returnValue is always set: leaving it unset
// blocks the renderer.
ipcMain.on('settings:get', (event) => {
  const fixed = { repoUrl: REPO_URL, version: app.getVersion() };
  let payload;
  try {
    payload = { ...readSettings(), systemDark: nativeTheme.shouldUseDarkColors, ...fixed };
  } catch (_) {
    payload = { systemDark: false, ...fixed };
  }
  event.returnValue = payload;
});

// Settings the renderer may change. The rest of the file (window bounds, skipped
// update version) belongs to main, so the page can't rewrite it.
const RENDERER_SETTINGS = {
  theme: (v) => v === 'light' || v === 'dark'
};

ipcMain.handle('settings:set', (_evt, partial) => {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return;
  const accepted = {};
  for (const [key, value] of Object.entries(partial)) {
    if (Object.hasOwn(RENDERER_SETTINGS, key) && RENDERER_SETTINGS[key](value)) accepted[key] = value;
  }
  if (Object.keys(accepted).length > 0) writeSettings(accepted);
});

ipcMain.on('app:dirty', (_evt, n) => {
  dirtyCount = Number(n) || 0;
});

// The renderer has finished its save/discard decision and wants to quit. Setting
// forceClose makes the close handler above fall through on the re-close. If the
// quit was started by "Restart Now", this is also the point where it is safe to
// hand over to the installer.
ipcMain.on('app:force-quit', () => {
  forceClose = true;
  if (pendingInstall) {
    pendingInstall = false;
    autoUpdater.quitAndInstall();
  } else if (mainWindow) {
    mainWindow.close();
  }
});

// The user cancelled the Save All / Don't Save / Cancel prompt, or a save failed.
// Drop the pending install so a later ordinary quit does not trigger it.
ipcMain.on('app:quit-cancelled', () => {
  pendingInstall = false;
});

// --- Auto-update -----------------------------------------------------------

// Every GitHub release built by .github/workflows/release.yml ships a
// latest.yml / latest-linux.yml / latest-mac.yml feed alongside the installers;
// electron-updater reads that feed to find newer *published* releases (drafts
// stay invisible to it, matching that workflow's review-then-publish flow).
// Set by the menu item and cleared once the check reaches a terminal state:
// "up to date", a download finished, or an error. It deliberately stays set
// while a download the user asked for is in flight, so a failed download shows
// an error box instead of vanishing after the "found, downloading" message.
let manualUpdateCheck = false;

// The three update capabilities, kept as predicates so initAutoUpdater and the
// menu item can't drift apart the way two inline platform checks would.

// Is there an update feed to read at all? The portable .exe has no install
// location, so it never checks.
function hasUpdateFeed() {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
}

// Can this build apply an update itself? electron-updater picks the installer
// backend per platform: NsisUpdater on Windows, and on Linux AppImage/Deb/Rpm
// chosen from the `package-type` marker electron-builder writes into deb and rpm
// packages. macOS is excluded because unsigned builds fail Squirrel.Mac's
// signature check (see the release workflow's CSC_IDENTITY_AUTO_DISCOVERY note),
// so mac only checks for a newer version and links the release page.
function canSelfUpdate() {
  return process.platform === 'win32' || process.platform === 'linux';
}

// Can the install finish without the user present? deb and rpm install through
// dpkg/rpm behind a graphical sudo prompt, so their install has to stay tied to
// a button the user just pressed — a root-password dialog appearing on its own
// mid-quit is not acceptable. Windows and AppImage need no elevation.
function canInstallUnattended() {
  return canSelfUpdate() && (process.platform === 'win32' || !!process.env.APPIMAGE);
}

function initAutoUpdater() {
  if (!hasUpdateFeed()) return;

  autoUpdater.autoDownload = canSelfUpdate();
  autoUpdater.autoInstallOnAppQuit = canInstallUnattended();

  autoUpdater.on('update-available', (info) => {
    if (canSelfUpdate()) {
      // Downloads silently in the background; 'update-downloaded' below prompts
      // to restart. Only say something now if the user explicitly asked, and
      // leave manualUpdateCheck set so a failed download is reported too.
      if (manualUpdateCheck) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          message: `SMR ${info.version} found`,
          detail: "Downloading in the background. You'll be prompted to restart once it's ready."
        }).catch(() => {});
      }
    } else {
      // A version the user chose to skip stays quiet on automatic checks; a manual
      // check always shows it. Read fresh so a skip made earlier this run counts.
      if (!manualUpdateCheck && info.version === readSettings().skippedVersion) return;
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `SMR ${info.version} is available`,
        detail: "Auto-install isn't supported on this platform yet. Download it from GitHub?",
        buttons: ['View Release', 'Later', 'Skip This Version'],
        defaultId: 0,
        cancelId: 1 // Esc or closing the box is "Later", never a skip
      }).then(({ response }) => {
        if (response === 0) openExternalUrl(`${REPO_URL}/releases/latest`);
        else if (response === 2) writeSettings({ skippedVersion: info.version });
      }).catch(() => {});
      manualUpdateCheck = false;
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: "You're up to date",
        detail: `SMR ${app.getVersion()} is the latest version.`
      }).catch(() => {});
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('error', (err) => {
    console.error('auto-update failed:', err);
    if (manualUpdateCheck) dialog.showErrorBox('Update failed', err.message);
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: `SMR ${info.version} is ready to install`,
      // deb/rpm hand the install to dpkg/rpm, which needs root.
      detail: canInstallUnattended()
        ? 'Restart now to finish updating?'
        : 'Restart now to finish updating? Your system will ask for your password to install the package.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response !== 0) return;
      // quitAndInstall() launches the installer without giving the dirty-tab
      // prompt a chance to run, so route through the renderer's quit flow first.
      if (dirtyCount > 0 && mainWindow) {
        pendingInstall = true;
        mainWindow.webContents.send('app:quit-requested');
      } else {
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {});
  });

  autoUpdater.checkForUpdates().catch(() => {}); // reported via the 'error' listener above
}

function checkForUpdatesManually() {
  manualUpdateCheck = true;
  autoUpdater.checkForUpdates().catch(() => {}); // reported via the 'error' listener above
}

// --- Application menu ----------------------------------------------------

function sendMenuAction(action) {
  if (mainWindow) mainWindow.webContents.send('menu:action', action);
}

async function showAbout() {
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About SMR',
    message: `SMR — Standalone Markdown Reader & Editor  (v${app.getVersion()})`,
    detail: `A simple desktop Markdown reader and editor.\nOpen files with ${mod}+O, edit them side-by-side, and save with ${mod}+S.`,
    buttons: ['OK', 'View on GitHub'],
    defaultId: 0,
    cancelId: 0
  });
  if (response === 1) openExternalUrl(REPO_URL);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';

  if (isMac) {
    app.setAboutPanelOptions({ applicationName: 'SMR', applicationVersion: app.getVersion(), website: REPO_URL });
  }

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new') },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('save-as') },
        { label: 'Reload From Disk', accelerator: 'CmdOrCtrl+R', click: () => sendMenuAction('reload') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => sendMenuAction('close-tab') },
        // The mac close role defaults to Cmd+W, which is Close Tab above.
        isMac ? { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Dark Mode', accelerator: 'CmdOrCtrl+D', click: () => sendMenuAction('toggle-theme') },
        { label: 'Toggle Table of Contents', accelerator: 'CmdOrCtrl+T', click: () => sendMenuAction('toggle-toc') },
        { label: 'Cycle Layout (Split / Preview / Editor)', accelerator: 'CmdOrCtrl+E', click: () => sendMenuAction('toggle-layout') },
        { label: 'Toggle Full-Width Preview', accelerator: 'CmdOrCtrl+Shift+E', click: () => sendMenuAction('toggle-full-width') },
        { label: 'Load Remote Images', click: () => sendMenuAction('toggle-remote-images') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+PageDown', click: () => sendMenuAction('next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+PageUp', click: () => sendMenuAction('prev-tab') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])
      ]
    },
    ...(isMac ? [{ role: 'windowMenu' }] : []),
    {
      role: 'help',
      submenu: [
        { label: 'Help & Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => sendMenuAction('help') },
        { label: 'SMR on GitHub', click: () => openExternalUrl(REPO_URL) },
        { label: 'Report an Issue', click: () => openExternalUrl(`${REPO_URL}/issues`) },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          enabled: hasUpdateFeed(),
          click: checkForUpdatesManually
        },
        // The mac app menu has its own About item, fed by setAboutPanelOptions above.
        ...(isMac ? [] : [{ label: 'About SMR', click: showAbout }])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- App lifecycle -------------------------------------------------------

// One running SMR owns the window and every watcher. A second launch (opening
// another .md from the file manager, `smr b.md`) hands its files to that instance
// through 'second-instance' and exits instead of opening a competing window.
const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) app.quit();

app.on('second-instance', (_event, argv, cwd) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  // cwd is the second process's directory, which is what its relative args mean.
  openPaths(markdownArgs(argv, cwd));
});

app.whenReady().then(() => {
  if (!gotInstanceLock) return;
  protocol.handle('smr-doc', handleDocAsset);
  buildMenu();

  // Files named on the command line open once the renderer is ready. Queued
  // ahead of createWindow() so they join any paths open-file already collected on
  // a Finder launch and everything opens from one window.
  pendingOpenPaths.push(...markdownArgs(process.argv, process.cwd()));

  createWindow();
  initAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('startup failed:', err);
  dialog.showErrorBox('SMR failed to start', String(err));
  app.exit(1);
});

// macOS: open file from Finder / file association. On a Finder launch this fires
// before 'ready', so the path is queued; the single whenReady handler above
// creates the window and opens it. Creating a window here too gave two windows,
// and closing the orphan nulled mainWindow and stopped every watcher.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  openPaths([filePath]);
});

app.on('window-all-closed', () => {
  stopAllWatching();
  if (process.platform !== 'darwin') app.quit();
});
