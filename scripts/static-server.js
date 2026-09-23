const http = require('http');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || 5000);

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let p = path.join(root, urlPath);
    if (urlPath.endsWith('/') || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      p = path.join(p, 'index.html');
    }
    if (!fs.existsSync(p)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime.lookup(p) || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  })
  .listen(port, () => console.log(`static server on http://localhost:${port} (root=${root})`));
