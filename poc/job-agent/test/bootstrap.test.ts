// The runtime loader reads the user's profile file. A profile holds personal data, so a parse
// error must not quote the file's text. Offline: the files are written to a temporary folder.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadRuntime } from '../src/bootstrap.ts';

test('a profile file that is not JSON fails without quoting its text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'openjob-boot-'));
  const profilePath = join(dir, 'profile.json');
  const leaked = 'Mario Rossi sk-ant-LEAK-personal-text';
  writeFileSync(profilePath, `{"headline": ${leaked}}`, 'utf8');
  assert.throws(
    () => loadRuntime({ profilePath, configPath: join(dir, 'missing.json') }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.doesNotMatch(message, /Mario Rossi|sk-ant-LEAK/, 'the file text is not part of the error');
      assert.match(message, /profile file is not valid JSON/);
      return true;
    },
  );
});
