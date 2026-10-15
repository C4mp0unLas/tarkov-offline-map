'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BossMonitor, parseBossLogLine, parsePosition } = require('../src/boss-monitor');

const log = (body, channel = 'aiData', at = '2026-10-15 12:00:00.000') => `${at}|1.2.0|Trace|${channel}|${body}`;

test('PvE alone does not enable monitoring; online PvE and PvP are classified and clear dynamic data', () => {
  const monitor = new BossMonitor();
  monitor.feed(log('Session mode: Pve', 'application'), { session: 'one' });
  assert.equal(monitor.snapshot().mode, 'recognizing');
  monitor.feed(log('Matching with group id: 17', 'application', '2026-10-15 12:00:01.000'), { session: 'one' });
  assert.equal(monitor.snapshot().mode, 'online-pve');
  monitor.reset('two');
  monitor.feed(log('Session mode: Pvp', 'application'), { session: 'two' });
  assert.equal(monitor.snapshot().mode, 'online-pvp');
  assert.deepEqual(monitor.snapshot().markers, []);
});

test('local PvE requires a local-start request and game start, then exposes the logged initial position', () => {
  const monitor = new BossMonitor();
  monitor.feed(log('Session mode: Pve', 'application'), { session: 'woods' });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:01.000'), { session: 'woods' });
  monitor.feed(log('---> Request: client/match/local/start', 'backend', '2026-10-15 12:00:02.000'), { session: 'woods', file: 'backend_000.log', lineNumber: 1 });
  monitor.feed(log('RaidId:abc, Count:0, Locations:woods ->', 'application', '2026-10-15 12:00:02.500'), { session: 'woods' });
  monitor.feed(log('GameStarted: Woods', 'application', '2026-10-15 12:00:03.000'), { session: 'woods' });
  monitor.feed(log('Init Boss wave:bossKilla ShallSpawn:True BossChance:35', 'aiData', '2026-10-15 12:00:03.100'), { session: 'woods' });
  monitor.feed(log('Bot activate role:bossKilla pos:(12.5, 3, -8) profileId:abc id:77', 'aiData', '2026-10-15 12:00:03.500'), { session: 'woods', file: 'aiData_000.log', lineNumber: 3 });
  const state = monitor.snapshot();
  assert.equal(state.mode, 'local-pve');
  assert.equal(state.bosses[0].status, 'spawned');
  assert.equal(state.bosses[0].chance, 35);
  assert.deepEqual(state.markers[0], {
    id: 'bossKilla:abc', role: 'bossKilla', name: 'Killa', x: 12.5, y: 3, z: -8,
    at: new Date('2026-10-15T12:00:03.500').getTime(), life: 'alive-estimated', zone: '', mapKey: 'woods',
  });
});

test('mixed online matching and detailed AI evidence fail closed', () => {
  const monitor = new BossMonitor();
  monitor.feed(log('Session mode: Pve', 'application'), { session: 'mixed' });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:01.000'), { session: 'mixed' });
  monitor.feed(log('Init Boss wave:bossKilla ShallSpawn:True BossChance:25', 'aiData', '2026-10-15 12:00:02.000'), { session: 'mixed' });
  assert.equal(monitor.snapshot().mode, 'recognizing');
  assert.deepEqual(monitor.snapshot().markers, []);
});

