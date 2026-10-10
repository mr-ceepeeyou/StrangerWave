const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
function createWindow() {
  const win = new BrowserWindow({ width: 1280, height: 850, minWidth: 700, minHeight: 560, backgroundColor: '#0b0b12', title: 'StrangerWave', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadURL(APP_URL);
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
