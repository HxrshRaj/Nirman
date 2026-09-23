import * as acorn from 'acorn';
import jsx from 'acorn-jsx';
import MagicString from 'magic-string';
import { ModuleNode } from '../resolver/types';
import { stripTypes } from '../resolver/ts-strip';
import { JsPlugin, TransformContext, TransformOutput } from './types';
import { esmToCjsPlugin } from './plugins/esm-to-cjs';
import { jsxPlugin } from './plugins/jsx';
import { transformCss } from './plugins/css-to-js';

const JSXParser = acorn.Parser.extend(jsx());

const DEFAULT_PLUGINS: JsPlugin[] = [esmToCjsPlugin, jsxPlugin];

/** The exact source text this module's AST/MagicString/offsets are all expressed in
 *  (raw source for .js/.jsx, type-stripped source for .ts/.tsx — matching what
 *  resolver/graph.ts used when it recorded dependency edge offsets). */
function parsableSourceFor(node: ModuleNode): string {
  if (node.kind === 'ts') return stripTypes(node.source, false);
  if (node.kind === 'tsx') return stripTypes(node.source, true);
  return node.source;
}

export type IdResolver = (absolutePath: string) => string;

const identityId: IdResolver = (p) => p;

/**
 * Runs the plugin pipeline for a single module and returns the live MagicString
 * instance (not just a rendered string). Bundling many modules together uses
 * MagicString's own `Bundle` to combine these into a single accurate source map
 * instead of hand-stitching separately-generated per-module maps.
 *
 * `idFor` lets the caller control what a `require(...)` call inside the module resolves
 * to: standalone single-module use (transformModule, below) leaves it as the absolute
 * path; the real bundler (bundle/bundle.ts) passes short, stable per-file ids so the
 * emitted bundle doesn't leak local filesystem paths.
 */
export function transformModuleToMagicString(
  node: ModuleNode,
  plugins: JsPlugin[] = DEFAULT_PLUGINS,
  idFor: IdResolver = identityId
): MagicString {
  if (node.kind === 'css') {
    return new MagicString(transformCss(node).code, { filename: node.id });
  }

  if (node.kind === 'json') {
    return new MagicString(`module.exports = ${node.source};\n`, { filename: node.id });
  }

  const source = parsableSourceFor(node);
  const isJsx = node.kind === 'jsx' || node.kind === 'tsx';
  const Parser = isJsx ? JSXParser : acorn.Parser;

  const ast = Parser.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });

  const s = new MagicString(source, { filename: node.id });

  const startToResolved = new Map<number, string>();
  for (const dep of node.dependencies) startToResolved.set(dep.start, dep.resolved);

  const ctx: TransformContext = {
    id: node.id,
    kind: node.kind,
    dependencies: node.dependencies,
    resolve(specifierStart: number) {
      const resolved = startToResolved.get(specifierStart);
      if (!resolved) {
        throw new Error(`No resolved dependency recorded for specifier at offset ${specifierStart} in ${node.id}`);
      }
      return idFor(resolved);
    },
  };

  for (const plugin of plugins) {
    if (plugin.test(ctx)) {
      plugin.apply(ast, s, ctx);
    }
  }

  return s;
}

/**
 * Transform a single module in isolation and render it to a standalone {code, map}
 * pair. Used for direct, single-file verification (see scripts/test-transform.js);
 * the real bundler uses transformModuleToMagicString directly so it can combine many
 * modules' maps into one via MagicString's Bundle.
 */
export function transformModule(node: ModuleNode, plugins: JsPlugin[] = DEFAULT_PLUGINS): TransformOutput {
  if (node.kind === 'css') return transformCss(node);
  if (node.kind === 'json') return { code: `module.exports = ${node.source};\n`, map: null };

  const s = transformModuleToMagicString(node, plugins);
  const map = s.generateMap({ source: node.id, includeContent: true, hires: true });

  return {
    code: s.toString(),
    map: {
      version: map.version,
      file: map.file,
      sources: map.sources,
      sourcesContent: map.sourcesContent,
      names: map.names,
      mappings: map.mappings,
    },
  };
}

export { DEFAULT_PLUGINS };
