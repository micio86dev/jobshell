// Tests for the user's source choices: switch a source on or off, add or remove a board tenant.
// Pure functions over the configuration object; the file is written only by the CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import { addTenant, BOARD_SOURCES, removeTenant, setEnabled, sourceRows, sourceStatus } from '../src/source-settings.ts';

test('a known source can be switched off and on again, and the other sources are untouched', () => {
  const base = defaultConfig();
  const off = setEnabled(base, 'remoteok', false);
  assert.equal(off.ok, true);
  if (!off.ok) return;
  assert.equal(off.config.sources['remoteok']?.enabled, false);

  const on = setEnabled(off.config, 'remoteok', true);
  assert.equal(on.ok, true);
  if (on.ok) assert.equal(on.config.sources['remoteok']?.enabled, true);
});

test('an unknown source id is refused: the user cannot invent a source by switching it', () => {
  const result = setEnabled(defaultConfig(), 'monster', false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not a known source/);
});

test('a tenant is added to a board source only, once, and a second add changes nothing', () => {
  const first = addTenant(defaultConfig(), 'greenhouse', 'acme');
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = addTenant(first.config, 'greenhouse', 'acme');
  assert.equal(again.ok, true);
  if (again.ok) assert.deepEqual(again.config.sources['greenhouse']?.tenants, ['acme']);
});

test('a tenant on a source that is not a board is refused', () => {
  const result = addTenant(defaultConfig(), 'remoteok', 'acme');
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not a board source/);
});

test('a tenant that is a URL, a path or a key-shaped value is refused and never echoed', () => {
  for (const bad of ['https://evil.example/x', '../etc', 'sk-live-abcdef123456']) {
    const result = addTenant(defaultConfig(), 'greenhouse', bad);
    assert.equal(result.ok, false, `${bad} must be refused`);
    if (!result.ok) assert.doesNotMatch(result.error, /evil\.example|sk-live/);
  }
});

test('a user tenant is removed by name and the list keeps the rest in order', () => {
  const added = addTenant(defaultConfig(), 'lever', 'acme');
  if (!added.ok) throw new Error(added.error);
  const second = addTenant(added.config, 'lever', 'beta');
  if (!second.ok) throw new Error(second.error);
  const removed = removeTenant(second.config, 'lever', 'acme');
  assert.equal(removed.ok, true);
  if (removed.ok) assert.deepEqual(removed.config.sources['lever']?.tenants, ['beta']);
});

test('sourceStatus reports the switch, the verified boards and the user tenants of a source', () => {
  const added = addTenant(defaultConfig(), 'greenhouse', 'acme');
  if (!added.ok) throw new Error(added.error);
  const status = sourceStatus(added.config, 'greenhouse');
  assert.equal(status.enabled, true, 'absent means on');
  assert.equal(status.userTenants.join(','), 'acme');
  assert.ok(status.verifiedTenants > 0, 'the verified registry is counted, not edited');
});

test('a source the policy will never run is reported as not reachable, even when the user left it on', () => {
  const base = defaultConfig();
  assert.equal(sourceStatus(base, 'ashby').reachable, false, 'ashby is prohibited until its robots.txt is readable');
  assert.equal(sourceStatus(base, 'lever').reachable, true, 'lever is allowed by policy');
  assert.equal(sourceStatus(base, 'linkedin').reachable, false, 'measurement-only sources run only from the extension');
  assert.equal(sourceStatus(base, 'ziprecruiter').reachable, true, 'fetched by the desktop app with the user account');
});

test('sourceRows lists every board source and every source the user touched, with what the page needs', () => {
  const touched = setEnabled(defaultConfig(), 'remoteok', false);
  if (!touched.ok) throw new Error(touched.error);
  const rows = sourceRows(touched.config);
  const ids = rows.map((row) => row.id);
  for (const board of BOARD_SOURCES) assert.ok(ids.includes(board), `${board} is listed`);
  assert.ok(ids.includes('remoteok'), 'a source the user switched off is listed');
  const remoteok = rows.find((row) => row.id === 'remoteok');
  assert.equal(remoteok?.enabled, false);
  assert.equal(rows.find((row) => row.id === 'ashby')?.reachable, false);
  assert.equal(rows.find((row) => row.id === 'greenhouse')?.isBoard, true);
  assert.equal(rows.find((row) => row.id === 'remoteok')?.isBoard, false);
});
