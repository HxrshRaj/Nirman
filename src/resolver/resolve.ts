import * as fs from 'fs';
import * as path from 'path';
import { ModuleKind } from './types';

const EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.json'];

export class ResolveError extends Error {}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Try `candidate`, then `candidate.js`, `candidate.jsx`, etc, in that order. */
function resolveAsFile(candidate: string): string | null {
  if (isFile(candidate)) return candidate;
  for (const ext of EXTENSIONS) {
    if (isFile(candidate + ext)) return candidate + ext;
  }
  return null;
}

/** Try `candidate/index.js`, `candidate/index.ts`, etc, and package.json "main"/"module". */
function resolveAsDirectory(candidate: string): string | null {
  if (!isDir(candidate)) return null;

  const pkgPath = path.join(candidate, 'package.json');
  if (isFile(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const entry = pkg.module || pkg.main;
      if (entry) {
        const asFile = resolveAsFile(path.join(candidate, entry));
        if (asFile) return asFile;
        const asIndex = resolveAsFile(path.join(candidate, entry, 'index'));
        if (asIndex) return asIndex;
      }
    } catch {
      // malformed package.json: fall through to index resolution
    }
  }

  return resolveAsFile(path.join(candidate, 'index'));
}

/**
 * Simplified but real `node_modules` resolution: walk up from `startDir` looking for a
 * `node_modules/<pkgName>` directory, the same way Node's algorithm walks ancestor dirs.
 */
function resolveFromNodeModules(specifier: string, startDir: string): string | null {
  let dir = startDir;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidateRoot = path.join(dir, 'node_modules', specifier);
    const asFile = resolveAsFile(candidateRoot);
    if (asFile) return asFile;
    const asDir = resolveAsDirectory(candidateRoot);
    if (asDir) return asDir;

    const parent = path.dirname(dir);
    if (parent === dir) return null; // reached filesystem root
    dir = parent;
  }
}

/**
 * Resolve `specifier` as imported from `importerFile` to an absolute path on disk.
 * Mirrors (a simplified version of) Node's CommonJS/ESM resolution algorithm:
 *  - './x' or '../x' or an absolute path -> resolve relative to the importer, trying
 *    the exact path, then each known extension, then as a directory (index file /
 *    package.json main field).
 *  - a bare specifier like 'lodash' or '@scope/pkg' -> walk up through node_modules
 *    directories from the importer, same as Node does.
 */
export function resolveModule(specifier: string, importerFile: string): string {
  const importerDir = path.dirname(importerFile);

  if (specifier.startsWith('.') || specifier.startsWith('/') || path.isAbsolute(specifier)) {
    const base = path.isAbsolute(specifier) ? specifier : path.resolve(importerDir, specifier);
    const asFile = resolveAsFile(base);
    if (asFile) return asFile;
    const asDir = resolveAsDirectory(base);
    if (asDir) return asDir;
    throw new ResolveError(
      `Cannot resolve '${specifier}' from '${importerFile}': no file at ${base}(.js|.jsx|.ts|.tsx|.json) or ${base}/index.*`
    );
  }

  const fromNodeModules = resolveFromNodeModules(specifier, importerDir);
  if (fromNodeModules) return fromNodeModules;

  throw new ResolveError(`Cannot resolve module '${specifier}' from '${importerFile}' (not found in any node_modules)`);
}

export function kindForFile(file: string): ModuleKind {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.js':
      return 'js';
    case '.jsx':
      return 'jsx';
    case '.ts':
      return 'ts';
    case '.tsx':
      return 'tsx';
    case '.json':
      return 'json';
    case '.css':
      return 'css';
    default:
      return 'js';
  }
}
