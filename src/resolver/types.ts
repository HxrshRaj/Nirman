export type ModuleKind = 'js' | 'jsx' | 'ts' | 'tsx' | 'json' | 'css';

export interface RawImport {
  /** The string written inside import/require, e.g. './foo' or 'lodash' */
  specifier: string;
  /** Character offset in the source where the specifier string (incl. quotes) starts */
  start: number;
  /** Character offset where it ends */
  end: number;
  /** 'import' | 'require' | 'export-from' | 'dynamic-import' */
  kind: 'import' | 'require' | 'export-from' | 'dynamic-import';
}

export interface ModuleNode {
  /** Absolute, normalized file path. Identity of the module. */
  id: string;
  kind: ModuleKind;
  source: string;
  /** Resolved absolute paths of everything this module imports, in source order */
  dependencies: DependencyEdge[];
  /** absolute ids of modules that import this one */
  dependents: Set<string>;
}

export interface DependencyEdge {
  specifier: string;
  resolved: string;
  start: number;
  end: number;
  kind: RawImport['kind'];
}

export interface DependencyGraph {
  entry: string;
  modules: Map<string, ModuleNode>;
  /** Order in which modules were first discovered (BFS-ish), entry last-dependency-first is
   * NOT guaranteed here; use topo order from graph.ts for execution order. */
  discoveryOrder: string[];
  /** Sets of module ids that participate in a cycle with each other */
  cycles: Set<string>[];
}
