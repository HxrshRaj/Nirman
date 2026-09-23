/**
 * Nirman's module runtime: a minimal, real CommonJS-style `require`/`module` shim.
 * This is the actual mechanism that makes bundled module boundaries work at run time —
 * every transformed module (see transform/plugins/esm-to-cjs.ts) is wrapped in a factory
 * function taking `(module, exports, require)`, exactly like Node's own module wrapper.
 *
 * Circular dependencies are handled the same way Node's real `require()` handles them:
 * a module's cache entry is created and inserted into the cache BEFORE its factory runs,
 * so a circular `require()` call reached while the first module is still executing gets
 * back that in-progress (possibly only partially populated) `module.exports` object,
 * instead of recursing forever or throwing.
 */
export function runtimeHeader(): string {
  return `(function () {
  var __nirman_modules = {};
  var __nirman_cache = {};

  function __nirman_define(id, factory) {
    __nirman_modules[id] = factory;
  }

  function __nirman_require(id) {
    var cached = __nirman_cache[id];
    if (cached) {
      if (cached.error) throw cached.error;
      return cached.exports;
    }

    var factory = __nirman_modules[id];
    if (!factory) {
      throw new Error('Nirman: module not found: "' + id + '"');
    }

    var module = { id: id, exports: {} };
    // Inserted into the cache BEFORE running the factory: a circular require() of this
    // same id, reached while this factory is still executing, sees this exact object
    // (module.exports), possibly not yet fully populated -- the same trade-off real
    // Node.js CommonJS require() makes for circular dependencies.
    __nirman_cache[id] = module;

    try {
      factory(module, module.exports, __nirman_require);
    } catch (err) {
      delete __nirman_cache[id];
      throw err;
    }

    return module.exports;
  }

  var __nirman_globalRequire = __nirman_require;
`;
}

export function runtimeFooter(entryId: string): string {
  return `
  __nirman_require(${JSON.stringify(entryId)});
})();
`;
}

export function moduleHeader(id: string): string {
  return `__nirman_define(${JSON.stringify(id)}, function (module, exports, require) {\n`;
}

export function moduleFooter(): string {
  return `\n});\n`;
}
