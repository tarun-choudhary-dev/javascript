import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';

export async function startFixtureServer() {
  const root = resolve('.');
  let wasmBlocked = false;
  let csp = null;
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (wasmBlocked && pathname.endsWith('/emscripten-module.wasm')) {
      response.writeHead(503).end();
      return;
    }
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    try {
      const bytes = await readFile(path);
      const mime = {'.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html'}[extname(path)] ?? 'application/octet-stream';
      response.writeHead(200, {'Content-Type': mime,
        ...(csp ? {'Content-Security-Policy': csp} : {})}).end(bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  return {base: `http://127.0.0.1:${server.address().port}`,
    setWasmBlocked: blocked => { wasmBlocked = blocked; },
    setCsp: policy => { csp = policy; },
    close: () => new Promise(resolvePromise => server.close(resolvePromise))};
}
