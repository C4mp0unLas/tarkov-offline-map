'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const DESIRED_LEVELS = { aiData: 'Trace', application: 'Debug', backend: 'Information' };
const LEVELS = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical'];
function planLoggingConfig(raw) {
  const bom = raw.charCodeAt(0) === 0xFEFF;
  const config = JSON.parse(bom ? raw.slice(1) : raw);
  if (!config || !Array.isArray(config.rules)) throw new Error('Logging.config 缺少 rules 数组');
  let changed = false;
  for (const [name, desired] of Object.entries(DESIRED_LEVELS)) {
    const matches = config.rules.filter(rule => rule && rule.fileName === name);
    if (matches.length !== 1) throw new Error(`Logging.config 中 ${name} 规则数量不是 1`);
    if (!LEVELS.includes(matches[0].minLevel)) throw new Error(`Logging.config 中 ${name} 日志级别无效`);
    if (LEVELS.indexOf(matches[0].minLevel) > LEVELS.indexOf(desired)) { matches[0].minLevel = desired; changed = true; }
  }
  return { changed, output: changed ? `${bom ? '\uFEFF' : ''}${JSON.stringify(config, null, 2)}\n` : raw };
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex').toUpperCase(); }
function loggingPaths(userData, gameRoot = '') {
  const id = sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16);
  const secureRoot = path.join(process.env.ProgramData || path.join(path.parse(userData).root, 'ProgramData'), 'TarkovOfflineMapBoss');
  const base = path.join(secureRoot, `boss-logging-${id}`);
  return { secureRoot, backup: base + '.backup', status: base + '.persistent-status.json' };
}
function buildElevatedScripts(gameRoot, userData, requestId = crypto.randomUUID()) {
  const payload = Buffer.from(JSON.stringify({ gameRoot, files: loggingPaths(userData, gameRoot), requestId })).toString('base64');
  const child = String.raw`
$ErrorActionPreference = 'Stop'
$ctx = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
$utf8 = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath([string]$ctx.gameRoot).TrimEnd('\')
$config = Join-Path $root 'Logging.config'
$secureRoot = [string]$ctx.files.secureRoot
function Reject-Links([string]$value) {
  $current = [IO.Path]::GetFullPath($value)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if (((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '目标路径包含链接或重解析点' }
    }
    $parent = [IO.Directory]::GetParent($current)
    if (-not $parent) { break }; $current = $parent.FullName
  }
}
function Write-State([string]$state, [string]$message = '') {
  $value = @{ requestId = [string]$ctx.requestId; state = $state; message = $message; gameRoot = $root } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText([string]$ctx.files.status, $value, $utf8)
}
function Game-Running { return @(Get-Process -Name 'EscapeFromTarkov' -ErrorAction SilentlyContinue).Count -gt 0 }
function Plan-Config([string]$raw) {
  $settings = $raw | ConvertFrom-Json
  if (-not ($settings.rules -is [array])) { throw 'Logging.config 缺少 rules 数组' }
  $levels = @('Trace','Debug','Information','Warning','Error','Critical')
  $desired = @{ aiData = 'Trace'; application = 'Debug'; backend = 'Information' }
  $changed = $false
  foreach ($name in @('aiData','application','backend')) {
    $matches = @($settings.rules | Where-Object { $_.fileName -ceq $name })
    if ($matches.Count -ne 1) { throw ('日志规则缺失或重复: ' + $name) }
    $index = [Array]::IndexOf($levels, [string]$matches[0].minLevel)
    if ($index -lt 0) { throw ('日志级别无效: ' + $name) }
    if ($index -gt [Array]::IndexOf($levels, $desired[$name])) { $matches[0].minLevel = $desired[$name]; $changed = $true }
  }
  return @{ Changed = $changed; Settings = $settings }
}
try {
  Reject-Links $root; Reject-Links $config; Reject-Links $secureRoot
  if ($root.StartsWith('\\') -or -not (Test-Path -LiteralPath (Join-Path $root 'EscapeFromTarkov.exe') -PathType Leaf)) { throw '游戏目录无效' }
  [IO.Directory]::CreateDirectory($secureRoot) | Out-Null
  $admins = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
  $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
  $users = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
  $acl = [Security.AccessControl.DirectorySecurity]::new()
  $acl.SetAccessRuleProtection($true, $false); $acl.SetOwner($admins)
  foreach ($sid in @($admins, $system)) { $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')) }
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($users,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'))
  Set-Acl -LiteralPath $secureRoot -AclObject $acl
  $mutex = [Threading.Mutex]::new($false, 'Global\TarkovOfflineMapPersistentLogging')
  $held = $false
  try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true }
  if (-not $held) { throw '另一项日志配置操作正在进行，请稍后重试' }
  while (Game-Running) { Write-State 'waiting-game-exit' '游戏退出后应用；当前尚未写入'; Start-Sleep -Seconds 3 }
  Reject-Links $config
  $before = [IO.File]::ReadAllBytes($config)
  $beforeHash = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash
  $plan = Plan-Config ([IO.File]::ReadAllText($config))
  if ($plan.Changed) {
    $backup = [string]$ctx.files.backup + '.' + $beforeHash + '.bak'
    Reject-Links $backup
    if (-not (Test-Path -LiteralPath $backup)) { [IO.File]::WriteAllBytes($backup, $before) }
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $beforeHash) { throw '配置备份校验失败' }
    $temp = $config + '.boss-' + [string]$ctx.requestId + '.tmp'
    $rollback = $config + '.boss-' + [string]$ctx.requestId + '.bak'
    Reject-Links $temp; Reject-Links $rollback
    [IO.File]::WriteAllText($temp, (($plan.Settings | ConvertTo-Json -Depth 100) + [Environment]::NewLine), $utf8)
    if (Game-Running) { throw '游戏已启动，尚未写入配置；退出后请重试' }
    if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $beforeHash) { throw '配置被其他程序修改，请重试' }
    $expected = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
    # Windows PowerShell 5.1 converts null string arguments to an empty path.
    # Supply a real rollback path rather than File.Replace(..., $null).
    [IO.File]::Replace($temp, $config, $rollback)
    if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $expected) { throw '写入后的配置哈希不匹配' }
  }
  if ((Plan-Config ([IO.File]::ReadAllText($config))).Changed) { throw '写入后的日志级别不符合要求' }
  Write-State 'configured' '已重新读取并核验 aiData / application / backend；设置长期保留'
} catch {
  try { Write-State 'error' $_.Exception.Message } catch {}
  exit 1
} finally {
  if ($held) { $mutex.ReleaseMutex() }; if ($mutex) { $mutex.Dispose() }
  if ($temp -and (Test-Path -LiteralPath $temp)) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
}
`;
  const childEncoded = Buffer.from(child.replace('__PAYLOAD__', payload), 'utf16le').toString('base64');
  if (childEncoded.length > 30000) throw new Error('日志配置脚本超过 Windows 长度限制');
  const parent = "try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$env:TARKOV_BOSS_MONITOR_CHILD) -ErrorAction Stop | Out-Null; exit 0 } catch { Write-Error $_.Exception.Message; exit 1 }";
  return { parent: Buffer.from(parent, 'utf16le').toString('base64'), child: childEncoded, requestId };
}
function readStatus(userData, gameRoot) {
  try { return JSON.parse(fs.readFileSync(loggingPaths(userData, gameRoot).status, 'utf8')); } catch { return null; }
}
async function runElevated(gameRoot, userData, { onStatus = () => {} } = {}) {
  const scripts = buildElevatedScripts(gameRoot, userData);
  await new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',scripts.parent],
    { windowsHide: true, timeout: 120000, env: { ...process.env, TARKOV_BOSS_MONITOR_CHILD: scripts.child } },
    (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim())) : resolve()));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const status = readStatus(userData, gameRoot);
    if (status?.requestId === scripts.requestId) {
      onStatus(status);
      if (status.state === 'error') throw new Error(status.message);
      if (status.state === 'configured') {
        if (planLoggingConfig(fs.readFileSync(path.join(gameRoot, 'Logging.config'), 'utf8')).changed) throw new Error('配置写入核验失败');
        return status;
      }
      if (status.state === 'waiting-game-exit') return status;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('未收到配置助手的有效结果，未确认写入成功；请查看权限或重试');
}
module.exports = { DESIRED_LEVELS, planLoggingConfig, sha256, loggingPaths, buildElevatedScripts, readStatus, runElevated };
