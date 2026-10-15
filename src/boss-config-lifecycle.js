'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DESIRED_LEVELS = { aiData: 'Trace', application: 'Debug', backend: 'Information' };
const LEVELS = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical'];

function planLoggingConfig(raw) {
  const hasBom = raw.charCodeAt(0) === 0xFEFF;
  const config = JSON.parse(hasBom ? raw.slice(1) : raw);
  if (!config || !Array.isArray(config.rules)) throw new Error('Logging.config 缺少 rules 数组');
  const result = JSON.parse(JSON.stringify(config));
  let changed = false;
  for (const [name, desired] of Object.entries(DESIRED_LEVELS)) {
    const matches = result.rules.filter((rule) => rule && rule.fileName === name);
    if (matches.length !== 1) throw new Error(`Logging.config 中 ${name} 规则数量不是 1`);
    if (!LEVELS.includes(matches[0].minLevel)) throw new Error(`Logging.config 中 ${name} 日志级别无效`);
    if (LEVELS.indexOf(matches[0].minLevel) > LEVELS.indexOf(desired)) {
      matches[0].minLevel = desired;
      changed = true;
    }
  }
  return { changed, output: changed ? `${hasBom ? '\uFEFF' : ''}${JSON.stringify(result, null, 2)}` : raw };
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex').toUpperCase();
}

function loggingPaths(userData, gameRoot = '') {
  const id = gameRoot ? sha256(path.resolve(gameRoot).toLowerCase()).slice(0, 16) : 'default';
  const secureRoot = path.join(process.env.ProgramData || path.join(path.parse(userData).root, 'ProgramData'), 'TarkovOfflineMapBoss');
  const secureBase = path.join(secureRoot, `boss-logging-${id}`);
  const userBase = path.join(userData, `boss-logging-${id}`);
  return {
    secureRoot,
    backup: `${secureBase}.backup`,
    backupHash: `${secureBase}.backup.sha256`,
    appliedHash: `${secureBase}.applied.sha256`,
    metadata: `${secureBase}.json`,
    restoreRequest: `${userBase}.restore-request`,
    conflict: `${secureBase}.restore-conflict`,
    status: `${secureBase}.status`,
  };
}

