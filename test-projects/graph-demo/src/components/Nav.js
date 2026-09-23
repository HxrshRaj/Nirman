import { capitalize } from '../utils/string';

export function renderNav(routes) {
  return routes.map((r) => capitalize(r)).join(' | ');
}
