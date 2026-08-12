import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSharedAdapter } from '../../src/bridge/shared-adapter.mjs';

export async function temporaryProject(test, { withMap = true, map } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'live-dot-map-bridge-test-'));
  test.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const shared = await loadSharedAdapter();
  if (withMap) {
    const directory = join(root, '.live-dot-map');
    await mkdir(directory, { recursive: true });
    const document = map || await shared.createEmptyMap({ name: 'bridge-test', now: '2026-08-11T00:00:00.000Z' });
    await writeFile(join(directory, 'map.json'), `${JSON.stringify(document, null, 2)}\n`);
  }
  return { root, shared };
}

export const createRouteCommand = (id = 'r1', name = '路线') => ({
  op: 'create',
  collection: 'routes',
  value: { id, name, source: null, main: id === 'r1' },
});

export function commandEnvelope(commandId, baseRevision, command = createRouteCommand()) {
  return { commandId, baseRevision, command };
}
