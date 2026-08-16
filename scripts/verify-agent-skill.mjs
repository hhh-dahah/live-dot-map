import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const canonicalPath = join(root, 'agent-kit', 'skills', 'live-dot-map', 'SKILL.md');
const targets = [
  join(root, 'agent-kit', 'plugins', 'live-dot-map', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'codex', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'claude-code', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'kimi-code', 'skills', 'live-dot-map', 'SKILL.md'),
  join(root, 'agent-kit', 'adapters', 'codebuddy', 'skills', 'live-dot-map', 'SKILL.md'),
];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonical = await readFile(canonicalPath);
const expected = digest(canonical);
for (const path of targets) {
  const actual = digest(await readFile(path));
  if (actual !== expected) throw new Error(`Skill hash 不一致: ${path} (${actual} != ${expected})`);
}
console.log(JSON.stringify({ ok: true, canonical: canonicalPath, sha256: expected, targets: targets.length }));
