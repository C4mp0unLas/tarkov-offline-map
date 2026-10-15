'use strict';

const MAX_EVENTS = 50000;
const { BUNDLE_TO_RAIDCODE, RCID_TO_RAIDCODE, RAIDCODE_TO_MAPKEY } = require('./constants');
const MAP_ALIASES = new Map(Object.entries(RAIDCODE_TO_MAPKEY).map(([key, value]) => [key.toLowerCase(), value]));
for (const [alias, code] of Object.entries({ ...BUNDLE_TO_RAIDCODE, ...RCID_TO_RAIDCODE })) {
  MAP_ALIASES.set(alias.toLowerCase(), RAIDCODE_TO_MAPKEY[code]);
}
for (const key of Object.values(RAIDCODE_TO_MAPKEY)) MAP_ALIASES.set(key, key);
MAP_ALIASES.set('labs', 'the-lab');

const ROLE_NAMES = {
  bossKilla: 'Killa', bossTagilla: 'Tagilla', bossBully: 'Reshala',
  bossKojaniy: 'Shturman', bossGluhar: 'Glukhar', bossSanitar: 'Sanitar',
  bossKnight: 'Knight', followerBigPipe: 'Big Pipe', followerBirdEye: 'Birdeye',
  bossZryachiy: 'Zryachiy', bossBoar: 'Kaban', bossKolontay: 'Kollontay',
  bossPartisan: 'Partisan', sectantPriest: 'Cultist Priest',
  pmcBEAR: 'AI PMC · BEAR', pmcUSEC: 'AI PMC · USEC', shooterBTR: 'BTR',
  followerBully: 'Reshala 随从', followerBullyBlackDiv: 'Reshala 随从',
  followerKojaniy: 'Shturman 随从', followerGluharAssault: 'Glukhar 突击手',
  followerGluharScout: 'Glukhar 侦察兵', followerGluharSecurity: 'Glukhar 护卫',
  followerGluharSnipe: 'Glukhar 狙击手', followerSanitar: 'Sanitar 随从',
  followerZryachiy: 'Zryachiy 随从', followerBoar: 'Kaban 随从',
  followerKolontay: 'Kollontay 随从', followerTagilla: 'Tagilla 随从',
};

function parseTimestamp(line, fallback) {
  const m = String(line || '').match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  const value = m ? new Date(m[1].replace(' ', 'T')).getTime() : Number(fallback);
  return Number.isFinite(value) ? value : null;
}

function parsePosition(text) {
  const m = String(text || '').match(/\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*\)/i);
  if (!m) return null;
  const [x, y, z] = m.slice(1).map(Number);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null;
}

