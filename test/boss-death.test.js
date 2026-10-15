'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BossMonitor, ROLE_NAMES } = require('../src/boss-monitor');
const log = (body, channel = 'aiData', at = '04.000') =>
  `2026-10-16 12:00:${at}|1.2.0|Trace|${channel}|${body}`;
function fixture() {
  const monitor = new BossMonitor();
  const lines = new Map();
  const feed = (body, channel = 'aiData', at = '04.000', file = channel + '_000.log', gap = 1) => {
    const lineNumber = (lines.get(file) || 0) + gap;
    lines.set(file, lineNumber);
    monitor.feed(log(body, channel, at), { session: 'death-regression', file, lineNumber });
  };
  feed('Session mode: Pve', 'application', '00.000');
  feed('MatchingCompleted:', 'application', '01.000');
  feed('---> Request: client/match/local/start', 'backend', '02.000');
  feed('RaidId:death-test, Count:0, Locations:woods ->', 'application', '02.500');
  feed('GameStarted: Woods', 'application', '03.000');
  return { monitor, feed };
}
const entities = state => [...state.bosses, ...state.followers, ...state.pmcs].flatMap(row => row.entities);

test('death pairs update every supported PMC, boss and follower role without duplicate deaths', () => {
  const { monitor, feed } = fixture();
  const roles = Object.keys(ROLE_NAMES).filter(role => role !== 'shooterBTR');
  for (const [i, role] of roles.entries()) {
    feed(`Bot activate role:${role} pos:(1,2,3) profileId:synthetic${i} id:${i}`);
  }
  const deathAt = new Date('2026-10-16T12:00:05.001').getTime();
  for (const [i] of roles.entries()) {
    feed('bot dispose:' + i, 'aiData', '05.001');
    feed('BotDied pos:(4,5,6)', 'aiData', '05.001', 'aiData_000.log', 3);
  }
  const state = monitor.snapshot();
  assert.equal(state.mode, 'local-pve');
  assert.equal(entities(state).length, roles.length);
  for (const role of roles) {
    const matched = entities(state).filter(entity => entity.role === role);
    assert.equal(matched.length, 1, role);
    assert.equal(matched[0].life, 'dead-confirmed', role);
    assert.equal(matched[0].diedAt, deathAt, role);
  }
  assert.ok(state.markers.every(marker => marker.life === 'dead-confirmed'));
  const repeated = monitor.events.filter(event => ['dispose', 'died'].includes(event.kind));
  for (const event of repeated) {
    const body = event.kind === 'dispose' ? 'bot dispose:' + event.botId : 'BotDied pos:(4,5,6)';
    assert.equal(monitor.feed(log(body, 'aiData', '05.001'),
      { session: 'death-regression', file: event.file, lineNumber: event.lineNumber }), false);
  }
  assert.deepEqual(monitor.snapshot(), state);
});

test('partial squad deaths preserve individual PMC and follower counts across later spawns', () => {
  const { monitor, feed } = fixture();
  for (const [role, id] of [['pmcBEAR', 1], ['pmcBEAR', 2], ['followerBully', 3], ['followerBully', 4]]) {
    feed(`Bot activate role:${role} pos:(1,2,3) profileId:synthetic${id} id:${id}`);
  }
  for (const id of [1, 3]) {
    feed('bot dispose:' + id, 'aiData', '05.000');
    feed('BotDied pos:(4,5,6)', 'aiData', '05.000');
  }
  feed('Bot activate role:pmcBEAR pos:(7,2,8) profileId:reinforcement id:5', 'aiData', '06.000');
  const state = monitor.snapshot();
  assert.equal(state.pmcs[0].spawned, 3);
  assert.equal(state.pmcs[0].entities.filter(e => e.life === 'dead-confirmed').length, 1);
  assert.equal(state.followers[0].entities.filter(e => e.life === 'dead-confirmed').length, 1);
  assert.equal(state.followers[0].entities.filter(e => e.life === 'alive-estimated').length, 1);
});

test('dispose without a matching death, another file, or an expired pair does not imply death', () => {
  for (const kind of ['dispose-only', 'other-file', 'late', 'too-many-lines']) {
    const { monitor, feed } = fixture();
    feed('Bot activate role:pmcUSEC pos:(1,2,3) profileId:synthetic id:1');
    feed('bot dispose:1', 'aiData', '05.000');
    if (kind !== 'dispose-only') feed('BotDied pos:(4,5,6)', 'aiData',
      kind === 'late' ? '06.001' : '05.001', kind === 'other-file' ? 'aiData_001.log' : 'aiData_000.log',
      kind === 'too-many-lines' ? 65 : 1);
    assert.equal(monitor.snapshot().pmcs[0].entities[0].life, 'alive-estimated', kind);
  }
});
