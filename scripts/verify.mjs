import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const steps = [
  ['core', 'npm', ['test']],
  ['browser-and-performance', 'node', ['--test-concurrency=1', '--test', 'tests/e2e/bridge-browser.mjs', 'tests/e2e/fallback-browser.mjs', 'tests/e2e/first-map-guide.mjs', 'tests/e2e/performance.mjs']],
  ['agent-cycle', 'node', ['--test', 'tests/e2e/agent-cycle.mjs']],
  ['installer', 'node', ['scripts/verify-installer.mjs']],
  ['windows-installer', 'npm', ['run', 'verify:windows-installer']],
  ['release', 'npm', ['run', 'verify:release']],
];

function run([name, command, args]) {
  return new Promise((resolve, reject) => {
    console.log(`\n[verify:${name}] ${command} ${args.join(' ')}`);
    const executable = process.platform === 'win32' && command === 'npm' ? (process.env.ComSpec || 'cmd.exe') : command;
    const childArgs = process.platform === 'win32' && command === 'npm'
      ? ['/d', '/s', '/c', `npm ${args.map((value) => /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value).join(' ')}`]
      : args;
    const child = spawn(executable, childArgs, { cwd: root, stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${name} failed: ${code ?? signal}`)));
  });
}

for (const step of steps) await run(step);
console.log('\n[verify] all gates passed');
