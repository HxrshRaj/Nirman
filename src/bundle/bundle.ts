import { Bundle } from 'magic-string';
import { DependencyGraph } from '../resolver/types';
import { transformModuleToMagicString } from '../transform/pipeline';
import { computeBundleIds } from './ids';
import { runtimeHeader, runtimeFooter, moduleHeader, moduleFooter } from './runtime';

export interface BundleResult {
  code: string;
  map: {
    version: number;
    file?: string;
    sources: string[];
    sourcesContent?: (string | null)[];
    names: string[];
    mappings: string;
  };
  /** absolute path -> short bundle id, exposed for the dev server / HMR and the graph visualizer */
  ids: Map<string, string>;
}

/**
 * Assembles the full dependency graph into one executable bundle: every module is
 * transformed (ESM->CJS, JSX->createElement, CSS extraction, ...) and wrapped in a
 * `__nirman_define(id, factory)` call, and the whole thing is wired up by the module
 * runtime (bundle/runtime.ts) which calls `__nirman_require(entryId)` once at the end.
 *
 * Source maps for every module are combined into ONE accurate bundle-level source map
 * using MagicString's own `Bundle`, rather than concatenating strings and hand-rolling
 * offset math — each module's real per-token mappings survive being moved into the
 * bigger file.
 */
export function createBundle(graph: DependencyGraph): BundleResult {
  const ids = computeBundleIds(graph);
  const idFor = (absPath: string): string => {
    const id = ids.get(absPath);
    if (!id) throw new Error(`No bundle id computed for module: ${absPath}`);
    return id;
  };

  const msBundle = new Bundle();
  msBundle.append(runtimeHeader(), {});

  for (const [absPath, node] of graph.modules) {
    const ms = transformModuleToMagicString(node, undefined, idFor);
    ms.prepend(moduleHeader(idFor(absPath)));
    ms.append(moduleFooter());
    msBundle.addSource({ content: ms, filename: absPath });
  }

  msBundle.append(runtimeFooter(idFor(graph.entry)), {});

  const map = msBundle.generateMap({ includeContent: true, hires: true });

  return {
    code: msBundle.toString(),
    map: {
      version: map.version,
      file: map.file,
      sources: map.sources,
      sourcesContent: map.sourcesContent,
      names: map.names,
      mappings: map.mappings,
    },
    ids,
  };
}
