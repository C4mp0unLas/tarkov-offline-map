# 塔科夫实时地图 (tarkov-offline-map)

[![Build & Release (Windows)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml/badge.svg)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/C4mp0unLas/tarkov-offline-map)](https://github.com/C4mp0unLas/tarkov-offline-map/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

本仓库由 [NepPure/tarkov-offline-map](https://github.com/NepPure/tarkov-offline-map) 派生，整合 Tarkov Boss Monitor 的日志监控功能；原项目与首领监控的许可及署名见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

- 只有日志确认当前战局为本地离线 PvE 后，才会自动启用首领监控；在线 PvP、在线 PvE 或证据不足时隐藏面板和动态标记。
- 在当前地图和悬浮小地图标出日志记录的首领初始位置，实时更新刷新计划与概率、实际刷新、随从、死亡推断、AI PMC 和 BTR 状态。初始位置不是实时移动追踪。
- 首领保留游戏原名，如 Killa、Tagilla、Reshala、Shturman、Glukhar、Knight、Big Pipe、Birdeye；已修复连续监控时图标闪烁。
- 通过读取磁盘日志获取信息，不读取或写入游戏进程内存，不注入 DLL。日志详细程度不足时，按界面提示授权备份、调整并恢复 Logging.config；详细原理与验证边界见 [首领监控移植说明](BOSS_MONITOR_IMPLEMENTATION.zh-CN.md)。

本派生版当前提供源码。安装 Node.js 后在项目目录执行 npm ci，再运行 npm run runclient（或双击 runclient.cmd）开始使用。后续发布的安装包见本仓库 Releases；上游旧版安装包不包含本次整合。
