'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('renderer bridge exposes log monitoring without a game configuration writer', () => {
  let api;
  const calls = [];
  const ipcRenderer = { invoke: (...args) => { calls.push(args); return Promise.resolve({}); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), {
    require: name => {
      assert.equal(name, 'electron');
      return { contextBridge: { exposeInMainWorld: (name, value) => { assert.equal(name, 'api'); api = value; } }, ipcRenderer };
    },
  });
  assert.equal(Object.hasOwn(api, 'applyBossLogging'), false);
  assert.equal(typeof api.discoverGame, 'function');
  assert.equal(typeof api.getState, 'function');
  api.getState();
  assert.deepEqual(calls, [['state:get']]);
});
