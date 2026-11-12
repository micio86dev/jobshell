import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkPortfolioLink, parsePortfolioLink } from '../src/portfolio-link.ts';

test('a portfolio link must be a public https address with no credentials', () => {
  assert.equal(parsePortfolioLink('https://example.com/me').ok, true);
  assert.equal(parsePortfolioLink('http://example.com/me').ok, false, 'plain http is refused');
  assert.equal(parsePortfolioLink('https://user:pw@example.com/').ok, false, 'credentials are refused');
  assert.equal(parsePortfolioLink('https://localhost/me').ok, false, 'a local host is refused');
  assert.equal(parsePortfolioLink('https://192.168.1.10/me').ok, false, 'a private address is refused');
  assert.equal(parsePortfolioLink('https://169.254.169.254/latest').ok, false, 'a metadata address is refused');
  assert.equal(parsePortfolioLink('not a link').ok, false);
});

test('a reachable link reports its status and the text the page carries', async () => {
  const fetchImpl = async () => new Response('<html><body><p>Languages: English, Italian</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  const result = await checkPortfolioLink('https://example.com/me', fetchImpl);
  assert.equal(result.reachable, true);
  assert.equal(result.status, 200);
  assert.match(result.text, /Languages: English, Italian/);
});

test('an unreachable or failing link is reported as not reachable, without the error detail', async () => {
  const failing = async () => new Response('gone', { status: 404 });
  assert.deepEqual(await checkPortfolioLink('https://example.com/none', failing), { reachable: false, status: 404, text: '' });
  const network = async () => { throw new Error('getaddrinfo ENOTFOUND secret-host.internal'); };
  const result = await checkPortfolioLink('https://example.com/none', network);
  assert.equal(result.reachable, false);
  assert.equal(JSON.stringify(result).includes('secret-host'), false, 'the network error text is not returned');
});

test('a redirect to a private or non-https address is not followed', async () => {
  const redirecting = async () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.5/private' } });
  const result = await checkPortfolioLink('https://example.com/me', redirecting);
  assert.equal(result.reachable, false);
});

test('a public name that starts like an IPv6 prefix is accepted, and more private forms are refused', () => {
  assert.equal(parsePortfolioLink('https://fcbarcelona.com/me').ok, true, 'a public name is not a private address');
  assert.equal(parsePortfolioLink('https://fdroid.org/').ok, true);
  assert.equal(parsePortfolioLink('https://localhost./me').ok, false, 'a trailing dot does not hide localhost');
  assert.equal(parsePortfolioLink('https://[::ffff:127.0.0.1]/me').ok, false, 'an IPv4-mapped address is refused');
  assert.equal(parsePortfolioLink('https://100.64.1.1/me').ok, false, 'a carrier-grade NAT address is refused');
});

test('the body read is bounded: a large page is not read to the end', async () => {
  let pulled = 0;
  const chunk = new Uint8Array(10_000).fill(97);
  // A 10 MB page, sent in 1 000 chunks: a reader that takes it all pulls every one of them.
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 1000) {
        controller.close();
        return;
      }
      sent += 1;
      pulled += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const fetchImpl = async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
  const result = await checkPortfolioLink('https://example.com/big', fetchImpl);
  assert.equal(result.reachable, true);
  assert.equal(pulled <= 1_100_000, true, `read ${pulled} bytes of a 10 MB stream`);
});

test('the IPv6 forms that resolve to loopback or unspecified, and the reserved IPv4 ranges, are refused', () => {
  assert.equal(parsePortfolioLink('https://[::127.0.0.1]/me').ok, false, 'an IPv4-compatible loopback is refused');
  assert.equal(parsePortfolioLink('https://[::]/me').ok, false, 'the unspecified address is refused');
  assert.equal(parsePortfolioLink('https://198.18.0.1/me').ok, false, 'a benchmarking address is refused');
  assert.equal(parsePortfolioLink('https://224.0.0.1/me').ok, false, 'a multicast address is refused');
  assert.equal(parsePortfolioLink('https://255.255.255.255/me').ok, false, 'the broadcast address is refused');
});
