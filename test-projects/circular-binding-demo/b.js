import * as a from './a';

export function bFn() {
  // Namespace import instead of destructuring: `a` is the SAME live module.exports
  // object a.js writes into. Reading `a.A_VALUE` here (lazily, inside a function body
  // that only actually runs after the whole graph has finished loading) sees the fully
  // initialized value, unlike a destructured `const { A_VALUE } = require('./a')`
  // captured during the circular window while a.js was still empty.
  return `A_VALUE seen from b.js = ${JSON.stringify(a.A_VALUE)}, aFn() = ${a.aFn()}`;
}
