'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LogWatcher } = require('../src/log-watcher');
const { BossMonitor } = require('../src/boss-monitor');
const SESSION = 'log_2026.10.15_12-00-00_1.2.0';
const line = (body, channel = 'application', at = '00') =>
  `2026-10-15 12:00:${at}.000|1.2.0|Trace|${channel}|${body}\n`;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boss-refresh-'));
  const dir = path.join(root, SESSION);
  fs.mkdirSync(dir);
  const files = Object.fromEntries(['application', 'backend', 'aiData'].map(c => [c, path.join(dir, `test ${c}_000.log`)]));
  fs.writeFileSync(files.application, line('Session mode: Pve') + line('MatchingCompleted:', 'application', '01')
    + line('RaidId:one, Count:0, Locations:woods ->', 'application', '03') + line('GameStarted: Woods', 'application', '04'));
  fs.writeFileSync(files.backend, line('---> Request: client/match/local/start', 'backend', '02'));
  fs.writeFileSync(files.aiData, line('Bot activate role:bossKilla pos:(1,2,3) profileId:one id:1', 'aiData', '05'));
  const monitor = new BossMonitor();
  const commits = [], statuses = [], rawReadiness = [];
  let ready = false;
  const w = new LogWatcher(root, () => {}, s => {
    statuses.push(s);
    if (s.state === 'watching') { monitor.setSession(s.sessionId); ready = s.rawHistoryReady; }
    if (s.state === 'rewind') { monitor.reset(s.sessionId); ready = false; }
    if (s.state === 'raw-batch') ready = false;
    if (s.state === 'raw-history') {
      ready = s.rawHistoryReady;
      commits.push(ready ? monitor.snapshot() : { mode: 'recognizing', markers: [] });
    }
  }, (raw, meta) => {
    rawReadiness.push(ready);
    monitor.feed(raw, meta);
  });
  w.start();
  t.after(() => { w.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  assert.equal(commits.at(-1).mode, 'local-pve');
  commits.length = statuses.length = rawReadiness.length = 0;
  return { w, files, dir, commits, statuses, rawReadiness };
}
test('complete live batches commit once without temporarily clearing local markers', t => {
  const f = fixture(t);
  for (let i = 0; i < 5; i++) {
    fs.appendFileSync(f.files.application, line(`GC iteration ${i}`, 'application', '06'));
    fs.appendFileSync(f.files.aiData, line(`AI tick ${i}`, 'aiData', '06'));
    f.w.scan(true);
  }
  assert.equal(f.commits.length, 5);
  assert.ok(f.commits.every(s => s.mode === 'local-pve' && s.markers.length === 1));
  assert.ok(f.rawReadiness.length > 0 && f.rawReadiness.every(ready => ready === false));
  assert.ok(f.statuses.filter(s => s.state === 'raw-history').every(s => s.rawHistoryReady));
});
test('partial lines hide monitoring until completed; online evidence commits without an intermediate local snapshot', t => {
  const f = fixture(t);
  fs.appendFileSync(f.files.backend, line('ordinary backend message', 'backend', '07').trimEnd());
  f.w.scan(true);
  assert.equal(f.commits.at(-1).mode, 'recognizing');
  assert.equal(f.w.rawHistoryReady, false);
  f.commits.length = 0;
  fs.appendFileSync(f.files.backend, '\n');
  // A newly discovered application file is read after backend: commit both together.
  fs.writeFileSync(path.join(f.dir, 'test application_001.log'), line('Matching with group id: 19', 'application', '08'));
  f.w.scan(true);
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].mode, 'online-pve');
  assert.deepEqual(f.commits[0].markers, []);
});
test('a newly discovered complete log channel does not cause a temporary empty view', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'test output_000.log'), line('noise', 'output', '06'));
  f.w.scan(true);
  assert.equal(f.commits.length, 1);
  assert.equal(f.commits[0].mode, 'local-pve');
  assert.equal(f.commits[0].markers.length, 1);
});
test('a live backlog larger than one polling budget hides monitoring until fully replayed', t => {
  const f = fixture(t);
  fs.appendFileSync(f.files.aiData, Buffer.alloc(8 * 1024 * 1024 + 100, 120));
  fs.appendFileSync(f.files.aiData, '\n');
  f.w.scan(true);
  assert.equal(f.commits.at(-1).mode, 'recognizing');
  f.w.scan(true);
  assert.equal(f.commits.at(-1).mode, 'local-pve');
});
