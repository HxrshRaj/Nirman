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

/**
 * Transform a single module: run every applicable plugin against a shared MagicString
 * built from the module's parsable source, then generate a real v3 source map from the
 * accumulated edits. `.css` and `.json` take separate, simpler code paths since they
 * have no JS AST of their own.
 */
export function transformModule(node: ModuleNode, plugins: JsPlugin[] = DEFAULT_PLUGINS): TransformOutput {
  if (node.kind === 'css') {
    return transformCss(node);
  }

  if (node.kind === 'json') {
    return { code: `module.exports = ${node.source};\n`, map: null };
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
      return resolved;
    },
  };

  for (const plugin of plugins) {
    if (plugin.test(ctx)) {
      plugin.apply(ast, s, ctx);
    }
  }

  const map = s.generateMap({
    source: node.id,
    includeContent: true,
    hires: true,
  });

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
