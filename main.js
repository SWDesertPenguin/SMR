const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;
let currentFilePath = null;
let watcher = null;
let watchDebounce = null;

const FILE_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd'] },
  { name: 'Text', extensions: ['txt'] },
  { name: 'All Files', extensions: ['*'] }
];

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#ffffff',
    title: 'SMR',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // allow the preload to require marked/dompurify/highlight.js
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  // Open external links in the system browser instead of replacing the app.
  const openExternal = (url) => {
    if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });

  mainWindow.on('closed', () => {
    stopWatching();
    mainWindow = null;
  });
}

// --- File loading + watching ---------------------------------------------

function stopWatching() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (watchDebounce) {
    clearTimeout(watchDebounce);
    watchDebounce = null;
  }
}

function startWatching(filePath) {
  stopWatching();
  try {
    watcher = fs.watch(filePath, (eventType) => {
      // Debounce: editors often fire several events per save.
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        if (eventType === 'rename') {
          // File may have been replaced (atomic save) or removed. Re-establish,
          // or stop watching if it's gone so the stale handle isn't leaked.
          if (fs.existsSync(filePath)) {
            startWatching(filePath);
            sendFile(filePath, { live: true });
          } else {
            stopWatching();
          }
        } else {
          sendFile(filePath, { live: true });
        }
      }, 120);
    });
  } catch (err) {
    // Non-fatal: watching just won't work for this file.
    console.error('watch failed:', err);
  }
}

function sendFile(filePath, opts = {}) {
  fs.readFile(filePath, 'utf8', (err, content) => {
    if (err) {
      if (!opts.live) {
        dialog.showErrorBox('Could not open file', `${filePath}\n\n${err.message}`);
      }
      return;
    }
    if (!mainWindow) return;
    mainWindow.webContents.send('file:loaded', {
      path: filePath,
      name: path.basename(filePath),
      content,
      live: !!opts.live
    });
  });
}

function loadFile(filePath) {
  currentFilePath = filePath;
  app.addRecentDocument(filePath);
  startWatching(filePath);
  sendFile(filePath);
}

async function openFileDialog() {
  if (!mainWindow) return;
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Open Markdown File',
      properties: ['openFile'],
      filters: FILE_FILTERS
    });
    if (!canceled && filePaths.length > 0) {
      loadFile(filePaths[0]);
    }
  } catch (err) {
    console.error('open dialog failed:', err);
  }
}

function reloadCurrent() {
  if (currentFilePath) sendFile(currentFilePath);
}

function closeFile() {
  stopWatching();
  currentFilePath = null;
  if (mainWindow) mainWindow.webContents.send('file:closed');
}

// --- IPC from renderer -----------------------------------------------------

// Drag-and-drop: renderer hands us a path; we centralize read + watch here.
ipcMain.handle('file:open-path', (_evt, filePath) => {
  if (typeof filePath === 'string' && filePath.length > 0) {
    loadFile(filePath);
    return true;
  }
  return false;
});

ipcMain.on('view:toggle-toc', () => sendMenuAction('toggle-toc'));

function sendMenuAction(action) {
  if (mainWindow) mainWindow.webContents.send('menu:action', action);
}

// --- Application menu ------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: openFileDialog },
        { label: 'Reload File', accelerator: 'CmdOrCtrl+R', click: reloadCurrent },
        { label: 'Close File', accelerator: 'CmdOrCtrl+W', click: closeFile },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Dark Mode',
          accelerator: 'CmdOrCtrl+D',
          click: () => sendMenuAction('toggle-theme')
        },
        {
          label: 'Toggle Table of Contents',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendMenuAction('toggle-toc')
        },
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
      label: 'Help',
      submenu: [
        {
          label: 'About SMR',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About SMR',
              message: 'SMR — Standalone Markdown Reader',
              detail: 'A simple desktop Markdown reader.\nOpen a file with Ctrl+O, or drag one onto the window.'
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- App lifecycle ---------------------------------------------------------

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // If launched with a file path argument, open it.
  const fileArg = process.argv.find(
    (a) => a !== '.' && /\.(md|markdown|mdown|mkd|txt)$/i.test(a)
  );
  if (fileArg && fs.existsSync(fileArg)) {
    mainWindow.webContents.once('did-finish-load', () => loadFile(fileArg));
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => console.error('startup failed:', err));

// macOS: open file from Finder / file association.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow) {
    loadFile(filePath);
  } else {
    app.whenReady().then(() => {
      createWindow();
      mainWindow.webContents.once('did-finish-load', () => loadFile(filePath));
    }).catch((err) => console.error('open-file handling failed:', err));
  }
});

app.on('window-all-closed', () => {
  stopWatching();
  if (process.platform !== 'darwin') app.quit();
});
