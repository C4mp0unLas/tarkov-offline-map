'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { planLoggingConfig, sha256, loggingPaths, buildElevatedScripts } = require('../src/boss-log-config');

const config = (overrides = {}) => JSON.stringify({
  rules: ['aiData', 'application', 'backend'].map((fileName) => ({
    fileName,
    minLevel: overrides[fileName] || 'Warning',
  })),
});

test('Logging.config plan changes only the three required logging levels', () => {
  const planned = planLoggingConfig(config());
  assert.equal(planned.changed, true);
  const parsed = JSON.parse(planned.output);
  assert.deepEqual(Object.fromEntries(parsed.rules.map((r) => [r.fileName, r.minLevel])), {
    aiData: 'Trace', application: 'Debug', backend: 'Information',
  });
  assert.equal(planLoggingConfig(planned.output).changed, false);
});

test('Logging.config refuses missing or duplicate rules and invalid levels', () => {
  assert.throws(() => planLoggingConfig('{"rules":[]}'), /aiData/);
  assert.throws(() => planLoggingConfig(JSON.stringify({ rules: [
    { fileName: 'aiData', minLevel: 'Warning' }, { fileName: 'aiData', minLevel: 'Warning' },
    { fileName: 'application', minLevel: 'Warning' }, { fileName: 'backend', minLevel: 'Warning' },
  ] })), /aiData/);
  assert.throws(() => planLoggingConfig(config({ aiData: 'Verbose' })), /无效/);
});

test('SHA-256 helper is stable for managed restore checks', () => {
  assert.equal(sha256('config'), sha256('config'));
  assert.notEqual(sha256('original'), sha256('edited'));
});

test('managed backups are outside user-writable app data and the elevated payload fits Windows limits', () => {
  const userData = 'C:\\Users\\tester\\AppData\\Roaming\\TarkovOfflineMap';
  const gameRoot = 'C:\\Games\\Escape from Tarkov';
  const files = loggingPaths(userData, gameRoot);
  assert.ok(!files.backup.toLowerCase().startsWith(userData.toLowerCase()));
  assert.ok(files.status.includes('persistent-status'));
  const scripts = buildElevatedScripts(gameRoot, userData, 1234);
  assert.ok(scripts.child.length <= 30000);
  assert.ok(scripts.parent.length < 8192);
});

test('persistent elevated script passes the Windows PowerShell parser without running', {
  skip: process.platform !== 'win32',
}, () => {
  const scripts = buildElevatedScripts('C:\\Games\\Escape from Tarkov', 'C:\\Users\\tester\\AppData\\Roaming\\TarkovOfflineMap', 1234);
  const source = "$s=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:TARKOV_BOSS_MONITOR_CHILD)); $t=$null; $e=$null; [System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$t,[ref]$e) | Out-Null; if ($e.Count) { $e | ForEach-Object { Write-Error $_.Message }; exit 1 }";
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], {
    env: { ...process.env, TARKOV_BOSS_MONITOR_CHILD: scripts.child },
    windowsHide: true,
  });
});
