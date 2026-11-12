// Tests for the MCP server an assistant calls. The handlers are pure, so nothing is
// spawned; `parseMcpRequest` is tested directly because notifications must not be
// answered.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { handleMcpRequest, internalErrorResponse, loadSeen, parseMcpRequest, type McpDeps } from '../src/mcp-server.ts';
import { capture, posting, profile } from './support.ts';

const mcpDeps = (): McpDeps => {
  const { fetchImpl } = capture();
  return {
    profile,
    promptContext: 'candidate',
    jev: { apiKey: 'k', fetchImpl },
    seen: (key) => key === 'remoteok:1',
  };
};

test('mcp: initialize advertises the protocol and the tool capability', async () => {
  const response = await handleMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize' }, mcpDeps());
  const result = response.result as { protocolVersion: string; capabilities: { tools: unknown }; serverInfo: { name: string } };
  assert.equal(result.protocolVersion, '2024-11-05');
  assert.deepEqual(result.capabilities.tools, {});
  assert.equal(result.serverInfo.name, 'openjob-agent');
});

test('mcp: the three tools are listed with schemas', async () => {
  const response = await handleMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, mcpDeps());
  const tools = (response.result as { tools: Array<{ name: string; inputSchema: unknown }> }).tools;
  assert.deepEqual(tools.map((tool) => tool.name), ['profile', 'score_posting', 'already_seen']);
  for (const tool of tools) assert.equal(typeof tool.inputSchema, 'object');
});

test('mcp: profile answers without leaking the CV or a key', async () => {
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'profile', arguments: {} } },
    mcpDeps(),
  );
  const text = (response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
  const payload = JSON.parse(text) as Record<string, unknown>;
  assert.equal(payload['headline'], 'Backend developer');
  assert.equal(payload['threshold'], 0.9);
  assert.deepEqual(payload['accepted_gaps'], ['learn Go']);
  assert.equal(payload['cv'], undefined, 'the CV stays out of the tool answer');
});

test('mcp: score_posting returns the probability and whether it clears the threshold', async () => {
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'score_posting', arguments: { posting } } },
    mcpDeps(),
  );
  const payload = JSON.parse((response.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}');
  assert.ok(Math.abs(payload.probability - 0.95) < 1e-9);
  assert.equal(payload.above_threshold, true);
  assert.equal(payload.key, 'linkedin:4012345678');
});

test('mcp: an incomplete posting is a protocol error, not a crash', async () => {
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'score_posting', arguments: { posting: { id: '1' } } } },
    mcpDeps(),
  );
  assert.equal(response.error?.code, -32602);
});

test('mcp: already_seen answers from the memory it was given', async () => {
  const seen = await handleMcpRequest(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'already_seen', arguments: { key: 'remoteok:1' } } },
    mcpDeps(),
  );
  const unseen = await handleMcpRequest(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'already_seen', arguments: { key: 'remoteok:2' } } },
    mcpDeps(),
  );
  assert.equal(JSON.parse((seen.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}').seen, true);
  assert.equal(JSON.parse((unseen.result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}').seen, false);
});

test('mcp: an unknown tool or method is an error with the right code', async () => {
  const tool = await handleMcpRequest(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nope', arguments: {} } },
    mcpDeps(),
  );
  const method = await handleMcpRequest({ jsonrpc: '2.0', id: 9, method: 'nope' }, mcpDeps());
  assert.equal(tool.error?.code, -32601);
  assert.equal(method.error?.code, -32601);
});

test('mcp: a frame without an id is a notification, and an invalid frame is refused', () => {
  const notification = parseMcpRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification?.notification, true);
  assert.equal(notification?.request.id, null);

  const request = parseMcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(request?.notification, false);

  assert.equal(parseMcpRequest({ jsonrpc: '2.0' }), null, 'no method is not a request');
  assert.equal(parseMcpRequest({ jsonrpc: '2.0', id: {}, method: 'x' }), null, 'a non-scalar id is refused');
  assert.equal(parseMcpRequest('not an object'), null);
});

test('mcp: a seen file that was asked for and cannot be read is an error, not an empty set', () => {
  assert.throws(() => loadSeen('/nonexistent/seen.json'), /unreadable/);

  const dir = mkdtempSync(join(tmpdir(), 'openjob-seen-'));
  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, 'not json', 'utf8');
  assert.throws(() => loadSeen(corrupt), /unreadable/);

  const notAnArray = join(dir, 'object.json');
  writeFileSync(notAnArray, '{"a":1}', 'utf8');
  assert.throws(() => loadSeen(notAnArray), /not a JSON array/);

  const good = join(dir, 'good.json');
  writeFileSync(good, '["remoteok:1","hn:2"]', 'utf8');
  assert.deepEqual([...loadSeen(good)].sort(), ['hn:2', 'remoteok:1']);
  writeFileSync(good, '["remoteok:1","hn:2",7]', 'utf8');
  assert.throws(() => loadSeen(good), /not a JSON array of keys/, 'a non-string entry is corruption, not a skip');

  assert.deepEqual([...loadSeen(null)], [], 'no path at all is a legitimate first run');
});

test('mcp: a posting with a non-web url is refused before any judgment, as the bridge refuses it', async () => {
  const response = await handleMcpRequest(
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: { name: 'score_posting', arguments: { posting: { ...posting, url: 'javascript:alert(1)' } } },
    },
    mcpDeps(),
  );
  assert.equal(response.error?.code, -32602, 'a javascript url is not a posting');
  assert.equal(response.result, undefined);
});

test('mcp: an internal failure answers with a generic message, and the detail stays off the protocol channel', () => {
  const response = internalErrorResponse(5, new Error('provider said: secret-token-123'));
  assert.equal(response.error?.code, -32603);
  assert.equal(response.error?.message, 'internal error');
  assert.doesNotMatch(JSON.stringify(response), /secret-token-123/);
});

test('mcp: the envelope is a zod shape, and a method that is not text is refused', () => {
  assert.equal(parseMcpRequest({ jsonrpc: '2.0', id: 1, method: 42 }), null, 'a method must be text');
  assert.equal(parseMcpRequest({ jsonrpc: '2.0', id: true, method: 'x' }), null, 'a boolean id is refused');
  const withNull = parseMcpRequest({ jsonrpc: '2.0', id: null, method: 'tools/list' });
  assert.equal(withNull?.notification, false, 'a null id is a request, not a notification');
});

test('mcp: a frame that is not JSON-RPC 2.0 is refused', () => {
  assert.equal(parseMcpRequest({ jsonrpc: '1.0', id: 1, method: 'tools/list' }), null, 'only the 2.0 protocol is spoken');
  assert.equal(parseMcpRequest({ id: 1, method: 'tools/list' }), null, 'a frame without the version is refused');
  assert.notEqual(parseMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), null);
});

test('mcp: an unknown tool is refused with a fixed message, never echoing the name it was called with', async () => {
  const secret = 'sk-ant-LEAK-as-a-tool-name';
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: secret, arguments: {} } },
    mcpDeps(),
  );
  assert.equal(response.error?.code, -32601);
  assert.equal(response.error?.message, 'unknown tool');
  assert.doesNotMatch(JSON.stringify(response), /sk-ant-LEAK/);
});

test('mcp: a tool call without a name is invalid params, not an unknown tool', async () => {
  const response = await handleMcpRequest(
    { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { arguments: {} } },
    mcpDeps(),
  );
  assert.equal(response.error?.code, -32602, 'JSON-RPC calls a malformed call invalid params');
});
