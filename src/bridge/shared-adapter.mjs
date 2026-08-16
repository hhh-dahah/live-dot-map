import { BridgeError } from './errors.mjs';

const REQUIRED_EXPORTS = ['validateMapDocument', 'applyMapCommand', 'applyCommandEnvelope', 'envelopeTouches', 'createEmptyMap', 'migrateMapV1', 'retrieveContext', 'checkAttemptEvidence', 'buildProjectProjection', 'findExplorationAlternatives', 'autonomyDecision', 'planConsolidation'];

export async function loadSharedAdapter() {
  let shared;
  try {
    shared = await import('../shared/index.mjs');
  } catch (error) {
    throw new BridgeError(
      'SHARED_MODULE_UNAVAILABLE',
      'src/shared/index.mjs is not available; inject a shared adapter while testing',
      { details: { requiredExports: REQUIRED_EXPORTS }, cause: error },
    );
  }

  const missing = REQUIRED_EXPORTS.filter((name) => typeof shared[name] !== 'function');
  if (missing.length) {
    throw new BridgeError('SHARED_CONTRACT_MISMATCH', 'Shared map module does not satisfy the bridge contract', {
      details: { requiredExports: REQUIRED_EXPORTS, missing },
    });
  }

  return {
    validateDocument: shared.validateMapDocument,
    applyCommand: shared.applyMapCommand,
    applyEnvelope: shared.applyCommandEnvelope,
    envelopeTouches: shared.envelopeTouches,
    retrieveContext: shared.retrieveContext,
    checkAttemptEvidence: shared.checkAttemptEvidence,
    buildProjectProjection: shared.buildProjectProjection,
    findExplorationAlternatives: shared.findExplorationAlternatives,
    autonomyDecision: shared.autonomyDecision,
    planConsolidation: shared.planConsolidation,
    createEmptyMap: shared.createEmptyMap,
    migrateDocument: shared.migrateMapV1,
  };
}

export const sharedBridgeContract = Object.freeze({
  validateMapDocument: '(value) => { ok: boolean, errors: Array }',
  applyMapCommand: '(document, command) => nextDocument; throws typed Error on invalid command',
  applyCommandEnvelope: '(document, envelope) => nextDocument; applies one transaction revision',
  envelopeTouches: '(envelope) => string[]; stable conflict paths',
  createEmptyMap: '({ name, now }) => document',
  migrateMapV1: '(document, { now }) => version-2 document',
});
