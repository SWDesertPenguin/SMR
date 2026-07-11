const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let forceClose = false;      // set true once the user confirms quitting with unsaved work
let dirtyCount = 0;          // mirrored from the renderer so the close handler stays synchronous

const watchers = new Map();      // path -> fs.FSWatcher
const watchDebounce = new Map(); // path -> timeout handle

// The reader only deals in Markdown. This list is the single source of truth for
// both the dialog filters and the per-path extension check used at every entry point.
const MD_EXTS = ['md', 'markdown', 'mdown', 'mkd'];
const FILE_FILTERS = [{ name: 'Markdown', extensions: MD_EXTS }];

const REPO_URL = 'https://github.com/SWDesertPenguin/SMR';

function isMarkdown(filePath) {
  if (typeof filePath !== 'string') return false;
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return MD_EXTS.includes(ext);
}

// Open http(s)/mailto links in the system browser; ignore anything else.
function openExternalUrl(url) {
  if (typeof url === 'string' && /^(https?:|mailto:)/.test(url)) {
    shell.openExternal(url);
  }
}

function createWindow() {
  forceClose = false; // a fresh window starts with no pending force-quit
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#ffffff',
    title: 'SMR',
    icon: path.join(__dirname, 'icon-dark.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow the preload to require marked/dompurify/highlight.js
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

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

  // Intercept close when tabs are unsaved. dirtyCount (mirrored from the renderer
  // via app:dirty) lets us decide synchronously whether to intercept at all; the
  // renderer then drives the Save All / Don't Save / Cancel flow and calls back
  // via app:force-quit so it can reuse the same save logic the tabs already use.
  mainWindow.on('close', (event) => {
    if (forceClose || dirtyCount === 0) return;
    event.preventDefault();
    if (mainWindow) mainWindow.webContents.send('app:quit-requested');
  });

  mainWindow.on('closed', () => {
    stopAllWatching();
    mainWindow = null;
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
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    app.addRecentDocument(filePath);
    return { path: filePath, name: path.basename(filePath), content };
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

function startWatching(filePath) {
  try {
    const w = fs.watch(filePath, (eventType) => {
      // Debounce: editors often fire several events per save.
      const prev = watchDebounce.get(filePath);
      if (prev) clearTimeout(prev);
      watchDebounce.set(filePath, setTimeout(() => {
        watchDebounce.delete(filePath);
        if (!fs.existsSync(filePath)) {
          stopWatching(filePath); // gone for good; drop the stale watcher
          return;                 // leave the tab alone
        }
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (mainWindow) mainWindow.webContents.send('file:changed', { path: filePath, content });
        } catch (_) { /* transient read error during save; ignore */ }
        // Atomic saves replace the inode, so the original watch is now stale.
        if (eventType === 'rename') {
          stopWatching(filePath);
          if (fs.existsSync(filePath)) startWatching(filePath);
        }
      }, 120));
    });
    watchers.set(filePath, w);
  } catch (err) {
    // Non-fatal: watching just won't work for this file.
    console.error('watch failed:', err);
  }
}

// Reconcile the watcher set to exactly the paths the renderer has open.
function setWatched(paths) {
  const wanted = new Set(paths.filter((p) => typeof p === 'string' && p));
  for (const filePath of [...watchers.keys()]) {
    if (!wanted.has(filePath)) stopWatching(filePath);
  }
  for (const filePath of wanted) {
    if (!watchers.has(filePath)) startWatching(filePath);
  }
}

// --- IPC from renderer ---------------------------------------------------

ipcMain.handle('dialog:open', async () => {
  if (!mainWindow) return { files: [] };
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Markdown File',
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS
  });
  if (canceled) return { files: [] };
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
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown File',
    defaultPath: name || 'Untitled.md',
    filters: FILE_FILTERS
  });
  if (canceled || !filePath) return { canceled: true };
  // Enforce a Markdown extension even if the user typed a bare name.
  const out = isMarkdown(filePath) ? filePath : `${filePath}.md`;
  try {
    fs.writeFileSync(out, content, 'utf8');
    app.addRecentDocument(out);
    return { path: out, name: path.basename(out) };
  } catch (err) {
    dialog.showErrorBox('Could not save file', `${out}\n\n${err.message}`);
    return { error: err.message };
  }
});

