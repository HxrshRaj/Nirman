# How Nirman's HMR actually works

Code: [`src/devserver/`](../src/devserver/). This describes the real mechanism, tied to
the actual browser/JS-runtime behavior it depends on — module caching, closures, and
script execution — not just "it swaps the code."

## The pieces

1. **`incremental.ts`** (server-side): when a file changes, re-scan *only that file*
   (real parse + resolve, same code path as the initial graph build), diff its
   dependencies against what they were, pull in any newly-imported modules transitively,
   and drop edges to anything no longer imported. The rest of the graph is untouched —
   this is what makes it an incremental rebuild, not a full one.
2. **`server.ts`**: `chokidar` watches the project directory; on a change, it calls into
   `incremental.ts`, transforms just the changed/added modules, and pushes a small JSON
   payload over WebSocket: `{ changed: [{id, code}], added: [{id, code}] }`. It also
   regenerates the full servable bundle in the background so a *fresh* page load stays
   consistent, but that regeneration is not what makes the live page update — the
   WebSocket push is.
3. **`client-runtime.ts`** (runs in the browser): the actual HMR client.

## The client runtime, mechanism by mechanism

### The module cache is why "swapping code" is even possible

Nirman's runtime (both the plain production one and this dev one) is a real, minimal
CommonJS shim: `__nirman_require(id)` checks a cache keyed by module id, and if absent,
creates a fresh `{ exports: {} }`, puts it in the cache *before* running the module's
factory function (so a circular `require()` sees the in-progress object — see
[`docs/module-resolution.md`](./module-resolution.md)), then calls
`factory(module, module.exports, require)`.

Because every module's code lives in a **named JS function value** stored in a table
(`__nirman_modules[id]`), redefining that table entry and deleting the corresponding
cache entry is enough to make the *next* `require(id)` call execute genuinely different
code. This is the whole trick: browsers don't have a "reload one file" primitive, but
they do let you replace a function value and call it again — HMR is built entirely out of
that.

### Tracking who depends on whom, live, at run time

The server doesn't tell the client which modules depend on which — the **client derives
this itself**, dynamically, as modules actually run. Instead of passing the same global
`require` function to every module factory, `__nirman_boundRequire(fromId)` returns a
*closure* that remembers which module is calling, and records
`__nirman_dependents[targetId][fromId] = true` on every call before delegating to the
real `__nirman_requireModule`. By the time the app has finished its first render, this
map is a complete, accurate reverse-dependency graph — built the same way the module
graph itself gets built (by actually executing `require()` calls), not by re-parsing
anything.

### Accepting an update: `module.hot.accept()`

A module opts into being hot-swappable by calling `module.hot.accept()` during its own
top-level execution. This just sets `__nirman_hotAccepted[id] = true` (or a callback, if
one was passed). Nothing else in the runtime treats a module specially until this flag is
checked.

### Finding the right module to re-execute

When the server pushes an update for module `X`, the client doesn't just re-run `X`
unconditionally — it asks: **does the actual code that's currently on the page still hold
a reference into X that would go stale if X's exports object were thrown away?**

`__nirman_findAcceptingBoundary(id)` walks **up** the live dependents graph from the
changed id: if `id` itself accepted, that's the boundary — re-execute just `X`. If not,
check everyone who required `X` (its dependents); if none of them accepted either, check
*their* dependents, and so on, until either an acceptor is found or the search reaches
modules nobody requires (which means the top of the graph — the entry point) without ever
finding one.

- **If a boundary is found**: redefine it (already done, alongside every changed module)
  and delete-then-`require()` it again. Re-running its factory means every `require()`
  call inside it runs again too, picking up whatever was just redefined.
- **If no boundary is found anywhere on the path**: `window.location.reload()`. This is
  always correct — it's exactly what happens on every normal page load — just not smooth.
  It's the deliberate fallback for code that never declared it was safe to hot-swap.

### What state survives, and why

Re-executing a module's factory function creates a **brand-new closure scope** — every
`let`/`const`/`var` declared in that module's top level is reinitialized. Nothing about
JS closures lets you "resume" a function body with its previous local variables; a fresh
call means a fresh scope. So by default, hot-swapping a module **resets its local state**.

To preserve state on purpose, Nirman gives modules `module.hot.dispose(callback)`: right
before a module is redefined+re-executed, if it registered a dispose callback, that
callback is called with an empty object it can populate (e.g. `data.count = count`).
That object is stashed (`__nirman_hotData[id]`) and handed back as `module.hot.data` the
next time that module's factory runs — so the *new* execution can read it at the top and
restore whatever it chose to carry forward (see
[`test-projects/hmr-demo/view.js`](../test-projects/hmr-demo/view.js), which carries a
running counter and its mounted DOM element across edits this way). This mirrors real
production HMR runtimes (webpack's `module.hot.data` is the same idea) — state
preservation is opt-in and explicit, not automatic, because the runtime has no way to know
*which* state is safe to keep.

### CSS is a special, simpler case

A CSS module (via the CSS-in-JS extractor, `transform/plugins/css-to-js.ts`) has no
export bindings anything could hold a stale reference to — its only effect is a
`<style>` tag's `textContent`. So generated CSS modules call `module.hot.accept()`
unconditionally, and the generated code always reassigns the existing tag's
`textContent` rather than skipping if one already exists. A CSS edit therefore *always*
hot-swaps with no JS re-execution at all — verified live (see README) by editing a color
value and reading `getComputedStyle` immediately afterward, with no page reload.

## Verified, live, in a real browser

Documented in the README's Part 4 section: a running `setInterval` counter kept
incrementing (proving no reload and no state reset) while the label text next to it
changed to match a live source edit; a separate CSS edit changed a computed style with
zero JS re-execution; and an edit to a module that never calls `module.hot.accept()`
correctly fell back to a full reload.

## Limitations

- Dependents are tracked by **id**, discovered from actual `require()` calls at run time
  — a module that is never reached during the current execution (e.g. a branch of code
  that hasn't run yet) has no recorded dependents, so an edit to it will look like it has
  no acceptors and reload, even if code that *would* accept it exists but simply hasn't
  executed yet in this session.
- No per-export live bindings (see `module-resolution.md`) — accepting a module re-runs
  its whole factory; there's no finer-grained "just this one export changed" story.
- No CSS/JS diffing smarter than "re-run the changed file's factory" — if a change is
  syntactically invalid, the server reports the error over the socket instead of crashing,
  but there's no partial/best-effort HMR for a broken module.
