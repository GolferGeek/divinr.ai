const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const windowStateKeeper = require('electron-window-state');

let mainWindow;

function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
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
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Divinr AI',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Divinr AI',
              message: 'Divinr AI',
              detail: `Version ${app.getVersion()}\nAI-powered market analysis platform`,
            });
          },
        },
      ],
    },
  ];

  // macOS app menu
  if (isMac) {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

function createWindow() {
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1400,
    defaultHeight: 900,
  });

  Menu.setApplicationMenu(buildMenu());

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    title: 'Divinr AI',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindowState.manage(mainWindow);

  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');
  const devPort = process.env.VITE_WEB_PORT || 6101;

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${devPort}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