function parseBossLogLine(line, meta = {}) {
  if (typeof line !== 'string' || !line) return null;
  const time = parseTimestamp(line, meta.timestamp);
  if (time == null) return null;
  const base = { time, file: String(meta.file || ''), lineNumber: Number(meta.lineNumber) || 0 };
  let m;

  if ((m = line.match(/\|application\|Session mode:\s*(Pve|Pvp)\b/i))) {
    return { ...base, kind: 'mode', mode: m[1].toLowerCase() };
  }
  if (/\|application\|Matching with group id:/i.test(line)) {
    return { ...base, kind: 'online-match' };
  }
  if (/\|application\|MatchingCompleted:/i.test(line)) return { ...base, kind: 'match-boundary' };
  if (/\|application\|GameStarted:/i.test(line)) return { ...base, kind: 'raid-start' };
  if (/\|backend\|.*---> Request.*client\/match\/local\/start\b/i.test(line)) return { ...base, kind: 'local-start' };
  if (/\|backend\|.*---> Request.*client\/match\/local\/end\b/i.test(line)) return { ...base, kind: 'raid-end' };
  if (line.includes('|application|') && (m = line.match(/RaidId:([^,]+),.*Locations:([^\r\n]*)/i))) {
    const location = m[2].split('->')[0].trim().replace(/,$/, '');
    return { ...base, kind: 'raid-map', raidId: m[1].trim(), mapKey: canonicalMapKey(location) };
  }
  if (line.includes('|application|') && (m = line.match(/scene preset path:maps\/([^/\\.]+)(?:\.bundle)?/i))) {
    return { ...base, kind: 'scene-map', mapKey: canonicalMapKey(m[1]) };
  }

  if (line.includes('|aiData|')) {
    if ((m = line.match(/Init Boss wave:(\w+) ShallSpawn:(True|False)\b(?: BossChance:(\d+))?/i))) {
      return { ...base, kind: 'plan', role: m[1], planned: m[2].toLowerCase() === 'true', chance: m[3] == null ? null : Number(m[3]) };
    }
    if (line.includes('Bot activate') && (m = line.match(/\brole:(\w+)\b/))) {
      const posMatch = line.match(/\bpos:(\([^)]*\))/);
      const profile = line.match(/\bprofileId:(\w+)/);
      const bot = line.match(/\bid:(\w+)/);
      return { ...base, kind: 'activate', role: m[1], position: parsePosition(posMatch && posMatch[1]), profileId: profile ? profile[1] : '', botId: bot ? bot[1] : '' };
    }
    if ((m = line.match(/\bbot dispose:(\d+)\b/i))) return { ...base, kind: 'dispose', botId: m[1] };
    if (/\bBotDied pos:\([^)]+\)/i.test(line)) return { ...base, kind: 'died' };
    if (line.includes('Group set boss.') && (m = line.match(/\bgroupName:(\S+)\s+\[Boss\]\s+botBoss\.Id:(\d+)\s+bossType:(\w+)\b/))) {
      return { ...base, kind: 'zone', zone: m[1], botId: m[2], role: m[3] };
    }
    if (line.includes('Add enemy') && (m = line.match(/groupId:(Zone\w+)\s+\[Boss\]\s+_defWildSpawnType:(\w+)\s+cause:initial\s/i))) {
      return { ...base, kind: 'zone', zone: m[1], botId: '', role: m[2] };
    }
  }

  if (line.includes('Audio.Vehicles.BTR.BtrSoundController:OnReadyToDeparture(BtrReadyToDepartureEvent)')) {
    return { ...base, kind: 'btr-ready' };
  }
  if (line.includes('Service PlayerTaxi has already been purchased!')) return { ...base, kind: 'btr-taxi' };
  return null;
}

function roleKind(role) {
  const value = String(role || '');
  if (/^pmc(?:bear|usec)$/i.test(value)) return 'pmc';
  if (/^shooterBTR$/i.test(value)) return 'btr';
  if (/^follower(?:BigPipe|BirdEye)$/i.test(value)) return 'boss';
  if (/^follower/i.test(value)) return 'follower';
  if (/^boss/i.test(value) || /^sectantPriest$/i.test(value)) return 'boss';
  return null;
}

function canonicalMapKey(value) {
  const key = String(value || '').replace(/\.bundle$/i, '').toLowerCase();
  return MAP_ALIASES.get(key) || null;
}

