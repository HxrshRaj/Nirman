import { renderNav } from './components/Nav';
import { fetchData } from './services/api';

export const ROUTES = ['home', 'about', 'contact'];

export function renderRouterBar() {
  return renderNav(ROUTES);
}

export async function loadRoute(name) {
  return fetchData(`route:${name}`);
}
