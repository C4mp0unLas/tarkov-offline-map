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
const report = createReport('只读首领监控、死亡显示与图标稳定性');
const stamp = '2026-10-15 12:00:';
const line = (body, channel = 'application', at = '00') => `${stamp}${at}.000|1.2.0|Trace|${channel}|${body}\n`;
async function run() {
  const prof = makeProfile('boss-icons-', { miniVisible: true, bossMonitorEnabled: true, miniRadius: 500 });
  let app;
  let expectedInputs;
  let gameRoot;
  let main;
  try {
    gameRoot = prof.path('fake-game');
    fs.mkdirSync(gameRoot);
    fs.writeFileSync(path.join(gameRoot, 'EscapeFromTarkov.exe'), '');
    fs.writeFileSync(path.join(gameRoot, 'Logging.config'), JSON.stringify({ rules: [
      { fileName: 'aiData', minLevel: 'Error' }, { fileName: 'application', minLevel: 'Debug' },
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
    fs.writeFileSync(aiFile, [
      ['bossKilla', 'one', 1], ['pmcBEAR', 'bear1', 2], ['pmcBEAR', 'bear2', 3],
      ['pmcUSEC', 'usec1', 4], ['pmcUSEC', 'usec2', 5],
      ['followerBully', 'guard1', 6], ['followerBully', 'guard2', 7],
    ].map(([role, profile, id]) => line(`Bot activate role:${role} pos:(1,2,3) profileId:${profile} id:${id}`, 'aiData', '05')).join(''));
    // Deliberately insufficient logging levels must never prompt or rewrite the configuration.
    expectedInputs = new Map([gameRoot, dir].flatMap(folder => fs.readdirSync(folder)
      .map(name => { const file = path.join(folder, name); return [file, fs.readFileSync(file)]; })));
    const appendLog = (file, value) => {
      expectedInputs.set(file, Buffer.concat([expectedInputs.get(file), Buffer.from(value)]));
      fs.appendFileSync(file, value);
    };
    const launched = await launchReady({ port: PORT, userData: prof.userData, cwd: ROOT,
      match: t => t.url.endsWith('/map.html'), timeoutMs: 30000 });
    app = launched.app;
    if (launched.degraded) console.log('Electron fallback arguments: ' + JSON.stringify(launched.usedArgs));
    main = launched.target;
    await evaluate(main.webSocketDebuggerUrl, 'window.api.ensureMini()');
    const mini = await waitForTarget(PORT, t => t.url.endsWith('/minimap.html'));
    if (!mini) throw new Error('Minimap did not open');
    const pages = [main, mini];
    for (const page of pages) {
      // Capture real desktop input before map wheel handlers while preserving programmatic CDP/UI checks.
      await evaluate(page.webSocketDebuggerUrl, `(() => { for (const type of ["wheel","pointerdown","mousedown"]) window.addEventListener(type, e => { if (e.isTrusted) { e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false }); })()`);
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
      appendLog(appFile, line('GC iteration ' + i, 'application', '06'));
      appendLog(aiFile, line('AI tick ' + i, 'aiData', '06'));
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
    const rowText = async name => evaluate(main.webSocketDebuggerUrl, `(() => {
      const row = [...document.querySelectorAll('.boss-panel-row')]
        .find(el => el.querySelector('strong').textContent === ${JSON.stringify(name)});
      return row?.querySelector('span').textContent || '';
    })()`);
    const pmcsVisible = await waitFor(async () =>
      (await rowText('AI PMC · BEAR')).includes('死亡已确认 0')
      && (await rowText('AI PMC · USEC')).includes('死亡已确认 0'), 5000);
    report.check('PMC 在未记录死亡时显示存活推测和死亡计数', pmcsVisible);
    const deathLogs = (ids, at) => ids.map(id => line('bot dispose:' + id, 'aiData', at)
      + line('Squad patrol reassigned', 'aiData', at)
      + line('BotDied pos:(4,5,6)', 'aiData', at)).join('');
    appendLog(aiFile, deathLogs([1, 2, 4, 6], '07'));
    for (const name of ['AI PMC · BEAR', 'AI PMC · USEC']) {
      const updated = await waitFor(async () => {
        const text = await rowText(name);
        return text.includes('已记录出现 2') && text.includes('推测存活 1')
          && text.includes('死亡已确认 1') && text.includes('最近死亡 12:00:07');
      }, 5000);
      report.check(name + ' 追加死亡日志后更新人数和死亡时间', updated);
    }
    const bossDead = await waitFor(async () => {
      const text = await rowText('Killa');
      return text.includes('已确认死亡事件') && text.includes('12:00:07');
    }, 5000);
    report.check('首领死亡状态和时间由实际日志管线更新', bossDead);
    const guardDead = await waitFor(async () => {
      const text = await rowText('Reshala 随从');
      return text.includes('推测存活 1') && text.includes('死亡已确认 1')
        && text.includes('已确认死亡事件') && text.includes('12:00:07');
    }, 5000);
    report.check('同类保镖分别保留存活与死亡状态', guardDead);
    for (const [i, page] of pages.entries()) {
      const result = await evaluate(page.webSocketDebuggerUrl, `(() => {
        const old = window.__bossProbe.boss;
        return { retained: old === document.querySelector('.boss-log-marker'),
          dead: old.children[1].getAttribute('stroke') === '#a7b0bd' };
      })()`);
      report.check((i ? '悬浮地图' : '主地图') + '真实死亡日志更新图标且不闪烁', result.retained && result.dead, JSON.stringify(result));
    }
    appendLog(aiFile, deathLogs([3, 7], '08')
      + line('Bot activate role:pmcUSEC pos:(8,2,9) profileId:usec3 id:8', 'aiData', '08'));
    const accumulated = await waitFor(async () => {
      const bear = await rowText('AI PMC · BEAR'), usec = await rowText('AI PMC · USEC');
      const guard = await rowText('Reshala 随从');
      return bear.includes('推测存活 0') && bear.includes('死亡已确认 2') && bear.includes('最近死亡 12:00:08')
        && usec.includes('已记录出现 3') && usec.includes('推测存活 2') && usec.includes('死亡已确认 1')
        && guard.includes('推测存活 0') && guard.includes('死亡已确认 2');
    }, 5000);
    report.check('后续死亡与追加刷新分别累计，保留此前死亡记录', accumulated);
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
    appendLog(aiFile, [
      ['bossScourgeEventLab', 'scourge', 20], ['followerScourgeEventLab', 'scourgeguard', 21],
      ['exUsecFree', 'rogue', 22], ['pmcBot', 'raider', 23],
    ].map(([role, profile, id]) => line('Bot activate role:' + role + ' pos:(2,3,4) profileId:' + profile + ' id:' + id, 'aiData', '09')).join(''));
    report.check('1.0.16 新角色在实际日志管线中显示原名与计数', await waitFor(async () =>
      (await rowText('Scourge')).includes('推测存活 1') && (await rowText('Scourge 随从')).includes('推测存活 1')
      && (await rowText('Rogue · 游荡者')).includes('实际激活 1') && (await rowText('Raider · 掠夺者')).includes('实际激活 1'), 5000));
    appendLog(aiFile, deathLogs([20, 21, 22, 23], '10'));
    report.check('Scourge 及随从、Rogue 和 Raider 均更新确认死亡', await waitFor(async () =>
      (await rowText('Scourge')).includes('死亡已确认 1') && (await rowText('Scourge 随从')).includes('死亡已确认 1')
      && (await rowText('Rogue · 游荡者')).includes('死亡已确认 1') && (await rowText('Raider · 掠夺者')).includes('死亡已确认 1'), 5000));
    await evaluate(main.webSocketDebuggerUrl, 'window.api.setConfig({ bossMapFilters: { woods: { mode: "selected", roles: ["bossScourgeEventLab"] } } })');
    report.check('按地图筛选同时更新面板与悬浮图标', await waitFor(async () => {
      const state = await evaluate(main.webSocketDebuggerUrl, 'window.api.getState()');
      return state.bossMonitor.bosses.length === 1 && state.bossMonitor.bosses[0].name === 'Scourge'
        && state.bossMonitor.markers.length === 1 && state.bossMonitor.specialAis.length === 2;
    }, 5000));
    await evaluate(main.webSocketDebuggerUrl, 'window.api.setConfig({ bossMapFilters: { woods: { mode: "all", roles: [] } } })');
    await evaluate(main.webSocketDebuggerUrl, 'document.getElementById("btn-settings").click()');
    report.check('设置页实际打开并提供 Scourge 筛选选项', await waitFor(() => evaluate(main.webSocketDebuggerUrl,
      'document.getElementById("boss-filter-map").options.length > 0 && document.getElementById("boss-filter-roles").textContent.includes("Scourge")'), 5000));
    report.check('客户端不再暴露配置写入 API 或配置状态', await evaluate(main.webSocketDebuggerUrl,
      '(async () => !("applyBossLogging" in window.api) && !("bossLogging" in await window.api.getState()))()'));
    await evaluate(main.webSocketDebuggerUrl, 'document.getElementById("settings-close").click()');
    report.check('设置页保留地图筛选并说明只读日志，没有应用配置按钮', await evaluate(main.webSocketDebuggerUrl,
      '!document.getElementById("set-boss-apply") && !!document.getElementById("boss-filter-mode") && document.body.textContent.includes("只读取现有日志")'));
    appendLog(appFile, line('Matching with group id: 19', 'application', '11'));
    for (const [i, page] of pages.entries()) {
      const hidden = await waitFor(() => evaluate(page.webSocketDebuggerUrl, `(() => {
        const panel = document.getElementById('boss-panel') || document.getElementById('mini-boss-status');
        return !document.querySelector('.boss-log-marker') && panel.classList.contains('hidden');
      })()`), 5000);
      report.check((i ? '悬浮地图' : '主地图') + '在线 PvE 隐藏监控', hidden);
    }
    appendLog(appFile, line('Session mode: Pvp', 'application', '12'));
    for (const [i, page] of pages.entries()) {
      const hidden = await waitFor(() => evaluate(page.webSocketDebuggerUrl, `(async () => {
        const panel = document.getElementById('boss-panel') || document.getElementById('mini-boss-status');
        return (await window.api.getState()).bossMonitor.mode === 'online-pvp'
          && !document.querySelector('.boss-log-marker') && panel.classList.contains('hidden');
      })()`), 5000);
      report.check((i ? '悬浮地图' : '主地图') + '在线 PvP 隐藏监控', hidden);
    }
  } finally {
    if (app) {
      let exited = false;
      try {
        if (main && app.alive) {
          await evaluate(main.webSocketDebuggerUrl, 'setTimeout(() => window.close(), 100); true');
          exited = await waitFor(async () => !app.alive, 30000);
        }
      } finally {
        report.check('客户端正常关闭，无残留配置定时器异常', exited && !/ReferenceError|Uncaught Exception/i.test(app.tail(100)));
        if (app.alive) { app.kill(); await sleep(500); }
      }
    }
    if (expectedInputs) {
      report.check('监控、设置与退出均不改写游戏配置或输入日志', [...expectedInputs]
        .every(([file, content]) => fs.existsSync(file) && fs.readFileSync(file).equals(content)));
      report.check('游戏目录没有产生备份、临时配置或其他文件',
        JSON.stringify(fs.readdirSync(gameRoot).sort()) === JSON.stringify(['EscapeFromTarkov.exe', 'Logging.config']));
    }
    prof.cleanup();
  }
}
run().catch(e => { report.check('运行完成', false, e.stack); }).finally(() => report.finish());
