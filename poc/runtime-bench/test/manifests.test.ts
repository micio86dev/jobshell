import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePyDependencies,
  parseRequiresPython,
  readNodePackage,
} from '../src/lib/manifests.ts';

test('parseRequiresPython reads the constraint from a pyproject body', () => {
  const pyproject = '[project]\nname = "browser-harness"\nrequires-python = ">=3.11"\n';
  assert.equal(parseRequiresPython(pyproject), '>=3.11');
});

test('parseRequiresPython returns null when the constraint is absent', () => {
  assert.equal(parseRequiresPython('[project]\nname = "x"\n'), null);
});

test('parsePyDependencies collapses the dependency array to one line', () => {
  const pyproject = '[project]\ndependencies = [\n  "cdp-use==1.4.5",\n  "pillow==12.3.0",\n]\n';
  assert.equal(parsePyDependencies(pyproject), '"cdp-use==1.4.5", "pillow==12.3.0",');
});

test('parsePyDependencies does not stop at an extras bracket inside an element', () => {
  const pyproject = '[project]\ndependencies = [\n  "uvicorn[standard]>=0.30",\n  "httpx[http2]>=0.27",\n]\n\n[build-system]\nrequires = ["hatchling"]\n';
  assert.equal(parsePyDependencies(pyproject), '"uvicorn[standard]>=0.30", "httpx[http2]>=0.27",');
});

test('parsePyDependencies reads a single-line array', () => {
  const pyproject = '[project]\ndependencies = ["a==1", "b==2"]\n';
  assert.equal(parsePyDependencies(pyproject), '"a==1", "b==2"');
});

test('parsePyDependencies keeps an extras bracket on a single-line array', () => {
  const pyproject = '[project]\ndependencies = ["uvicorn[standard]>=0.30", "httpx[http2]>=0.27"]\n';
  assert.equal(parsePyDependencies(pyproject), '"uvicorn[standard]>=0.30", "httpx[http2]>=0.27"');
});

test('parsePyDependencies stops at the array bracket even when it shares a line with elements', () => {
  const pyproject = '[project]\ndependencies = [\n  "a==1",\n  "b==2", ]\n\n[build-system]\nrequires = ["hatchling"]\n';
  assert.equal(parsePyDependencies(pyproject), '"a==1", "b==2",');
});

test('parsePyDependencies returns null for an absent or empty array', () => {
  assert.equal(parsePyDependencies('[project]\nname = "x"\n'), null);
  assert.equal(parsePyDependencies('[project]\ndependencies = [\n]\n'), null);
});

test('readNodePackage narrows a well-formed package.json', () => {
  const facts = readNodePackage({
    name: 'agent-browser',
    version: '0.41.2',
    engines: { node: '>=22.0.0' },
    bin: { 'agent-browser': './bin/agent-browser.js' },
    dependencies: { b: '1', a: '2' },
  });
  assert.deepEqual(facts, {
    name: 'agent-browser',
    version: '0.41.2',
    engines: { node: '>=22.0.0' },
    bin: { 'agent-browser': './bin/agent-browser.js' },
    dependencies: ['a', 'b'],
  });
});

test('readNodePackage returns null for a non-object manifest', () => {
  assert.equal(readNodePackage(null), null);
  assert.equal(readNodePackage('not json'), null);
  assert.equal(readNodePackage([1, 2]), null);
});

test('readNodePackage ignores wrongly typed fields instead of inventing values', () => {
  const facts = readNodePackage({ name: 42, version: '1.0.0', engines: 'nope', dependencies: [] });
  assert.deepEqual(facts, { name: null, version: '1.0.0', engines: null, bin: null, dependencies: [] });
});
