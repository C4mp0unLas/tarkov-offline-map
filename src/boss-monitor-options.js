'use strict';
const { ROLE_NAMES, canonicalRole, followerParent, roleKind } = require('./boss-monitor');
const DEFAULT_BOSSES = {
  interchange: ['bossKilla', 'bossTagilla'],
  customs: ['bossBully', 'bossPartisan', 'bossKnight', 'followerBigPipe', 'followerBirdEye', 'sectantPriest'],
  woods: ['bossKojaniy', 'bossPartisan', 'bossKnight', 'followerBigPipe', 'followerBirdEye', 'sectantPriest'],
  shoreline: ['bossSanitar', 'bossPartisan', 'bossKnight', 'followerBigPipe', 'followerBirdEye', 'sectantPriest'],
  reserve: ['bossGluhar'], lighthouse: ['bossZryachiy', 'bossPartisan', 'bossKnight', 'followerBigPipe', 'followerBirdEye'],
  'ground-zero': [], factory: ['bossTagilla', 'sectantPriest'], 'the-lab': ['bossScourgeEventLab'],
};
function normalizeFilters(value) {
  const out = {};
  for (const [key, filter] of Object.entries(value || {})) {
    if (!/^[a-z0-9-]+$/.test(key) || !filter || typeof filter !== 'object') continue;
    out[key] = { mode: ['all', 'selected', 'off'].includes(filter.mode) ? filter.mode : 'all',
      roles: [...new Set((Array.isArray(filter.roles) ? filter.roles : []).filter(r => typeof r === 'string' && /^\w{1,80}$/.test(r)).map(canonicalRole))] };
  }
  return out;
}
function filterSnapshot(snapshot, filters = {}) {
  if (snapshot.mode !== 'local-pve') return snapshot;
  const out = { ...snapshot };
  const permitted = (role, map) => {
    const filter = filters[map];
    if (!filter || filter.mode === 'all') return true;
    if (filter.mode === 'off') return false;
    const parent = followerParent(role);
    return filter.roles.some(r => canonicalRole(r) === role || (parent && canonicalRole(r) === parent));
  };
  for (const key of ['bosses', 'followers']) {
    out[key] = (snapshot[key] || []).filter(row => permitted(row.role, snapshot.mapKey));
  }
  out.markers = (snapshot.markers || []).filter(marker => permitted(marker.role, marker.mapKey));
  const filter = filters[snapshot.mapKey];
  out.filterMode = filter?.mode || 'all';
  if (filter?.mode === 'selected') {
    for (const role of filter.roles.filter(r => roleKind(r) === 'boss')) {
      if (!out.bosses.some(row => row.role === role)) out.bosses.push({ role, name: ROLE_NAMES[role] || role, status: 'unknown', chance: null, waves: [], entities: [] });
    }
  }
  return out;
}
class BossNotifications {
  constructor() { this.seen = new Set(); this.token = null; this.hiddenAt = Infinity; }
  setHidden(hidden, now = Date.now()) { this.hiddenAt = hidden ? now : Infinity; }
  take(snapshot, enabled, hidden) {
    if (snapshot.mode !== 'local-pve') return [];
    if (snapshot.raidToken !== this.token) { this.seen.clear(); this.token = snapshot.raidToken; }
    const found = [];
    for (const row of snapshot.bosses || []) {
      const first = row.entities?.[0];
      if (!first || this.seen.has(row.role)) continue;
      this.seen.add(row.role);
      if (enabled && hidden && !snapshot.ended && first.time >= this.hiddenAt - 2000) found.push(row.name);
    }
    return found;
  }
}
module.exports = { DEFAULT_BOSSES, normalizeFilters, filterSnapshot, BossNotifications };