test('online PvE wins immediately over stale local data; a new boundary clears old raid state', () => {
  const monitor = new BossMonitor();
  const session = 'current';
  monitor.feed(log('Session mode: Pve', 'application'), { session });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:01.000'), { session });
  monitor.feed(log('---> Request: client/match/local/start', 'backend', '2026-10-15 12:00:02.000'), { session });
  monitor.feed(log('RaidId:one, Count:0, Locations:woods ->', 'application', '2026-10-15 12:00:02.500'), { session });
  monitor.feed(log('GameStarted: Woods', 'application', '2026-10-15 12:00:03.000'), { session });
  monitor.feed(log('Bot activate role:bossKilla pos:(1,2,3) profileId:old id:11', 'aiData', '2026-10-15 12:00:04.000'), { session, file: 'aiData_000.log', lineNumber: 1 });
  assert.equal(monitor.snapshot().mode, 'local-pve');
  monitor.feed(log('Matching with group id: 19', 'application', '2026-10-15 12:00:05.000'), { session });
  assert.equal(monitor.snapshot().mode, 'online-pve');
  assert.deepEqual(monitor.snapshot().markers, []);
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:06.000'), { session });
  assert.equal(monitor.snapshot().mode, 'online-pve');
  assert.deepEqual(monitor.snapshot().bosses, []);
});

test('online and local evidence at the same timestamp fail closed', () => {
  const monitor = new BossMonitor();
  monitor.feed(log('Session mode: Pve', 'application'), { session: 'conflict' });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:01.000'), { session: 'conflict' });
  const at = '2026-10-15 12:00:02.000';
  monitor.feed(log('Matching with group id: 19', 'application', at), { session: 'conflict' });
  monitor.feed(log('---> Request: client/match/local/start', 'backend', at), { session: 'conflict' });
  monitor.feed(log('GameStarted: Woods', 'application', '2026-10-15 12:00:03.000'), { session: 'conflict' });
  assert.equal(monitor.snapshot().mode, 'recognizing');
  assert.deepEqual(monitor.snapshot().markers, []);
});

test('local evidence from a previous raid cannot authorize a new raid', () => {
  const monitor = new BossMonitor();
  const session = 'raid-reset';
  monitor.feed(log('Session mode: Pve', 'application'), { session });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:00:01.000'), { session });
  monitor.feed(log('---> Request: client/match/local/start', 'backend', '2026-10-15 12:00:02.000'), { session });
  monitor.feed(log('RaidId:first, Count:0, Locations:woods ->', 'application', '2026-10-15 12:00:02.500'), { session });
  monitor.feed(log('GameStarted: Woods', 'application', '2026-10-15 12:00:03.000'), { session });
  assert.equal(monitor.snapshot().mode, 'local-pve');
  monitor.feed(log('---> Request: client/match/local/end', 'backend', '2026-10-15 12:05:00.000'), { session });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:05:10.000'), { session });
  monitor.feed(log('RaidId:second, Count:0, Locations:customs ->', 'application', '2026-10-15 12:05:11.000'), { session });
  monitor.feed(log('GameStarted: Customs', 'application', '2026-10-15 12:05:12.000'), { session });
  assert.equal(monitor.snapshot().mode, 'recognizing');
  assert.deepEqual(monitor.snapshot().markers, []);
});

test('a later local boundary can supersede earlier online matchmaking evidence', () => {
  const monitor = new BossMonitor();
  const session = 'new-local-raid';
  monitor.feed(log('Session mode: Pve', 'application'), { session });
  monitor.feed(log('Matching with group id: 19', 'application', '2026-10-15 12:00:01.000'), { session });
  monitor.feed(log('MatchingCompleted:', 'application', '2026-10-15 12:10:00.000'), { session });
  monitor.feed(log('---> Request: client/match/local/start', 'backend', '2026-10-15 12:10:01.000'), { session });
  monitor.feed(log('RaidId:local, Count:0, Locations:woods ->', 'application', '2026-10-15 12:10:02.000'), { session });
  monitor.feed(log('GameStarted: Woods', 'application', '2026-10-15 12:10:03.000'), { session });
  assert.equal(monitor.snapshot().mode, 'local-pve');
});

