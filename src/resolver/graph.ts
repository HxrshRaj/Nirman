import * as fs from 'fs';
import { DependencyEdge, DependencyGraph, ModuleNode } from './types';
import { resolveModule, kindForFile } from './resolve';
import { parseImports } from './parse-imports';
import { stripTypes } from './ts-strip';

/** Read a file and, if it's TS/TSX, erase its type syntax so it can be parsed as JS/JSX. */
function readParsable(file: string, kind: ModuleNode['kind']): string {
  const raw = fs.readFileSync(file, 'utf8');
  if (kind === 'ts') return stripTypes(raw, false);
  if (kind === 'tsx') return stripTypes(raw, true);
  return raw;
}

export interface BuildGraphOptions {
  /** Called for every module as it's discovered, useful for progress reporting. */
  onModule?: (id: string) => void;
}

/**
 * Build the full module dependency graph starting from `entryFile`, using a real parser
 * to find imports/requires and a real (simplified Node-style) resolver to turn each
 * specifier into a concrete file on disk. Traversal is iterative (a work-list, not
 * recursive function calls) specifically so a deep or cyclic graph can never blow the
 * call stack or spin forever — a module already visited is never re-queued.
 */
export function buildGraph(entryFile: string, options: BuildGraphOptions = {}): DependencyGraph {
  const modules = new Map<string, ModuleNode>();
  const discoveryOrder: string[] = [];
  const queue: string[] = [entryFile];
  const queued = new Set<string>([entryFile]);

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (modules.has(file)) continue;

    const kind = kindForFile(file);
    const rawSourceForOutput = fs.readFileSync(file, 'utf8');
    const parsableSource = kind === 'ts' || kind === 'tsx' ? readParsable(file, kind) : rawSourceForOutput;

    const rawImports = kind === 'json' || kind === 'css' ? [] : parseImports(parsableSource, kind);

    const dependencies: DependencyEdge[] = [];
    for (const imp of rawImports) {
      let resolved: string;
      try {
        resolved = resolveModule(imp.specifier, file);
      } catch (err) {
        throw new Error(
          `Failed to resolve import '${imp.specifier}' in ${file}: ${(err as Error).message}`
        );
      }
      dependencies.push({
        specifier: imp.specifier,
        resolved,
        start: imp.start,
        end: imp.end,
        kind: imp.kind,
      });
      if (!queued.has(resolved)) {
        queued.add(resolved);
        queue.push(resolved);
      }
    }

    const node: ModuleNode = {
      id: file,
      kind,
      source: rawSourceForOutput,
      dependencies,
      dependents: new Set(),
    };
    modules.set(file, node);
    discoveryOrder.push(file);
    options.onModule?.(file);
  }

  // Now that every module exists, fill in reverse edges (dependents).
  for (const node of modules.values()) {
    for (const dep of node.dependencies) {
      modules.get(dep.resolved)?.dependents.add(node.id);
    }
  }

  const cycles = findCycles(modules);

  return { entry: entryFile, modules, discoveryOrder, cycles };
}

/**
 * Tarjan's strongly-connected-components algorithm, run iteratively (explicit stack, no
 * recursion) so it can't stack-overflow on a large or maliciously deep graph. Any SCC
 * with more than one module — or a single module that imports itself — is a real
 * circular dependency.
 */
function findCycles(modules: Map<string, ModuleNode>): Set<string>[] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: Set<string>[] = [];

  interface Frame {
    id: string;
    depIndex: number;
  }

  for (const startId of modules.keys()) {
    if (indices.has(startId)) continue;

    const work: Frame[] = [{ id: startId, depIndex: 0 }];
    indices.set(startId, index);
    lowlink.set(startId, index);
    index++;
    stack.push(startId);
    onStack.add(startId);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const node = modules.get(frame.id)!;
      const deps = node.dependencies.map((d) => d.resolved);

      if (frame.depIndex < deps.length) {
        const depId = deps[frame.depIndex];
        frame.depIndex++;

        if (!indices.has(depId)) {
          indices.set(depId, index);
          lowlink.set(depId, index);
          index++;
          stack.push(depId);
          onStack.add(depId);
          work.push({ id: depId, depIndex: 0 });
        } else if (onStack.has(depId)) {
          lowlink.set(frame.id, Math.min(lowlink.get(frame.id)!, indices.get(depId)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1];
          lowlink.set(parent.id, Math.min(lowlink.get(parent.id)!, lowlink.get(frame.id)!));
        }

        if (lowlink.get(frame.id) === indices.get(frame.id)) {
          const scc = new Set<string>();
          let member: string;
          do {
            member = stack.pop()!;
            onStack.delete(member);
            scc.add(member);
          } while (member !== frame.id);

          const hasSelfLoop = modules.get(frame.id)!.dependencies.some((d) => d.resolved === frame.id);
          if (scc.size > 1 || hasSelfLoop) {
            sccs.push(scc);
          }
        }
      }
    }
  }

  return sccs;
}
