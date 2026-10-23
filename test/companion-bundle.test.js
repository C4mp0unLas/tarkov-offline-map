'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashFile, validateCachedAsset } = require('../tools/make-companion-bundle');
test('companion validation rejects corruption, partial downloads and missing files', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-bundle-'));
  const file = path.join(folder, 'installer.exe');
  try {
    fs.writeFileSync(file, 'original');
    const asset = { size: 8, sha256: await hashFile(file) };
    assert.equal(await validateCachedAsset(file, asset), true);
    fs.writeFileSync(file, 'modified');
    assert.equal(await validateCachedAsset(file, asset), false);
    fs.writeFileSync(file, 'orig');
    assert.equal(await validateCachedAsset(file, asset), false);
    fs.unlinkSync(file);
    assert.equal(await validateCachedAsset(file, asset), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

