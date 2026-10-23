'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findGameRoot, collectLauncherPathValues } = require('../src/game-install');

test('game install discovery needs only the executable, without a logging configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eft-root-'));
  try {
    assert.equal(findGameRoot([root]), null);
    fs.writeFileSync(path.join(root, 'EscapeFromTarkov.exe'), '');
    assert.equal(findGameRoot([root]), root);
    assert.equal(findGameRoot([path.join(root, 'EscapeFromTarkov.exe')]), root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('launcher discovery only collects local path-like fields', () => {
  const paths = collectLauncherPathValues({
    gamePath: 'D:/Games/Escape from Tarkov',
    cache: { directory: 'D:/Cache' },
    token: 'secret-value',
  });
  assert.deepEqual(paths, ['D:/Games/Escape from Tarkov', 'D:/Cache']);
  assert.ok(!paths.some((value) => value.includes('secret')));
});
