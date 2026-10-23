'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BossMonitor, parseBossLogLine } = require('../src/boss-monitor');
const { filterSnapshot, normalizeFilters, BossNotifications } = require('../src/boss-monitor-options');
function fixture(map = 'laboratory') {
  const monitor = new BossMonitor(); let line = 0;
  const feed = (body, channel = 'aiData', second = 4, file = channel + '_000.log') => monitor.feed(
    `2026-10-23 12:00:${String(second).padStart(2, '0')}.000|1.2.5|Trace|${channel}|${body}`, { session: 'synthetic', file, lineNumber: ++line });
  feed('Session mode: Pve', 'application', 0); feed('MatchingCompleted:', 'application', 1);
  feed('---> Request: client/match/local/start', 'backend', 2);
  feed(`RaidId:synthetic, Count:0, Locations:${map} ->`, 'application', 2); feed('GameStarted:', 'application', 3);
  return { monitor, feed };
}
test('1.0.16 Scourge plans, followers and deaths use the Lab initial position', () => {
  const { monitor, feed } = fixture();
  feed('Init Boss wave:bossScourgeEventLab ShallSpawn:True BossChance:65');
  feed('Bot activate role:bossScourgeEventLab pos:(12,-3,25) profileId:scourge id:1');
  feed('Bot activate role:followerScourgeEventLab pos:(13,-3,26) profileId:guard id:2');
  feed('Group set boss. groupName:ZoneLabEvent [Boss] botBoss.Id:1 bossType:bossScourgeEventLab', 'aiData', 17);
  feed('bot dispose:1', 'aiData', 20); feed('BotDied pos:(12,-3,25)', 'aiData', 20);
  const state = monitor.snapshot();
  assert.equal(state.mode, 'local-pve'); assert.equal(state.mapKey, 'the-lab');
  assert.equal(state.bosses[0].name, 'Scourge'); assert.equal(state.bosses[0].chance, 65);
  assert.equal(state.bosses[0].entities[0].zone, 'ZoneLabEvent');
  assert.equal(state.followers[0].name, 'Scourge 随从');
  assert.equal(state.markers[0].life, 'dead-confirmed'); assert.equal(state.markers[0].mapKey, 'the-lab');
  assert.deepEqual([state.markers[0].x, state.markers[0].y, state.markers[0].z], [12,-3,25]);
});
test('Rogue alias merges profiles, retains individual zones and records Raider deaths', () => {
  const { monitor, feed } = fixture();
  for (const [role,id] of [['exUsecFree',1],['exUsec',2],['pmcBot',3]]) feed(`Bot activate role:${role} pos:(${id},2,3) profileId:synthetic${id} id:${id}`);
  feed('Bot activate role:exUsec pos:(1,2,3) profileId:synthetic1 id:1', 'aiData', 5);
  feed('Group set boss. groupName:ZoneRogue [Boss] botBoss.Id:1 bossType:exUsecFree', 'aiData', 12);
  feed('bot dispose:1', 'aiData', 13); feed('BotDied pos:(1,2,3)', 'aiData', 13);
  feed('bot dispose:3', 'aiData', 14); feed('BotDied pos:(1,2,3)', 'aiData', 14);
  const state=monitor.snapshot(); const rogue=state.specialAis.find(r=>r.role==='exUsec'); const raider=state.specialAis.find(r=>r.role==='pmcBot');
  assert.equal(rogue.entities.length,2); assert.equal(rogue.entities[0].zone,'ZoneRogue');
  assert.equal(rogue.entities[0].life,'dead-confirmed'); assert.equal(rogue.entities[1].life,'alive-estimated');
  assert.equal(raider.entities[0].life,'dead-confirmed'); assert.equal(state.bosses.length,0);
  feed('---> Request: client/match/local/end', 'backend', 15);
  assert.deepEqual(monitor.snapshot().specialAis, []); // Never expose an ended local raid as a new authorized raid.
});
test('online PvE and PvP suppress all new role data', () => {
  for(const mode of ['Pve','Pvp']) {
    const { monitor, feed }=fixture(); feed('Bot activate role:pmcBot pos:(1,2,3) profileId:test id:1');
    if(mode==='Pve') feed('Matching with group id: synthetic', 'application', 6);
    else feed('Session mode: Pvp', 'application', 6);
    const state=monitor.snapshot(); assert.equal(state.mode, mode==='Pve'?'online-pve':'online-pvp');
    assert.deepEqual(state.specialAis,[]); assert.deepEqual(state.markers,[]);
  }
});
test('map filters retain selected boss followers and independent AI counts', () => {
  const { monitor, feed }=fixture();
  for(const [i,role] of ['bossScourgeEventLab','followerScourgeEventLab','bossKilla','pmcBot'].entries()) feed(`Bot activate role:${role} pos:(1,2,3) profileId:filter${i} id:${i}`);
  const raw=monitor.snapshot(); const filters=normalizeFilters({'the-lab':{mode:'selected',roles:['BOSSSCOURGEEVENTLAB']}});
  const selected=filterSnapshot(raw,filters); assert.deepEqual(selected.bosses.map(r=>r.name),['Scourge']);
  assert.equal(selected.followers.length,1); assert.equal(selected.specialAis.length,1); assert.equal(selected.markers.length,1);
  const off=filterSnapshot(raw,{'the-lab':{mode:'off',roles:[]}}); assert.equal(off.bosses.length,0); assert.equal(off.followers.length,0);
  assert.equal(off.markers.length,0); assert.equal(off.specialAis.length,1); assert.equal(raw.bosses.length,2);
});
test('notifications only emit fresh hidden-window discoveries once per raid', () => {
  const n=new BossNotifications(); n.setHidden(true,10000);
  const state={mode:'local-pve',raidToken:'raid1',bosses:[{role:'bossKilla',name:'Killa',entities:[{time:10000}]}]};
  assert.deepEqual(n.take(state,true,true),['Killa']); assert.deepEqual(n.take(state,true,true),[]);
  state.raidToken='raid2'; state.bosses[0].entities[0].time=1000; assert.deepEqual(n.take(state,true,true),[]);
  state.raidToken='raid3'; state.bosses[0].entities[0].time=10000; assert.deepEqual(n.take(state,true,false),[]); assert.deepEqual(n.take(state,true,true),[]);
  state.raidToken='raid4'; assert.deepEqual(n.take(state,false,true),[]); assert.deepEqual(n.take(state,true,true),[]);
});
test('BTR patrol reports only departure signals since activation outside Woods', () => {
  const { monitor, feed }=fixture();
  const signal='Audio.Vehicles.BTR.BtrSoundController:OnReadyToDeparture(BtrReadyToDepartureEvent)';
  feed(signal,'application',4); feed('Bot activate role:shooterBTR pos:(1,2,3) profileId:btr id:8','aiData',5);
  assert.match(monitor.snapshot().btr.estimate,/等待确认巡逻状态/);
  feed(signal,'application',6); assert.match(monitor.snapshot().btr.estimate,/巡逻中.*1 次发车信号/);
});
test('Cultist daytime plan uses output game time and never overrides actual activation', () => {
  const { monitor, feed }=fixture('woods');
  feed('RealDateTime:10/23/2026 12:00:00 GameDateTime:10/23/2026 12:00:00 factor:7','application',4,'output.log');
  feed('GameTimer utcNow:10/23/2026 12:00:00 start:10/23/2026 12:00:00 escape:10/23/2026 12:40:00','application',4,'output.log');
  feed('Init Boss wave:sectantPriest ShallSpawn:True BossChance:20');
  assert.equal(monitor.snapshot().bosses[0].status,'not-planned');
  feed('Bot activate role:sectantPriest pos:(1,2,3) profileId:priest id:7','aiData',5);
  assert.equal(monitor.snapshot().bosses[0].status,'spawned');
});
test('timestamp inheritance rejects missing time and accepts BTR multiline timestamp', () => {
  assert.equal(parseBossLogLine('BotDied pos:(1,2,3)'),null);
  const value=parseBossLogLine('Audio.Vehicles.BTR.BtrSoundController:OnReadyToDeparture(BtrReadyToDepartureEvent)',{timestamp:123456});
  assert.equal(value.time,123456);
});
