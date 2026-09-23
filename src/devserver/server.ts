import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import mime from 'mime-types';
import { buildGraph } from '../resolver/graph';
import { DependencyGraph } from '../resolver/types';
import { applyFileChange } from './incremental';
import { createDevBundle } from './dev-bundle';
import { transformModuleToMagicString } from '../transform/pipeline';
import { computeBundleIds } from '../bundle/ids';

const RELEVANT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.css']);

function defaultHtmlShell(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Nirman dev server</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/bundle.js"></script>
  </body>
</html>
`;
}

function injectBundleScript(html: string): string {
  if (html.includes('/bundle.js')) return html;
  if (html.includes('</body>')) return html.replace('</body>', '  <script src="/bundle.js"></script>\n</body>');
  return `${html}\n<script src="/bundle.js"></script>\n`;
}

export function startDevServer(entry: string, port: number): void {
  const root = path.dirname(entry);
  const graph: DependencyGraph = buildGraph(entry);

  let currentCode = '';
  let currentMap = '';

  function rebuildFullBundle(): void {
    const wsUrl = `ws://localhost:${port}/__nirman_hmr`;
    const { code, map } = createDevBundle(graph, wsUrl);
    currentCode = code;
    currentMap = JSON.stringify(map);
  }

  rebuildFullBundle();

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];

    if (url === '/bundle.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(`${currentCode}\n//# sourceMappingURL=/bundle.js.map\n`);
      return;
    }

    if (url === '/bundle.js.map') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(currentMap);
      return;
    }

    if (url === '/' || url === '/index.html') {
      const indexPath = path.join(root, 'index.html');
      const html = fs.existsSync(indexPath) ? injectBundleScript(fs.readFileSync(indexPath, 'utf8')) : defaultHtmlShell();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    }

    // Generic static file fallback (images, fonts, etc. referenced by the app).
    const staticPath = path.join(root, url.replace(/^\/+/, ''));
    if (staticPath.startsWith(root) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const type = mime.lookup(staticPath) || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      fs.createReadStream(staticPath).pipe(res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server, path: '/__nirman_hmr' });
  const clients = new Set<WebSocket>();
  wss.on('connection', (socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
  });

  function broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  let rebuildQueued = false;
  function handleFileEvent(changedPathRaw: string): void {
    const changedPath = path.resolve(changedPathRaw);
    if (!RELEVANT_EXTENSIONS.has(path.extname(changedPath))) return;
    if (!graph.modules.has(changedPath)) return; // not part of the current graph -> nothing to do

    if (rebuildQueued) return; // chokidar can fire multiple events per save; coalesce
    rebuildQueued = true;
    setTimeout(() => {
      rebuildQueued = false;
      try {
        const { changed, added, removedEdges } = applyFileChange(graph, changedPath);
        const ids = computeBundleIds(graph);
        const idFor = (p: string): string => ids.get(p) ?? p;

        const changedOut = transformModuleToMagicString(changed, undefined, idFor).toString();
        const addedOut = added.map((node) => ({
          id: idFor(node.id),
          code: transformModuleToMagicString(node, undefined, idFor).toString(),
        }));

        rebuildFullBundle(); // keep the servable full bundle consistent for fresh loads

        broadcast({
          type: 'update',
          changed: [{ id: idFor(changed.id), code: changedOut }],
          added: addedOut,
        });

        const rel = path.relative(root, changedPath);
        console.log(
          `[nirman] rebuilt ${rel} (+${added.length} new module${added.length === 1 ? '' : 's'}, -${removedEdges.length} removed edge${removedEdges.length === 1 ? '' : 's'}) -> pushed HMR update to ${clients.size} client(s)`
        );
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[nirman] rebuild failed: ${message}`);
        broadcast({ type: 'error', message });
      }
    }, 30); // tiny debounce so a single save (which can fire 2+ fs events) triggers one rebuild
  }

  const watcher = chokidar.watch(root, {
    ignored: (p: string) => p.includes('node_modules') || p.includes('.git'),
    ignoreInitial: true,
  });
  watcher.on('change', handleFileEvent);
  watcher.on('add', handleFileEvent);

  server.listen(port, () => {
    console.log(`Nirman dev server running at http://localhost:${port}`);
    console.log(`Watching ${root} for changes (${graph.modules.size} modules loaded)`);
  });
}
