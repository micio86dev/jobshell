import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyLicense, firstMeaningfulLine } from '../src/lib/licenses.ts';

test('classifyLicense recognises the licences present in the candidate runtimes', () => {
  const cases: Array<[string, string]> = [
    ['MIT License\n\nCopyright (c) 2025 Browser Use', 'MIT'],
    ['                                 Apache License\n                           Version 2.0, January 2004', 'Apache-2.0'],
    ['GNU AFFERO GENERAL PUBLIC LICENSE\nVersion 3, 19 November 2007', 'AGPL-3.0'],
    ['GNU GENERAL PUBLIC LICENSE\n                       Version 3, 29 June 2007', 'GPL-3.0'],
    ['ISC License\n\nCopyright (c) 2024', 'ISC'],
    ['BSD 3-Clause License\n\nRedistribution and use in source and binary forms', 'BSD-3-Clause'],
    ['BSD 2-Clause License\n\nRedistribution and use in source and binary forms', 'BSD-2-Clause'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(classifyLicense(text), expected, `expected ${expected} for ${text.slice(0, 20)}`);
  }
});

test('classifyLicense distinguishes a 3-clause BSD body from a 2-clause one', () => {
  const threeClause =
    'Copyright (c) 2024\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted.\nNeither the name of the copyright holder nor the names of its\ncontributors may be used to endorse.';
  const twoClause =
    'Copyright (c) 2024\nRedistribution and use in source and binary forms, with or without\nmodification, are permitted.';
  assert.equal(classifyLicense(threeClause), 'BSD-3-Clause');
  assert.equal(classifyLicense(twoClause), 'BSD-2-Clause');
});

test('classifyLicense does not match a licence word inside another word', () => {
  // "disclaim" contains "isc"; an unanchored rule would mislabel this file.
  assert.equal(classifyLicense('The authors disclaim all warranties in this file.'), null);
});

test('classifyLicense returns null for an unrecognised licence body', () => {
  assert.equal(classifyLicense('Proprietary. All rights reserved.'), null);
});

test('classifyLicense prefers Apache over a later MIT mention', () => {
  const text = 'Apache License\nVersion 2.0\n\nThis product includes software licensed under the MIT License.';
  assert.equal(classifyLicense(text), 'Apache-2.0');
});

test('firstMeaningfulLine skips leading blank lines and trims', () => {
  assert.equal(firstMeaningfulLine('\n\n   MIT License  \nCopyright'), 'MIT License');
  assert.equal(firstMeaningfulLine('   \n\t\n'), null);
});
