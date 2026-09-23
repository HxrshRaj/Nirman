import * as fs from 'fs';
import { DependencyGraph, DependencyEdge, ModuleNode } from '../resolver/types';
import { resolveModule, kindForFile } from '../resolver/resolve';
import { parseImports } from '../resolver/parse-imports';
import { stripTypes } from '../resolver/ts-strip';

function readParsable(file: string, kind: ModuleNode['kind']): string {
  const raw = fs.readFileSync(file, 'utf8');
  if (kind === 'ts') return stripTypes(raw, false);
  if (kind === 'tsx') return stripTypes(raw, true);
  return raw;
}

export interface IncrementalResult {
  /** The module that was actually edited on disk. */
  changed: ModuleNode;
  /** Modules that are newly reachable because the edit added an import that didn't
   *  exist in the graph before (transitively pulled in, same as the initial build). */
  added: ModuleNode[];
  /** Resolved ids that `changed` no longer depends on after the edit. */
  removedEdges: string[];
}

/**
 * Re-scans exactly one changed file and mutates `graph` in place to reflect the new
 * reality, pulling in any newly-imported modules the same way the initial graph build
 * does (real resolution, not a guess) and dropping edges to imports that were deleted.
 * Deliberately does NOT re-parse or re-transform anything else in the graph — this is
 * what makes a dev-server edit an incremental rebuild instead of a full one.
 */
export function applyFileChange(graph: DependencyGraph, changedFile: string): IncrementalResult {
  const existing = graph.modules.get(changedFile);
  if (!existing) {
    throw new Error(`applyFileChange called for a file not in the graph: ${changedFile}`);
  }

  const kind = kindForFile(changedFile);
  const rawSource = fs.readFileSync(changedFile, 'utf8');
  const parsable = kind === 'ts' || kind === 'tsx' ? readParsable(changedFile, kind) : rawSource;
  const rawImports = kind === 'json' || kind === 'css' ? [] : parseImports(parsable, kind);

  const newDependencies: DependencyEdge[] = [];
  for (const imp of rawImports) {
    const resolved = resolveModule(imp.specifier, changedFile);
    newDependencies.push({ specifier: imp.specifier, resolved, start: imp.start, end: imp.end, kind: imp.kind });
  }

  const oldResolvedSet = new Set(existing.dependencies.map((d) => d.resolved));
  const newResolvedSet = new Set(newDependencies.map((d) => d.resolved));

  const removedEdges = [...oldResolvedSet].filter((r) => !newResolvedSet.has(r));
  const addedEdgeTargets = [...newResolvedSet].filter((r) => !oldResolvedSet.has(r));

  // Drop this module from the dependents list of anything it no longer imports.
  for (const removed of removedEdges) {
    graph.modules.get(removed)?.dependents.delete(changedFile);
  }

  const changedNode: ModuleNode = {
    id: changedFile,
    kind,
    source: rawSource,
    dependencies: newDependencies,
    dependents: existing.dependents,
  };
  graph.modules.set(changedFile, changedNode);

  // Pull in any brand-new imports transitively, exactly like the initial graph build.
  const added: ModuleNode[] = [];
  const queue: string[] = [...addedEdgeTargets];
  const seen = new Set(graph.modules.keys());

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (graph.modules.has(file)) {
      graph.modules.get(file)!.dependents.add(changedFile);
      continue;
    }

    const fKind = kindForFile(file);
    const fRawSource = fs.readFileSync(file, 'utf8');
    const fParsable = fKind === 'ts' || fKind === 'tsx' ? readParsable(file, fKind) : fRawSource;
    const fRawImports = fKind === 'json' || fKind === 'css' ? [] : parseImports(fParsable, fKind);

    const fDeps: DependencyEdge[] = [];
    for (const imp of fRawImports) {
      const resolved = resolveModule(imp.specifier, file);
      fDeps.push({ specifier: imp.specifier, resolved, start: imp.start, end: imp.end, kind: imp.kind });
      if (!seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }

    const newNode: ModuleNode = { id: file, kind: fKind, source: fRawSource, dependencies: fDeps, dependents: new Set() };
    graph.modules.set(file, newNode);
    graph.discoveryOrder.push(file);
    added.push(newNode);
  }

  // Newly added modules' own dependents need this fresh graft point recorded too.
  for (const dep of changedNode.dependencies) {
    graph.modules.get(dep.resolved)?.dependents.add(changedFile);
  }

  return { changed: changedNode, added, removedEdges };
}
