// Gives renderer.js the same `poechat` API it had under Electron, backed by Tauri.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const handlers = {};
  const listening = [];
  const fire = (ch, payload) => (handlers[ch] || []).forEach((cb) => cb(payload));

  window.poechat = {
    on(channel, cb) {
      (handlers[channel] = handlers[channel] || []).push(cb);
      listening.push(listen(channel, (e) => cb(e.payload)));
    },
    // Call once every listener is registered: fetches the starting state and starts the log reader.
    async ready() {
      await Promise.all(listening);
      const s = await invoke('init');
      fire('config', s.config);
      fire('emotes', s.emotes);
      fire('lock', s.locked);
      if (s.status) fire('status', s.status);
    },
    saveConfig: (partial) => invoke('save_config', { partial }),
    refreshEmotes: () => invoke('refresh_emotes'),
    toggleLock: () => invoke('toggle_lock'),
    resizeBy: (dw, dh) => invoke('resize_by', { dw, dh }),
    quit: () => invoke('quit'),
  };
})();