ipcMain.handle('watch:set', (_evt, paths) => {
  setWatched(Array.isArray(paths) ? paths : []);
});

ipcMain.handle('dialog:confirm-close', async (_evt, name) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `Save changes to ${name}?`,
    detail: "Your changes will be lost if you don't save them."
  });
  return ['save', 'discard', 'cancel'][response];
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
  return ['save', 'discard', 'cancel'][response];
});

ipcMain.handle('shell:open-external', (_evt, url) => openExternalUrl(url));

ipcMain.on('app:dirty', (_evt, n) => {
  dirtyCount = Number(n) || 0;
});

// The renderer has finished its save/discard decision and wants to quit. Setting
// forceClose makes the close handler above fall through on the re-close.
ipcMain.on('app:force-quit', () => {
  forceClose = true;
  if (mainWindow) mainWindow.close();
});

// --- Auto-update -----------------------------------------------------------

// Every GitHub release built by .github/workflows/release.yml ships a
// latest.yml / latest-mac.yml feed alongside the installers; electron-updater
// reads that feed to find newer *published* releases (drafts stay invisible
// to it, matching that workflow's review-then-publish flow).
let manualUpdateCheck = false; // only surface "up to date" / error dialogs when the user asked

function initAutoUpdater() {
  if (!app.isPackaged) return; // no update feed to read outside a real build
  if (process.env.PORTABLE_EXECUTABLE_DIR) return; // portable build: nothing to install into

  // Unsigned macOS builds fail Squirrel.Mac's signature check (see the
  // release workflow's CSC_IDENTITY_AUTO_DISCOVERY note), so mac only checks
  // for a newer version and points the user at the release page instead of
  // downloading and installing it.
  autoUpdater.autoDownload = process.platform === 'win32';
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (process.platform === 'win32') {
      // Downloads silently in the background; 'update-downloaded' below prompts
      // to restart. Only say something now if the user explicitly asked.
      if (manualUpdateCheck) {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          message: `SMR ${info.version} found`,
          detail: "Downloading in the background. You'll be prompted to restart once it's ready."
        });
      }
    } else {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: `SMR ${info.version} is available`,
        detail: "Auto-install isn't supported on this platform yet. Download it from GitHub?",
        buttons: ['View Release', 'Later'],
        defaultId: 0,
        cancelId: 1
      }).then(({ response }) => {
        if (response === 0) openExternalUrl(`${REPO_URL}/releases/latest`);
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: "You're up to date",
        detail: `SMR ${app.getVersion()} is the latest version.`
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('error', (err) => {
    console.error('auto-update check failed:', err);
    if (manualUpdateCheck) dialog.showErrorBox('Update check failed', err.message);
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: `SMR ${info.version} is ready to install`,
      detail: 'Restart now to finish updating?',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
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
        isMac ? { role: 'close' } : { role: 'quit' }
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
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+PageDown', click: () => sendMenuAction('next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+PageUp', click: () => sendMenuAction('prev-tab') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      role: 'help',
      submenu: [
        { label: 'Help & Keyboard Shortcuts', accelerator: 'CmdOrCtrl+/', click: () => sendMenuAction('help') },
        { label: 'SMR on GitHub', click: () => openExternalUrl(REPO_URL) },
        { label: 'Report an Issue', click: () => openExternalUrl(`${REPO_URL}/issues`) },
        { type: 'separator' },
        {
          label: 'Check for Updates…',
          enabled: app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR,
          click: checkForUpdatesManually
        },
        { label: 'About SMR', click: showAbout }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- App lifecycle -------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  initAutoUpdater();

  // If launched with a file path argument, open it once the renderer is ready.
  const fileArg = process.argv.find((a) => a !== '.' && isMarkdown(a));
  if (fileArg && fs.existsSync(fileArg)) {
    mainWindow.webContents.once('did-finish-load', () => pushOpen(fileArg));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => console.error('startup failed:', err));

// macOS: open file from Finder / file association.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    pushOpen(filePath);
  } else {
    app.whenReady().then(() => {
      createWindow();
      mainWindow.webContents.once('did-finish-load', () => pushOpen(filePath));
    }).catch((err) => console.error('open-file handling failed:', err));
  }
});

app.on('window-all-closed', () => {
  stopAllWatching();
  if (process.platform !== 'darwin') app.quit();
});