function buildElevatedScripts(gameRoot, userData, ownerPid = process.pid) {
  const files = loggingPaths(userData, gameRoot);
  const payload = Buffer.from(JSON.stringify({ gameRoot, userData, ownerPid, files }), 'utf8').toString('base64');
  const child = String.raw`
$ErrorActionPreference = 'Stop'
$ctx = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
$utf8 = [Text.UTF8Encoding]::new($false)
$root = [IO.Path]::GetFullPath([string]$ctx.gameRoot).TrimEnd('\')
$config = Join-Path $root 'Logging.config'
$exe = Join-Path $root 'EscapeFromTarkov.exe'
$backup = [string]$ctx.files.backup
$backupHashFile = [string]$ctx.files.backupHash
$appliedHashFile = [string]$ctx.files.appliedHash
$metadataFile = [string]$ctx.files.metadata
$restoreRequest = [string]$ctx.files.restoreRequest
$conflictFile = [string]$ctx.files.conflict
$statusFile = [string]$ctx.files.status
$secureRoot = [IO.Path]::GetFullPath([string]$ctx.files.secureRoot)
$userData = [IO.Path]::GetFullPath([string]$ctx.userData)
$ownerPid = [int]$ctx.ownerPid
$ownerStart = 0L
try { $ownerStart = (Get-Process -Id $ownerPid -ErrorAction Stop).StartTime.ToUniversalTime().Ticks } catch {}

function Write-State([string]$value) {
  try { [IO.File]::WriteAllText($statusFile, $value, $utf8) } catch {}
}
function Test-NoReparsePath([string]$pathValue) {
  $current = [IO.Path]::GetFullPath($pathValue)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force
      if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw '目标路径包含链接或重解析点' }
    }
    $parentInfo = [IO.Directory]::GetParent($current)
    $parent = if ($parentInfo) { $parentInfo.FullName } else { $null }
    if (-not $parent -or $parent -eq $current) { break }
    $current = $parent
  }
}
function Test-GameRunning {
  return @((Get-Process -Name 'EscapeFromTarkov' -ErrorAction SilentlyContinue)).Count -gt 0
}
function Test-OwnerRunning {
  if ($ownerStart -eq 0) { return $false }
  try {
    $p = Get-Process -Id $ownerPid -ErrorAction Stop
    return $p.StartTime.ToUniversalTime().Ticks -eq $ownerStart
  } catch { return $false }
}
function Restore-ManagedConfig {
  if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { return $true }
  Test-NoReparsePath $root
  Test-NoReparsePath $config
  Test-NoReparsePath $secureRoot
  if ((Test-Path -LiteralPath $backupHashFile -PathType Leaf) -and
      (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -eq ([IO.File]::ReadAllText($backupHashFile)).Trim() -and
      (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -eq ([IO.File]::ReadAllText($backupHashFile)).Trim()) {
    Remove-Item -LiteralPath $backup, $backupHashFile, $appliedHashFile, $metadataFile, $restoreRequest -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $conflictFile -Force -ErrorAction SilentlyContinue
    Write-State 'restored'
    return $true
  }
  if (-not (Test-Path -LiteralPath $backupHashFile -PathType Leaf) -or -not (Test-Path -LiteralPath $appliedHashFile -PathType Leaf) -or -not (Test-Path -LiteralPath $metadataFile -PathType Leaf)) {
    [IO.File]::WriteAllText($conflictFile, '配置备份信息不完整；已保留备份并停止自动恢复。', $utf8)
    Write-State 'conflict'
    return $false
  }
  $metadata = [IO.File]::ReadAllText($metadataFile) | ConvertFrom-Json
  if ([IO.Path]::GetFullPath([string]$metadata.gameRoot).TrimEnd('\') -ne $root) {
    [IO.File]::WriteAllText($conflictFile, '备份对应的游戏目录不匹配；已保留备份并停止自动恢复。', $utf8)
    Write-State 'conflict'
    return $false
  }
  $expected = ([IO.File]::ReadAllText($appliedHashFile)).Trim()
  $expectedBackup = ([IO.File]::ReadAllText($backupHashFile)).Trim()
  if ((Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $expected -or (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $expectedBackup) {
    [IO.File]::WriteAllText($conflictFile, 'Logging.config 或备份已被其他程序修改；已保留现场并跳过自动恢复。', $utf8)
    Write-State 'conflict'
    return $false
  }
  $temp = $config + '.boss-monitor.restore.tmp'
  [IO.File]::Copy($backup, $temp, $true)
  Move-Item -LiteralPath $temp -Destination $config -Force
  Remove-Item -LiteralPath $backup, $backupHashFile, $appliedHashFile, $metadataFile, $restoreRequest -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $conflictFile -Force -ErrorAction SilentlyContinue
  Write-State 'restored'
  return $true
}
function Apply-ManagedConfig {
  Test-NoReparsePath $root
  Test-NoReparsePath $config
  Test-NoReparsePath $secureRoot
  $raw = [IO.File]::ReadAllText($config)
  $settings = $raw | ConvertFrom-Json
  if (-not ($settings.rules -is [array])) { throw 'Logging.config 缺少 rules 数组' }
  $levels = @('Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical')
  $desired = @{ aiData = 'Trace'; application = 'Debug'; backend = 'Information' }
  $changed = $false
  foreach ($name in @('aiData', 'application', 'backend')) {
    $matches = @($settings.rules | Where-Object { $_.fileName -ceq $name })
    if ($matches.Count -ne 1) { throw "Logging.config 中 $name 规则数量不是 1" }
    $index = [Array]::IndexOf($levels, [string]$matches[0].minLevel)
    if ($index -lt 0) { throw "Logging.config 中 $name 日志级别无效" }
    if ($index -gt [Array]::IndexOf($levels, $desired[$name])) { $matches[0].minLevel = $desired[$name]; $changed = $true }
  }
  if (-not $changed) { Write-State 'already-configured'; return $false }
  if (Test-GameRunning) { throw '游戏进程仍在运行，延后配置修改' }
  [IO.Directory]::CreateDirectory($secureRoot) | Out-Null
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  $acl.SetOwner([System.Security.Principal.NTAccount]::new('BUILTIN\Administrators'))
  foreach ($principal in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($principal, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  $readRule = [System.Security.AccessControl.FileSystemAccessRule]::new('BUILTIN\Users', 'ReadAndExecute', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.AddAccessRule($readRule)
  Set-Acl -LiteralPath $secureRoot -AclObject $acl
  [IO.File]::Copy($config, $backup, $false)
  [IO.File]::WriteAllText($backupHashFile, (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash, $utf8)
  [IO.File]::WriteAllText($metadataFile, (@{ gameRoot = $root } | ConvertTo-Json -Compress), $utf8)
  $temp = $config + '.boss-monitor.tmp'
  [IO.File]::WriteAllText($temp, (($settings | ConvertTo-Json -Depth 100) + [Environment]::NewLine), $utf8)
  if (Test-GameRunning) { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue; throw '游戏进程已启动，延后配置修改' }
  Test-NoReparsePath $config
  $plannedHash = (Get-FileHash -LiteralPath $temp -Algorithm SHA256).Hash
  [IO.File]::WriteAllText($appliedHashFile, $plannedHash, $utf8)
  [IO.File]::Replace($temp, $config, $null)
  Remove-Item -LiteralPath $conflictFile -Force -ErrorAction SilentlyContinue
  Write-State 'configured-after-game-exit'
  return $true
}

try {
  if (-not (Test-Path -LiteralPath $exe -PathType Leaf) -or -not (Test-Path -LiteralPath $config -PathType Leaf)) { throw '游戏目录无效或缺少 Logging.config' }
  [IO.Directory]::CreateDirectory($userData) | Out-Null
  Test-NoReparsePath $root
  Test-NoReparsePath $config
  Test-NoReparsePath $userData
  Test-NoReparsePath $secureRoot
  $mutexName = 'Global\TarkovOfflineMapBoss_' + ([IO.Path]::GetFileNameWithoutExtension($backup) -replace '[^A-Za-z0-9_]', '_')
  $mutex = New-Object System.Threading.Mutex($false, $mutexName)
  $hasMutex = $false
  try { $hasMutex = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $hasMutex = $true }
  if (-not $hasMutex) { Write-State 'already-managed'; exit 0 }
  if (-not (Test-OwnerRunning) -and -not (Test-Path -LiteralPath $restoreRequest)) { Write-State 'cancelled'; exit 0 }

  while ($true) {
    if (Test-GameRunning) {
      Write-State 'waiting-game-exit'
      Start-Sleep -Seconds 3
      continue
    }
    if ((Test-Path -LiteralPath $restoreRequest) -or -not (Test-OwnerRunning)) {
      if (Test-Path -LiteralPath $backup) { [void](Restore-ManagedConfig) } else { Write-State 'cancelled' }
      break
    }
    if (-not (Test-Path -LiteralPath $backup)) {
      Start-Sleep -Seconds 2
      if (Test-GameRunning) { continue }
      if (-not (Test-OwnerRunning) -or (Test-Path -LiteralPath $restoreRequest)) { Write-State 'cancelled'; break }
      if (-not (Apply-ManagedConfig)) { break }
    } else {
      $metadata = [IO.File]::ReadAllText($metadataFile) | ConvertFrom-Json
      $expected = ([IO.File]::ReadAllText($appliedHashFile)).Trim()
      if ([IO.Path]::GetFullPath([string]$metadata.gameRoot).TrimEnd('\') -ne $root -or (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash -ne $expected) {
        [IO.File]::WriteAllText($conflictFile, 'Logging.config 已被其他程序修改；保留备份，跳过后续恢复。', $utf8)
        Write-State 'conflict'
        break
      }
      Write-State 'managed'
    }
    Start-Sleep -Seconds 3
  }
} catch {
  Write-State ('error: ' + $_.Exception.Message)
}
`;
  const childCommand = child.replace('__PAYLOAD__', payload);
  const childEncoded = Buffer.from(childCommand, 'utf16le').toString('base64');
  if (childEncoded.length > 30000) throw new Error('管理员守护脚本超过 Windows 环境变量长度限制');
  const parent = "$child=$env:TARKOV_BOSS_MONITOR_CHILD; if ([string]::IsNullOrEmpty($child) -or $child.Length -gt 30000) { exit 87 }; try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-NonInteractive','-EncodedCommand',$child) | Out-Null; exit 0 } catch { exit 1223 }";
  return { parent: Buffer.from(parent, 'utf16le').toString('base64'), child: childEncoded };
}

