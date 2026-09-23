import * as acorn from 'acorn';
import MagicString from 'magic-string';
import { JsPlugin, TransformContext } from '../types';

function collectPatternNames(pattern: any, out: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') collectPatternNames(prop.argument, out);
        else collectPatternNames(prop.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) {
        if (el) collectPatternNames(el, out);
      }
      break;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out);
      break;
    case 'RestElement':
      collectPatternNames(pattern.argument, out);
      break;
  }
}

/**
 * Rewrites ES module `import`/`export` syntax into CommonJS `require`/`exports`, the
 * form Nirman's module runtime (see bundle/runtime.ts) actually executes at run time in
 * the browser. This is a genuine, from-scratch transform: it walks the real AST (not
 * text/regex), rewrites only the exact statement ranges involved, and every edit lands
 * on the shared MagicString instance so the final source map stays accurate.
 *
 * Import specifiers are rewritten to `require(<resolved absolute id>)`, not the original
 * specifier text — Nirman's runtime looks modules up by resolved id, exactly like a real
 * bundler's module registry.
 */
export const esmToCjsPlugin: JsPlugin = {
  name: 'esm-to-cjs',

  test(ctx: TransformContext) {
    return ctx.kind === 'js' || ctx.kind === 'jsx' || ctx.kind === 'ts' || ctx.kind === 'tsx';
  },

  apply(ast: acorn.Node, s: MagicString, ctx: TransformContext) {
    const body: any[] = (ast as any).body;
    let usesEsm = false;
    let reexportCounter = 0;

    for (const stmt of body) {
      switch (stmt.type) {
        case 'ImportDeclaration': {
          usesEsm = true;
          const resolved = ctx.resolve(stmt.source.start);
          const requireCall = `require(${JSON.stringify(resolved)})`;

          if (stmt.specifiers.length === 0) {
            s.overwrite(stmt.start, stmt.end, `${requireCall};`);
            break;
          }

          let defaultLocal: string | null = null;
          let namespaceLocal: string | null = null;
          const named: { imported: string; local: string }[] = [];
          for (const spec of stmt.specifiers) {
            if (spec.type === 'ImportDefaultSpecifier') defaultLocal = spec.local.name;
            else if (spec.type === 'ImportNamespaceSpecifier') namespaceLocal = spec.local.name;
            else if (spec.type === 'ImportSpecifier') {
              const importedName = spec.imported.type === 'Identifier' ? spec.imported.name : spec.imported.value;
              named.push({ imported: importedName, local: spec.local.name });
            }
          }

          const parts: string[] = [];
          const tempVar = namespaceLocal ?? `__nirman_mod_${stmt.start}`;
          parts.push(`const ${tempVar} = ${requireCall};`);
          if (defaultLocal) {
            parts.push(`const ${defaultLocal} = ${tempVar}.__esModule ? ${tempVar}.default : ${tempVar};`);
          }
          if (named.length) {
            const destructure = named
              .map(({ imported, local }) => (imported === local ? imported : `${imported}: ${local}`))
              .join(', ');
            parts.push(`const { ${destructure} } = ${tempVar};`);
          }
          s.overwrite(stmt.start, stmt.end, parts.join(' '));
          break;
        }

        case 'ExportAllDeclaration': {
          usesEsm = true;
          const resolved = ctx.resolve(stmt.source.start);
          const v = `__nirman_reexport_${reexportCounter++}`;
          s.overwrite(
            stmt.start,
            stmt.end,
            `var ${v} = require(${JSON.stringify(resolved)}); ` +
              `Object.keys(${v}).forEach(function (k) { if (k === "default" || k === "__esModule") return; exports[k] = ${v}[k]; });`
          );
          break;
        }

        case 'ExportNamedDeclaration': {
          usesEsm = true;
          if (stmt.source) {
            const resolved = ctx.resolve(stmt.source.start);
            const v = `__nirman_reexport_${reexportCounter++}`;
            const assigns = stmt.specifiers
              .map((sp: any) => `exports.${sp.exported.name} = ${v}.${sp.local.name};`)
              .join(' ');
            s.overwrite(stmt.start, stmt.end, `var ${v} = require(${JSON.stringify(resolved)}); ${assigns}`);
          } else if (stmt.declaration) {
            const decl = stmt.declaration;
            s.remove(stmt.start, decl.start);
            const names: string[] = [];
            if (decl.type === 'VariableDeclaration') {
              for (const d of decl.declarations) collectPatternNames(d.id, names);
            } else if (decl.id) {
              names.push(decl.id.name);
            }
            const assigns = names.map((n) => `exports.${n} = ${n};`).join(' ');
            s.appendLeft(decl.end, ` ${assigns}`);
          } else {
            const assigns = stmt.specifiers.map((sp: any) => `exports.${sp.exported.name} = ${sp.local.name};`).join(' ');
            s.overwrite(stmt.start, stmt.end, assigns);
          }
          break;
        }

        case 'ExportDefaultDeclaration': {
          usesEsm = true;
          const decl = stmt.declaration;
          const isNamedDecl =
            (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id != null;
          if (isNamedDecl) {
            s.remove(stmt.start, decl.start);
            s.appendLeft(decl.end, `\nexports.default = ${decl.id.name};`);
          } else {
            s.overwrite(stmt.start, decl.start, `exports.default = `);
          }
          break;
        }
      }
    }

    if (usesEsm) {
      s.prepend(`Object.defineProperty(exports, "__esModule", { value: true });\n`);
    }
  },
};
