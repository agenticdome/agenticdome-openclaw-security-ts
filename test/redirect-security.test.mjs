import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {runInNewContext} from 'node:vm';
import {after, before, test} from 'node:test';

// Resolve the actual transport used by the installed core SDK, rather than an
// unrelated hoisted test dependency. All traffic and credentials are synthetic.
const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('agenticdome-sdk'));
const axiosRequire = createRequire(sdkRequire.resolve('axios'));
const {http} = axiosRequire('follow-redirects');
let origin, destination, originUrl, destinationUrl;

before(async () => {
  destination = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.headers));
  });
  destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
  destinationUrl = `http://127.0.0.1:${destination.address().port}/sink`;
  origin = createServer((request, response) => {
    if (request.url === '/same-sink') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(request.headers));
    } else {
      response.writeHead(302, {Location: request.url === '/same' ? '/same-sink' : destinationUrl});
      response.end();
    }
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  // Different hostnames force the cross-host credential boundary. Both hosts
  // resolve to loopback and no external systems participate in these tests.
  originUrl = `http://localhost:${origin.address().port}`;
});

after(async () => {
  for (const server of [origin, destination]) {
    if (!server) continue;
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

function redirectedHeaders(path, options) {
  return new Promise((resolve, reject) => {
    const request = http.get(originUrl + path, {...options, family: 4, maxRedirects: 2}, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    request.setTimeout(3000, () => request.destroy(new Error('Synthetic redirect timed out')));
    request.on('error', reject);
  });
}

test('cross-host redirects strip credentials from flat array-form headers', async () => {
  const seen = await redirectedHeaders('/cross', {headers: ['Host', new URL(originUrl).host, 'Authorization', 'Bearer synthetic-fixture', 'Cookie', 'fixture=synthetic', 'X-Safe-Marker', 'keep']});
  assert.equal(seen.authorization, undefined); assert.equal(seen.cookie, undefined);
  assert.equal(seen['x-safe-marker'], 'keep');
});

test('custom credential names containing regex metacharacters are stripped exactly', async () => {
  const seen = await redirectedHeaders('/cross', {headers: {'X+Session-Key': 'synthetic-fixture', 'X-Safe-Marker': 'keep'}, sensitiveHeaders: ['X+Session-Key']});
  assert.equal(seen['x+session-key'], undefined); assert.equal(seen['x-safe-marker'], 'keep');
});

test('cross-realm sensitiveHeaders retain their credential-stripping meaning', async () => {
  const sensitiveHeaders = runInNewContext('["x-fixture-key"]');
  const seen = await redirectedHeaders('/cross', {headers: {'X-Fixture-Key': 'synthetic-fixture', 'X-Safe-Marker': 'keep'}, sensitiveHeaders});
  assert.equal(seen['x-fixture-key'], undefined); assert.equal(seen['x-safe-marker'], 'keep');
});

test('legitimate same-origin redirects retain caller credentials', async () => {
  const seen = await redirectedHeaders('/same', {headers: {Authorization: 'Bearer synthetic-fixture', 'X-Fixture-Key': 'synthetic-fixture'}, sensitiveHeaders: ['X-Fixture-Key']});
  assert.equal(seen.authorization, 'Bearer synthetic-fixture'); assert.equal(seen['x-fixture-key'], 'synthetic-fixture');
});
