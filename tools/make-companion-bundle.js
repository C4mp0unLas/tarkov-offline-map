#!/usr/bin/env node
'use strict';
// Redistribute the pinned installer without running it or touching game files.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const ROOT = path.join(__dirname, '..');
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function validateCachedAsset(file, asset) {
  try { return fs.statSync(file).size === asset.size && await hashFile(file) === asset.sha256; }
  catch { return false; }
}
async function fetchCompanion(file, asset) {
  if (await validateCachedAsset(file, asset)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = file + '.partial';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log('Downloading official ' + asset.fileName + ' (attempt ' + attempt + ')');
      const response = await fetch(asset.download, { headers: { 'User-Agent': 'tarkov-offline-map-bundle' }, signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw new Error('Download HTTP ' + response.status);
      const declared = response.headers.get('content-length');
      if (declared && Number(declared) !== asset.size) throw new Error('Download size differs from pinned release');
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
      if (!await validateCachedAsset(partial, asset)) throw new Error('Companion SHA-256 or size mismatch');
      fs.copyFileSync(partial, file);
      fs.unlinkSync(partial);
      return;
    } catch (error) {
      try { fs.unlinkSync(partial); } catch {}
      if (attempt === 3) throw error;
      console.log('Retry: ' + error.message);
    }
  }
}
async function main() {
  const { version } = require('../package.json');
  const asset = require('../third_party/tarkov-boss/manifest.json');
  const dist = path.join(ROOT, 'dist');
  const original = path.join(dist, '塔科夫地图-' + version + '.exe');
  if (!fs.existsSync(original)) throw new Error('Run npm run dist first');
  const cached = path.join(dist, 'companion-cache', asset.fileName);
  await fetchCompanion(cached, asset);
  console.log('Verified official companion SHA-256: ' + asset.sha256);
  const exeName = 'tarkov-offline-map-' + version + '-win-x64-portable.exe';
  const folder = 'tarkov-offline-map-' + version + '-with-boss-' + asset.version + '-win-x64';
  const stage = path.join(dist, folder);
  fs.mkdirSync(path.join(stage, '配套工具'), { recursive: true });
  fs.copyFileSync(original, path.join(dist, exeName));
  const entries = [
    [original, exeName],
    [path.join(ROOT, 'USAGE.zh-CN.md'), '使用说明.zh-CN.md'],
    [path.join(ROOT, 'LICENSE'), 'LICENSE.txt'],
    [path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'THIRD_PARTY_NOTICES.md'],
    [cached, '配套工具/' + asset.fileName],
    [path.join(ROOT, 'third_party/tarkov-boss/LICENSE'), '配套工具/LICENSE.txt'],
    [path.join(ROOT, 'third_party/tarkov-boss/README.zh-CN.md'), '配套工具/README.zh-CN.md'],
    [path.join(ROOT, 'third_party/tarkov-boss/manifest.json'), '配套工具/SOURCE.json'],
  ];
  const files = [];
  for (const [source, name] of entries) {
    const output = path.join(stage, name);
    fs.copyFileSync(source, output);
    files.push({ name, bytes: fs.statSync(output).size, sha256: await hashFile(output) });
  }
  fs.writeFileSync(path.join(stage, 'SHA256SUMS.txt'), files.map(file => file.sha256 + '  ' + file.name).join('\n') + '\n');
  const zip = path.join(dist, folder + '.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  const sevenZip = require('7zip-bin').path7za;
  execFileSync(sevenZip, ['a', '-tzip', '-mx=0', zip, ...files.map(file => file.name), 'SHA256SUMS.txt'], { cwd: stage, windowsHide: true, stdio: 'inherit' });
  execFileSync(sevenZip, ['t', zip], { windowsHide: true, stdio: 'inherit' });
  let sourceCommit = null, sourceDirty = null;
  try {
    sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
    sourceDirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch {}
  const metadata = { version, sourceCommit, sourceDirty, companion: asset, files, zip: { name: path.basename(zip), bytes: fs.statSync(zip).size, sha256: await hashFile(zip) } };
  fs.writeFileSync(path.join(dist, 'bundle-manifest.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify({ exe: path.join(dist, exeName), zip, sha256: metadata.zip.sha256 }));
}
module.exports = { hashFile, validateCachedAsset };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });

