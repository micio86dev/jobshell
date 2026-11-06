import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export type FixtureServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const LOGIN_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture login</title></head>
<body>
  <h1>Sign in</h1>
  <form method="post" action="/login" id="login-form">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password">
    <label><input id="remember" name="remember" type="checkbox" value="1"> Stay signed in</label>
    <button id="submit" type="submit">Sign in</button>
  </form>
  <p id="error" hidden>Invalid credentials</p>
</body></html>`;

const APP_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture app</title></head>
<body>
  <h1 id="welcome">Welcome back</h1>
  <ul id="items">
    ${Array.from({ length: 40 }, (_, i) => `<li>Job posting ${i + 1}</li>`).join('\n    ')}
  </ul>
  <iframe id="frame" src="/frame" width="300" height="120" title="Fixture frame"></iframe>
  <a id="download" href="/download" download="offer.txt">Download offer</a>
  <input id="upload" type="file">
  <div id="dynamic"></div>
  <script>
    // Dynamic page interaction: the counter only appears after a client-side update.
    let count = 0;
    setInterval(() => {
      count += 1;
      document.getElementById('dynamic').textContent = 'tick ' + count;
    }, 100);
  </script>
</body></html>`;

const FRAME_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture frame</title></head>
<body><p id="frame-text">Inside the iframe</p></body></html>`;

const HEAVY_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture heavy</title></head>
<body>
  <div id="root">
    ${Array.from({ length: 1500 }, (_, i) => `<div class="row"><span>row ${i}</span></div>`).join('\n    ')}
  </div>
</body></html>`;

const SESSION_COOKIE = 'fixture_session=ok-1234567890';

const html = (res: http.ServerResponse, body: string, status = 200): void => {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

/**
 * Local, deterministic fixture site for the runtime benchmark.
 *
 * Everything the protocol needs is served from 127.0.0.1 so a run never depends
 * on a third-party service: a login form that sets an HttpOnly session cookie, an
 * authenticated app page with an iframe, a dynamic region, a download link, a
 * file input and a DOM-heavy page.
 */
export const startFixtureServer = async (): Promise<FixtureServer> => {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const cookie = req.headers.cookie ?? '';
    const authenticated = cookie.includes('fixture_session=');

    if (req.method === 'POST' && url.pathname === '/login') {
      // `?remember=1` models a "stay signed in" login with a persistent cookie.
      // Without it the cookie is a session cookie, which browsers discard on close.
      const remember = url.searchParams.get('remember') === '1' || body.includes('remember=1');
      const attributes = remember
        ? `${SESSION_COOKIE}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`
        : `${SESSION_COOKIE}; HttpOnly; Path=/; SameSite=Lax`;
      res.writeHead(302, { location: '/app', 'set-cookie': attributes });
      res.end();
      return;
    }
    switch (url.pathname) {
      case '/login':
        html(res, LOGIN_PAGE);
        return;
      case '/app':
        if (!authenticated) {
          res.writeHead(302, { location: '/login' });
          res.end();
          return;
        }
        html(res, APP_PAGE);
        return;
      case '/frame':
        html(res, FRAME_PAGE);
        return;
      case '/heavy':
        html(res, HEAVY_PAGE);
        return;
      case '/download':
        res.writeHead(200, {
          'content-type': 'text/plain; charset=utf-8',
          'content-disposition': 'attachment; filename="offer.txt"',
        });
        res.end('fixture download payload\n');
        return;
      case '/session':
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ authenticated }));
        return;
      default:
        html(res, '<h1>not found</h1>', 404);
    }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

/** A file the upload step can send, created once per run directory. */
export const writeUploadFixture = (dir: string): string => {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'cv.txt');
  fs.writeFileSync(file, 'Fixture CV payload\n');
  return file;
};
