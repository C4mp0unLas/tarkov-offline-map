#!/usr/bin/env node
'use strict';
// Isolated UI regression: synthetic logs only; no changes to the real game's configuration.
const fs = require('fs');
const path = require('path');
const { launchReady } = require('./lib/spawn-electron');
const { cdp, evaluate, waitFor, waitForTarget, sleep } = require('./lib/cdp');
const { makeProfile, createReport } = require('./lib/suite');
const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || 9456);
const report = createReport('首领监控图标稳定性');
const stamp = '2026-10-15 12:00:';
const line = (body, channel = 'application', at = '00') => `${stamp}${at}.000|1.2.0|Trace|${channel}|${body}\n`;
async function run() {
  const prof = makeProfile('boss-icons-', { miniVisible: true, bossMonitorEnabled: true, miniRadius: 500 });
  let app;
  try {
    const gameRoot = prof.path('fake-game');
    fs.mkdirSync(gameRoot);
    fs.writeFileSync(path.join(gameRoot, 'EscapeFromTarkov.exe'), '');
    fs.writeFileSync(path.join(gameRoot, 'Logging.config'), JSON.stringify({ rules: [
      { fileName: 'aiData', minLevel: 'Trace' }, { fileName: 'application', minLevel: 'Debug' },
      { fileName: 'backend', minLevel: 'Information' },
    ] }));
    const configPath = prof.path('settings.json');
    fs.writeFileSync(configPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(configPath)), gamePath: gameRoot }));
    const dir = path.join(prof.logs, 'log_2026.10.15_12-00-00_1.2.0');
    fs.mkdirSync(dir);
    const appFile = path.join(dir, 'test application_000.log');
    const aiFile = path.join(dir, 'test aiData_000.log');
    fs.writeFileSync(appFile, line('Session mode: Pve') + line('MatchingCompleted:', 'application', '01')
      + line('RaidId:one, Count:0, Locations:woods ->', 'application', '03')
      + line('scene preset path:maps/woods_preset.bundle rcid:woods.scenespreset.asset', 'application', '03')
      + line('GameStarted: Woods', 'application', '04'));
    fs.writeFileSync(path.join(dir, 'test backend_000.log'), line('---> Request: client/match/local/start', 'backend', '02'));
    fs.writeFileSync(aiFile, line('Bot activate role:bossKilla pos:(1,2,3) profileId:one id:1', 'aiData', '05'));
    const launched = await launchReady({ port: PORT, userData: prof.userData, cwd: ROOT,
      match: t => t.url.endsWith('/map.html'), timeoutMs: 30000 });
    app = launched.app;
    if (launched.degraded) console.log('Electron fallback arguments: ' + JSON.stringify(launched.usedArgs));
    const main = launched.target;
    await evaluate(main.webSocketDebuggerUrl, 'window.api.ensureMini()');
    const mini = await waitForTarget(PORT, t => t.url.endsWith('/minimap.html'));
    if (!mini) throw new Error('Minimap did not open');
    const pages = [main, mini];
    for (const page of pages) {
      // Desktop input must not pan a test window during the stability sample.
      await cdp(page.webSocketDebuggerUrl, [['Input.setIgnoreInputEvents', { ignore: true }]]);
      await evaluate(page.webSocketDebuggerUrl, 'window.dispatchEvent(new MouseEvent("mouseup"))');
      const ready = await waitFor(() => evaluate(page.webSocketDebuggerUrl,
        '!!document.querySelector(".boss-log-marker") && !!document.querySelector(".map-marker")'), 15000);
      if (!ready) throw new Error('Markers not ready: ' + page.url);
      await evaluate(page.webSocketDebuggerUrl, `(() => {
        window.__bossProbe = { boss: document.querySelector('.boss-log-marker'),
          map: document.querySelector('.map-marker'), removed: 0, states: [], moves: [], renders: [] };
        const v = window.__view;
        v.view = new Proxy(v.view, { set(obj, key, value) {
          if ((key === 'cx' || key === 'cy') && obj[key] !== value && window.__bossProbe.moves.length < 2)
            window.__bossProbe.moves.push({ key, value, stack: new Error().stack });
          obj[key] = value; return true;
        } });
        let cache = v.staticMarkerRender;
        Object.defineProperty(v, 'staticMarkerRender', { configurable: true, get: () => cache, set: next => {
          if (window.__bossProbe.renders.length < 2) window.__bossProbe.renders.push({ before: cache?.key, after: next?.key,
            sameMarkers: next?.markers?.[0] === cache?.markers?.[0], sameNearest: next?.nearestExfil === cache?.nearestExfil, stack: new Error().stack });
          cache = next;
        } });
        window.api.onState(s => window.__bossProbe.states.push(s.bossMonitor?.mode));
        new MutationObserver(ms => {
          for (const m of ms) for (const el of m.removedNodes)
            if (el.nodeType === 1 && el.matches('.boss-log-marker, .map-marker')) window.__bossProbe.removed++;
        }).observe(document.querySelector('.boss-log-layer').parentNode, { childList: true, subtree: true });
        return true;
      })()`);
    }
    report.check('监控图标和面板使用首领原名', await evaluate(main.webSocketDebuggerUrl,
      'document.querySelector(".boss-log-marker text").textContent.includes("Killa") && document.getElementById("boss-panel-body").textContent.includes("Killa")'));
    for (let i = 0; i < 5; i++) {
      fs.appendFileSync(appFile, line('GC iteration ' + i, 'application', '06'));
      fs.appendFileSync(aiFile, line('AI tick ' + i, 'aiData', '06'));
      await sleep(800);
    }
    for (const [i, page] of pages.entries()) {
      const result = await evaluate(page.webSocketDebuggerUrl, `(() => {
        const p = window.__bossProbe;
        return { bossStable: p.boss === document.querySelector('.boss-log-marker'),
          mapStable: p.map === document.querySelector('.map-marker'), removed: p.removed,
          states: p.states, moves: p.moves, renders: p.renders };
      })()`);
      report.check((i ? '悬浮地图' : '主地图') + '持续监控保持图标及模式稳定',
        result.bossStable && result.mapStable && result.removed === 0
          && result.states.length > 0 && result.states.every(s => s === 'local-pve'), JSON.stringify(result));
    }
    // Directly exercise display changes without clearing the existing marker.
    for (const [i, page] of pages.entries()) {
      const result = await evaluate(page.webSocketDebuggerUrl, `(() => {
        const v = window.__view, old = document.querySelector('.boss-log-marker');
        v.setBossMarkers(v.bossMarkers.map(m => ({ ...m, life: 'dead-confirmed' })));
        const recolored = old === document.querySelector('.boss-log-marker') && old.children[1].getAttribute('stroke') === '#a7b0bd';
        const before = old.getAttribute('transform');
        v.setViewport({ ...v.getViewport(), cx: v.view.cx + 10 });
        return { recolored, moved: before !== old.getAttribute('transform'), retained: old === document.querySelector('.boss-log-marker') };
      })()`);
      report.check((i ? '悬浮地图' : '主地图') + '状态和视角更新复用首领图标', result.recolored && result.moved && result.retained, JSON.stringify(result));
    }
    fs.appendFileSync(appFile, line('Matching with group id: 19', 'application', '08'));
    for (const [i, page] of pages.entries()) {
      const hidden = await waitFor(() => evaluate(page.webSocketDebuggerUrl, `(() => {
        const panel = document.getElementById('boss-panel') || document.getElementById('mini-boss-status');
        return !document.querySelector('.boss-log-marker') && panel.classList.contains('hidden');
      })()`), 5000);
      report.check((i ? '悬浮地图' : '主地图') + '在线战局隐藏监控', hidden);
    }
  } finally {
    if (app) { app.kill(); await sleep(500); }
    prof.cleanup();
  }
}
run().catch(e => { report.check('运行完成', false, e.stack); }).finally(() => report.finish());
