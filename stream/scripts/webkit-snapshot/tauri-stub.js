// Stands in for Tauri's IPC, so the real React hooks run in a plain WKWebView.
// Injected at document start, before any app code.
//
// Answer commands by defining window.__TAURI_STUBS__ in your own stub file
// (passed with --stub). Each entry is a value or a function of the command's
// arguments, and may return a promise; throw or reject to make invoke fail:
//
//   window.__TAURI_STUBS__ = {
//     get_notes_sync_status: ({ folderPath }) => ({ ... }),
//     sync_notes: () => new Promise(() => {}), // Never settles: "in progress"
//   };
//
// Unknown commands reject with "no stub for <cmd>" and are listed by
// window.__tauriStub.missing, so a snapshot shows which ones you still need.
// window.__tauriStub.emit(event, payload) fires Tauri event listeners, for
// example "tauri://blur" and "tauri://focus" for window focus.
(() => {
  const callbacks = new Map();
  const listeners = new Map(); // event name -> callback ids
  const stores = new Map(); // rid -> Map of key -> value
  const missing = new Set();
  let nextId = 1;

  const defaults = {
    "plugin:app|version": "0.0.0-snapshot",
    "plugin:app|name": "stream",
    "plugin:updater|check": null, // No update, and no console error
    "plugin:store|load": () => {
      const rid = nextId++;
      stores.set(rid, new Map());
      return rid;
    },
    "plugin:store|get_store": () => null,
    "plugin:store|get": ({ rid, key }) => {
      const store = stores.get(rid);
      return store?.has(key) ? [store.get(key), true] : [null, false];
    },
    "plugin:store|set": ({ rid, key, value }) => {
      stores.get(rid)?.set(key, value);
    },
    "plugin:store|save": null,
    "plugin:event|listen": ({ event, handler }) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return handler;
    },
    "plugin:event|unlisten": ({ event, eventId }) => {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((id) => id !== eventId),
      );
    },
    "plugin:event|emit": null,
  };

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
    transformCallback: (callback, once) => {
      const id = nextId++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        return callback?.(payload);
      });
      return id;
    },
    unregisterCallback: (id) => callbacks.delete(id),
    convertFileSrc: (path) => path,
    invoke: async (cmd, args = {}) => {
      const stubs = window.__TAURI_STUBS__ ?? {};
      const answer = cmd in stubs ? stubs[cmd] : defaults[cmd];
      if (answer === undefined && !(cmd in stubs) && !(cmd in defaults)) {
        missing.add(cmd);
        throw `no stub for ${cmd}`;
      }
      return typeof answer === "function" ? answer(args) : answer;
    },
  };

  window.__tauriStub = {
    get missing() {
      return [...missing];
    },
    emit: (event, payload) => {
      for (const id of listeners.get(event) ?? []) {
        callbacks.get(id)?.({ event, id, payload });
      }
    },
  };
})();
