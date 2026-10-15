'use strict';

const fs = require('fs');
const path = require('path');

function gameRootCandidates(values) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    let candidate = value.trim().replace(/^"|"$/g, '');
    if (/\.exe$/i.test(candidate)) candidate = path.dirname(candidate);
    for (const root of [candidate, path.join(candidate, 'Escape from Tarkov'), path.join(candidate, 'EFT')]) {
      const key = path.resolve(root).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(root);
    }
  };
  for (const value of values || []) add(value);
  return out;
}

function findGameRoot(values, fsApi = fs) {
  for (const candidate of gameRootCandidates(values)) {
    try {
      if (fsApi.existsSync(path.join(candidate, 'EscapeFromTarkov.exe'))
        && fsApi.existsSync(path.join(candidate, 'Logging.config'))) return path.resolve(candidate);
    } catch {}
  }
  return null;
}

function collectLauncherPathValues(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectLauncherPathValues(item, output);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/(path|dir|folder)/i.test(key) && typeof item === 'string') output.push(item);
      if (item && typeof item === 'object') collectLauncherPathValues(item, output);
    }
  }
  return output;
}

module.exports = { gameRootCandidates, findGameRoot, collectLauncherPathValues };
