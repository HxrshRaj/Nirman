import * as acorn from 'acorn';
import jsx from 'acorn-jsx';
import * as walk from 'acorn-walk';
import { RawImport, ModuleKind } from './types';

const JSXParser = acorn.Parser.extend(jsx());

/**
 * acorn-walk's default `base` visitor set has no entries for JSX node types (they come
 * from the acorn-jsx extension, not core ESTree), so a plain `walk.simple` throws
 * "No walker function defined for node type JSXElement" the moment it needs to recurse
 * into one. This extends the default base with real recursion rules for every JSX node
 * shape so the walk can safely pass through JSX subtrees on its way to any
 * import/require calls nested inside them (e.g. inside a `{expr}` child).
 */
const jsxWalkBase: Record<string, (node: any, st: any, c: any) => void> = {
  ...(walk.base as any),
  JSXElement(node: any, st, c) {
    c(node.openingElement, st, 'JSXOpeningElement');
    for (const child of node.children) c(child, st);
    if (node.closingElement) c(node.closingElement, st, 'JSXClosingElement');
  },
  JSXFragment(node: any, st, c) {
    for (const child of node.children) c(child, st);
  },
  JSXOpeningElement(node: any, st, c) {
    c(node.name, st);
    for (const attr of node.attributes) c(attr, st);
  },
  JSXClosingElement(node: any, st, c) {
    c(node.name, st);
  },
  JSXAttribute(node: any, st, c) {
    c(node.name, st);
    if (node.value) c(node.value, st);
  },
  JSXSpreadAttribute(node: any, st, c) {
    c(node.argument, st);
  },
  JSXExpressionContainer(node: any, st, c) {
    c(node.expression, st);
  },
  JSXMemberExpression(node: any, st, c) {
    c(node.object, st);
    c(node.property, st);
  },
  JSXNamespacedName(node: any, st, c) {
    c(node.namespace, st);
    c(node.name, st);
  },
  JSXIdentifier() {},
  JSXText() {},
  JSXEmptyExpression() {},
  JSXOpeningFragment() {},
  JSXClosingFragment() {},
};

/**
 * Parse a module's source with a real parser (acorn, extended with JSX) and walk the
 * resulting AST to find every static `import`, `export ... from`, dynamic `import()`,
 * and CommonJS `require()` call. We deliberately do NOT regex-match import statements:
 * regexes can't tell a real import from a string/comment that merely looks like one,
 * and they can't give us exact character offsets for source-map-accurate rewriting.
 */
export function parseImports(source: string, kind: ModuleKind): RawImport[] {
  if (kind === 'json' || kind === 'css') return [];

  const isJsx = kind === 'jsx' || kind === 'tsx';
  // acorn has no TS support; TS-specific syntax is stripped by the transformer before this
  // parse runs for .ts/.tsx (see transform/strip-types.ts). By the time parseImports sees
  // the source, it is plain JS (optionally with JSX).
  const Parser = isJsx ? JSXParser : acorn.Parser;

  let ast: acorn.Node;
  try {
    ast = Parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowImportExportEverywhere: false,
      allowAwaitOutsideFunction: true,
    });
  } catch (err) {
    const e = err as Error;
    throw new Error(`Parse error while scanning imports: ${e.message}`);
  }

  const found: RawImport[] = [];

  walk.simple(ast, {
    ImportDeclaration(node: any) {
      found.push({
        specifier: node.source.value,
        start: node.source.start,
        end: node.source.end,
        kind: 'import',
      });
    },
    ExportNamedDeclaration(node: any) {
      if (node.source) {
        found.push({
          specifier: node.source.value,
          start: node.source.start,
          end: node.source.end,
          kind: 'export-from',
        });
      }
    },
    ExportAllDeclaration(node: any) {
      if (node.source) {
        found.push({
          specifier: node.source.value,
          start: node.source.start,
          end: node.source.end,
          kind: 'export-from',
        });
      }
    },
    ImportExpression(node: any) {
      // import('./foo') dynamic import — only handle the static-string-literal case
      if (node.source && node.source.type === 'Literal' && typeof node.source.value === 'string') {
        found.push({
          specifier: node.source.value,
          start: node.source.start,
          end: node.source.end,
          kind: 'dynamic-import',
        });
      }
    },
    CallExpression(node: any) {
      if (
        node.callee &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require' &&
        node.arguments.length === 1 &&
        node.arguments[0].type === 'Literal' &&
        typeof node.arguments[0].value === 'string'
      ) {
        found.push({
          specifier: node.arguments[0].value,
          start: node.arguments[0].start,
          end: node.arguments[0].end,
          kind: 'require',
        });
      }
    },
  }, isJsx ? jsxWalkBase : undefined);

  // Sort by source position so downstream consumers see them in document order.
  found.sort((a, b) => a.start - b.start);
  return found;
}
