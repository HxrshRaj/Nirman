import * as acorn from 'acorn';
import MagicString from 'magic-string';
import { DependencyEdge, ModuleKind } from '../resolver/types';

/** Everything a plugin needs to know about the module it's transforming. */
export interface TransformContext {
  /** Absolute path of the module being transformed — used as its bundle id. */
  id: string;
  kind: ModuleKind;
  /** Resolved import/require edges for this module, in source order. */
  dependencies: DependencyEdge[];
  /** Look up the resolved absolute path for a specifier appearing at a given AST-node
   *  start offset (there can be more than one `import './x'` with the same text). */
  resolve(specifierStart: number): string;
}

/**
 * A plugin gets the parsed AST and a *shared* MagicString instance for the module and
 * mutates it in place (overwrite/remove/appendLeft/...). Every plugin's edits are
 * expressed as offsets into the ORIGINAL source text, so multiple plugins can edit
 * disjoint regions of the same module without needing to re-parse each other's output
 * or chain separate source maps together — the single MagicString instance tracks all
 * edits back to the one original source, and a single generateMap() call at the end
 * produces the true, accurate source map.
 */
export interface JsPlugin {
  name: string;
  /** Should this plugin run at all for this module? */
  test(ctx: TransformContext): boolean;
  /** Mutate `magicString` in place using `ast` for node positions. */
  apply(ast: acorn.Node, magicString: MagicString, ctx: TransformContext): void;
}

export interface TransformOutput {
  code: string;
  /** Raw source-map JSON (v3), or null if this module produced no map (e.g. JSON). */
  map: RawSourceMap | null;
}

export interface RawSourceMap {
  version: number;
  file?: string;
  sources: string[];
  sourcesContent?: (string | null)[];
  names: string[];
  mappings: string;
}
