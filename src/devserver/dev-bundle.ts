import { Bundle } from 'magic-string';
import { DependencyGraph } from '../resolver/types';
import { transformModuleToMagicString } from '../transform/pipeline';
import { computeBundleIds } from '../bundle/ids';
import { moduleHeader, moduleFooter } from '../bundle/runtime';
import { devRuntimeHeader, devRuntimeFooter } from './client-runtime';

export interface DevBundleResult {
  code: string;
  map: Record<string, unknown>;
  ids: Map<string, string>;
}

/** Same assembly strategy as bundle/bundle.ts, but wrapped in the HMR-aware runtime
 *  (client-runtime.ts) instead of the plain production one. */
export function createDevBundle(graph: DependencyGraph, wsUrl: string): DevBundleResult {
  const ids = computeBundleIds(graph);
  const idFor = (absPath: string): string => {
    const id = ids.get(absPath);
    if (!id) throw new Error(`No bundle id computed for module: ${absPath}`);
    return id;
  };

  const msBundle = new Bundle();
  msBundle.append(devRuntimeHeader(), {});

  for (const [absPath, node] of graph.modules) {
    const ms = transformModuleToMagicString(node, undefined, idFor);
    ms.prepend(moduleHeader(idFor(absPath)));
    ms.append(moduleFooter());
    msBundle.addSource({ content: ms, filename: absPath });
  }

  msBundle.append(devRuntimeFooter(idFor(graph.entry), wsUrl), {});

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
