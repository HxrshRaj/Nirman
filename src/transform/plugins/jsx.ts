import * as acorn from 'acorn';
import MagicString from 'magic-string';
import { JsPlugin, TransformContext } from '../types';

function jsxMemberPath(n: any): string {
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${jsxMemberPath(n.object)}.${n.property.name}`;
  return '';
}

/** Lower-case-starting or hyphenated names are DOM tag names -> string; anything else
 *  (Foo, Foo.Bar, ns:name) is a component reference or is treated as a literal tag name. */
function jsxNameToJs(nameNode: any): string {
  if (nameNode.type === 'JSXMemberExpression') return jsxMemberPath(nameNode);
  if (nameNode.type === 'JSXNamespacedName') {
    return JSON.stringify(`${nameNode.namespace.name}:${nameNode.name.name}`);
  }
  const name = nameNode.name as string;
  if (/-/.test(name) || /^[a-z]/.test(name)) return JSON.stringify(name);
  return name;
}

function attrKeyText(attr: any): string {
  if (attr.name.type === 'JSXNamespacedName') {
    return JSON.stringify(`${attr.name.namespace.name}:${attr.name.name.name}`);
  }
  const keyName = attr.name.name as string;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyName) ? keyName : JSON.stringify(keyName);
}

/**
 * JSX whitespace collapsing, a simplified version of the real JSX-runtime rule: a text
 * node that spans multiple lines has each line trimmed and blank lines dropped, with the
 * remaining lines joined by a single space (so pure-indentation-and-newline text between
 * sibling elements disappears entirely). A text node with no newline at all is kept
 * completely verbatim, since `<span> hello </span>` legitimately means literal
 * leading/trailing spaces. This is not the full spec algorithm but matches it for the
 * common formatting patterns (children on their own indented lines, or short inline text).
 */
function trimJsxText(raw: string): string {
  if (!raw.includes('\n')) return raw;
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.join(' ');
}

/**
 * Transforms JSX syntax into plain `React.createElement(...)` calls via surgical,
 * per-AST-node edits on the shared MagicString — never by regenerating a whole subtree
 * as a fresh string. Every JSXElement/JSXFragment/JSXExpressionContainer/JSXText node is
 * addressed by its own exact offsets, so nesting (conditionals, `.map()` callbacks,
 * fragments, expression children) all compose correctly and the resulting source map
 * stays accurate down to individual tokens, not just "this whole element is line N".
 *
 * Known, documented limitation: JSX spread attributes (`<Foo {...props}/>`) are not
 * supported (this plugin throws a clear error rather than silently emitting wrong code).
 */
export const jsxPlugin: JsPlugin = {
  name: 'jsx',

  test(ctx: TransformContext) {
    return ctx.kind === 'jsx' || ctx.kind === 'tsx';
  },

  apply(ast: acorn.Node, s: MagicString) {
    function transformJsxNode(node: any): void {
      if (node.type === 'JSXFragment') {
        s.overwrite(node.openingFragment.start, node.openingFragment.end, 'React.createElement(React.Fragment, null, ');
        transformChildren(node.children);
        s.overwrite(node.closingFragment.start, node.closingFragment.end, ')');
        return;
      }

      const opening = node.openingElement;
      const closing = node.closingElement;
      const tagExpr = jsxNameToJs(opening.name);

      s.overwrite(opening.start, opening.name.end, `React.createElement(${tagExpr}, `);

      const attrs = opening.attributes;
      if (attrs.length === 0) {
        s.overwrite(opening.name.end, opening.end, opening.selfClosing ? 'null)' : 'null, ');
      } else {
        for (const attr of attrs) {
          if (attr.type === 'JSXSpreadAttribute') {
            throw new Error(
              `JSX spread attributes ({...expr}) are not supported by Nirman's JSX transform (at offset ${attr.start})`
            );
          }
          const keyText = attrKeyText(attr);
          s.overwrite(attr.start, attr.name.end, `${keyText}: `);

          if (attr.value == null) {
            s.appendLeft(attr.end, 'true');
          } else if (attr.value.type === 'Literal') {
            s.remove(attr.name.end, attr.value.start);
            s.overwrite(attr.value.start, attr.value.end, JSON.stringify(attr.value.value));
          } else if (attr.value.type === 'JSXExpressionContainer') {
            s.remove(attr.name.end, attr.value.start);
            s.remove(attr.value.start, attr.value.expression.start);
            s.remove(attr.value.expression.end, attr.value.end);
            findAndTransformNestedJsx(attr.value.expression);
          }
          s.appendLeft(attr.end, ', ');
        }
        const lastAttrEnd = attrs[attrs.length - 1].end;
        s.appendLeft(attrs[0].start, '{ ');
        s.overwrite(lastAttrEnd, opening.end, opening.selfClosing ? ' })' : ' }, ');
      }

      if (!opening.selfClosing) {
        transformChildren(node.children);
        s.overwrite(closing.start, closing.end, ')');
      }
    }

    function transformChildren(children: any[]): void {
      for (const child of children) {
        if (child.type === 'JSXText') {
          const trimmed = trimJsxText(child.value);
          if (trimmed.length === 0) {
            s.remove(child.start, child.end);
          } else {
            s.overwrite(child.start, child.end, `${JSON.stringify(trimmed)}, `);
          }
        } else if (child.type === 'JSXExpressionContainer') {
          if (child.expression.type === 'JSXEmptyExpression') {
            s.remove(child.start, child.end);
          } else {
            s.remove(child.start, child.expression.start);
            findAndTransformNestedJsx(child.expression);
            s.overwrite(child.expression.end, child.end, ', ');
          }
        } else if (child.type === 'JSXElement' || child.type === 'JSXFragment') {
          transformJsxNode(child);
          s.appendLeft(child.end, ', ');
        } else if (child.type === 'JSXSpreadChild') {
          throw new Error(`JSX spread children ({...expr}) are not supported by Nirman's JSX transform (at offset ${child.start})`);
        }
      }
    }

    /** Generic recursive property walk: finds every top-level JSXElement/JSXFragment
     *  inside an arbitrary JS expression subtree (ternaries, .map() callbacks, logical
     *  expressions, ...) without needing per-node-type child-field knowledge, and stops
     *  descending once it hits one (transformJsxNode handles that node's own interior). */
    function findAndTransformNestedJsx(node: any): void {
      if (node == null || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (const el of node) findAndTransformNestedJsx(el);
        return;
      }
      if (typeof node.type !== 'string') return;
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
        transformJsxNode(node);
        return;
      }
      for (const key of Object.keys(node)) {
        if (key === 'start' || key === 'end' || key === 'loc' || key === 'range' || key === 'type') continue;
        const val = (node as any)[key];
        if (val && typeof val === 'object') findAndTransformNestedJsx(val);
      }
    }

    findAndTransformNestedJsx(ast);
  },
};
