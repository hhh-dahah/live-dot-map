import assert from 'node:assert/strict';
import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist', 'windows-installer');
const executable = join(output, 'LiveDotMapSetup.exe');
const payload = join(output, 'payload');

function run(exe, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(exe, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`${exe} exited ${code}: ${stderr || stdout}`)));
  });
}

await access(executable, constants.F_OK);
assert.ok((await stat(executable)).size > 1_000_000, 'WinForms setup executable is unexpectedly small');
for (const relative of ['payload/payload-manifest.json', 'payload/app.html', 'payload/livedot-bridge-win-x64.exe', 'installer-manifest.json']) {
  await access(join(output, relative), constants.F_OK);
}
assert.ok((await stat(join(payload, 'livedot-bridge-win-x64.exe'))).size > 1_000_000, 'SEA payload is unexpectedly small');
const result = await run(executable, ['--verify-payload', payload]);
const verification = JSON.parse(result.stdout);
assert.equal(verification.Ok, true, JSON.stringify(verification));
const manifest = JSON.parse(await readFile(join(output, 'installer-manifest.json'), 'utf8'));
assert.equal(manifest.schema, 1);
assert.equal(manifest.signed, false);
assert.equal(manifest.requiresAdministrator, false);
assert.equal(manifest.files['LiveDotMapSetup.exe'].bytes > 1_000_000, true);
console.log(JSON.stringify({ ok: true, version: verification.Version, installer: executable, payloadVerified: verification.Ok }, null, 2));
