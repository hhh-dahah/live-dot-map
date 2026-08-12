import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeMarkdownFields,
  normalizeMarkdownPath,
  stableHash,
  stableStringify,
  validateForDraft,
} from '../../src/web/shared.mjs';

test('Markdown 路径兼容旧前缀但拒绝目录穿越', () => {
  assert.equal(normalizeMarkdownPath('nodes/01-开始.md'), '.live-dot-map/nodes/01-开始.md');
  assert.equal(normalizeMarkdownPath('.\\live-dot-map\\nodes\\n1.md'), '.live-dot-map/nodes/n1.md');
  assert.throws(() => normalizeMarkdownPath('../secret.md'), /不能包含/);
  assert.throws(() => normalizeMarkdownPath('C:/secret.md'), /项目目录/);
  assert.throws(() => normalizeMarkdownPath('nodes/a\u0000.md'), /非法字符/);
});

test('路径规范化按 ID 固定新对象路径并保留未知字段', () => {
  const input = { version: 1, nodes: [{ id: 'n1', md: 'nodes/old-name.md', future: { keep: true } }] };
  const output = canonicalizeMarkdownFields(input);
  assert.equal(output.nodes[0].md, '.live-dot-map/nodes/n1.md');
  assert.deepEqual(output.nodes[0].future, { keep: true });
  assert.equal(input.nodes[0].md, 'nodes/old-name.md');
});

test('稳定摘要与草稿校验不依赖对象键顺序', () => {
  assert.equal(stableStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
  const result = validateForDraft({ version: 99, foo: 'bar' });
  assert.equal(result.ok, false);
  assert.equal(result.document.version, 99);
});