function classifyMode(events) {
  const ordered = events.slice().sort((a, b) => a.time - b.time || eventPriority(a) - eventPriority(b));
  const modes = ordered.filter((e) => e.kind === 'mode');
  const latestMode = modes[modes.length - 1];
  if (!latestMode) return { mode: 'recognizing', reason: '等待战局模式日志' };
  if (modes.some((e) => e.time === latestMode.time && e.mode !== latestMode.mode)) {
    return { mode: 'recognizing', reason: '战局模式日志信号冲突' };
  }
  if (latestMode.mode === 'pvp') return { mode: 'online-pvp', reason: '已识别为 PvP；首领监控已停用' };

  const starts = ordered.filter((e) => e.kind === 'raid-start');
  const raidStart = starts.at(-1);
  const boundary = ordered.filter((e) => e.kind === 'match-boundary').at(-1);
  const end = ordered.filter((e) => e.kind === 'raid-end').at(-1);
  const maps = ordered.filter((e) => e.kind === 'raid-map');
  const map = maps.at(-1);
  const floor = Math.max(latestMode.time, boundary?.time ?? -Infinity, end?.time ?? -Infinity);
  // Evidence from a completed raid must never authorize the following raid.
  const online = ordered.filter((e) => e.kind === 'online-match' && e.time >= latestMode.time
    && (!end || e.time > end.time)).at(-1);
  const local = ordered.filter((e) => e.kind === 'local-start' && e.time >= floor
    && (!end || e.time > end.time)).at(-1);
  const latestMapChangedRaid = map && maps.some((e) => e.raidId !== map.raidId);
  if (online && local && online.time === local.time) {
    return { mode: 'recognizing', reason: '在线与本地战局信号冲突' };
  }
  const validLocal = local && raidStart && map?.mapKey && local.time <= raidStart.time
    && raidStart.time - local.time <= 120000 && latestMode.time <= raidStart.time
    && (!boundary || raidStart.time >= boundary.time) && (!end || raidStart.time > end.time)
    && (!latestMapChangedRaid || (raidStart.time >= map.time && local.time >= map.time - 30000));
  if (online && validLocal) {
    if (online.time > local.time || !boundary || boundary.time <= online.time) {
      return { mode: 'online-pve', reason: '已识别为在线 PvE；首领监控已停用' };
    }
  }
  if (online) {
    if (!validLocal || local.time <= online.time) {
      return { mode: 'online-pve', reason: '已识别为在线 PvE；首领监控已停用' };
    }
    if (!boundary || boundary.time <= online.time) {
      return { mode: 'recognizing', reason: '在线与本地战局信号冲突' };
    }
  }
  if (validLocal) {
    return { mode: 'local-pve', reason: '已确认本地 PvE 战局',
      raidToken: `${boundary?.time || ''}|${map.raidId}|${raidStart.time}|${local.time}` };
  }
  return { mode: 'recognizing', reason: 'PvE 已识别，等待可确认本地开局的日志' };
}

function eventPriority(event) {
  if (event.kind === 'online-match' || event.kind === 'local-start' || event.kind === 'match-boundary') return 0;
  if (event.kind === 'raid-map' || event.kind === 'scene-map') return 1;
  if (event.kind === 'raid-start') return 2;
  return 3;
}

function btrEstimate(raid, now, mapKey) {
  if (!raid.btr) return '等待 BTR 出现记录';
  if (raid.ended) return '战局已结束';
  if (String(mapKey || '').toLowerCase() !== 'woods') return '已记录 BTR；路线推算仅支持森林';
  const signals = raid.btrReadyAt.filter((t) => t >= raid.btr.time).sort((a, b) => a - b);
  if (!signals.length) {
    const elapsed = Math.max(0, (now - raid.btr.time) / 1000);
    const checkpoint = ['ZoneHouse', 'ZoneMiniHouse', 'ZoneRoad'].includes(raid.btr.zone);
    const stop = checkpoint ? '检查站' : '首个站点';
    return elapsed < 260 ? `正驶向${stop}（推测）` : `停靠在${stop}（推测）`;
  }
  const last = signals[signals.length - 1];
  if (raid.btrTaxiAt.some((t) => Math.abs(t - last) <= 15000)) return '按乘客指定路线行驶；目的地无法确认（推测暂停）';
  const route2 = signals.length >= 3 && signals[2] - signals[1] < 210000;
  const elapsed = Math.max(0, (now - last) / 1000);
  const leg = (from, to, seconds) => {
    const phase = elapsed < 8 ? `${from} 准备发车` : elapsed < 8 + seconds ? `${from} → ${to} 行驶中` : `停靠在${to}`;
    return `${phase}（推测）`;
  };
  if (route2) {
    const stops = ['检查站', '锯木厂', '路口', '旧锯木厂', '火车车库', 'EMERCOM 基地'];
    const travel = [40, 30, 90, 55, 110, 90];
    const index = (signals.length - 1) % stops.length;
    return leg(stops[index], stops[(index + 1) % stops.length], travel[index]);
  }
  if (signals.length === 1) return leg('检查站', '锯木厂', 40);
  if (signals.length === 2) return '已从锯木厂发车；路口或 Scav 地堡方向不确定（推测）';
  if (signals.length === 3) return leg('Scav 地堡', '沉没村庄', 65);
  if (signals.length === 4) return '已从沉没村庄发车；旧锯木厂或火车车库方向不确定（推测）';
  return `森林北部环线行驶中 · ${signals.length} 次发车信号（推测）`;
}

