import * as path from 'path';
import { DependencyGraph } from '../resolver/types';

/**
 * Assigns every module a short, stable, filesystem-path-free id derived from its path
 * relative to the entry's directory (e.g. "./components/Header.js",
 * "../node_modules/left-pad/index.js"). Stable per absolute path — independent of
 * discovery order — which matters for HMR: the same file must keep the same id across
 * incremental rebuilds so the client's module cache can be patched in place.
 */
export function computeBundleIds(graph: DependencyGraph): Map<string, string> {
  const root = path.dirname(graph.entry);
  const ids = new Map<string, string>();
  for (const id of graph.modules.keys()) {
    let rel = path.relative(root, id).split(path.sep).join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    ids.set(id, rel);
  }
  return ids;
}
