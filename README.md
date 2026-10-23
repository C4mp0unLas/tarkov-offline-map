# 塔科夫实时地图 (tarkov-offline-map)

[![Build & Release (Windows)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml/badge.svg)](https://github.com/C4mp0unLas/tarkov-offline-map/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/C4mp0unLas/tarkov-offline-map)](https://github.com/C4mp0unLas/tarkov-offline-map/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

本仓库由 [NepPure/tarkov-offline-map](https://github.com/NepPure/tarkov-offline-map) 派生，整合 Tarkov Boss Monitor 1.0.16 的日志监控功能；原项目与首领监控的许可及署名见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

- 只有日志确认当前战局为本地离线 PvE 后，才会自动启用首领监控；在线 PvP、在线 PvE 或证据不足时隐藏面板和动态标记。
- 在当前地图和悬浮小地图标出日志记录的首领初始位置，实时更新刷新计划与概率、实际刷新、随从、死亡推断、AI PMC 和 BTR 状态。初始位置不是实时移动追踪。
- 首领保留游戏原名，如 Killa、Tagilla、Reshala、Shturman、Glukhar、Knight、Big Pipe、Birdeye；已修复连续监控时图标闪烁。
- 通过读取磁盘日志获取信息，不读取或写入游戏进程内存，不注入 DLL。小地图不修改游戏配置，不提供日志级别写入、备份或恢复功能；详细原理与验证边界见 [首领监控移植说明](BOSS_MONITOR_IMPLEMENTATION.zh-CN.md)。

首次使用请到 [Releases](https://github.com/C4mp0unLas/tarkov-offline-map/releases/latest) 下载文件名带 with-boss-1.0.16 的 Windows x64 整合 ZIP：包含免安装小地图 EXE、官方 Tarkov Boss Monitor 1.0.16 安装程序及许可证。已配置好日志时可只下载小地图 EXE。详细安装顺序、日志目录选择和完整性校验提示见 [搭配使用说明](USAGE.zh-CN.md)。源码运行：安装 Node.js 后执行 npm ci，再运行 npm run runclient（或双击 runclient.cmd）。

2.6.0 支持实验室 Scourge 及随从、Rogue / Raider 激活与死亡统计、按地图筛选和首领刷新通知。小地图仅解析现有日志，日志详细程度由用户通过配套 [Tarkov Boss Monitor 1.0.16](https://github.com/seongjin-lab/tarkov-boss) 管理；配套工具会修改游戏配置，并带有上游日志清理和卸载恢复功能。整合包仅将两个程序放在一起，不自动安装或启动配套工具。日志未包含刷新、初始坐标或死亡记录时，相应信息无法显示或确认；游戏目录中无需存在 Logging.config 也能选择目录。
