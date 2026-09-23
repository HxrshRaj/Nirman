import { renderRouterBar, loadRoute } from './router';
import { renderHeader } from './components/Header';
import { renderFooter } from './components/Footer';
import { loadInto, subscribe } from './store/state';

export async function renderApp() {
  const header = renderHeader('graph demo app');
  const nav = renderRouterBar();
  const footer = renderFooter(2026);

  const lines = [];
  subscribe((data) => lines.push(`loaded ${data.key} (cachedWithVersion=${data.cachedWithVersion})`));
  await loadInto('boot');
  await loadInto('boot'); // second call, same key -> exercises the cache HIT path
  await loadRoute('home');

  return [header, nav, ...lines, footer].join('\n');
}