function selectCurrentRaidEvents(events) {
  const ordered = events.slice().sort((a, b) => a.time - b.time || eventPriority(a) - eventPriority(b)
    || String(a.file).localeCompare(String(b.file)) || (a.lineNumber || 0) - (b.lineNumber || 0));
  let active = [];
  let mapKey = null;
  let raidId = null;
  const reset = () => { active = []; mapKey = null; raidId = null; };
  for (const event of ordered) {
    if (event.kind === 'match-boundary') {
      reset();
      continue;
    }
    if (event.kind === 'raid-map') {
      if (raidId && event.raidId && raidId !== event.raidId) reset();
      raidId = event.raidId || raidId;
      mapKey = event.mapKey || null;
      active.push({ ...event, mapKey });
      continue;
    }
    if (event.kind === 'scene-map') {
      mapKey = event.mapKey || null;
      active.push({ ...event, mapKey });
      continue;
    }
    active.push({ ...event, mapKey });
  }
  const firstMap = active.find((event) => event.mapKey);
  if (firstMap) {
    for (const event of active) {
      if (event.time > firstMap.time) break;
      if (!event.mapKey) event.mapKey = firstMap.mapKey;
    }
  }
  return active;
}

function summarizeRaid(events, now, fallbackMapKey = null) {
  const ordered = selectCurrentRaidEvents(events);
  let raid = { plans: new Map(), entities: [], zones: [], btrReadyAt: [], btrTaxiAt: [], startedAt: null, ended: false, btr: null, mapKey: null };
  const pendingDisposals = new Map();
  const activeProfiles = new Map();
  for (const event of ordered) {
    if (event.kind === 'raid-map' || event.kind === 'scene-map') { raid.mapKey = event.mapKey || raid.mapKey; continue; }
    if (event.kind === 'raid-start') { raid.startedAt = event.time; continue; }
    if (event.kind === 'raid-end') { raid.ended = true; continue; }
    if (raid.ended) continue;
    if (event.kind === 'plan') {
      if (roleKind(event.role) === 'pmc') {
        const current = raid.plans.get(event.role) || { role: event.role, waves: [] };
        current.waves.push({ planned: event.planned, chance: event.chance, at: event.time, mapKey: event.mapKey });
        raid.plans.set(event.role, current);
      } else if (roleKind(event.role) === 'boss') {
        const roles = /^bossKnight$/i.test(event.role) ? [event.role, 'followerBigPipe', 'followerBirdEye'] : [event.role];
        for (const role of roles) {
          const current = raid.plans.get(role) || { role, waves: [] };
          current.waves.push({ planned: event.planned, chance: event.chance, at: event.time, mapKey: event.mapKey });
          raid.plans.set(role, current);
        }
      }
      continue;
    }
    if (event.kind === 'zone') { raid.zones.push(event); continue; }
    if (event.kind === 'activate') {
      const kind = roleKind(event.role);
      if (event.botId) activeProfiles.set(event.botId, event.profileId || `${event.time}`);
      if (!kind) continue;
      const profileKey = event.profileId || `${event.time}`;
      if (raid.entities.some((entity) => entity.role.toLowerCase() === event.role.toLowerCase()
        && (entity.profileId || `${entity.time}`) === profileKey)) continue;
      const zone = raid.zones.filter((z) => z.role.toLowerCase() === event.role.toLowerCase()
        && (!z.botId || z.botId === event.botId) && Math.abs(z.time - event.time) <= 2000).sort((a, b) => b.time - a.time)[0];
      const entity = {
        kind, role: event.role, name: ROLE_NAMES[event.role] || event.role,
        position: event.position, botId: event.botId, profileId: event.profileId,
        time: event.time, zone: zone ? zone.zone : '', mapKey: event.mapKey, life: 'alive-estimated',
      };
      raid.entities.push(entity);
      if (kind === 'btr' && !raid.btr) raid.btr = entity;
      continue;
    }
    if (event.kind === 'dispose') {
      if (event.file) pendingDisposals.set(event.file, event);
      continue;
    }
    if (event.kind === 'died') {
      const disposal = pendingDisposals.get(event.file);
      if (disposal && event.time >= disposal.time && event.time - disposal.time <= 1000
        && event.lineNumber > disposal.lineNumber && event.lineNumber - disposal.lineNumber <= 64) {
        const activeProfile = activeProfiles.get(disposal.botId);
        const matches = raid.entities.slice().reverse().filter((e) => e.botId === disposal.botId
          && e.time <= disposal.time && e.life === 'alive-estimated'
          && activeProfile && (e.profileId || `${e.time}`) === activeProfile);
        const entity = matches.length === 1 ? matches[0] : null;
        if (entity) { entity.life = 'dead-confirmed'; entity.diedAt = event.time; }
        if (entity) activeProfiles.delete(disposal.botId);
      }
      pendingDisposals.delete(event.file);
      continue;
    }
    if (event.kind === 'btr-ready' && !raid.btrReadyAt.includes(event.time)) raid.btrReadyAt.push(event.time);
    if (event.kind === 'btr-taxi' && !raid.btrTaxiAt.includes(event.time)) raid.btrTaxiAt.push(event.time);
  }
  if (raid.ended) {
    for (const entity of raid.entities) if (entity.life === 'alive-estimated') entity.life = 'unconfirmed-at-end';
  }
  for (const entity of raid.entities) {
    if (entity.zone) continue;
    const zone = raid.zones.filter((z) => z.role.toLowerCase() === entity.role.toLowerCase()
      && z.botId && z.botId === entity.botId && Math.abs(z.time - entity.time) <= 5000)
      .sort((a, b) => Math.abs(a.time - entity.time) - Math.abs(b.time - entity.time))[0];
    if (zone) entity.zone = zone.zone;
  }
  const rows = new Map();
  for (const [role, plan] of raid.plans) rows.set(role, { ...plan, entity: null });
  for (const entity of raid.entities) {
    const row = rows.get(entity.role) || { role: entity.role, waves: [], entity: null };
    row.entity = entity;
    rows.set(entity.role, row);
  }
  const serializeRows = (kind) => [...rows.values()].filter((r) => roleKind(r.role) === kind).map((r) => {
    const waves = r.waves || [];
    const entities = raid.entities.filter((e) => e.role.toLowerCase() === r.role.toLowerCase());
    const latestWave = waves[waves.length - 1];
    return {
      role: r.role,
      name: ROLE_NAMES[r.role] || r.role,
      status: entities.length ? 'spawned' : latestWave ? (latestWave.planned ? 'planned' : 'not-planned') : 'unknown',
      chance: latestWave ? latestWave.chance : null,
      plannedWaves: waves.filter((w) => w.planned).length,
      notPlannedWaves: waves.filter((w) => !w.planned).length,
      waves,
      entities,
    };
  });
  const pmcs = serializeRows('pmc').map((r) => ({
    ...r,
    spawned: r.entities.length,
    initialPlanned: r.waves.filter((w) => raid.startedAt == null || w.at < raid.startedAt).filter((w) => w.planned).length,
    initialNotPlanned: r.waves.filter((w) => raid.startedAt == null || w.at < raid.startedAt).filter((w) => !w.planned).length,
    additionalPlanned: r.waves.filter((w) => raid.startedAt != null && w.at >= raid.startedAt && w.planned).length,
    additionalNotPlanned: r.waves.filter((w) => raid.startedAt != null && w.at >= raid.startedAt && !w.planned).length,
  }));
  const bosses = serializeRows('boss');
  const followers = serializeRows('follower');
  return {
    bosses, followers, pmcs,
    markers: raid.entities.filter((e) => e.kind === 'boss' && e.position && e.mapKey).map((e) => ({
      id: `${e.role}:${e.profileId || e.time}`, role: e.role, name: e.name, ...e.position,
      at: e.time, life: e.life, zone: e.zone, mapKey: e.mapKey,
    })),
    btr: raid.btr ? {
      status: 'confirmed', name: 'BTR', at: raid.btr.time, position: raid.btr.position,
      estimate: btrEstimate(raid, now, raid.mapKey || fallbackMapKey), mapKey: raid.btr.mapKey, zone: raid.btr.zone,
      readySignals: raid.btrReadyAt.length,
    } : { status: 'unknown', estimate: '等待 BTR 出现记录', readySignals: raid.btrReadyAt.length },
  };
}

