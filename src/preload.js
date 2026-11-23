const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('poechat', {
  on: (channel, cb) => {
    const allowed = ['messages', 'emotes', 'config', 'lock', 'status', 'compose'];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  saveConfig: (partial) => ipcRenderer.send('save-config', partial),
  refreshEmotes: () => ipcRenderer.send('refresh-emotes'),
  toggleLock: () => ipcRenderer.send('toggle-lock'),
  resizeBy: (dw, dh) => ipcRenderer.send('resize-by', { dw, dh }),
  quit: () => ipcRenderer.send('quit'),
  sendChat: (text) => ipcRenderer.send('send-chat', text),
  cancelCompose: () => ipcRenderer.send('cancel-compose'),
});
