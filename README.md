# 塔科夫实时地图 (tarkov-offline-map)

[![Build & Release (Windows)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml/badge.svg)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/C4mp0unLas/tarkov-offline-map)](https://github.com/C4mp0unLas/tarkov-offline-map/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

本仓库由 [NepPure/tarkov-offline-map](https://github.com/NepPure/tarkov-offline-map) 派生，整合 Tarkov Boss Monitor 1.0.16 的日志监控功能；原项目与首领监控的许可及署名见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

- 只有日志确认当前战局为本地离线 PvE 后，才会自动启用首领监控；在线 PvP、在线 PvE 或证据不足时隐藏面板和动态标记。
- 在当前地图和悬浮小地图标出日志记录的首领初始位置，实时更新刷新计划与概率、实际刷新、随从、死亡推断、AI PMC 和 BTR 状态。初始位置不是实时移动追踪。
- 首领保留游戏原名，如 Killa、Tagilla、Reshala、Shturman、Glukhar、Knight、Big Pipe、Birdeye；已修复连续监控时图标闪烁。
- 通过读取磁盘日志获取信息，不读取或写入游戏进程内存，不注入 DLL。日志详细程度不足时，按界面提示授权备份、调整并核验 Logging.config；设置长期保留，不再自动恢复；详细原理与验证边界见 [首领监控移植说明](BOSS_MONITOR_IMPLEMENTATION.zh-CN.md)。

直接使用请到 [Releases](https://github.com/C4mp0unLas/tarkov-offline-map/releases/latest) 下载 Windows x64 免安装 EXE。源码运行：安装 Node.js 后执行 npm ci，再运行 npm run runclient（或双击 runclient.cmd）。

2.6.0 支持实验室 Scourge 及随从、Rogue / Raider 激活与死亡统计、按地图筛选和首领刷新通知。首次使用在设置中点击“应用并核验日志设置”；游戏运行时等待退出后应用，重新启动游戏生效。游戏更新或启动器修复可能覆盖日志配置，可在设置中再次应用。
