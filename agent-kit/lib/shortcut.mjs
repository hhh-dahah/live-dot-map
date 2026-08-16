import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function windowsDesktopDirectory({ platform = process.platform, env = process.env, exec = execFileSync } = {}) {
  if (platform !== 'win32') return join(homedir(), 'Desktop');
  try {
    const output = exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath(\'Desktop\')'], { encoding: 'utf8', timeout: 5_000 });
    const path = String(output || '').trim();
    if (path) return path;
  } catch {
    // Fall back to the conventional path.  A shortcut failure is non-fatal.
  }
  return join(env.USERPROFILE || homedir(), 'Desktop');
}

export async function createShortcut({
  target,
  arguments: args = '',
  name = '活点地图',
  desktopDirectory,
  platform = process.platform,
  env = process.env,
  exec = execFileSync,
} = {}) {
  if (!target) return { ok: false, skipped: true, reason: 'missing-target' };
  const desktop = desktopDirectory || windowsDesktopDirectory({ platform, env, exec });
  await mkdir(desktop, { recursive: true });
  if (platform !== 'win32') {
    const launcher = join(desktop, `${name}.command`);
    const script = `#!/bin/sh\nexec ${JSON.stringify(resolve(target))}${args ? ` ${args}` : ''}\n`;
    await writeFile(launcher, script, { encoding: 'utf8' });
    return { ok: true, type: 'command', path: launcher };
  }
  const shortcut = join(desktop, `${name}.lnk`);
  const script = [
    "$ws=New-Object -ComObject WScript.Shell",
    `$sc=$ws.CreateShortcut(${psQuote(shortcut)})`,
    `$sc.TargetPath=${psQuote(resolve(target))}`,
    args ? `$sc.Arguments=${psQuote(args)}` : '',
    `$sc.WorkingDirectory=${psQuote(dirname(resolve(target)))}`,
    '$sc.Save()',
  ].filter(Boolean).join(';');
  try {
    exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore', timeout: 10_000 });
    return { ok: true, type: 'windows-lnk', path: shortcut };
  } catch (error) {
    // Keep a runnable .cmd beside the requested shortcut so the user still
    // has a recoverable entry point without claiming the .lnk succeeded.
    const fallback = join(desktop, `${name}.cmd`);
    await writeFile(fallback, `@echo off\n"${resolve(target)}" ${args}\n`, { encoding: 'utf8' });
    return { ok: false, type: 'windows-lnk', path: shortcut, fallback, reason: 'powershell-shortcut-failed', error };
  }
}
