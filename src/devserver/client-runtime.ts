/**
 * The dev-mode module runtime: everything the plain production runtime
 * (bundle/runtime.ts) has, PLUS real hot-module-replacement machinery. See
 * docs/how-hmr-works.md for the full writeup; this is the actual client-side code that
 * document describes.
 *
 * Design in one paragraph: every module's bound `require(id)` records, at run time,
 * an edge in `__nirman_dependents[depId][callerId] = true`. That live, runtime-observed
 * graph (not anything statically computed by the server) is what HMR propagation walks.
 * When the server pushes an update for a changed module, we look for the nearest
 * "self-accepting" module reachable by walking UP that dependents graph (the changed
 * module itself, or whichever ancestor called `module.hot.accept()`); we redefine and
 * re-execute that boundary module, which re-requires its (now-updated) dependencies and
 * picks up the new code. If no acceptor is found anywhere on the path up to the entry,
 * we fall back to a full page reload -- always correct, if less smooth.
 */
export function devRuntimeHeader(): string {
  return `(function () {
  if (typeof process === 'undefined') {
    var process = { env: { NODE_ENV: 'development' } };
  }
  var __nirman_modules = {};
  var __nirman_cache = {};
  var __nirman_dependents = {}; // depId -> { callerId: true, ... }
  var __nirman_hotAccepted = {}; // id -> true | callback
  var __nirman_hotDispose = {}; // id -> callback
  var __nirman_hotData = {}; // id -> data object handed from dispose() to the next run

  function __nirman_define(id, factory) {
    __nirman_modules[id] = factory;
  }

  function __nirman_makeHot(id) {
    var data = __nirman_hotData[id];
    delete __nirman_hotData[id];
    return {
      data: data,
      accept: function (cb) { __nirman_hotAccepted[id] = cb || true; },
      dispose: function (cb) { __nirman_hotDispose[id] = cb; },
    };
  }

  function __nirman_boundRequire(fromId) {
    return function (id) {
      if (!__nirman_dependents[id]) __nirman_dependents[id] = {};
      __nirman_dependents[id][fromId] = true;
      return __nirman_requireModule(id);
    };
  }

  function __nirman_requireModule(id) {
    var cached = __nirman_cache[id];
    if (cached) {
      if (cached.error) throw cached.error;
      return cached.exports;
    }

    var factory = __nirman_modules[id];
    if (!factory) {
      throw new Error('Nirman: module not found: "' + id + '"');
    }

    var module = { id: id, exports: {}, hot: __nirman_makeHot(id) };
    __nirman_cache[id] = module;

    try {
      factory(module, module.exports, __nirman_boundRequire(id));
    } catch (err) {
      delete __nirman_cache[id];
      throw err;
    }

    return module.exports;
  }

  function __nirman_findAcceptingBoundary(id, seen) {
    seen = seen || {};
    if (seen[id]) return null;
    seen[id] = true;
    if (__nirman_hotAccepted[id]) return id;
    var dependents = __nirman_dependents[id];
    if (!dependents) return null;
    for (var depId in dependents) {
      var found = __nirman_findAcceptingBoundary(depId, seen);
      if (found !== null) return found;
    }
    return null;
  }

  function __nirman_reExecute(id) {
    delete __nirman_cache[id];
    __nirman_requireModule(id);
  }

  function __nirman_applyUpdate(payload) {
    (payload.added || []).forEach(function (m) {
      __nirman_define(m.id, new Function('module', 'exports', 'require', m.code + '\\n//# sourceURL=' + m.id));
    });

    var changedIds = [];
    (payload.changed || []).forEach(function (m) {
      var old = __nirman_cache[m.id];
      if (old && __nirman_hotDispose[m.id]) {
        var data = {};
        try { __nirman_hotDispose[m.id](data); } catch (e) { console.error('[nirman] dispose() threw for', m.id, e); }
        __nirman_hotData[m.id] = data;
      }
      delete __nirman_hotDispose[m.id];
      // NOTE: __nirman_hotAccepted[m.id] is deliberately NOT cleared here -- we still
      // need it in the boundary search right below, to know this module accepted last
      // time. Re-executing it will call module.hot.accept() again and refresh the flag.
      __nirman_define(m.id, new Function('module', 'exports', 'require', m.code + '\\n//# sourceURL=' + m.id));
      changedIds.push(m.id);
    });

    var reloadNeeded = false;
    changedIds.forEach(function (id) {
      var boundary = __nirman_findAcceptingBoundary(id);
      if (boundary === null) {
        reloadNeeded = true;
        return;
      }
      __nirman_reExecute(boundary);
      var accept = __nirman_hotAccepted[boundary];
      if (typeof accept === 'function') {
        try { accept(__nirman_cache[boundary] && __nirman_cache[boundary].exports); } catch (e) { console.error('[nirman] accept() callback threw for', boundary, e); }
      }
      console.log('[nirman] hot-updated module boundary:', boundary, '(changed file:', id + ')');
    });

    if (reloadNeeded) {
      console.log('[nirman] no HMR acceptor on the update path -- doing a full reload');
      window.location.reload();
    }
  }

  window.__nirmanApplyUpdate = __nirman_applyUpdate;
`;
}

export function devRuntimeFooter(entryId: string, wsUrl: string): string {
  return `
  (function connect() {
    var ws = new WebSocket(${JSON.stringify(wsUrl)});
    ws.addEventListener('message', function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'update') __nirman_applyUpdate(msg);
      else if (msg.type === 'reload') window.location.reload();
      else if (msg.type === 'error') console.error('[nirman]', msg.message);
    });
    ws.addEventListener('open', function () { console.log('[nirman] HMR connected'); });
    ws.addEventListener('close', function () {
      console.log('[nirman] HMR socket closed, retrying in 1s');
      setTimeout(connect, 1000);
    });
  })();

  __nirman_requireModule(${JSON.stringify(entryId)});
})();
`;
}