test('canonical AI and application logs suppress mirrored output events', () => {
  const monitor = new BossMonitor();
  const session = 'deduplicate';
  const appFile = '2026.10.15 application_000.log';
  const aiFile = '2026.10.15 aiData_000.log';
  const outputFile = '2026.10.15 output_000.log';
  const feed = (body, channel, file, lineNumber, at) => monitor.feed(log(body, channel, at), {
    session, file, lineNumber,
  });
  feed('Session mode: Pve', 'application', appFile, 1, '2026-10-15 12:00:00.000');
  feed('MatchingCompleted:', 'application', appFile, 2, '2026-10-15 12:00:01.000');
  feed('---> Request: client/match/local/start', 'backend', '2026.10.15 backend_000.log', 1, '2026-10-15 12:00:02.000');
  feed('RaidId:woods, Count:0, Locations:woods ->', 'application', appFile, 3, '2026-10-15 12:00:02.500');
  feed('GameStarted: Woods', 'application', appFile, 4, '2026-10-15 12:00:03.000');
  const activation = 'Bot activate role:bossKilla pos:(1,2,3) profileId:one id:7';
  feed(activation, 'aiData', aiFile, 1, '2026-10-15 12:00:04.000');
  feed(activation, 'aiData', outputFile, 1, '2026-10-15 12:00:04.000');
  assert.equal(monitor.snapshot().bosses[0].entities.length, 1);
});

test('death inference follows the active bot profile and does not misattribute a reused bot id', () => {
  const monitor = new BossMonitor();
  const session = 'death';
  const feed = (body, channel, lineNumber, time = '2026-10-15 12:00:04.000') => monitor.feed(
    log(body, channel, time), { session, file: `${channel}_000.log`, lineNumber },
  );
  feed('Session mode: Pve', 'application', 1, '2026-10-15 12:00:00.000');
  feed('MatchingCompleted:', 'application', 2, '2026-10-15 12:00:01.000');
  feed('---> Request: client/match/local/start', 'backend', 1, '2026-10-15 12:00:02.000');
  feed('RaidId:death, Count:0, Locations:woods ->', 'application', 3, '2026-10-15 12:00:02.500');
  feed('GameStarted: Woods', 'application', 4, '2026-10-15 12:00:03.000');
  feed('Bot activate role:bossKilla pos:(1,2,3) profileId:first id:77', 'aiData', 1);
  feed('bot dispose:77', 'aiData', 2);
  feed('BotDied pos:(1,2,3)', 'aiData', 3);
  assert.equal(monitor.snapshot().bosses[0].entities[0].life, 'dead-confirmed');
  monitor.reset(session);
  feed('Session mode: Pve', 'application', 1, '2026-10-15 12:01:00.000');
  feed('MatchingCompleted:', 'application', 2, '2026-10-15 12:01:01.000');
  feed('---> Request: client/match/local/start', 'backend', 1, '2026-10-15 12:01:02.000');
  feed('RaidId:reuse, Count:0, Locations:woods ->', 'application', 3, '2026-10-15 12:01:02.500');
  feed('GameStarted: Woods', 'application', 4, '2026-10-15 12:01:03.000');
  feed('Bot activate role:bossKilla pos:(1,2,3) profileId:first id:77', 'aiData', 1, '2026-10-15 12:01:04.000');
  feed('bot dispose:77', 'aiData', 2, '2026-10-15 12:01:04.100');
  feed('Bot activate role:bossKilla pos:(4,5,6) profileId:second id:77', 'aiData', 3, '2026-10-15 12:01:04.200');
  feed('BotDied pos:(1,2,3)', 'aiData', 4, '2026-10-15 12:01:04.300');
  assert.equal(monitor.snapshot().bosses[0].entities[0].life, 'alive-estimated');
});

test('position parser handles signed coordinates and rejects malformed values', () => {
  assert.deepEqual(parsePosition('pos:(-12.25, 4e1, 0.5)'), { x: -12.25, y: 40, z: 0.5 });
  assert.equal(parsePosition('pos:(1, two, 3)'), null);
  assert.equal(parseBossLogLine('not a game log'), null);
});
