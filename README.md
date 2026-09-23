# Nirman

A JavaScript build tool — bundler, transformer, and dev server with real hot module
replacement — built from scratch in TypeScript. No `esbuild`/`webpack`/`rollup` under the
hood: the dependency resolution, module transformation, bundling, module runtime, and HMR
client are all Nirman's own code.

**Live demo:** _link once deployed — see "Status" below_
**Dependency graph visualizer:** _link once deployed — see "Status" below_

## Why this exists

This project exists to demonstrate the mechanics real front-end build tools (Grunt,
Gulp, webpack, Vite, esbuild) hide behind a config file: how a `import`/`require` graph
actually gets resolved and walked, how ESM/JSX syntax actually gets rewritten into
something a browser or Node can run, how a bundle's module boundaries actually work at
run time, and — the part that most depends on real browser mechanics — how a dev server
can patch a running page's JavaScript in place without reloading it.

## Architecture

```
entry file
   |
   v
resolver (src/resolver)         real Acorn/acorn-jsx parse -> import/require offsets
   |                            -> simplified real Node-style resolution
   |                            -> iterative graph build + Tarjan cycle detection
   v
transform (src/transform)       shared AST + MagicString per module
   |                            -> esm-to-cjs, jsx->createElement, css-in-js extractor
   |                            -> real source maps (MagicString.generateMap)
   v
bundle (src/bundle)             MagicString Bundle combines every module's map into one
   |                            -> stable path-relative module ids
   |                            -> minimal real CommonJS require()/module shim
   v
dev server (src/devserver)      http + ws + chokidar
                                 -> incremental re-transform of only the changed file(s)
                                 -> HMR client runtime: accept/dispose, live dependents
                                    graph, boundary search, reload fallback
```

Each stage is a real, independent mechanism — see the docs below for the parts that
needed the most care:

- [`docs/module-resolution.md`](docs/module-resolution.md) — resolution algorithm,
  cycle detection, and a genuine circular-import edge case that was found (and fixed)
  while testing, not designed for in advance.
- [`docs/how-hmr-works.md`](docs/how-hmr-works.md) — exactly what the HMR client does to
  a running page: module caching, the live dependents graph, accept/dispose, and what
  state does and doesn't survive a hot swap, tied back to real JS/browser mechanics
  (closures, script execution, module caching).

## Running it

```bash
npm install
npx tsc -p tsconfig.json
```

**Inspect a dependency graph** (prints every module and edge, plus any cycles found):

```bash
node dist/cli/index.js graph test-projects/graph-demo/src/index.js
```

**Export it as JSON**, for the visualizer or anything else:

```bash
node dist/cli/index.js graph-json demo-app/src/index.jsx --out demo-app/dist/graph/graph.json
```

**Production build** (writes a bundle + a real source map):

```bash
node dist/cli/index.js build demo-app/src/index.jsx --out demo-app/dist/bundle.js
```

**Dev server with HMR**:

```bash
node dist/cli/index.js dev demo-app/src/index.jsx --port 4322
# open http://localhost:4322, then edit any file under demo-app/src
```

## What's real here (and how it was verified, not just claimed)

| Part | What it does | How it was verified |
|---|---|---|
| Resolver + graph | Acorn-based import scanning, Node-style resolution, cycle detection | Built and printed the graph for a real 13-file project with a genuine circular pair; checked every edge by hand; verified `node_modules` main-field resolution, extension inference, and directory/index resolution against real fixtures |
| Transform | ESM→CJS, JSX→`createElement`, CSS-in-JS extraction, real source maps | Transformed a real `.jsx` file, confirmed the output parses as valid JS (Acorn), then used `source-map`'s `SourceMapConsumer` to map two independent generated positions back through the map and confirmed they point at the exact right original source line |
| Bundler + runtime | Real CommonJS-style `require`/`module` shim, combined bundle-level source maps | Bundled the 13-file project and *executed the output in Node*; the circular pair produces the correct value on a real cache hit; found and fixed a real bug where third-party CJS `require()` calls (inside React's own source) weren't being rewritten to resolved ids |
| Dev server + HMR | Incremental rebuild on file change, live dependents graph, accept/dispose, reload fallback | Ran the dev server against a real fixture in a real browser, edited a file live, and watched (a) a running counter keep counting across a hot swap (state preserved via `module.hot.data`), (b) a CSS edit change a computed style with no reload, (c) an edit to a non-accepting module correctly trigger a full reload |
| Demo app | Multi-component React app, CSS, an async operation, real interactivity | Built with Nirman itself (17 modules incl. React/react-dom/scheduler's own internals, resolved through Nirman's own `node_modules` resolution); loaded in a real browser via both `nirman dev` and a static `nirman build` output; clicked a real checkbox and confirmed the resulting state update |
| Graph visualizer | D3 force-directed rendering of the real graph | Generated `graph.json` for the demo app, spot-checked several edges against the actual source files, loaded the visualizer against it in a real browser and confirmed all 17 node labels render |

## What's simplified compared to a production bundler

- **No live ES-module bindings** for circular dependencies — Nirman compiles to
  CommonJS-style `require()`, which has the same well-known destructured-circular-import
  caveat real Node.js `require()` has. See `docs/module-resolution.md` for the concrete
  repro and the (real, verified) workaround.
- **No `package.json` `"exports"` map** — only `"main"`/`"module"` plus physical-file
  fallback.
- **No code splitting** — one entry produces one bundle.
- **No JSX spread attributes/children** (`<Foo {...props}/>`) — the transform throws a
  clear error rather than silently emitting wrong code.
- **CSS gets no line-accurate source map** — the whole file is synthesized into a
  style-injecting module; JS/JSX source maps are fully real and verified (see the table
  above), CSS attribution is file-level only.
- **HMR dependents are runtime-observed, not statically computed** — a module that
  hasn't executed yet in the current session has no recorded dependents (see
  `docs/how-hmr-works.md`).

## What would get hardened with more time

- Real live-binding support for circular ESM imports (getter-based, like Rollup), instead
  of documenting the CJS-style limitation.
- `package.json` `"exports"` map support.
- Finer-grained HMR (per-export invalidation) instead of whole-module re-execution.
- Code splitting / dynamic `import()` producing separate chunks instead of being resolved
  eagerly into the same bundle.
- A real test suite (the current verification is a set of purpose-built scripts under
  `scripts/` and `test-projects/`, run and inspected manually) rather than an assertion
  framework wired into CI.

## Status

- [x] Part 1 — resolver + dependency graph
- [x] Part 2 — transformation pipeline + source maps
- [x] Part 3 — bundler + module runtime
- [x] Part 4 — dev server + real HMR
- [x] Part 5 — demo app dogfooded with Nirman
- [x] Part 6 — dependency graph visualizer
- [ ] Live deployment of the demo app + visualizer, and the public GitHub repo link —
  pending GitHub/hosting authentication (see the final summary in this session for what's
  needed to finish this step).
