import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonical = join(root, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md');
const text = await readFile(canonical, 'utf8');
const targets = [
  join(root, 'agent-kit', 'plugins', 'live-dot-map', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'codex', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'claude-code', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'kimi-code', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'codebuddy', 'skills', 'live-dot-map', 'SKILL.md'),
];
for (const target of targets) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, 'utf8');
}
console.log(`同步 canonical Skill 到 ${targets.length} 个分发位置`);