function buildElevatedCommand(gameRoot, userData, ownerPid = process.pid) {
  return buildElevatedScripts(gameRoot, userData, ownerPid).parent;
}

function runElevated(gameRoot, userData, ownerPid) {
  return new Promise((resolve, reject) => {
    let scripts;
    try { scripts = buildElevatedScripts(gameRoot, userData, ownerPid); } catch (error) { reject(error); return; }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', scripts.parent], {
      windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024,
      env: { ...process.env, TARKOV_BOSS_MONITOR_CHILD: scripts.child },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || stdout || error.message || '').trim();
        reject(new Error(detail || '管理员授权未完成'));
      } else resolve({ stdout, stderr });
    });
  });
}

function hasManagedBackup(userData, gameRoot) {
  return fs.existsSync(loggingPaths(userData, gameRoot).backup);
}

function requestRestore(userData, gameRoot) {
  const files = loggingPaths(userData, gameRoot);
  fs.mkdirSync(userData, { recursive: true });
  if (!fs.existsSync(files.restoreRequest)) fs.writeFileSync(files.restoreRequest, String(Date.now()));
  return true;
}

function resumeManagedConfig(userData, gameRoot) {
  try { fs.unlinkSync(loggingPaths(userData, gameRoot).restoreRequest); } catch {}
}

module.exports = {
  DESIRED_LEVELS, planLoggingConfig, sha256, loggingPaths,
  buildElevatedCommand, buildElevatedScripts, runElevated, hasManagedBackup, requestRestore, resumeManagedConfig,
};