class BossMonitor {
  constructor() {
    this.session = null;
    this.events = [];
    this.keys = new Set();
    this.files = new Set();
    this.overflow = false;
  }

  reset(session = null) {
    this.session = session;
    this.events = [];
    this.keys.clear();
    this.files.clear();
    this.overflow = false;
  }

  setSession(session) {
    if (session && session !== this.session) this.reset(session);
  }

  feed(line, meta = {}) {
    if (meta.sessionId || meta.session) this.setSession(meta.sessionId || meta.session);
    if (meta.file) this.files.add(meta.file);
    const event = parseBossLogLine(line, meta);
    if (!event) return false;
    this.lastFedKind = event.kind;
    const key = event.lineNumber
      ? `${event.file}|${event.lineNumber}`
      : `${event.time}|${event.kind}|${JSON.stringify(event)}`;
    if (this.keys.has(key)) return false;
    if (this.overflow) return false;
    this.keys.add(key);
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.overflow = true;
    }
    return true;
  }

  snapshot({ now = Date.now(), mapKey = null } = {}) {
    const canonical = [...this.files].some((f) => /(?:^|[\\/ ])aiData_\d+\.log$/i.test(f))
      && [...this.files].some((f) => /(?:^|[\\/ ])application_\d+\.log$/i.test(f));
    const events = canonical ? this.events.filter((e) => !/output(?:_log)?(?:_\d+)?\.log$/i.test(e.file)
      || ['btr-ready', 'btr-taxi'].includes(e.kind)) : this.events;
    const classified = classifyMode(events);
    if (this.overflow) {
      return {
        mode: 'recognizing', reason: '日志量超出安全处理上限，等待新游戏会话重新识别', session: this.session,
        markers: [], bosses: [], followers: [], pmcs: [], btr: null,
        updatedAt: this.events.reduce((latest, event) => Math.max(latest, event.time), 0) || null,
      };
    }
    if (classified.mode !== 'local-pve') {
      return {
        mode: classified.mode,
        reason: classified.reason,
        session: this.session,
        markers: [], bosses: [], followers: [], pmcs: [],
        btr: null,
        updatedAt: this.events.reduce((latest, event) => Math.max(latest, event.time), 0) || null,
      };
    }
    return {
      ...classified,
      ...summarizeRaid(events, now, null),
      session: this.session,
      updatedAt: this.events.reduce((latest, event) => Math.max(latest, event.time), 0) || null,
    };
  }
}

module.exports = { BossMonitor, parseBossLogLine, parsePosition, classifyMode, summarizeRaid, btrEstimate, ROLE_NAMES };
