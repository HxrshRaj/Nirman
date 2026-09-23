# Module resolution and dependency graph

This document describes exactly how Nirman turns an entry file into a dependency graph:
how specifiers are parsed, how they're resolved to real files on disk, how circular
dependencies are detected, and a real edge case discovered (and fixed) while building it.

Code: [`src/resolver/`](../src/resolver/).

## 1. Finding import/require statements — a real parser, not regex

`resolver/parse-imports.ts` parses a module's source with **Acorn** (extended with
`acorn-jsx` for `.jsx`/`.tsx`), then walks the resulting AST (`acorn-walk`) looking for:

- `import ... from 'x'`
- `export ... from 'x'` / `export * from 'x'`
- `import('x')` (dynamic import, static string literal only)
- `require('x')` (any static string literal call, anywhere in the file — not just at the
  top level; see §4 below for why that matters)

Regex-matching import statements is fragile: a string or comment that merely *looks like*
an import (`// import { X } from 'y'` or `const s = "import z from 'w'"`) would be a false
positive, and text-based matching can't give exact character offsets for later rewriting.
Parsing gets both right for free.

`.ts`/`.tsx` files are first run through the TypeScript compiler's `transpileModule` in
"strip types only" mode (`resolver/ts-strip.ts`) so Acorn — which has no TypeScript
support — can parse the result. This is the one place Nirman leans on an existing parser
for something it isn't trying to reimplement (erasing TS-only syntax); everything about
resolution, graph-building, transformation and bundling downstream is Nirman's own code.

## 2. Resolving a specifier to a file

`resolver/resolve.ts` implements a simplified but real version of Node's resolution
algorithm:

- **Relative/absolute** (`./x`, `../x`, `/x`): resolve relative to the importing file's
  directory. Try the exact path; then each of `.js .jsx .ts .tsx .json`; then, if it's a
  directory, its `package.json` `"module"`/`"main"` field (recursively resolved as a file
  or `index.*`), or plain `index.*`.
- **Bare specifiers** (`lodash`, `@scope/pkg`, `react-dom/client`): walk up the directory
  tree from the importer, checking `<dir>/node_modules/<specifier>` at each level (as a
  file, then as a directory) exactly like Node does, stopping at the filesystem root.

This was verified against a real installed npm package tree (React 18 + react-dom +
scheduler, ~17 files once transitively resolved — see [`demo-app/`](../demo-app)), not
just hand-written fixtures, including subpath specifiers like `react-dom/client` that
resolve to a physically-shipped file rather than through package.json's `exports` map
(Nirman does not implement the `exports` map itself — see Limitations below).

## 3. Building the graph

`resolver/graph.ts` does an **iterative** (work-list, not recursive) breadth-first
traversal from the entry file: parse imports, resolve each one, and if it's a module the
graph hasn't seen yet, queue it. This is deliberate — a recursive implementation can
stack-overflow on a deep or explosively cyclic import graph; an explicit queue can't.

Cycle detection is **Tarjan's strongly-connected-components algorithm**, also implemented
iteratively (an explicit stack of "call frames" instead of real recursion, for the same
stack-safety reason). Any SCC with more than one member — or a single module that imports
itself — is a real circular dependency, recorded in `graph.cycles`.

Verified on a 13-file test project ([`test-projects/graph-demo`](../test-projects/graph-demo))
with a genuine circular pair (`services/api.js` ↔ `services/cache.js`): the printed graph
(`scripts/print-graph.js`) was checked edge-by-edge against the source files, and exactly
one cycle was detected, matching the one deliberately written.

## 4. A real edge case: destructured imports and circular dependencies

This was **discovered empirically**, not designed for in advance — see
[`test-projects/circular-binding-demo`](../test-projects/circular-binding-demo) for the
isolated repro and `scripts/test-circular-binding.js` for the test that surfaces it.

Nirman's transform (`transform/plugins/esm-to-cjs.ts`) rewrites `import { X } from './y'`
into `const { X } = require('./y');` — a **destructuring snapshot** taken at the exact
moment that line executes. If `./y` is on a circular path and hasn't run its own
`export const X = ...` yet at that moment (because the *other* half of the cycle required
it first), `X` is captured as `undefined`, permanently — reassigning `exports.X` later
does not update an already-destructured local variable.

This matches real Node.js `require()` behavior for the same pattern; Nirman doesn't
introduce a new limitation, it inherits a well-known one from choosing to compile down to
CommonJS-style requires instead of implementing live ES-module bindings (which real ESM
gives you for free, and which tools like Rollup approximate with generated getters — a
scope Nirman doesn't attempt).

**The concrete fix**, applied to [`test-projects/graph-demo/src/services/cache.js`](../test-projects/graph-demo/src/services/cache.js):
use a **namespace import** (`import * as api from './api'`) instead of a destructured
one, and read `api.API_VERSION` **lazily**, inside a function body that only runs after
the whole module graph has finished loading. A namespace import binds to the *same live
object* the other module writes into, so a property read after that module has finished
initializing always sees the current value — only destructuring at the moment of
circular re-entry is unsafe.

Verified concretely (`scripts/test-circular-binding.js` bundles and runs both versions):

```
# destructured named import, evaluated during the circular window:
A_VALUE seen from b.js = undefined, aFn() = undefined

# namespace import, read lazily:
A_VALUE seen from b.js = "a-value", aFn() = a-called
```

## Known simplifications

- **No `package.json` `"exports"` map.** Modern dual-format packages increasingly rely on
  conditional exports; Nirman only reads `"main"`/`"module"` and falls back to files that
  happen to physically exist at the requested subpath (which is why `react-dom/client`
  resolves — the file `react-dom/client.js` really is there — but a package that *only*
  defines a subpath through `exports`, with no matching physical file, would not resolve).
- **No `.mjs`/`.cjs` extension handling or self-referencing package names.**
- **TypeScript type erasure loses original `.ts` source-map positions** for the strip
  step (see [`docs/how-hmr-works.md`](./how-hmr-works.md) and the README for the
  source-map scope Nirman does fully verify, which is JS/JSX).
