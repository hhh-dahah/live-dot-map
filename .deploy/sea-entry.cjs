"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/shared/index.mjs
var shared_exports = {};
__export(shared_exports, {
  COLLECTIONS: () => COLLECTIONS,
  MAP_VERSION: () => MAP_VERSION,
  applyCommandEnvelope: () => applyCommandEnvelope,
  applyMapCommand: () => applyMapCommand,
  autonomyDecision: () => autonomyDecision,
  buildProjectProjection: () => buildProjectProjection,
  checkAttemptEvidence: () => checkAttemptEvidence,
  commandTouches: () => commandTouches,
  createEmptyMap: () => createEmptyMap,
  documentMapDir: () => documentMapDir,
  envelopeTouches: () => envelopeTouches,
  findExplorationAlternatives: () => findExplorationAlternatives,
  mapError: () => mapError,
  migrateMapV1: () => migrateMapV1,
  planConsolidation: () => planConsolidation,
  retrieveContext: () => retrieveContext,
  stableMarkdownPath: () => stableMarkdownPath,
  validateMapDocument: () => validateMapDocument
});
function clone2(value) {
  return structuredClone(value);
}
function utcNow(now) {
  const value = now ? new Date(now) : /* @__PURE__ */ new Date();
  if (Number.isNaN(value.getTime())) throw mapError("INVALID_TIME", 400, "\u65F6\u95F4\u683C\u5F0F\u65E0\u6548");
  return value.toISOString();
}
function legacyTime(value, fallback) {
  if (typeof value !== "string") return fallback;
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}
function fnv1a(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function mapError(code, status, message, details) {
  return Object.assign(new Error(message), { code, status, details });
}
function cleanRecord(input, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw mapError("INVALID_COMMAND", 400, `${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
  const output = {};
  for (const [key, value] of Object.entries(input)) {
    if (DANGEROUS_KEYS.has(key)) throw mapError("INVALID_KEY", 400, `\u7981\u6B62\u5B57\u6BB5 ${key}`);
    output[key] = clone2(value);
  }
  return output;
}
function documentMapDir(document) {
  const value = document.mapDir;
  return typeof value === "string" && value ? value : ".live-dot-map";
}
function stableMarkdownPath(collection, id, mapDir = ".live-dot-map") {
  if (!ID2.test(id)) throw mapError("INVALID_ID", 400, "\u5BF9\u8C61 ID \u65E0\u6548");
  return collection === "nodes" ? `${mapDir}/nodes/${id}/index.md` : `${mapDir}/routes/${id}/index.md`;
}
function createEmptyMap(options = {}) {
  const now = utcNow(options.now);
  const mapId = options.mapId ?? `map-${fnv1a(`${options.name ?? "\u672A\u547D\u540D\u5730\u56FE"}:${now}`)}`;
  return {
    mapId,
    version: MAP_VERSION,
    revision: 0,
    lastEventId: 0,
    name: String(options.name ?? "\u672A\u547D\u540D\u5730\u56FE").slice(0, MAX_NAME),
    ...options.mapDir ? { mapDir: options.mapDir } : {},
    bundleLayoutVersion: 1,
    createdAt: now,
    updatedAt: now,
    view: { x: 0, y: 0, k: 1 },
    ui: { showAnns: true, showRoutes: true, showNums: false, showFailed: true },
    counters: { num: 1, edge: 1, ann: 1, nodeName: 1, edgeName: 1, routeName: 1 },
    routes: [],
    nodes: [],
    edges: [],
    anns: []
  };
}
function migrateObject(value, fallback, collection) {
  const item = cleanRecord(value, collection);
  const createdAt = legacyTime(item.createdAt, fallback);
  const updatedAt = legacyTime(item.updatedAt, createdAt);
  const migrated = {
    ...item,
    createdAt,
    updatedAt,
    createdBy: typeof item.createdBy === "string" ? item.createdBy : "migration",
    updatedBy: "migration",
    updatedRevision: 0
  };
  if (collection === "nodes") {
    const legacyType = String(item.type ?? "");
    migrated.kind = item.kind === "goal" || item.kind === "problem" || item.kind === "result" ? item.kind : legacyType === "\u95EE\u9898" || legacyType === "problem" ? "problem" : legacyType === "\u7ED3\u679C" || legacyType === "result" ? "result" : "goal";
  }
  if (collection === "nodes" && isObject(item.milestone)) {
    migrated.milestone = {
      ...item.milestone,
      createdBy: typeof item.milestone.createdBy === "string" ? item.milestone.createdBy : "migration",
      updatedBy: "migration",
      updatedAt,
      updatedRevision: 0
    };
  }
  if (collection === "anns") {
    migrated.source = typeof item.source === "string" ? item.source : "migration";
    migrated.priority = typeof item.priority === "string" ? item.priority : "normal";
    migrated.attention = "new";
    migrated.acknowledgements = Array.isArray(item.acknowledgements) ? clone2(item.acknowledgements) : [];
    migrated.legacyReview = true;
  }
  return migrated;
}
function migrateMapV1(input, options = {}) {
  const old = cleanRecord(input, "map.json");
  if (old.version !== 1) throw mapError("UNSUPPORTED_VERSION", 409, `\u53EA\u80FD\u8FC1\u79FB version 1\uFF0C\u6536\u5230 ${String(old.version)}`);
  const now = utcNow(options.now);
  const createdAt = legacyTime(old.createdAt ?? old.updatedAt, now);
  const updatedAt = legacyTime(old.updatedAt, createdAt);
  const mapId = typeof old.mapId === "string" && ID2.test(old.mapId) ? old.mapId : `map-${fnv1a(`${String(old.name ?? "\u672A\u547D\u540D\u5730\u56FE")}:${createdAt}`)}`;
  const result2 = {
    ...old,
    mapId,
    version: MAP_VERSION,
    revision: 0,
    lastEventId: 0,
    name: String(old.name ?? "\u672A\u547D\u540D\u5730\u56FE").slice(0, MAX_NAME),
    createdAt,
    updatedAt,
    migration: { from: 1, migratedAt: now, actor: "migration" },
    view: cleanRecord(old.view ?? { x: 0, y: 0, k: 1 }, "view"),
    ui: cleanRecord(old.ui ?? {}, "ui"),
    counters: cleanRecord(old.counters ?? {}, "counters"),
    routes: (Array.isArray(old.routes) ? old.routes : []).map((v) => migrateObject(v, updatedAt, "routes")),
    nodes: (Array.isArray(old.nodes) ? old.nodes : []).map((v) => migrateObject(v, updatedAt, "nodes")),
    edges: (Array.isArray(old.edges) ? old.edges : []).map((v) => migrateObject(v, updatedAt, "edges")),
    anns: (Array.isArray(old.anns) ? old.anns : []).map((v) => migrateObject(v, updatedAt, "anns"))
  };
  const validation = validateMapDocument(result2);
  if (!validation.ok) throw mapError("MIGRATION_INVALID", 422, "v1 \u6570\u636E\u65E0\u6CD5\u5B89\u5168\u8FC1\u79FB", validation.errors);
  return result2;
}
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validateBaseObject(item, label, ids, errors) {
  if (!isObject(item)) {
    errors.push(`${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
    return false;
  }
  if (typeof item.id !== "string" || !ID2.test(item.id)) errors.push(`${label}.id \u65E0\u6548`);
  else if (ids.has(item.id)) errors.push(`\u91CD\u590D id: ${item.id}`);
  else ids.add(item.id);
  if (typeof item.createdAt !== "string" || !ISO_MS.test(item.createdAt)) errors.push(`${label}.createdAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedAt !== "string" || !ISO_MS.test(item.updatedAt)) errors.push(`${label}.updatedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedBy !== "string") errors.push(`${label}.updatedBy \u7F3A\u5931`);
  if (item.createdBy !== void 0 && typeof item.createdBy !== "string") errors.push(`${label}.createdBy \u65E0\u6548`);
  if (!Number.isInteger(item.updatedRevision) || Number(item.updatedRevision) < 0) errors.push(`${label}.updatedRevision \u65E0\u6548`);
  if (item.archived !== void 0 && typeof item.archived !== "boolean") errors.push(`${label}.archived \u65E0\u6548`);
  if (item.archivedAt !== void 0 && (typeof item.archivedAt !== "string" || !ISO_MS.test(item.archivedAt))) errors.push(`${label}.archivedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (item.archivedBy !== void 0 && typeof item.archivedBy !== "string") errors.push(`${label}.archivedBy \u65E0\u6548`);
  if (item.archiveReason !== void 0 && (typeof item.archiveReason !== "string" || item.archiveReason.length > MAX_ANN)) errors.push(`${label}.archiveReason \u65E0\u6548\u6216\u8FC7\u957F`);
  return true;
}
function normalizeNodeKind(value) {
  if (value === "goal" || value === "problem" || value === "result") return value;
  if (value === "\u95EE\u9898" || value === "problem") return "problem";
  if (value === "\u7ED3\u679C" || value === "result") return "result";
  return "goal";
}
function validateMapDocument(value) {
  const errors = [];
  if (!isObject(value)) return { ok: false, errors: ["map.json \u5FC5\u987B\u662F\u5BF9\u8C61"] };
  if (value.version !== MAP_VERSION) return { ok: false, readOnly: true, errors: [`\u4E0D\u652F\u6301 schema version ${String(value.version)}`] };
  if (typeof value.mapId !== "string" || !ID2.test(value.mapId)) errors.push("mapId \u65E0\u6548");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) errors.push("revision \u65E0\u6548");
  if (!Number.isInteger(value.lastEventId) || Number(value.lastEventId) < 0) errors.push("lastEventId \u65E0\u6548");
  if (typeof value.name !== "string" || value.name.length > MAX_NAME) errors.push("name \u65E0\u6548\u6216\u8FC7\u957F");
  if (typeof value.createdAt !== "string" || !ISO_MS.test(value.createdAt)) errors.push("createdAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC");
  if (typeof value.updatedAt !== "string" || !ISO_MS.test(value.updatedAt)) errors.push("updatedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC");
  if (!isObject(value.view)) errors.push("view \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!isObject(value.ui)) errors.push("ui \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!isObject(value.counters)) errors.push("counters \u5FC5\u987B\u662F\u5BF9\u8C61");
  const ids = /* @__PURE__ */ new Set();
  const byCollection = { routes: [], nodes: [], edges: [], anns: [] };
  for (const collection of COLLECTIONS) {
    const list = value[collection];
    if (!Array.isArray(list)) {
      errors.push(`${collection} \u5FC5\u987B\u662F\u6570\u7EC4`);
      continue;
    }
    if (list.length > 1e5) {
      errors.push(`${collection} \u8D85\u8FC7\u5BF9\u8C61\u4E0A\u9650`);
      continue;
    }
    for (let i = 0; i < list.length; i += 1) {
      if (validateBaseObject(list[i], `${collection}[${i}]`, ids, errors)) byCollection[collection].push(list[i]);
    }
  }
  const nodeIds = new Set(byCollection.nodes.map((v) => String(v.id)));
  const routeIds = new Set(byCollection.routes.map((v) => String(v.id)));
  for (const [i, route] of byCollection.routes.entries()) {
    if (route.currentNodeId === void 0 || route.currentNodeId === null) continue;
    if (typeof route.currentNodeId !== "string" || !nodeIds.has(route.currentNodeId)) {
      errors.push(`routes[${i}].currentNodeId \u5F15\u7528\u4E0D\u5B58\u5728`);
      continue;
    }
    const current = byCollection.nodes.find((node) => node.id === route.currentNodeId);
    if (current && current.route !== route.id) errors.push(`routes[${i}].currentNodeId \u4E0D\u5C5E\u4E8E\u8BE5\u8DEF\u7EBF`);
  }
  for (const [i, edge] of byCollection.edges.entries()) {
    if (!nodeIds.has(String(edge.from))) errors.push(`edges[${i}].from \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.to !== null && !nodeIds.has(String(edge.to))) errors.push(`edges[${i}].to \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (!["success", "failed", "pending"].includes(String(edge.status))) errors.push(`edges[${i}].status \u65E0\u6548`);
    if (edge.route !== null && edge.route !== void 0 && !routeIds.has(String(edge.route))) errors.push(`edges[${i}].route \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.score !== void 0 && (!Number.isInteger(edge.score) || Number(edge.score) < 0 || Number(edge.score) > 100)) errors.push(`edges[${i}].score \u65E0\u6548`);
  }
  for (const [i, node] of byCollection.nodes.entries()) {
    if (node.kind !== void 0 && !["goal", "problem", "result"].includes(String(node.kind))) errors.push(`nodes[${i}].kind \u65E0\u6548`);
    if (node.route !== null && node.route !== void 0 && !routeIds.has(String(node.route))) errors.push(`nodes[${i}].route \u5F15\u7528\u4E0D\u5B58\u5728`);
  }
  for (const [i, ann] of byCollection.anns.entries()) {
    if (typeof ann.text !== "string" || ann.text.length > MAX_ANN) errors.push(`anns[${i}].text \u65E0\u6548\u6216\u8FC7\u957F`);
    if (!["new", "delivered", "acknowledged", "resolved"].includes(String(ann.attention))) errors.push(`anns[${i}].attention \u65E0\u6548`);
    const target = ann.target;
    if (!isObject(target) || !["node", "edge", "canvas"].includes(String(target.kind))) errors.push(`anns[${i}].target \u65E0\u6548`);
    else if (target.kind === "node" && !nodeIds.has(String(target.id))) errors.push(`anns[${i}] \u8282\u70B9\u76EE\u6807\u4E0D\u5B58\u5728`);
    else if (target.kind === "edge" && !byCollection.edges.some((e) => e.id === target.id)) errors.push(`anns[${i}] \u65B9\u6848\u76EE\u6807\u4E0D\u5B58\u5728`);
  }
  return { ok: errors.length === 0, errors };
}
function getList(document, collection) {
  return document[collection];
}
function findItem(document, collection, id) {
  const item = getList(document, collection).find((entry) => entry.id === id);
  if (!item) throw mapError("NOT_FOUND", 404, `${collection}/${id} \u4E0D\u5B58\u5728`);
  return item;
}
function touch(item, actor, revision, now) {
  item.updatedAt = now;
  item.updatedBy = actor;
  item.updatedRevision = revision;
}
function archiveItem(item, actor, revision, now, reason) {
  item.archived = true;
  item.archivedAt = now;
  item.archivedBy = actor;
  if (reason === void 0 || reason === null || reason === "") delete item.archiveReason;
  else if (typeof reason !== "string" || reason.length > MAX_ANN) throw mapError("INVALID_ARCHIVE_REASON", 422, "\u5F52\u6863\u539F\u56E0\u65E0\u6548\u6216\u8FC7\u957F");
  else item.archiveReason = reason;
  touch(item, actor, revision, now);
}
function restoreItem(item, actor, revision, now) {
  delete item.archived;
  delete item.archivedAt;
  delete item.archivedBy;
  delete item.archiveReason;
  touch(item, actor, revision, now);
}
function markLegacyTranslated(document) {
  Object.defineProperty(document, "legacyTranslated", {
    value: true,
    enumerable: false,
    configurable: true
  });
}
function assertName(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_NAME) throw mapError("INVALID_NAME", 422, "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC7 80 \u5B57");
}
function isAgent(actor) {
  return typeof actor === "string" && actor.startsWith("agent:");
}
function assertAgentCurationAllowed(value, actor) {
  if (!isAgent(actor)) return;
  const fields = ["shelved"].filter((field) => value[field] === true);
  if (!fields.length) return;
  throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "Agent \u4E0D\u80FD\u76F4\u63A5\u6401\u7F6E\u5730\u56FE\u8BB0\u5FC6\uFF0C\u5FC5\u987B\u7B49\u5F85\u4EBA\u5728\u753B\u5E03\u5BA1\u6838\u540E\u63D0\u4EA4", {
    fields,
    suggestion: "\u8C03\u7528 map_plan_consolidation \u751F\u6210\u53EA\u8BFB\u5EFA\u8BAE\uFF0C\u7B49\u5F85\u4EBA\u7C7B\u5BA1\u6838"
  });
}
function assertHumanOnlyCommand(command2, actor) {
  if (isAgent(actor) && command2.op === "update" && command2.humanOnly === true) {
    throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "\u8BE5\u6574\u7406\u547D\u4EE4\u53EA\u80FD\u7531\u4EBA\u5728\u753B\u5E03\u5BA1\u6838\u540E\u63D0\u4EA4", {
      suggestion: "\u5148\u8C03\u7528 map_plan_consolidation \u67E5\u770B\u53EA\u8BFB\u5EFA\u8BAE\uFF0C\u518D\u7531\u4EBA\u5728\u753B\u5E03\u786E\u8BA4"
    });
  }
}
function applyOne(document, command2, actor, revision, now) {
  assertHumanOnlyCommand(command2, actor);
  if (command2.op === "create") {
    const value = cleanRecord(command2.value, "value");
    if (typeof value.id !== "string" || !ID2.test(value.id)) throw mapError("INVALID_ID", 422, "\u65B0\u5BF9\u8C61 ID \u65E0\u6548");
    if (getList(document, command2.collection).some((v) => v.id === value.id)) throw mapError("DUPLICATE_ID", 409, `\u5BF9\u8C61 ${value.id} \u5DF2\u5B58\u5728`);
    if (command2.collection !== "anns") assertName(value.name);
    if (command2.collection === "nodes") {
      if (value.kind !== void 0 && !["goal", "problem", "result"].includes(String(value.kind))) throw mapError("INVALID_NODE_KIND", 422, "\u8282\u70B9 kind \u5FC5\u987B\u662F goal\u3001problem \u6216 result");
      value.kind = normalizeNodeKind(value.kind ?? value.type) === "problem" ? "problem" : "goal";
      delete value.milestone;
      delete value.milestoneSuggestion;
    }
    assertAgentCurationAllowed(value, actor);
    const item = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command2.collection === "nodes" && item.md === void 0) item.md = stableMarkdownPath("nodes", String(item.id), documentMapDir(document));
    if (command2.collection === "edges" && item.md === void 0) item.md = stableMarkdownPath("edges", String(item.id), documentMapDir(document));
    if (command2.collection === "anns") {
      if (typeof item.text !== "string" || item.text.length > MAX_ANN) throw mapError("INVALID_ANNOTATION", 422, "\u6807\u6CE8\u65E0\u6548\u6216\u8FC7\u957F");
      item.source = actor === "human" ? "human" : actor;
      item.priority = item.priority ?? "normal";
      item.attention = actor === "human" ? "new" : item.attention ?? "acknowledged";
      item.acknowledgements = [];
    }
    if (value.archived === true) {
      archiveItem(item, actor, revision, now, value.archiveReason);
    } else {
      delete item.archivedAt;
      delete item.archivedBy;
      delete item.archiveReason;
    }
    getList(document, command2.collection).push(item);
    return;
  }
  if (command2.op === "update") {
    const item = findItem(document, command2.collection, command2.id);
    const patch = cleanRecord(command2.patch, "patch");
    for (const key of ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "updatedRevision"]) delete patch[key];
    if ("name" in patch) assertName(patch.name);
    if (command2.collection === "nodes" && "kind" in patch) {
      if (!["goal", "problem", "result"].includes(String(patch.kind))) throw mapError("INVALID_NODE_KIND", 422, "\u8282\u70B9 kind \u5FC5\u987B\u662F goal\u3001problem \u6216 result");
      patch.kind = patch.kind === "problem" ? "problem" : "goal";
    }
    assertAgentCurationAllowed(patch, actor);
    if (command2.collection === "nodes") {
      delete patch.milestone;
      delete patch.milestoneSuggestion;
    }
    const archiveState = patch.archived;
    const archiveReason = patch.archiveReason;
    delete patch.archived;
    delete patch.archivedAt;
    delete patch.archivedBy;
    delete patch.archiveReason;
    Object.assign(item, patch);
    if (command2.collection === "anns" && actor === "human") {
      item.source = "human";
      item.attention = "new";
      if (!Array.isArray(item.acknowledgements)) item.acknowledgements = [];
    }
    if (archiveState === true) archiveItem(item, actor, revision, now, archiveReason);
    else if (archiveState === false) restoreItem(item, actor, revision, now);
    else touch(item, actor, revision, now);
    return;
  }
  if (command2.op === "archive") {
    const item = findItem(document, command2.collection, command2.id);
    archiveItem(item, actor, revision, now, command2.archiveReason);
    return;
  }
  if (command2.op === "restore") {
    const item = findItem(document, command2.collection, command2.id);
    restoreItem(item, actor, revision, now);
    return;
  }
  if (command2.op === "delete") {
    const item = getList(document, command2.collection).find((entry) => entry.id === command2.id);
    if (!item) return;
    archiveItem(item, actor, revision, now);
    return;
  }
  if (command2.op === "set_view" || command2.op === "set_ui") {
    const key = command2.op === "set_view" ? "view" : "ui";
    document[key] = { ...document[key], ...cleanRecord(command2.patch, key) };
    return;
  }
  if (command2.op === "set_meta") {
    const patch = cleanRecord(command2.patch, "meta");
    assertName(patch.name);
    document.name = String(patch.name).trim().slice(0, MAX_NAME);
    document.updatedAt = now;
    return;
  }
  if (command2.op === "deliver_annotations") {
    for (const id of command2.ids) {
      const ann = findItem(document, "anns", id);
      if (ann.attention === "new") ann.attention = "delivered";
      const deliveries = Array.isArray(ann.deliveries) ? ann.deliveries : [];
      if (!deliveries.some((entry) => isObject(entry) && entry.deliveryId === command2.deliveryId)) deliveries.push({ deliveryId: command2.deliveryId, sessionId: command2.deliveryId, deliveredAt: now });
      ann.deliveries = deliveries;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command2.op === "ack_annotations") {
    if (!actor.startsWith("agent:")) throw mapError("AGENT_REQUIRED", 403, "\u53EA\u6709 Agent \u4F1A\u8BDD\u53EF\u4EE5\u786E\u8BA4\u8BFB\u53D6");
    for (const id of command2.ids) if (!command2.summary.includes(id)) throw mapError("ACK_MISSING_ID", 422, `\u6458\u8981\u6CA1\u6709\u5F15\u7528\u6807\u6CE8 ${id}`);
    for (const id of command2.ids) {
      const ann = findItem(document, "anns", id);
      ann.attention = "acknowledged";
      const records = Array.isArray(ann.acknowledgements) ? ann.acknowledgements : [];
      records.push({ actor, sessionId: actor, acknowledgedAt: now, summary: command2.summary });
      ann.acknowledgements = records;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command2.op === "resolve_annotations") {
    for (const id of command2.ids) {
      const ann = findItem(document, "anns", id);
      if (actor === "human") ann.attention = "resolved";
      else ann.resolutionProposal = { actor, evidence: command2.evidence ?? "", proposedAt: now };
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command2.op === "suggest_milestone") {
    throw mapError("FEATURE_RETIRED", 410, "\u91CC\u7A0B\u7891\u529F\u80FD\u5DF2\u4E0B\u7EBF\uFF1B\u8BF7\u4F7F\u7528\u666E\u901A\u8282\u70B9\u3001\u95EE\u9898\u8282\u70B9\u548C\u8DEF\u7EBF\u8868\u8FBE\u9636\u6BB5\u5224\u65AD");
  }
  throw mapError("UNKNOWN_COMMAND", 400, `\u4E0D\u652F\u6301\u7684\u5730\u56FE\u547D\u4EE4\uFF1A${String(command2?.op ?? "")}`);
}
function applyMapCommand(document, command2, options = {}) {
  const validation = validateMapDocument(document);
  if (!validation.ok) throw mapError("INVALID_MAP", 422, "\u5F53\u524D\u5730\u56FE\u65E0\u6548", validation.errors);
  const next = clone2(document);
  const revision = options.revision ?? next.revision + 1;
  const now = utcNow(options.now);
  applyOne(next, command2, options.actor ?? "human", revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const result2 = validateMapDocument(next);
  if (!result2.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", result2.errors);
  if (command2.op === "delete") markLegacyTranslated(next);
  return next;
}
function applyCommandEnvelope(document, envelope2, options = {}) {
  if (!envelope2 || !Array.isArray(envelope2.commands) || envelope2.commands.length === 0 || envelope2.commands.length > 100) throw mapError("INVALID_ENVELOPE", 400, "commands \u5FC5\u987B\u5305\u542B 1\u2013100 \u6761\u547D\u4EE4");
  if (!ID2.test(envelope2.projectId) || !ID2.test(envelope2.commandId) || !ID2.test(envelope2.sessionId)) throw mapError("INVALID_ENVELOPE", 400, "projectId/commandId/sessionId \u65E0\u6548");
  if (!Number.isInteger(envelope2.baseRevision) || envelope2.baseRevision < 0) throw mapError("INVALID_ENVELOPE", 400, "baseRevision \u65E0\u6548");
  const agentInitialMap = isAgent(envelope2.actor) && (document.nodes.length === 0 || isObject(document.ui?.initialization) && document.ui.initialization.status === "in_progress");
  if (isAgent(envelope2.actor)) {
    const objectCommands = envelope2.commands.filter((command2) => ["create", "update", "archive", "restore", "delete"].includes(command2.op));
    const nodeCreates = envelope2.commands.filter((command2) => command2.op === "create" && command2.collection === "nodes");
    if (objectCommands.length > MAX_AGENT_OBJECTS_PER_ENVELOPE) throw mapError("AGENT_BATCH_LIMIT", 422, "Agent \u5355\u6B21\u6700\u591A\u4FEE\u6539 10 \u4E2A\u5BF9\u8C61\uFF0C\u8BF7\u5148\u5408\u5E76\u6216\u8BA9\u4EBA\u9009\u62E9", { maxObjects: MAX_AGENT_OBJECTS_PER_ENVELOPE, suggestion: "\u538B\u7F29\u6267\u884C\u788E\u7247\uFF0C\u4FDD\u7559\u9879\u76EE/\u8DEF\u7EBF\u7EA7\u7ED3\u8BBA" });
    if (nodeCreates.length > MAX_AGENT_NEW_NODES_PER_ENVELOPE) throw mapError("AGENT_NODE_LIMIT", 422, "Agent \u5355\u6B21\u6700\u591A\u65B0\u589E 5 \u4E2A\u6D3B\u8DC3\u8282\u70B9\uFF0C\u8BF7\u5148\u5408\u5E76\u6216\u5206\u9636\u6BB5\u63D0\u4EA4", { maxNodes: MAX_AGENT_NEW_NODES_PER_ENVELOPE, suggestion: "\u53EA\u4FDD\u7559\u76EE\u6807\u3001\u9636\u6BB5\u3001\u7ED3\u679C\u6216\u5BA1\u6838\u95E8" });
    const activeNodes = document.nodes.filter((node) => visibleNode(document, node)).length;
    if (activeNodes + nodeCreates.length >= MAX_ACTIVE_NODES && nodeCreates.length) throw mapError("AGENT_ACTIVE_NODE_LIMIT", 422, "\u6D3B\u8DC3\u8282\u70B9\u5C06\u8FBE\u5230 30 \u4E2A\uFF0CAgent \u5FC5\u987B\u5148\u6574\u7406\u3001\u5408\u5E76\u6216\u5F52\u6863", { maxActiveNodes: MAX_ACTIVE_NODES, suggestion: "\u8BF7\u8BA9\u4EBA\u9009\u62E9\u6574\u7406\u8DEF\u7EBF" });
    if (agentInitialMap && activeNodes + nodeCreates.length > MAX_INITIAL_MAP_NODES) throw mapError("AGENT_INITIAL_MAP_LIMIT", 422, "\u9996\u6B21\u521D\u59CB\u5316\u5730\u56FE\u6700\u591A\u4FDD\u7559 15 \u4E2A\u6D3B\u8DC3\u8282\u70B9\uFF0C\u8BF7\u538B\u7F29\u4E3A\u76EE\u6807\u3001\u9636\u6BB5\u3001\u8DEF\u7EBF\u548C\u5F85\u5224\u65AD\u4E8B\u9879", { maxInitialNodes: MAX_INITIAL_MAP_NODES, suggestion: "\u4E0D\u8981\u6309\u6587\u4EF6\u3001\u76EE\u5F55\u3001\u51FD\u6570\u6216\u804A\u5929\u8F6E\u6B21\u5EFA\u8282\u70B9" });
  }
  const revision = document.revision + 1;
  const now = utcNow(options.now);
  let next = clone2(document);
  if (agentInitialMap && !isObject(next.ui.initialization)) next.ui.initialization = { status: "in_progress", startedBy: envelope2.actor, startedAt: now };
  for (const command2 of envelope2.commands) applyOne(next, command2, envelope2.actor, revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const validation = validateMapDocument(next);
  if (!validation.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", validation.errors);
  if (envelope2.commands.some((command2) => command2.op === "delete")) markLegacyTranslated(next);
  return next;
}
function commandTouches(command2) {
  if (command2.op === "create" || command2.op === "delete" || command2.op === "archive" || command2.op === "restore") return [`${command2.collection}/${command2.op === "create" ? String(command2.value.id ?? "*") : command2.id}/*`];
  if (command2.op === "update") return Object.keys(command2.patch).map((key) => `${command2.collection}/${command2.id}/${key}`);
  if (command2.op === "set_view" || command2.op === "set_ui") return Object.keys(command2.patch).map((key) => `${command2.op === "set_view" ? "view" : "ui"}/${key}`);
  if (command2.op === "set_meta") return ["meta/name"];
  if ("ids" in command2) return command2.ids.map((id) => `anns/${id}/attention`);
  if (command2.op === "suggest_milestone") return [`nodes/${command2.nodeId}/milestoneSuggestion`];
  return ["*"];
}
function envelopeTouches(envelope2) {
  return [...new Set(envelope2.commands.flatMap(commandTouches))].sort();
}
function tokenize(text) {
  const normalized = text.toLowerCase().normalize("NFKC");
  const words = normalized.match(/[a-z0-9_:-]+/g) ?? [];
  const chinese = [...normalized.matchAll(/[\p{Script=Han}]+/gu)].flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.length < 2 ? chars : chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
  });
  return [.../* @__PURE__ */ new Set([...words, ...chinese])];
}
function objectText(item) {
  return [item.id, item.name, item.kind, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === "string").join(" ");
}
function ageScore(updatedAt, now) {
  if (typeof updatedAt !== "string") return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 864e5);
  return Math.max(0, 60 - Math.floor(days) * 5);
}
function hiddenState(item) {
  return item.archived === true || item.shelved === true;
}
function visibleRoute(document, routeId, includeHistory = false) {
  if (includeHistory || typeof routeId !== "string" || !routeId) return true;
  const route = document.routes.find((entry) => entry.id === routeId);
  return !route || !hiddenState(route);
}
function visibleNode(document, node, includeHistory = false) {
  return includeHistory || !hiddenState(node) && visibleRoute(document, node.route);
}
function visibleEdge(document, edge, includeHistory = false) {
  if (includeHistory) return true;
  if (hiddenState(edge) || !visibleRoute(document, edge.route)) return false;
  const nodeById = new Map(document.nodes.map((node) => [String(node.id), node]));
  const from = typeof edge.from === "string" ? nodeById.get(edge.from) : void 0;
  const to = typeof edge.to === "string" ? nodeById.get(edge.to) : void 0;
  return (!from || visibleNode(document, from)) && (!to || visibleNode(document, to));
}
function visibleAnnotation(document, ann, includeHistory = false) {
  if (includeHistory || hiddenState(ann)) return includeHistory || !hiddenState(ann);
  if (!visibleRoute(document, ann.route)) return false;
  const target = ann.target;
  if (!isObject(target)) return true;
  if (target.kind === "node") {
    const node = document.nodes.find((entry) => entry.id === target.id);
    return !node || visibleNode(document, node);
  }
  if (target.kind === "edge") {
    const edge = document.edges.find((entry) => entry.id === target.id);
    return !edge || visibleEdge(document, edge);
  }
  if (target.kind === "route") return visibleRoute(document, target.id);
  return true;
}
function hiddenMarkdownPaths(document) {
  const exact = /* @__PURE__ */ new Set();
  const prefixes = /* @__PURE__ */ new Set();
  const mapDir = documentMapDir(document).replace(/\\/g, "/").replace(/\/$/, "");
  const add = (value) => {
    if (typeof value !== "string" || !value.trim()) return;
    const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    exact.add(normalized);
    const index = normalized.lastIndexOf("/");
    if (normalized.endsWith("/index.md") && index > 0) prefixes.add(`${normalized.slice(0, index)}/`);
  };
  const hideOwner = (collection, item) => {
    const id = String(item.id);
    add(item.md);
    add(stableMarkdownPath(collection, id, mapDir));
    add(`${mapDir}/${collection === "nodes" ? "nodes" : "routes"}/${id}/index.md`);
    prefixes.add(`${mapDir}/${collection === "nodes" ? "nodes" : "routes"}/${id}/`.toLowerCase());
  };
  for (const route of document.routes) if (hiddenState(route)) {
    add(route.md);
    add(`${mapDir}/routes/${String(route.id)}/index.md`);
    prefixes.add(`${mapDir}/routes/${String(route.id)}/`.toLowerCase());
  }
  for (const node of document.nodes) if (!visibleNode(document, node)) hideOwner("nodes", node);
  for (const edge of document.edges) if (!visibleEdge(document, edge)) hideOwner("edges", edge);
  return { exact, prefixes: [...prefixes] };
}
function visibleMarkdown(document, docs, includeHistory = false) {
  if (includeHistory) return docs;
  const hidden2 = hiddenMarkdownPaths(document);
  return docs.filter((doc) => {
    const path = String(doc.path).replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
    return !hidden2.exact.has(path) && !hidden2.prefixes.some((prefix) => path.startsWith(prefix));
  });
}
function headingContent(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`^\\s*[-#]*\\s*${escaped}\\s*[:\uFF1A]?\\s*([\\s\\S]*?)(?=\\n\\s*[-#]+\\s|\\n\\s*[\\u4e00-\\u9fffA-Za-z][^\\n]{0,40}[:\uFF1A]\\s|$)`, "im"));
  return match?.[1]?.trim() ?? "";
}
function checkAttemptEvidence(document, markdown = []) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, "/"), String(item.text ?? "")]));
  const issues = [];
  for (const edge of document.edges) {
    const actor = String(edge.updatedBy ?? edge.createdBy ?? "");
    if (!actor.startsWith("agent:") || !["pending", "success", "failed"].includes(String(edge.status))) continue;
    const status = String(edge.status);
    const path = String(edge.md ?? stableMarkdownPath("edges", String(edge.id), documentMapDir(document))).replace(/\\/g, "/");
    const text = docs.get(path) ?? "";
    const required2 = status === "pending" ? ["\u5173\u952E\u8BC1\u636E", "\u4E0B\u4E00\u6B65"] : ["\u5173\u952E\u8BC1\u636E", "\u7ED3\u679C", "\u4E0B\u4E00\u6B65"];
    if (status === "failed") required2.push("\u5931\u8D25\u539F\u56E0");
    if (status === "success") required2.push("\u8BC4\u5206");
    const missing = required2.filter((heading) => !headingContent(text, heading));
    if (!text) missing.splice(0, missing.length, "Markdown \u6587\u4EF6");
    if (missing.length) issues.push({ edgeId: String(edge.id), status, path, missing, reason: `Agent \u65B9\u6848 ${String(edge.id)} \u7F3A\u5C11\uFF1A${missing.join("\u3001")}` });
  }
  return issues;
}
function bm25(query, docs) {
  if (query.length === 0 || docs.length === 0) return [];
  const tokenized = docs.map((doc) => tokenize(doc.text));
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, tokenized.length);
  return docs.map((doc, index) => {
    const tokens = tokenized[index];
    const counts = /* @__PURE__ */ new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    let score = 0;
    for (const term of query) {
      const frequency = counts.get(term) ?? 0;
      if (!frequency) continue;
      const present = tokenized.filter((entry) => entry.includes(term)).length;
      const idf = Math.log(1 + (docs.length - present + 0.5) / (present + 0.5));
      score += idf * (frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * tokens.length / Math.max(1, averageLength))));
    }
    return { doc, score };
  }).filter((entry) => entry.score > 0);
}
function retrieveContext(document, query, options = {}) {
  const normalizedQuery = typeof query === "string" ? query : "";
  const terms = tokenize(normalizedQuery);
  const queryLower = normalizedQuery.toLowerCase();
  const limit = Math.max(1, Math.min(12, Number.isInteger(options.limit) ? Number(options.limit) : 12));
  const now = new Date(options.now ?? Date.now());
  const all = COLLECTIONS.flatMap((kind) => document[kind].map((item) => ({ kind, item })));
  const includeHistory = options.includeHistory === true;
  const active = all.filter(({ item, kind }) => {
    if (includeHistory) return true;
    if (kind === "routes") return !hiddenState(item);
    if (kind === "nodes") return visibleNode(document, item);
    if (kind === "edges") return visibleEdge(document, item);
    return visibleAnnotation(document, item);
  });
  const seeds = /* @__PURE__ */ new Set();
  for (const { item } of active) {
    const id = String(item.id ?? "").toLowerCase();
    const name = String(item.name ?? "").toLowerCase();
    if (id && queryLower.includes(id) || name && queryLower.includes(name)) seeds.add(String(item.id));
  }
  if (typeof options.currentNodeId === "string" && active.some(({ item }) => String(item.id) === options.currentNodeId)) seeds.add(options.currentNodeId);
  const adjacency = /* @__PURE__ */ new Map();
  const connect = (a, b) => {
    if (!adjacency.has(a)) adjacency.set(a, /* @__PURE__ */ new Set());
    adjacency.get(a).add(b);
  };
  for (const edge of document.edges) {
    if (typeof edge.from !== "string") continue;
    const edgeId = String(edge.id);
    connect(edgeId, edge.from);
    connect(edge.from, edgeId);
    if (typeof edge.to === "string") {
      connect(edgeId, edge.to);
      connect(edge.to, edgeId);
      connect(edge.from, edge.to);
      connect(edge.to, edge.from);
    }
  }
  const oneHop = /* @__PURE__ */ new Set();
  for (const seed of seeds) for (const id of adjacency.get(seed) ?? []) oneHop.add(id);
  const twoHop = /* @__PURE__ */ new Set();
  for (const id of oneHop) for (const next of adjacency.get(id) ?? []) if (!seeds.has(next) && !oneHop.has(next)) twoHop.add(next);
  const seedRoutes = new Set(active.filter(({ item }) => seeds.has(String(item.id))).map(({ item }) => item.route).filter((v) => typeof v === "string"));
  const ranked = [];
  for (const { kind, item } of active) {
    const reasons = [];
    let score = 0;
    const id = String(item.id);
    const text = objectText(item).toLowerCase();
    if (seeds.has(id)) {
      score += 1e3;
      reasons.push(options.currentNodeId === id ? "\u5F53\u524D\u63A8\u8FDB\u8282\u70B9" : "\u95EE\u9898\u660E\u786E\u63D0\u5230\u8BE5\u5BF9\u8C61");
    }
    const tokenHits = terms.filter((term) => text.includes(term)).length;
    if (tokenHits) {
      score += Math.min(250, tokenHits * 50);
      reasons.push(`\u6587\u672C\u547D\u4E2D ${tokenHits} \u4E2A\u8BCD\u5143`);
    }
    if (kind === "anns" && (item.attention === "new" || item.attention === "delivered")) {
      score += 800;
      reasons.push("\u4EBA\u7C7B\u65B0\u6807\u6CE8\u5C1A\u672A\u786E\u8BA4");
    }
    if (kind === "anns" && isObject(item.target) && seeds.has(String(item.target.id))) {
      score += 800;
      reasons.push("\u6807\u6CE8\u5C5E\u4E8E\u660E\u786E\u76EE\u6807");
    }
    if (kind === "nodes" && normalizeNodeKind(item.kind ?? item.type) === "problem" && item.resolved !== true) {
      score += 700;
      reasons.push("\u672A\u89E3\u51B3\u95EE\u9898\u8282\u70B9");
    }
    if (oneHop.has(id)) {
      score += 300;
      reasons.push("\u660E\u786E\u76EE\u6807\u7684\u4E00\u8DF3\u90BB\u5C45");
    }
    if (typeof item.route === "string" && seedRoutes.has(item.route)) {
      score += 200;
      reasons.push("\u4E0E\u660E\u786E\u76EE\u6807\u5C5E\u4E8E\u540C\u4E00\u8DEF\u7EBF");
    }
    if (twoHop.has(id)) {
      score += 120;
      reasons.push("\u660E\u786E\u76EE\u6807\u7684\u4E24\u8DF3\u90BB\u5C45");
    }
    if (kind === "edges" && item.status === "pending") {
      score += 100;
      reasons.push("\u5F85\u9A8C\u8BC1\u65B9\u6848");
    }
    if (kind === "edges" && typeof item.score === "number") {
      score += item.score;
      reasons.push(`\u8D28\u91CF\u8BC4\u5206 ${item.score}`);
    }
    const recent = ageScore(item.updatedAt, now);
    if (recent) {
      score += recent;
      reasons.push(`\u6700\u8FD1\u4FEE\u6539 +${recent}`);
    }
    if (score > 0) {
      const relationPath = options.currentNodeId && id !== options.currentNodeId && (oneHop.has(id) || twoHop.has(id)) ? [options.currentNodeId, id] : seeds.has(id) ? [id] : [];
      ranked.push({ kind, id, score, reasons, source: typeof item.source === "string" ? item.source : typeof item.createdBy === "string" ? item.createdBy : kind, relationPath, value: clone2(item) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const markdownScores = bm25(terms, visibleMarkdown(document, options.markdown ?? [], includeHistory));
  const max = Math.max(0, ...markdownScores.map((entry) => entry.score));
  const markdown = markdownScores.map(({ doc, score }) => ({
    kind: "markdown",
    id: doc.path,
    path: doc.path,
    score: max ? Math.round(score / max * 300) : 0,
    reasons: ["Markdown BM25 \u547D\u4E2D"],
    source: "markdown",
    relationPath: [],
    snippet: doc.text.replace(/\s+/g, " ").slice(0, 320)
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, 6);
  return { objects: ranked.slice(0, limit), markdown };
}
function findExplorationAlternatives(document, currentNodeId = null, options = {}) {
  const limit = Math.max(1, Math.min(3, Number.isInteger(options.limit) ? Number(options.limit) : 3));
  const nodeById = new Map(document.nodes.map((node) => [String(node.id), node]));
  const routeById = new Map(document.routes.map((route) => [String(route.id), route]));
  const routeForNode = (nodeId) => {
    if (!nodeId) return null;
    const nodeRoute = nodeById.get(nodeId)?.route;
    if (typeof nodeRoute === "string") return nodeRoute;
    const sourceRoute = document.routes.find((route) => route.source === nodeId);
    return sourceRoute ? String(sourceRoute.id) : null;
  };
  const routeSource = (routeId) => {
    if (!routeId) return null;
    const source = routeById.get(routeId)?.source;
    return typeof source === "string" ? source : null;
  };
  const normalizeName = (value) => String(value ?? "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
  const resolveSourceNode = (edge) => {
    if (typeof edge.from === "string" && edge.from) return edge.from;
    const edgeRoute = typeof edge.route === "string" ? edge.route : null;
    return routeSource(edgeRoute);
  };
  const resolveRouteId = (edge, sourceNodeId) => {
    if (typeof edge.route === "string" && edge.route) return edge.route;
    return routeForNode(sourceNodeId);
  };
  const failedContexts = document.edges.filter((edge) => visibleEdge(document, edge) && edge.status === "failed").map((edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const sourceRouteId = routeForNode(sourceNodeId) ?? resolveRouteId(edge, sourceNodeId);
    const terms = tokenize(String(edge.name ?? ""));
    return { edge, sourceNodeId, sourceRouteId, terms, key: `${sourceNodeId ?? ""}:${normalizeName(edge.name)}` };
  });
  const requestedSource = typeof currentNodeId === "string" && currentNodeId ? currentNodeId : null;
  const requestedRoute = routeForNode(requestedSource);
  const relevantFailures = failedContexts.filter((failure2) => !requestedSource || failure2.sourceNodeId === requestedSource || failure2.sourceNodeId === null && failure2.sourceRouteId === requestedRoute);
  const sourceIds = /* @__PURE__ */ new Set([...requestedSource ? [requestedSource] : [], ...relevantFailures.flatMap((failure2) => failure2.sourceNodeId ? [failure2.sourceNodeId] : [])]);
  const sourceRouteIds = /* @__PURE__ */ new Set([...requestedRoute ? [requestedRoute] : [], ...relevantFailures.flatMap((failure2) => failure2.sourceRouteId ? [failure2.sourceRouteId] : [])]);
  const failedTerms = new Set(relevantFailures.flatMap((failure2) => failure2.terms));
  const failedKeys = new Set(relevantFailures.map((failure2) => failure2.key));
  const active = document.edges.filter((edge) => {
    return visibleEdge(document, edge) && ["pending", "success"].includes(String(edge.status));
  });
  const rank = (edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const candidateRouteId = resolveRouteId(edge, sourceNodeId);
    const terms = tokenize(String(edge.name ?? ""));
    const overlap = terms.filter((term) => failedTerms.has(term)).length;
    const sameSource = Boolean(sourceNodeId && sourceIds.has(sourceNodeId));
    const matchingFailure = relevantFailures.map((failure2) => ({ failure: failure2, overlap: terms.filter((term) => failure2.terms.includes(term)).length })).sort((a, b) => Number(b.failure.sourceNodeId === sourceNodeId) - Number(a.failure.sourceNodeId === sourceNodeId) || b.overlap - a.overlap || String(a.failure.edge.id).localeCompare(String(b.failure.edge.id)))[0]?.failure;
    const effectiveSourceNodeId = sourceNodeId ?? matchingFailure?.sourceNodeId ?? requestedSource ?? "";
    const sourceRouteId = matchingFailure?.sourceRouteId ?? routeForNode(effectiveSourceNodeId) ?? (sourceRouteIds.size === 1 ? [...sourceRouteIds][0] : null);
    const isCrossRoute = Boolean(candidateRouteId && sourceRouteId && candidateRouteId !== sourceRouteId);
    const isTried = String(edge.status) !== "pending";
    const candidateKey = `${effectiveSourceNodeId}:${normalizeName(edge.name)}`;
    if (String(edge.status) !== "success" && failedKeys.has(candidateKey)) return null;
    const reasons = [];
    if (sameSource) reasons.push("\u540C\u4E00\u6765\u6E90\u8282\u70B9\u7684\u66FF\u4EE3\u65B9\u6848");
    if (overlap) reasons.push(`\u4E0E\u5931\u8D25\u65B9\u5411\u5171\u4EAB ${overlap} \u4E2A\u5173\u952E\u8BCD`);
    if (isCrossRoute) reasons.push(`\u8DE8\u8DEF\u7EBF\u5019\u9009\uFF08\u6765\u6E90\u8DEF\u7EBF ${sourceRouteId ?? "\u672A\u77E5"}\uFF09`);
    if (edge.status === "success") reasons.push(isCrossRoute ? "\u5176\u4ED6\u8DEF\u7EBF\u5DF2\u6709\u6210\u529F\u8BC1\u636E" : "\u5DF2\u6709\u6210\u529F\u8BC1\u636E\uFF0C\u53EF\u590D\u7528");
    if (edge.status === "pending") reasons.push("\u5C1A\u672A\u9A8C\u8BC1\uFF0C\u53EF\u7EE7\u7EED\u5C1D\u8BD5");
    if (!reasons.length) return null;
    const quality = typeof edge.score === "number" ? edge.score : 0;
    const score = quality + (sameSource ? 400 : 0) + overlap * 80;
    const reason = isCrossRoute ? `${isTried ? "\u5DF2\u6709\u6210\u529F\u8BC1\u636E" : "\u5F85\u9A8C\u8BC1\u65B9\u5411"}\uFF1B\u8DE8\u8DEF\u7EBF${overlap ? "\u76F8\u4F3C" : "\u5206\u652F"}\u5019\u9009\uFF0C\u6765\u6E90\u8DEF\u7EBF ${sourceRouteId ?? "\u672A\u77E5"}` : `${isTried ? "\u5DF2\u6709\u6210\u529F\u8BC1\u636E" : "\u5F85\u9A8C\u8BC1\u65B9\u5411"}\uFF1B\u56DE\u5230\u6765\u6E90\u8282\u70B9 ${effectiveSourceNodeId || "\u672A\u77E5"} \u7684\u66FF\u4EE3\u65B9\u6848`;
    return {
      id: String(edge.id),
      sourceNodeId: effectiveSourceNodeId,
      routeId: candidateRouteId,
      isTried,
      isCrossRoute,
      sourceRouteId,
      reason,
      status: String(edge.status),
      score,
      reasons
    };
  };
  return active.map(rank).filter((item) => Boolean(item)).filter((item) => sourceIds.size > 0 ? item.sourceNodeId !== "" || item.reasons.some((reason) => reason.includes("\u5173\u952E\u8BCD")) : item.reasons.some((reason) => reason.includes("\u5173\u952E\u8BCD"))).sort((a, b) => Number(a.isCrossRoute) - Number(b.isCrossRoute) || Number(a.isTried) - Number(b.isTried) || b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
}
function buildProjectProjection(document, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const maxRoutes = Math.max(1, Math.min(12, Number.isInteger(options.maxRoutes) ? Number(options.maxRoutes) : 6));
  const maxCandidates = Math.max(1, Math.min(12, Number.isInteger(options.maxCandidates) ? Number(options.maxCandidates) : 6));
  const activeRoutes = document.routes.filter((route) => !hiddenState(route));
  const activeNodes = document.nodes.filter((node) => visibleNode(document, node));
  const activeEdges = document.edges.filter((edge) => visibleEdge(document, edge));
  const nodesByRoute = /* @__PURE__ */ new Map();
  for (const node of activeNodes) {
    const route = typeof node.route === "string" ? node.route : "";
    if (!nodesByRoute.has(route)) nodesByRoute.set(route, []);
    nodesByRoute.get(route).push(node);
  }
  const edgesByRoute = /* @__PURE__ */ new Map();
  for (const edge of activeEdges) {
    const route = typeof edge.route === "string" ? edge.route : "";
    if (!edgesByRoute.has(route)) edgesByRoute.set(route, []);
    edgesByRoute.get(route).push(edge);
  }
  const updatedTime = (item) => {
    const value = new Date(String(item.updatedAt ?? "")).getTime();
    return Number.isFinite(value) ? value : 0;
  };
  const routeScore = (route) => Math.max(updatedTime(route), ...(nodesByRoute.get(String(route.id)) ?? []).map(updatedTime));
  const sortedRoutes = [...activeRoutes].sort((a, b) => routeScore(b) - routeScore(a) || String(a.id).localeCompare(String(b.id)));
  const mainRoute = activeRoutes.find((route) => route.main === true) ?? sortedRoutes[0] ?? null;
  const nodeForRoute = (route) => {
    if (!route) return { node: null, source: "none" };
    const candidates = nodesByRoute.get(String(route.id)) ?? [];
    const stored = typeof route.currentNodeId === "string" ? candidates.find((node) => node.id === route.currentNodeId) : void 0;
    if (stored) return { node: stored, source: "stored" };
    const routeEdges = edgesByRoute.get(String(route.id)) ?? [];
    const hasOutgoing = new Set(routeEdges.map((edge) => String(edge.from)));
    const terminal = candidates.filter((node) => !hasOutgoing.has(String(node.id)));
    const inferred = [...terminal.length ? terminal : candidates].sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id)))[0] ?? null;
    return { node: inferred, source: inferred ? "inferred" : "none" };
  };
  const currentChoice = nodeForRoute(mainRoute);
  const currentNodeId = currentChoice.node ? String(currentChoice.node.id) : null;
  const currentRouteId = mainRoute ? String(mainRoute.id) : null;
  const pendingCandidates = activeEdges.filter((edge) => edge.status === "pending" && (!currentRouteId || edge.route === currentRouteId || edge.from === currentNodeId)).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0) || updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, maxCandidates).map((edge) => ({ id: String(edge.id), name: String(edge.name ?? edge.id), from: String(edge.from), to: edge.to === null || edge.to === void 0 ? null : String(edge.to), score: typeof edge.score === "number" ? edge.score : 0, routeId: typeof edge.route === "string" ? edge.route : null, reason: edge.from === currentNodeId ? "\u4ECE\u5F53\u524D\u8282\u70B9\u5EF6\u4F38\u7684\u5F85\u9A8C\u8BC1\u65B9\u6848" : "\u5F53\u524D\u4E3B\u8DEF\u7EBF\u7684\u5F85\u9A8C\u8BC1\u65B9\u6848" }));
  const recentOutcomes = activeEdges.filter((edge) => edge.status === "success" || edge.status === "failed").sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6).map((edge) => ({ id: String(edge.id), name: String(edge.name ?? edge.id), status: String(edge.status), score: typeof edge.score === "number" ? edge.score : null, routeId: typeof edge.route === "string" ? edge.route : null, updatedAt: String(edge.updatedAt ?? "") }));
  const staleDays = (item) => {
    const timestamp = updatedTime(item);
    return timestamp ? Math.max(0, (now.getTime() - timestamp) / 864e5) : 999;
  };
  const stalledRoutes = activeRoutes.filter((route) => staleDays(route) >= 7 || (nodesByRoute.get(String(route.id)) ?? []).length === 0).sort((a, b) => staleDays(b) - staleDays(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6).map((route) => ({ id: String(route.id), name: String(route.name ?? route.id), reason: (nodesByRoute.get(String(route.id)) ?? []).length === 0 ? "\u8DEF\u7EBF\u6682\u65E0\u8282\u70B9" : `\u5DF2 ${Math.floor(staleDays(route))} \u5929\u6CA1\u6709\u66F4\u65B0`, updatedAt: typeof route.updatedAt === "string" ? route.updatedAt : null }));
  const humanUpdates = document.anns.filter((ann) => visibleAnnotation(document, ann) && ann.source === "human" && ["new", "delivered"].includes(String(ann.attention))).sort((a, b) => (String(a.attention) === "new" ? -1 : 1) - (String(b.attention) === "new" ? -1 : 1) || updatedTime(b) - updatedTime(a)).slice(0, 6).map((ann) => ({ id: String(ann.id), text: String(ann.text ?? ""), attention: String(ann.attention), priority: String(ann.priority ?? "normal"), target: clone2(ann.target) }));
  const problems = activeNodes.filter((node) => normalizeNodeKind(node.kind ?? node.type) === "problem" && node.resolved !== true).sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 12).map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), kind: "problem", resolved: false, routeId: typeof node.route === "string" ? node.route : null, updatedAt: String(node.updatedAt ?? "") }));
  const milestones = [];
  return {
    totalGoal: String(document.goal ?? document.name ?? "\u672A\u547D\u540D\u5730\u56FE"),
    mainRoute: { id: mainRoute ? String(mainRoute.id) : null, name: mainRoute ? String(mainRoute.name ?? mainRoute.id) : "\u6682\u65E0\u4E3B\u8DEF\u7EBF", status: mainRoute ? String(mainRoute.status ?? "active") : "empty", currentNodeId },
    current: { nodeId: currentNodeId, nodeName: currentChoice.node ? String(currentChoice.node.name ?? currentChoice.node.id) : null, routeId: currentRouteId, source: currentChoice.source },
    activeRoutes: sortedRoutes.slice(0, maxRoutes).map((route) => ({ id: String(route.id), name: String(route.name ?? route.id), status: String(route.status ?? "active"), nodeCount: (nodesByRoute.get(String(route.id)) ?? []).length, edgeCount: (edgesByRoute.get(String(route.id)) ?? []).length, currentNodeId: typeof route.currentNodeId === "string" ? route.currentNodeId : null })),
    pendingCandidates,
    recentOutcomes,
    stalledRoutes,
    humanUpdates,
    problems,
    milestones
  };
}
function autonomyDecision(document, candidates) {
  const reasons = [];
  if (document.anns.some((ann) => visibleAnnotation(document, ann) && (ann.attention === "new" || ann.attention === "delivered"))) reasons.push("\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u7684\u4EBA\u7C7B\u6807\u6CE8");
  const projection = buildProjectProjection(document);
  const currentNodeId = projection.current.nodeId;
  const currentRouteId = projection.current.routeId ?? projection.mainRoute.id;
  const nodeRoute = new Map(document.nodes.map((node) => [String(node.id), typeof node.route === "string" ? node.route : null]));
  const candidateRoute = (candidate) => {
    const metadata = candidate;
    if (typeof metadata.routeId === "string") return metadata.routeId;
    const value = candidate.value;
    if (!value) return null;
    if (typeof value.route === "string") return value.route;
    if (candidate.kind === "edges" && typeof value.from === "string") return nodeRoute.get(value.from) ?? null;
    return null;
  };
  const usableCandidates = candidates.filter((candidate) => candidate.kind !== "markdown");
  const uniqueCandidateIds = new Set(usableCandidates.map((candidate) => String(candidate.id)));
  const directOrCurrent = usableCandidates.filter((candidate) => {
    const routeId = candidateRoute(candidate);
    const isOneHop = candidate.reasons.some((reason) => reason.includes("\u4E00\u8DF3"));
    const isCurrent = currentNodeId !== null && String(candidate.id) === currentNodeId;
    return isCurrent || isOneHop || currentRouteId !== null && routeId === currentRouteId;
  });
  const crossRoute = usableCandidates.filter((candidate) => {
    const metadata = candidate;
    if (metadata.isCrossRoute === true) return true;
    const routeId = candidateRoute(candidate);
    return Boolean(routeId && currentRouteId && routeId !== currentRouteId);
  });
  if (usableCandidates.length > 0 && currentRouteId && directOrCurrent.length === 0) reasons.push("\u5019\u9009\u4E0D\u5728\u5F53\u524D\u8DEF\u7EBF\u6216\u4E00\u8DF3\u8303\u56F4");
  if (crossRoute.length > 0) reasons.push("\u5B58\u5728\u9700\u8981\u4EBA\u5DE5\u786E\u8BA4\u7684\u8DE8\u8DEF\u7EBF\u5019\u9009");
  const majorNewDirection = crossRoute.some((candidate) => !candidate.reasons.some((reason) => reason.includes("\u4E00\u8DF3")));
  if (majorNewDirection) reasons.push("\u5B58\u5728\u91CD\u5927\u65B0\u65B9\u5411\uFF0C\u4E0D\u80FD\u81EA\u52A8\u6269\u5F20\u8DEF\u7EBF");
  const activeNodes = document.nodes.filter((node) => visibleNode(document, node)).length;
  if (activeNodes >= 20) reasons.push(`\u6D3B\u8DC3\u5BF9\u8C61\u6570\u91CF\u8FBE\u5230\u6574\u7406\u9608\u503C\uFF08${activeNodes} \u4E2A\u8282\u70B9\uFF09`);
  if (uniqueCandidateIds.size > 10) reasons.push(`\u5355\u6279\u5019\u9009\u5BF9\u8C61\u8D85\u8FC7 10 \u4E2A\uFF08${uniqueCandidateIds.size}\uFF09`);
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push("\u5019\u9009\u7F6E\u4FE1\u5EA6\u6216\u5019\u9009\u5206\u5DEE\u4E0D\u8DB3");
  return { auto: reasons.length === 0, reasons };
}
function normalizeForComparison(value) {
  return String(value ?? "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
function comparisonTokens(value) {
  const normalized = normalizeForComparison(value);
  if (!normalized) return /* @__PURE__ */ new Set();
  return new Set(tokenize(normalized));
}
function similarText(left, right) {
  const a = normalizeForComparison(left);
  const b = normalizeForComparison(right);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  if (a === b) return true;
  const leftTokens = comparisonTokens(a);
  const rightTokens = comparisonTokens(b);
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap > 0 && overlap / (leftTokens.size + rightTokens.size - overlap) >= 0.5;
}
function consolidationCounts(document) {
  const activeRoutes = document.routes.filter((route) => !hiddenState(route));
  const activeNodes = document.nodes.filter((node) => visibleNode(document, node));
  const activeEdges = document.edges.filter((edge) => visibleEdge(document, edge));
  return {
    routes: document.routes.length,
    nodes: document.nodes.length,
    edges: document.edges.length,
    activeNodes: activeNodes.length,
    activeEdges: activeEdges.length
  };
}
function sortedUnique(values) {
  return [...new Set([...values].map((value) => String(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function sourceFor(document, objectIds, markdownPaths = []) {
  const byId = /* @__PURE__ */ new Map();
  for (const collection of ["routes", "nodes", "edges"]) {
    for (const item of document[collection]) byId.set(String(item.id), item);
  }
  const objects = objectIds.map((id) => byId.get(String(id))).filter((item) => Boolean(item));
  const routeIds = objects.flatMap((item) => {
    if (typeof item.route === "string") return [item.route];
    if (typeof item.id === "string" && document.routes.some((route) => route.id === item.id)) return [item.id];
    return [];
  });
  const actors = objects.flatMap((item) => [item.createdBy, item.updatedBy]).filter((actor) => typeof actor === "string");
  const paths = objects.map((item) => typeof item.md === "string" ? item.md : "").filter(Boolean).concat(markdownPaths);
  return { objectIds: sortedUnique(objectIds), routeIds: sortedUnique(routeIds), actors: sortedUnique(actors), markdownPaths: sortedUnique(paths.map((path) => path.replace(/\\/g, "/"))) };
}
function decrementAfter(before, commands) {
  const after = { ...before };
  const archived = /* @__PURE__ */ new Set();
  for (const command2 of commands) {
    const isArchive = command2.op === "archive" || command2.op === "update" && command2.patch.archived === true;
    if (!isArchive) continue;
    const key = `${command2.collection}/${command2.id}`;
    if (archived.has(key)) continue;
    archived.add(key);
    if (command2.collection === "nodes") after.activeNodes = Math.max(0, after.activeNodes - 1);
    if (command2.collection === "edges") after.activeEdges = Math.max(0, after.activeEdges - 1);
  }
  return after;
}
function makeSuggestion(document, before, value) {
  const source = sourceFor(document, value.objectIds, value.markdownPaths ?? []);
  const afterKnown = value.afterKnown ?? value.mode === "human_only";
  return {
    ...value,
    source,
    before: { ...before },
    after: afterKnown ? decrementAfter(before, value.commands) : { ...before },
    afterKnown,
    commands: value.commands.map((command2) => structuredClone(command2))
  };
}
function activeForConsolidation(document) {
  const routes = document.routes.filter((route) => !hiddenState(route));
  const routeIds = new Set(routes.map((route) => String(route.id)));
  const nodes = document.nodes.filter((node) => visibleNode(document, node));
  const edges = document.edges.filter((edge) => visibleEdge(document, edge) && (!edge.route || routeIds.has(String(edge.route))));
  return { routes, nodes, edges };
}
function successfulChains(edges) {
  const successful = edges.filter((edge) => edge.status === "success" && typeof edge.from === "string" && typeof edge.to === "string").sort((a, b) => String(a.route ?? "").localeCompare(String(b.route ?? "")) || String(a.from).localeCompare(String(b.from)) || String(a.to).localeCompare(String(b.to)) || String(a.id).localeCompare(String(b.id)));
  const byFrom = /* @__PURE__ */ new Map();
  for (const edge of successful) {
    const key = `${String(edge.route ?? "")}:${String(edge.from)}`;
    const list = byFrom.get(key) ?? [];
    list.push(edge);
    byFrom.set(key, list);
  }
  const incoming = new Set(successful.map((edge) => `${String(edge.route ?? "")}:${String(edge.to)}`));
  const starts = successful.filter((edge) => !incoming.has(`${String(edge.route ?? "")}:${String(edge.from)}`));
  const chains = [];
  const visited = /* @__PURE__ */ new Set();
  const walk = (start) => {
    const chain = [];
    let current = start;
    while (current && !visited.has(String(current.id))) {
      visited.add(String(current.id));
      chain.push(current);
      const nextEdges = byFrom.get(`${String(current.route ?? "")}:${String(current.to)}`) ?? [];
      current = nextEdges.length === 1 ? nextEdges[0] : void 0;
    }
    if (chain.length >= 2) chains.push(chain);
  };
  for (const start of starts) walk(start);
  for (const edge of successful) if (!visited.has(String(edge.id))) walk(edge);
  return chains;
}
function planConsolidation(document, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const maxSuggestions = Math.max(1, Math.min(20, Number.isInteger(options.maxSuggestions) ? Number(options.maxSuggestions) : 12));
  const active = activeForConsolidation(document);
  const before = consolidationCounts(document);
  const trigger = [];
  if (before.activeNodes >= 20) trigger.push(`\u6D3B\u8DC3\u8282\u70B9\u8FBE\u5230 ${before.activeNodes} \u4E2A`);
  if (before.activeEdges >= 20) trigger.push(`\u6D3B\u8DC3\u65B9\u6848\u8FBE\u5230 ${before.activeEdges} \u6761`);
  const suggestions = [];
  const ageDays = (value) => {
    const time = new Date(String(value ?? "")).getTime();
    return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 864e5) : 0;
  };
  const add = (value) => {
    if (suggestions.length < maxSuggestions) suggestions.push(makeSuggestion(document, before, value));
  };
  for (const edge of active.edges) {
    if (edge.status !== "failed") continue;
    const age = ageDays(edge.updatedAt);
    const score = typeof edge.score === "number" ? edge.score : 0;
    if (age < 7 && score >= 50) continue;
    trigger.push("\u5B58\u5728\u957F\u671F\u672A\u66F4\u65B0\u6216\u4F4E\u5206\u5931\u8D25\u65B9\u6848");
    add({
      id: `archive-${edge.id}`,
      kind: "archive_edge",
      mode: "human_only",
      applyable: true,
      title: `\u5F52\u6863\u5931\u8D25\u65B9\u6848\uFF1A${String(edge.name ?? edge.id)}`,
      reason: `\u8BE5\u65B9\u6848\u5DF2\u5931\u8D25\uFF0C${Math.floor(age)} \u5929\u672A\u66F4\u65B0\uFF0C\u5F53\u524D\u8BC4\u5206 ${score}\uFF1B\u5F52\u6863\u53EA\u5F31\u5316\u663E\u793A\uFF0C\u4E0D\u5220\u9664\u5386\u53F2 Markdown\u3002`,
      objectIds: [String(edge.id)],
      commands: [{ op: "update", collection: "edges", id: String(edge.id), humanOnly: true, patch: { archived: true } }]
    });
  }
  const seenFailures = /* @__PURE__ */ new Map();
  for (const edge of active.edges) {
    if (edge.status !== "failed") continue;
    const key = `${String(edge.from)}:${normalizeForComparison(edge.name)}`;
    const prior = seenFailures.get(key);
    if (!prior) {
      seenFailures.set(key, edge);
      continue;
    }
    const candidate = ageDays(edge.updatedAt) >= ageDays(prior.updatedAt) ? edge : prior;
    const other = candidate === edge ? prior : edge;
    trigger.push("\u53D1\u73B0\u540C\u4E00\u6765\u6E90\u7684\u91CD\u590D\u5931\u8D25\u65B9\u5411");
    add({
      id: `duplicate-${candidate.id}`,
      kind: "archive_edge",
      mode: "human_only",
      applyable: true,
      title: `\u6574\u7406\u91CD\u590D\u5931\u8D25\u65B9\u5411\uFF1A${String(candidate.name ?? candidate.id)}`,
      reason: `\u4E0E\u65B9\u6848 ${String(other.id)} \u6765\u6E90\u76F8\u540C\u4E14\u540D\u79F0\u76F8\u8FD1\uFF1B\u4FDD\u7559\u8F83\u65B0\u7684\u8BB0\u5F55\uFF0C\u5F52\u6863\u91CD\u590D\u65B9\u5411\u3002`,
      objectIds: [String(candidate.id), String(other.id)],
      commands: [{ op: "update", collection: "edges", id: String(candidate.id), humanOnly: true, patch: { archived: true } }]
    });
  }
  const nodesByRoute = /* @__PURE__ */ new Map();
  for (const node of active.nodes) {
    const key = String(node.route ?? "");
    const list = nodesByRoute.get(key) ?? [];
    list.push(node);
    nodesByRoute.set(key, list);
  }
  for (const [routeId, nodes] of [...nodesByRoute.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const consumed = /* @__PURE__ */ new Set();
    for (let index = 0; index < sorted.length; index += 1) {
      const canonical = sorted[index];
      if (consumed.has(String(canonical.id))) continue;
      for (let nextIndex = index + 1; nextIndex < sorted.length; nextIndex += 1) {
        const duplicate = sorted[nextIndex];
        if (consumed.has(String(duplicate.id)) || !similarText(canonical.name, duplicate.name)) continue;
        trigger.push("\u540C\u4E00\u8DEF\u7EBF\u5B58\u5728\u540D\u79F0\u8FD1\u4E49\u8282\u70B9");
        add({
          id: `merge-nodes-${canonical.id}-${duplicate.id}`,
          kind: "merge_nodes",
          mode: "preview_only",
          applyable: false,
          title: `\u9884\u89C8\u5408\u5E76\u8FD1\u4E49\u8282\u70B9\uFF1A${String(canonical.name ?? canonical.id)}`,
          reason: `\u8DEF\u7EBF ${routeId || "\u672A\u5206\u914D"} \u4E2D\u8282\u70B9\u540D\u79F0\u76F8\u4F3C\uFF1B\u5408\u5E76\u9700\u8981\u540C\u65F6\u91CD\u8FDE\u65B9\u6848\u3001\u6807\u6CE8\u548C Markdown \u5F15\u7528\uFF0C\u5F53\u524D\u53EA\u63D0\u4F9B\u9884\u89C8\uFF0C\u4E0D\u81EA\u52A8\u6539\u5199\u3002`,
          objectIds: [String(canonical.id), String(duplicate.id)],
          commands: []
        });
        consumed.add(String(duplicate.id));
        break;
      }
    }
  }
  for (const chain of successfulChains(active.edges)) {
    const ids = chain.map((edge) => String(edge.id));
    trigger.push("\u5B58\u5728\u8FDE\u7EED\u6210\u529F\u6B65\u9AA4\uFF0C\u53EF\u538B\u7F29\u4E3A\u9636\u6BB5\u7ED3\u8BBA");
    add({
      id: `compress-success-${ids[0]}`,
      kind: "compress_success_chain",
      mode: "preview_only",
      applyable: false,
      title: `\u9884\u89C8\u538B\u7F29\u8FDE\u7EED\u6210\u529F\u6B65\u9AA4\uFF1A${ids.join(" \u2192 ")}`,
      reason: `\u540C\u4E00\u8DEF\u7EBF\u8FDE\u7EED ${chain.length} \u6B65\u6210\u529F\uFF1B\u9700\u8981\u4EBA\u786E\u8BA4\u9636\u6BB5\u7ED3\u8BBA\u5E76\u4FDD\u7559\u6BCF\u6761\u8BC1\u636E\uFF0C\u5F53\u524D\u547D\u4EE4\u6A21\u578B\u4E0D\u80FD\u5B89\u5168\u5220\u9664\u6216\u6539\u5199\u539F\u6B65\u9AA4\u3002`,
      objectIds: ids,
      commands: []
    });
  }
  const nodesById = new Map(active.nodes.map((node) => [String(node.id), node]));
  const reconnectSeen = /* @__PURE__ */ new Set();
  const pendingEdges = active.edges.filter((edge) => ["pending"].includes(String(edge.status)) && typeof edge.from === "string" && typeof edge.to === "string");
  for (let index = 0; index < pendingEdges.length; index += 1) {
    const left = pendingEdges[index];
    const leftTarget = nodesById.get(String(left.to));
    if (!leftTarget) continue;
    for (let otherIndex = index + 1; otherIndex < pendingEdges.length; otherIndex += 1) {
      const right = pendingEdges[otherIndex];
      if (String(left.from) !== String(right.from) || String(left.route ?? "") !== String(right.route ?? "") || String(left.to) === String(right.to)) continue;
      const rightTarget = nodesById.get(String(right.to));
      if (!rightTarget || !similarText(leftTarget.name, rightTarget.name)) continue;
      const canonical = String(leftTarget.id).localeCompare(String(rightTarget.id)) <= 0 ? leftTarget : rightTarget;
      const duplicateEdge = canonical.id === leftTarget.id ? right : left;
      if (reconnectSeen.has(String(duplicateEdge.id))) continue;
      reconnectSeen.add(String(duplicateEdge.id));
      trigger.push("\u53D1\u73B0\u91CD\u590D\u5206\u652F\uFF0C\u53EF\u91CD\u8FDE\u5230\u540C\u4E00\u7ED3\u679C\u8282\u70B9");
      add({
        id: `reconnect-${duplicateEdge.id}-${canonical.id}`,
        kind: "reconnect_duplicate_branch",
        mode: "human_only",
        applyable: true,
        title: `\u91CD\u8FDE\u91CD\u590D\u5206\u652F\u5230\uFF1A${String(canonical.name ?? canonical.id)}`,
        reason: `\u6765\u81EA\u540C\u4E00\u8282\u70B9\u7684\u4E24\u4E2A\u5F85\u9A8C\u8BC1\u5206\u652F\u6307\u5411\u540D\u79F0\u8FD1\u4E49\u7ED3\u679C\uFF1B\u4EC5\u5728\u4EBA\u786E\u8BA4\u540E\u628A ${String(duplicateEdge.id)} \u91CD\u8FDE\u5230 ${String(canonical.id)}\uFF0C\u4E0D\u4F1A\u5220\u9664\u539F\u8282\u70B9\u6216 Markdown\u3002`,
        objectIds: [String(left.from), String(left.id), String(right.id), String(leftTarget.id), String(rightTarget.id)],
        commands: [{ op: "update", collection: "edges", id: String(duplicateEdge.id), humanOnly: true, patch: { to: String(canonical.id) } }]
      });
    }
  }
  const markdownThreshold = 4e3;
  for (const markdown of [...options.markdown ?? []].sort((a, b) => String(a.path).localeCompare(String(b.path)))) {
    const text = String(markdown.text ?? "");
    if (text.length <= markdownThreshold) continue;
    const path = String(markdown.path).replace(/\\/g, "/");
    const owner2 = [...document.nodes, ...document.edges].find((item) => String(item.md ?? "").replace(/\\/g, "/") === path);
    const objectIds = owner2 ? [String(owner2.id)] : [];
    trigger.push("\u5B58\u5728\u8FC7\u957F Markdown \u6458\u8981\u5019\u9009");
    add({
      id: `summarize-markdown-${fnv1a(path)}`,
      kind: "summarize_markdown",
      mode: "preview_only",
      applyable: false,
      title: `\u9884\u89C8\u751F\u6210 Markdown \u6458\u8981\uFF1A${path}`,
      reason: `\u539F\u6587 ${text.length} \u5B57\u7B26\uFF0C\u8D85\u8FC7 ${markdownThreshold} \u5B57\u7B26\u5EFA\u8BAE\u9608\u503C\uFF1B\u53EA\u751F\u6210\u6458\u8981\u9884\u89C8\uFF0C\u539F\u6587\u5FC5\u987B\u4FDD\u7559\uFF0C\u5F53\u524D\u4E0D\u63D0\u4EA4\u5199\u5165\u547D\u4EE4\u3002`,
      objectIds,
      markdownPaths: [path],
      commands: []
    });
  }
  const kindOrder = {
    archive_edge: 1,
    archive_route: 2,
    reconnect_duplicate_branch: 3,
    merge_nodes: 4,
    compress_success_chain: 5,
    summarize_markdown: 6
  };
  const ordered = suggestions.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id)).slice(0, maxSuggestions);
  let after = { ...before };
  for (const suggestion of ordered) if (suggestion.afterKnown) after = decrementAfter(after, suggestion.commands);
  return {
    revision: document.revision,
    counts: { ...before },
    before: { ...before },
    after,
    trigger: [...new Set(trigger)],
    suggestions: ordered
  };
}
var MAP_VERSION, COLLECTIONS, ID2, ISO_MS, DANGEROUS_KEYS, MAX_NAME, MAX_ANN, MAX_AGENT_OBJECTS_PER_ENVELOPE, MAX_AGENT_NEW_NODES_PER_ENVELOPE, MAX_ACTIVE_NODES, MAX_INITIAL_MAP_NODES;
var init_shared = __esm({
  "src/shared/index.mjs"() {
    "use strict";
    MAP_VERSION = 2;
    COLLECTIONS = ["routes", "nodes", "edges", "anns"];
    ID2 = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
    ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
    MAX_NAME = 80;
    MAX_ANN = 4e3;
    MAX_AGENT_OBJECTS_PER_ENVELOPE = 10;
    MAX_AGENT_NEW_NODES_PER_ENVELOPE = 5;
    MAX_ACTIVE_NODES = 30;
    MAX_INITIAL_MAP_NODES = 15;
  }
});

// src/cli/livedot.ts
var import_node_crypto16 = require("node:crypto");
var import_promises18 = require("node:fs/promises");
var import_node_fs3 = require("node:fs");
var import_node_path22 = require("node:path");
var import_node_readline = require("node:readline");
var import_node_sea = require("node:sea");

// src/bridge/errors.mjs
var BridgeError = class extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, { cause });
    this.name = "BridgeError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
};
function asBridgeError(error3) {
  if (error3 instanceof BridgeError) return error3;
  return new BridgeError("INTERNAL_ERROR", "Local bridge request failed", {
    cause: error3
  });
}

// src/bridge/project-store.mjs
var import_node_crypto2 = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_path3 = require("node:path");
var import_node_path4 = require("node:path");

// src/bridge/fs-utils.mjs
var import_node_crypto = require("node:crypto");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
function checksum(value) {
  return (0, import_node_crypto.createHash)("sha256").update(stableJson(value)).digest("hex");
}
function cloneJson(value) {
  return structuredClone(value);
}
var MAX_JSON_BYTES = 64 * 1024 * 1024;
async function exists(path) {
  try {
    await (0, import_promises.stat)(path);
    return true;
  } catch (error3) {
    if (error3?.code === "ENOENT") return false;
    throw error3;
  }
}
async function ensureDirectory(path) {
  await (0, import_promises.mkdir)(path, { recursive: true });
}
async function canonicalDirectory(path) {
  return (0, import_promises.realpath)(path);
}
async function syncDirectory(path) {
  let handle;
  try {
    handle = await (0, import_promises.open)(path, "r");
    await handle.sync();
  } catch (error3) {
    if (!["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"].includes(error3?.code)) throw error3;
  } finally {
    await handle?.close();
  }
}
async function atomicWriteFile(path, data, { mode = 384 } = {}) {
  await ensureDirectory((0, import_node_path.dirname)(path));
  const temporary = (0, import_node_path.join)((0, import_node_path.dirname)(path), `.${(0, import_node_crypto.randomBytes)(12).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await (0, import_promises.open)(temporary, "wx", mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = void 0;
    await (0, import_promises.rename)(temporary, path);
    await syncDirectory((0, import_node_path.dirname)(path));
  } catch (error3) {
    await handle?.close().catch(() => {
    });
    await (0, import_promises.unlink)(temporary).catch(() => {
    });
    throw error3;
  }
}
async function appendDurable(path, line) {
  await ensureDirectory((0, import_node_path.dirname)(path));
  const handle = await (0, import_promises.open)(path, "a", 384);
  try {
    await handle.writeFile(`${line}
`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function lockOwnerIsGone(path, staleMs) {
  try {
    const [metadata, content] = await Promise.all([(0, import_promises.stat)(path), (0, import_promises.readFile)(path, "utf8")]);
    try {
      const owner2 = JSON.parse(content);
      if (Number.isSafeInteger(owner2.pid) && owner2.pid > 0) {
        try {
          process.kill(owner2.pid, 0);
          return false;
        } catch (error3) {
          return error3?.code === "ESRCH";
        }
      }
    } catch {
    }
    return Date.now() - metadata.mtimeMs > staleMs;
  } catch (error3) {
    if (error3?.code === "ENOENT") return false;
    return true;
  }
}
async function withFileLock(path, operation, { timeoutMs = 5e3, staleMs = 3e4 } = {}) {
  await ensureDirectory((0, import_node_path.dirname)(path));
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await (0, import_promises.open)(path, "wx", 384);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: (/* @__PURE__ */ new Date()).toISOString() }));
      await handle.sync();
    } catch (error3) {
      if (error3?.code !== "EEXIST") {
        await handle?.close().catch(() => {
        });
        handle = void 0;
        await (0, import_promises.unlink)(path).catch(() => {
        });
        throw error3;
      }
      if (await lockOwnerIsGone(path, staleMs)) {
        await (0, import_promises.unlink)(path).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) {
        const timeout = new Error("Timed out waiting for the project write lock");
        timeout.code = "LOCK_TIMEOUT";
        throw timeout;
      }
      await new Promise((resolve16) => setTimeout(resolve16, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {
    });
    await (0, import_promises.unlink)(path).catch((error3) => {
      if (error3?.code !== "ENOENT") throw error3;
    });
  }
}
async function readJson(path, { maxBytes = MAX_JSON_BYTES } = {}) {
  const metadata = await (0, import_promises.stat)(path);
  if (metadata.size > maxBytes) {
    const error3 = new RangeError(`JSON file exceeds ${maxBytes} bytes`);
    error3.code = "FILE_TOO_LARGE";
    error3.details = { path, size: metadata.size, limit: maxBytes };
    throw error3;
  }
  return JSON.parse(await (0, import_promises.readFile)(path, "utf8"));
}
async function writeJsonAtomic(path, value) {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}
`);
}
async function quarantineCopy(source, quarantineDirectory, label, content) {
  await ensureDirectory(quarantineDirectory);
  const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const target = (0, import_node_path.join)(
    quarantineDirectory,
    `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${(0, import_node_crypto.randomBytes)(4).toString("hex")}-${safeLabel}`
  );
  if (content === void 0) await (0, import_promises.copyFile)(source, target);
  else await (0, import_promises.writeFile)(target, content, { mode: 384 });
  return target;
}

// src/bridge/maps.mjs
var import_promises2 = require("node:fs/promises");
var import_node_path2 = require("node:path");
var DATA_DIRECTORY = ".live-dot-map";
var MAPS_DIRECTORY = "maps";
var ACTIVE_MAP_FILE = "active-map";
var LEGACY_NODES_PREFIX = ".live-dot-map/nodes/";
var LEGACY_ROUTES_PREFIX = ".live-dot-map/routes/";
var MAP_ID = /^[a-z0-9][a-z0-9-_]{0,63}$/;
var BUNDLE_OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
var BUNDLE_LAYOUT_VERSION = 1;
function isSafeMapId(id) {
  return typeof id === "string" && MAP_ID.test(id);
}
function mapsRoot(projectRoot) {
  return (0, import_node_path2.join)(projectRoot, DATA_DIRECTORY, MAPS_DIRECTORY);
}
function mapDirectory(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400, details: { mapId } });
  }
  return (0, import_node_path2.join)(mapsRoot(projectRoot), mapId);
}
function mapRelativeDirectory(mapId) {
  return `${DATA_DIRECTORY}/${MAPS_DIRECTORY}/${mapId}`;
}
async function readActiveMap(projectRoot) {
  try {
    const value = (await (0, import_promises2.readFile)((0, import_node_path2.join)(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), "utf8")).trim();
    return isSafeMapId(value) ? value : null;
  } catch (error3) {
    if (error3?.code === "ENOENT") return null;
    throw error3;
  }
}
async function resolveActiveMap(projectRoot) {
  return await readActiveMap(projectRoot) ?? "default";
}
async function writeActiveMap(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400, details: { mapId } });
  }
  await atomicWriteFile((0, import_node_path2.join)(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), `${mapId}
`);
}
function slugifyMapName(name, now = () => /* @__PURE__ */ new Date()) {
  const base = String(name ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9-_]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 64);
  const candidate = base.replace(/^[^a-z0-9]+/, "");
  if (candidate && MAP_ID.test(candidate)) return candidate;
  return `map-${now().getTime().toString(36)}`;
}
async function listMapIds(projectRoot) {
  const entries = await (0, import_promises2.readdir)(mapsRoot(projectRoot), { withFileTypes: true }).catch((error3) => {
    if (error3?.code === "ENOENT") return [];
    throw error3;
  });
  return entries.filter((entry) => entry.isDirectory() && isSafeMapId(entry.name)).map((entry) => entry.name).sort();
}
async function listMaps(projectRoot) {
  const active = await resolveActiveMap(projectRoot);
  const ids = await listMapIds(projectRoot);
  const maps = [];
  for (const id of ids) {
    const document = await readJson((0, import_node_path2.join)(mapsRoot(projectRoot), id, "map.json")).catch(() => null);
    maps.push({
      id,
      name: typeof document?.name === "string" && document.name ? document.name : id,
      updatedAt: typeof document?.updatedAt === "string" ? document.updatedAt : null,
      active: id === active
    });
  }
  return { activeMap: active, maps };
}
async function createMap(projectRoot, name, { now = () => /* @__PURE__ */ new Date() } = {}) {
  const displayName = String(name ?? "").trim().slice(0, 80) || "\u672A\u547D\u540D\u5730\u56FE";
  const base = slugifyMapName(displayName, now);
  await ensureDirectory(mapsRoot(projectRoot));
  for (let suffix = 1; suffix < 1e5; suffix += 1) {
    const id = suffix === 1 ? base : `${base}-${suffix}`;
    try {
      await (0, import_promises2.mkdir)(mapDirectory(projectRoot, id));
      return { id, name: displayName };
    } catch (error3) {
      if (error3?.code !== "EEXIST") throw error3;
    }
  }
  throw new BridgeError("MAP_ID_EXHAUSTED", "\u540C\u540D\u5730\u56FE\u6570\u91CF\u8FC7\u591A\uFF0C\u65E0\u6CD5\u5206\u914D\u5B89\u5168 ID", { status: 409 });
}
function rewriteMarkdownPaths(document, mapDir) {
  for (const list of [document?.nodes, document?.edges]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.md !== "string") continue;
      if (item.md.startsWith(LEGACY_NODES_PREFIX)) item.md = `${mapDir}/nodes/${item.md.slice(LEGACY_NODES_PREFIX.length)}`;
      else if (item.md.startsWith(LEGACY_ROUTES_PREFIX)) item.md = `${mapDir}/routes/${item.md.slice(LEGACY_ROUTES_PREFIX.length)}`;
    }
  }
  if (typeof document.mapDir !== "string") document.mapDir = mapDir;
  return document;
}
function rewriteBundlePaths(document, mapDir) {
  let changed = false;
  for (const [list, kind] of [
    [document?.nodes, "nodes"],
    [document?.edges, "routes"],
    [document?.routes, "routes"]
  ]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item.id !== "string" || typeof item.md !== "string") continue;
      const current = item.md.replace(/\\/g, "/");
      const finalPath = `${mapDir}/${kind}/${item.id}/index.md`;
      const ownedLegacyPaths = /* @__PURE__ */ new Set([
        `.live-dot-map/${kind}/${item.id}.md`,
        `.live-dot-map/${kind}/${item.id}/index.md`,
        `${mapDir}/${kind}/${item.id}.md`,
        finalPath
      ]);
      if (ownedLegacyPaths.has(current) && item.md !== finalPath) {
        item.md = finalPath;
        changed = true;
      }
    }
  }
  if (document.mapDir !== mapDir) {
    document.mapDir = mapDir;
    changed = true;
  }
  if (document.bundleLayoutVersion !== BUNDLE_LAYOUT_VERSION) {
    document.bundleLayoutVersion = BUNDLE_LAYOUT_VERSION;
    changed = true;
  }
  return changed;
}
function stampBundleMigrationRevision(document) {
  document.revision = (Number.isSafeInteger(document.revision) ? document.revision : 0) + 1;
}
async function ensureBundleLayout(projectRoot, mapId) {
  const root = mapDirectory(projectRoot, mapId);
  const mapPath = (0, import_node_path2.join)(root, "map.json");
  if (!await exists(mapPath)) return { migrated: false, mapId };
  const lockPath = (0, import_node_path2.join)(root, ".bridge", "write.lock");
  try {
    return await withFileLock(lockPath, () => ensureBundleLayoutLocked(projectRoot, mapId, root, mapPath));
  } catch (error3) {
    if (error3?.code === "LOCK_TIMEOUT") return { migrated: false, mapId, deferred: true };
    throw error3;
  }
}
async function ensureBundleLayoutLocked(projectRoot, mapId, root, mapPath) {
  let document;
  try {
    document = await readJson(mapPath);
  } catch (error3) {
    if (error3 instanceof BridgeError) throw error3;
    throw new BridgeError("CORRUPT_MAP", "map.json \u65E0\u6CD5\u89E3\u6790\uFF0C\u8D44\u6599\u5305\u8FC1\u79FB\u672A\u6267\u884C", {
      status: 409,
      cause: error3,
      details: { mapId, causeMessage: String(error3?.message || error3) }
    });
  }
  if (Number(document.bundleLayoutVersion) > BUNDLE_LAYOUT_VERSION) {
    throw new BridgeError("FUTURE_BUNDLE_LAYOUT", "\u8D44\u6599\u5305\u5E03\u5C40\u7248\u672C\u9AD8\u4E8E\u5F53\u524D\u7A0B\u5E8F\uFF0C\u53EA\u80FD\u53EA\u8BFB", { status: 409 });
  }
  const planned = [];
  for (const kind of ["nodes", "routes"]) {
    const directory = (0, import_node_path2.join)(root, kind);
    await rejectSymlink(directory);
    const entries = await (0, import_promises2.readdir)(directory, { withFileTypes: true }).catch((error3) => error3?.code === "ENOENT" ? [] : (() => {
      throw error3;
    })());
    for (const entry of entries) {
      if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
      const ownerId = entry.name.slice(0, -3);
      if (!BUNDLE_OWNER_ID.test(ownerId)) throw new BridgeError("BUNDLE_OWNER_INVALID", `\u65E7\u8D44\u6599\u6587\u4EF6\u540D\u4E0D\u80FD\u5B89\u5168\u8FC1\u79FB\uFF1A${entry.name}`, { status: 409 });
      const source = (0, import_node_path2.join)(directory, entry.name);
      const destination = (0, import_node_path2.join)(directory, ownerId, "index.md");
      await rejectSymlink(source);
      if (await exists(destination)) {
        throw new BridgeError("BUNDLE_MIGRATION_CONFLICT", `\u8D44\u6599\u5305\u76EE\u6807\u5DF2\u5B58\u5728\uFF0C\u672A\u8986\u76D6\uFF1A${kind}/${ownerId}/index.md`, { status: 409 });
      }
      planned.push({ source, destination, relative: `${kind}/${entry.name}` });
    }
  }
  const metadataChanged = rewriteBundlePaths(document, mapRelativeDirectory(mapId));
  if (!metadataChanged && !planned.length) {
    return { migrated: false, mapId };
  }
  if (!planned.length) {
    stampBundleMigrationRevision(document);
    await writeJsonAtomic(mapPath, document);
    return { migrated: false, mapId };
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDirectory = (0, import_node_path2.join)(root, ".bridge", "backups", `pre-bundle-migration-${stamp}`);
  const journalPath = (0, import_node_path2.join)(root, ".bridge", "migrations", "bundle-layout-v1.json");
  await ensureDirectory(backupDirectory);
  await ensureDirectory((0, import_node_path2.dirname)(journalPath));
  await (0, import_promises2.copyFile)(mapPath, (0, import_node_path2.join)(backupDirectory, "map.json"));
  for (const item of planned) {
    const backup = (0, import_node_path2.join)(backupDirectory, item.relative);
    await ensureDirectory((0, import_node_path2.dirname)(backup));
    await (0, import_promises2.copyFile)(item.source, backup);
  }
  await writeJsonAtomic(journalPath, { version: 1, state: "prepared", mapId, planned: planned.map((item) => item.relative), completed: [] });
  const completed = [];
  try {
    for (const item of planned) {
      await ensureDirectory((0, import_node_path2.dirname)(item.destination));
      await (0, import_promises2.rename)(item.source, item.destination);
      completed.push(item);
      await writeJsonAtomic(journalPath, { version: 1, state: "moving", mapId, planned: planned.map((entry) => entry.relative), completed: completed.map((entry) => entry.relative) });
    }
    rewriteBundlePaths(document, mapRelativeDirectory(mapId));
    stampBundleMigrationRevision(document);
    await writeJsonAtomic(mapPath, document);
    await writeJsonAtomic(journalPath, { version: 1, state: "complete", mapId, planned: planned.map((entry) => entry.relative), completed: completed.map((entry) => entry.relative) });
  } catch (error3) {
    for (const item of completed.reverse()) {
      await ensureDirectory((0, import_node_path2.dirname)(item.source));
      await (0, import_promises2.rename)(item.destination, item.source).catch(() => void 0);
    }
    throw new BridgeError("BUNDLE_MIGRATION_FAILED", `\u8D44\u6599\u5305\u8FC1\u79FB\u5931\u8D25\uFF0C\u65E7\u6587\u4EF6\u5DF2\u6062\u590D\uFF1B\u5907\u4EFD\u5728 ${backupDirectory}`, { status: 500, cause: error3, details: { backupDirectory } });
  }
  return { migrated: true, mapId, backupDirectory };
}
async function rejectSymlink(path) {
  const metadata = await (0, import_promises2.lstat)(path).catch((error3) => {
    if (error3?.code === "ENOENT") return null;
    throw error3;
  });
  if (metadata?.isSymbolicLink()) {
    throw new BridgeError("SYMLINK_ESCAPE", "\u672C\u5730\u6865\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8FC1\u79FB\u9879\u76EE\u6570\u636E", { status: 403, details: { path } });
  }
}
async function migrateLegacyLayout(projectRoot) {
  const dataDirectory = (0, import_node_path2.join)(projectRoot, DATA_DIRECTORY);
  const target = mapDirectory(projectRoot, "default");
  const mapDir = mapRelativeDirectory("default");
  for (const path of [
    (0, import_node_path2.join)(dataDirectory, "map.json"),
    (0, import_node_path2.join)(dataDirectory, "nodes"),
    (0, import_node_path2.join)(dataDirectory, "routes"),
    (0, import_node_path2.join)(dataDirectory, ".bridge")
  ]) await rejectSymlink(path);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDirectory = (0, import_node_path2.join)(dataDirectory, ".bridge", "backups", `pre-maps-migration-${stamp}`);
  await ensureDirectory(backupDirectory);
  await (0, import_promises2.copyFile)((0, import_node_path2.join)(dataDirectory, "map.json"), (0, import_node_path2.join)(backupDirectory, "map.json"));
  for (const name of ["nodes", "routes"]) {
    const source = (0, import_node_path2.join)(dataDirectory, name);
    if (await exists(source)) await (0, import_promises2.cp)(source, (0, import_node_path2.join)(backupDirectory, name), { recursive: true });
  }
  const legacyWal = (0, import_node_path2.join)(dataDirectory, ".bridge", "wal.ndjson");
  if (await exists(legacyWal)) await (0, import_promises2.copyFile)(legacyWal, (0, import_node_path2.join)(backupDirectory, "wal.ndjson"));
  const moves = [
    [(0, import_node_path2.join)(dataDirectory, "map.json"), (0, import_node_path2.join)(target, "map.json")],
    [(0, import_node_path2.join)(dataDirectory, "nodes"), (0, import_node_path2.join)(target, "nodes")],
    [(0, import_node_path2.join)(dataDirectory, "routes"), (0, import_node_path2.join)(target, "routes")],
    [(0, import_node_path2.join)(dataDirectory, ".bridge", "snapshots"), (0, import_node_path2.join)(target, ".bridge", "snapshots")],
    [(0, import_node_path2.join)(dataDirectory, ".bridge", "backups"), (0, import_node_path2.join)(target, ".bridge", "backups")],
    [(0, import_node_path2.join)(dataDirectory, ".bridge", "quarantine"), (0, import_node_path2.join)(target, ".bridge", "quarantine")],
    [legacyWal, (0, import_node_path2.join)(target, ".bridge", "wal.ndjson.legacy-migrated")]
  ];
  const completed = [];
  try {
    await ensureDirectory((0, import_node_path2.join)(target, ".bridge"));
    for (const [source, destination] of moves) {
      if (!await exists(source)) continue;
      await ensureDirectory((0, import_node_path2.dirname)(destination));
      await (0, import_promises2.rename)(source, destination);
      completed.push([destination, source]);
    }
    const document = await readJson((0, import_node_path2.join)(target, "map.json"));
    rewriteMarkdownPaths(document, mapDir);
    await writeJsonAtomic((0, import_node_path2.join)(target, "map.json"), document);
    await writeActiveMap(projectRoot, "default");
  } catch (error3) {
    for (const [destination, source] of completed.reverse()) {
      await (0, import_promises2.rename)(destination, source).catch(() => void 0);
    }
    await (0, import_promises2.rm)((0, import_node_path2.join)(dataDirectory, ACTIVE_MAP_FILE), { force: true }).catch(() => void 0);
    await (0, import_promises2.rm)(mapsRoot(projectRoot), { recursive: true, force: true }).catch(() => void 0);
    throw new BridgeError("MAPS_MIGRATION_FAILED", `\u591A\u5730\u56FE\u8FC1\u79FB\u5931\u8D25\uFF0C\u5DF2\u56DE\u6EDA\uFF1B\u5B8C\u6574\u5907\u4EFD\u5728 ${backupDirectory}`, {
      status: 500,
      cause: error3,
      details: { backupDirectory, causeMessage: String(error3?.message || error3) }
    });
  }
  return { backupDirectory };
}
async function ensureMapsLayout(projectRoot) {
  const dataDirectory = (0, import_node_path2.join)(projectRoot, DATA_DIRECTORY);
  await ensureDirectory(dataDirectory);
  const existing = await listMapIds(projectRoot);
  if (existing.length) {
    const active = await readActiveMap(projectRoot);
    if (!active || !existing.includes(active)) {
      const fallback = existing.includes("default") ? "default" : existing[0];
      await writeActiveMap(projectRoot, fallback);
      for (const mapId of existing) await ensureBundleLayout(projectRoot, mapId);
      return { migrated: false, activeMap: fallback };
    }
    for (const mapId of existing) await ensureBundleLayout(projectRoot, mapId);
    return { migrated: false, activeMap: active };
  }
  if (await exists((0, import_node_path2.join)(dataDirectory, "map.json"))) {
    await migrateLegacyLayout(projectRoot);
    await ensureBundleLayout(projectRoot, "default");
    return { migrated: true, activeMap: "default" };
  }
  await ensureDirectory(mapDirectory(projectRoot, "default"));
  await writeActiveMap(projectRoot, "default");
  return { migrated: false, activeMap: "default" };
}

// src/bridge/project-store.mjs
var MAP_DIRECTORY = ".live-dot-map";
var BRIDGE_DIRECTORY = ".bridge";
function validationResult(result2) {
  if (result2 === true || result2 === void 0) return { ok: true, errors: [] };
  if (result2 === false) return { ok: false, errors: ["Document validation failed"] };
  return { ok: Boolean(result2?.ok), readOnly: Boolean(result2?.readOnly), errors: Array.isArray(result2?.errors) ? result2.errors : [] };
}
function terminalRecord(record) {
  return ["commit", "external", "recover", "checkpoint"].includes(record?.type);
}
function timestampName(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}
var ProjectStore = class _ProjectStore {
  #tail = Promise.resolve();
  #records = [];
  #commands = /* @__PURE__ */ new Map();
  #faultInjector;
  #onEvent;
  #pollIntervalMs;
  #pollTimer;
  #diskSignature;
  #lastOperationQuarantineAt = 0;
  constructor({
    projectRoot,
    shared,
    clock = () => /* @__PURE__ */ new Date(),
    snapshotEvery = 20,
    faultInjector = () => {
    },
    onEvent = () => {
    },
    pollIntervalMs = 250,
    dataDirectory,
    mapName,
    mapDir
  }) {
    this.projectRoot = projectRoot;
    this.shared = shared;
    this.clock = clock;
    this.snapshotEvery = Math.max(1, Number(snapshotEvery) || 20);
    this.readOnly = false;
    this.#faultInjector = faultInjector;
    this.#onEvent = onEvent;
    this.mapName = typeof mapName === "string" && mapName ? mapName : void 0;
    this.mapDir = typeof mapDir === "string" && mapDir ? mapDir : void 0;
    const requestedPollInterval = Number(pollIntervalMs);
    this.#pollIntervalMs = requestedPollInterval <= 0 ? 0 : Math.max(50, requestedPollInterval || 250);
    this.dataDirectory = dataDirectory ?? (0, import_node_path3.join)(projectRoot, MAP_DIRECTORY);
    this.mapPath = (0, import_node_path3.join)(this.dataDirectory, "map.json");
    this.bridgeDirectory = (0, import_node_path3.join)(this.dataDirectory, BRIDGE_DIRECTORY);
    this.walPath = (0, import_node_path3.join)(this.bridgeDirectory, "wal.ndjson");
    this.lockPath = (0, import_node_path3.join)(this.bridgeDirectory, "write.lock");
    this.snapshotDirectory = (0, import_node_path3.join)(this.bridgeDirectory, "snapshots");
    this.backupDirectory = (0, import_node_path3.join)(this.bridgeDirectory, "backups");
    this.quarantineDirectory = (0, import_node_path3.join)(this.bridgeDirectory, "quarantine");
  }
  static async open(options) {
    let resolved = options;
    if (!options?.dataDirectory && options?.projectRoot && await exists(mapsRoot(options.projectRoot))) {
      const mapId = await resolveActiveMap(options.projectRoot);
      resolved = {
        ...options,
        dataDirectory: mapDirectory(options.projectRoot, mapId),
        mapDir: options.mapDir ?? mapRelativeDirectory(mapId)
      };
    }
    const store = new _ProjectStore(resolved);
    await store.#initialize();
    store.#startExternalMonitor();
    return store;
  }
  #startExternalMonitor() {
    if (this.#pollTimer || this.#pollIntervalMs <= 0) return;
    this.#pollTimer = setInterval(() => {
      this.#pollExternal().catch(() => {
      });
    }, this.#pollIntervalMs);
    this.#pollTimer.unref?.();
  }
  async #pollExternal() {
    let metadata;
    try {
      metadata = await (0, import_promises3.stat)(this.mapPath);
    } catch {
      return;
    }
    const signature = `${metadata.dev ?? ""}:${metadata.ino ?? ""}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    if (signature === this.#diskSignature) return;
    await this.snapshot();
  }
  async #captureDiskSignature() {
    try {
      const metadata = await (0, import_promises3.stat)(this.mapPath);
      this.#diskSignature = `${metadata.dev ?? ""}:${metadata.ino ?? ""}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    } catch {
      this.#diskSignature = void 0;
    }
  }
  async #initialize() {
    await this.#assertSafeStoragePaths();
    return withFileLock(this.lockPath, () => this.#initializeLocked());
  }
  async #assertSafeStoragePaths() {
    const canonicalRoot = await (0, import_promises3.realpath)(this.projectRoot);
    const directories = [this.dataDirectory, this.bridgeDirectory, this.snapshotDirectory, this.backupDirectory, this.quarantineDirectory];
    const files = [this.mapPath, this.walPath, this.lockPath];
    const rejectSymlink2 = async (path) => {
      try {
        if ((await (0, import_promises3.lstat)(path)).isSymbolicLink()) {
          throw new BridgeError("SYMLINK_ESCAPE", "\u672C\u5730\u6865\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BFB\u5199\u9879\u76EE\u6570\u636E", { status: 403, details: { path } });
        }
      } catch (error3) {
        if (error3?.code !== "ENOENT") throw error3;
      }
    };
    for (const path of [...directories, ...files]) await rejectSymlink2(path);
    for (const path of directories) {
      await ensureDirectory(path);
      await rejectSymlink2(path);
      const canonical = await (0, import_promises3.realpath)(path);
      const escaped = (0, import_node_path4.relative)(canonicalRoot, canonical);
      if (escaped.startsWith("..") || (0, import_node_path4.isAbsolute)(escaped) || (0, import_node_path4.resolve)(canonical) === (0, import_node_path4.resolve)(canonicalRoot)) {
        throw new BridgeError("PATH_ESCAPE", "\u672C\u5730\u6865\u6570\u636E\u76EE\u5F55\u5FC5\u987B\u4F4D\u4E8E\u6CE8\u518C\u9879\u76EE\u5185", { status: 403, details: { path } });
      }
    }
  }
  #createEmptyDocument() {
    return this.shared.createEmptyMap({
      name: this.mapName ?? (0, import_node_path3.basename)(this.projectRoot),
      now: this.clock().toISOString(),
      ...this.mapDir ? { mapDir: this.mapDir } : {}
    });
  }
  async #initializeLocked() {
    this.#records = await this.#readWal();
    if (!await exists(this.mapPath)) {
      const created = await this.#createEmptyDocument();
      await this.#assertValid(created, "EMPTY_MAP_INVALID");
      await writeJsonAtomic(this.mapPath, created);
    }
    let document;
    try {
      document = await readJson(this.mapPath);
      try {
        await this.#assertValid(document, "CORRUPT_MAP");
      } catch (error3) {
        if (document?.version !== 1 && error3 instanceof BridgeError && error3.details?.readOnly === true) {
          this.readOnly = true;
        } else {
          if (document?.version !== 1 || typeof this.shared.migrateDocument !== "function") throw error3;
          await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.v1-before-migration.json");
          document = await this.shared.migrateDocument(document, { now: this.clock().toISOString() });
          await this.#assertValid(document, "MIGRATION_INVALID");
          await writeJsonAtomic(this.mapPath, document);
        }
      }
    } catch (error3) {
      if (error3?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error3.details });
      }
      let raw = "";
      try {
        raw = await (0, import_promises3.readFile)(this.mapPath, "utf8");
      } catch {
      }
      if (!raw.trim()) {
        await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.empty.json").catch(() => void 0);
        const created = await this.#createEmptyDocument();
        await this.#assertValid(created, "EMPTY_MAP_INVALID");
        await writeJsonAtomic(this.mapPath, created);
        document = created;
      } else {
        const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.json.corrupt").catch(() => void 0);
        const candidate = await this.#latestRecoverableDocument();
        if (!candidate) {
          if (error3 instanceof BridgeError) throw error3;
          throw new BridgeError("CORRUPT_MAP", "map.json \u65E0\u6CD5\u89E3\u6790\u6216\u6062\u590D\uFF08\u635F\u574F\u6587\u4EF6\u5DF2\u9694\u79BB\uFF0C\u53EF\u624B\u5DE5\u68C0\u67E5\uFF09", {
            status: 409,
            cause: error3,
            details: { causeMessage: String(error3?.message || error3), quarantinePath }
          });
        }
        document = candidate.document;
        await writeJsonAtomic(this.mapPath, document);
      }
    }
    this.document = document;
    const latestTerminal = this.#records.filter(terminalRecord).sort((a, b) => (a.revision || 0) - (b.revision || 0)).at(-1);
    this.checksum = latestTerminal?.checksum || checksum(document);
    this.revision = latestTerminal?.revision ?? (Number.isSafeInteger(document.revision) ? document.revision : 0);
    await this.#captureDiskSignature();
    if (this.readOnly) {
      this.checksum = checksum(document);
      return;
    }
    await this.#recoverDanglingPrepare();
    await this.#refreshExternalUnlocked();
    this.#rebuildCommandIndex();
    await this.#ensureDailyBackup();
  }
  async #assertValid(document, code = "INVALID_DOCUMENT") {
    let result2;
    try {
      result2 = validationResult(await this.shared.validateDocument(document));
    } catch (error3) {
      throw new BridgeError(code, "Map document validation threw an error", {
        status: 422,
        details: { validationError: error3.message },
        cause: error3
      });
    }
    if (!result2.ok) {
      throw new BridgeError(code, "Map document failed validation", {
        status: 422,
        details: { errors: result2.errors, readOnly: result2.readOnly === true }
      });
    }
  }
  async #readWal() {
    if (!await exists(this.walPath)) return [];
    const metadata = await (0, import_promises3.stat)(this.walPath);
    if (metadata.size > 128 * 1024 * 1024) {
      throw new BridgeError("WAL_TOO_LARGE", "WAL \u8D85\u8FC7 128 MiB \u5B89\u5168\u4E0A\u9650\uFF0C\u9700\u8981\u4EBA\u5DE5\u6062\u590D", { status: 413, details: { size: metadata.size } });
    }
    const content = await (0, import_promises3.readFile)(this.walPath, "utf8");
    const lines = content.split("\n");
    const records = [];
    let invalidAt = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index].trim();
      if (!line) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        invalidAt = index;
        break;
      }
    }
    if (invalidAt >= 0) {
      const invalid = lines.slice(invalidAt).join("\n");
      await quarantineCopy(this.walPath, this.quarantineDirectory, "wal.invalid-tail", invalid);
      const repaired = records.length ? `${records.map((item) => JSON.stringify(item)).join("\n")}
` : "";
      await atomicWriteFile(this.walPath, repaired);
    }
    return records;
  }
  async #latestRecoverableDocument() {
    for (let index = this.#records.length - 1; index >= 0; index -= 1) {
      const record = this.#records[index];
      if (!record?.document) continue;
      try {
        await this.#assertValid(record.document, "INVALID_WAL_DOCUMENT");
        if (checksum(record.document) === record.checksum) return record;
      } catch {
      }
    }
    return null;
  }
  async #appendRecord(record) {
    await appendDurable(this.walPath, JSON.stringify(record));
    this.#records.push(record);
  }
  async #recoverDanglingPrepare() {
    const committed = new Set(this.#records.filter((item) => item.type === "commit").map((item) => item.commandId));
    const terminalRevision = this.#records.filter(terminalRecord).reduce((max, item) => Math.max(max, item.revision || 0), 0);
    const dangling = this.#records.filter((item) => item.type === "prepare" && !committed.has(item.commandId) && item.revision > terminalRevision).sort((a, b) => a.revision - b.revision);
    for (const prepare of dangling) {
      await this.#assertValid(prepare.document, "INVALID_WAL_DOCUMENT");
      if (checksum(prepare.document) !== prepare.checksum) {
        throw new BridgeError("WAL_CHECKSUM_MISMATCH", "Prepared WAL document checksum does not match", {
          status: 409,
          details: { commandId: prepare.commandId }
        });
      }
      const disk = await readJson(this.mapPath);
      const diskChecksum = checksum(disk);
      if (diskChecksum !== prepare.checksum) {
        if (prepare.baseChecksum && diskChecksum !== prepare.baseChecksum) {
          const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.recovery-conflict.json");
          throw new BridgeError("RECOVERY_CONFLICT", "A concurrent external change conflicts with the prepared WAL command", {
            status: 409,
            details: { commandId: prepare.commandId, quarantinePath }
          });
        }
        await writeJsonAtomic(this.mapPath, prepare.document);
      }
      await this.#appendRecord({
        type: "commit",
        recovered: true,
        commandId: prepare.commandId,
        requestDigest: prepare.requestDigest,
        revision: prepare.revision,
        checksum: prepare.checksum,
        timestamp: this.clock().toISOString()
      });
      this.document = cloneJson(prepare.document);
      this.checksum = prepare.checksum;
      this.revision = prepare.revision;
    }
  }
  #rebuildCommandIndex() {
    const prepares = new Map(this.#records.filter((item) => item.type === "prepare").map((item) => [item.commandId, item]));
    this.#commands.clear();
    for (const commit of this.#records.filter((item) => item.type === "commit")) {
      const prepare = prepares.get(commit.commandId);
      if (!prepare) continue;
      this.#commands.set(commit.commandId, {
        revision: commit.revision,
        checksum: commit.checksum,
        requestDigest: prepare.requestDigest
      });
    }
  }
  async #refreshExternalUnlocked() {
    let disk;
    try {
      disk = await readJson(this.mapPath);
      await this.#assertValid(disk, "CORRUPT_MAP");
    } catch (error3) {
      if (error3?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "\u5916\u90E8 map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error3.details });
      }
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.external-corrupt.json").catch(() => void 0);
      if (error3 instanceof BridgeError) {
        error3.details = { ...error3.details, quarantinePath };
        throw error3;
      }
      throw new BridgeError("CORRUPT_MAP", "External map.json change is not valid JSON", {
        status: 409,
        details: { quarantinePath },
        cause: error3
      });
    }
    const diskChecksum = checksum(disk);
    if (diskChecksum === this.checksum) {
      this.document = cloneJson(disk);
      return false;
    }
    if (Number.isSafeInteger(disk.revision) && disk.revision <= this.revision) {
      const previous = [...this.#records].reverse().find((record2) => record2.document && record2.checksum === this.checksum)?.document;
      const recoverable = previous || (this.document && checksum(this.document) === this.checksum ? this.document : null);
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.stale-external.json");
      if (recoverable) await writeJsonAtomic(this.mapPath, recoverable);
      throw new BridgeError("EXTERNAL_REVISION_CONFLICT", "External map.json did not advance the revision", {
        status: 409,
        details: { currentRevision: this.revision, externalRevision: disk.revision, quarantinePath, restored: Boolean(recoverable) }
      });
    }
    const revision = Math.max(this.revision + 1, Number.isSafeInteger(disk.revision) ? disk.revision : 0);
    const record = {
      type: "external",
      revision,
      checksum: diskChecksum,
      document: disk,
      timestamp: this.clock().toISOString()
    };
    await this.#appendRecord(record);
    this.document = cloneJson(disk);
    this.checksum = diskChecksum;
    this.revision = revision;
    this.#emit({ type: "external", revision, checksum: diskChecksum });
    return true;
  }
  #exclusive(operation) {
    const locked = () => withFileLock(this.lockPath, operation).catch((error3) => {
      if (error3?.code === "LOCK_TIMEOUT") {
        throw new BridgeError("PROJECT_BUSY", "Another local bridge process is writing this project", {
          status: 503,
          cause: error3
        });
      }
      throw error3;
    });
    const running = this.#tail.then(locked, locked);
    this.#tail = running.catch(() => {
    });
    return running;
  }
  async #reloadState() {
    const previousRevision = this.revision;
    const previousChecksum = this.checksum;
    if (this.readOnly) {
      const disk2 = await readJson(this.mapPath);
      const result2 = validationResult(await this.shared.validateDocument(disk2));
      if (result2.ok || result2.readOnly !== true) {
        throw new BridgeError("READ_ONLY_SCHEMA_CHANGED", "\u53EA\u8BFB\u6253\u5F00\u671F\u95F4 schema \u72B6\u6001\u53D1\u751F\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u9879\u76EE", { status: 409 });
      }
      this.document = cloneJson(disk2);
      this.revision = Number.isSafeInteger(disk2.revision) ? disk2.revision : 0;
      this.checksum = checksum(disk2);
      await this.#captureDiskSignature();
      return;
    }
    this.#records = await this.#readWal();
    let disk;
    try {
      disk = await readJson(this.mapPath);
      await this.#assertValid(disk, "CORRUPT_MAP");
    } catch (error3) {
      if (error3?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error3.details });
      }
      let raw = "";
      try {
        raw = await (0, import_promises3.readFile)(this.mapPath, "utf8");
      } catch {
      }
      if (!raw.trim()) {
        const created = await this.#createEmptyDocument();
        await this.#assertValid(created, "EMPTY_MAP_INVALID");
        await writeJsonAtomic(this.mapPath, created);
        disk = created;
      } else {
        let quarantinePath;
        const nowMs = this.clock().getTime();
        if (!this.#lastOperationQuarantineAt || nowMs - this.#lastOperationQuarantineAt > 6e4) {
          this.#lastOperationQuarantineAt = nowMs;
          quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.operation-corrupt.json").catch(() => void 0);
        }
        if (error3 instanceof BridgeError) {
          error3.details = { ...error3.details, quarantinePath };
          throw error3;
        }
        throw new BridgeError("CORRUPT_MAP", "map.json is not valid JSON", {
          status: 409,
          details: { quarantinePath },
          cause: error3
        });
      }
    }
    const latestTerminal = this.#records.filter(terminalRecord).sort((a, b) => (a.revision || 0) - (b.revision || 0)).at(-1);
    this.revision = latestTerminal?.revision ?? (Number.isSafeInteger(disk.revision) ? disk.revision : 0);
    this.checksum = latestTerminal?.checksum || checksum(disk);
    await this.#recoverDanglingPrepare();
    const externalChanged = await this.#refreshExternalUnlocked();
    this.#rebuildCommandIndex();
    await this.#captureDiskSignature();
    if (!externalChanged && (this.revision !== previousRevision || this.checksum !== previousChecksum)) {
      this.#emit({ type: "external", revision: this.revision, checksum: this.checksum });
    }
  }
  #emit(event) {
    try {
      this.#onEvent(event);
    } catch {
    }
  }
  async snapshot() {
    return this.#exclusive(async () => {
      await this.#reloadState();
      return {
        revision: this.revision,
        checksum: this.checksum,
        readOnly: this.readOnly,
        document: cloneJson(this.document)
      };
    });
  }
  async close() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = void 0;
    }
    await this.#tail.catch(() => {
    });
  }
  async execute(request) {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError("READ_ONLY_SCHEMA", "\u672A\u77E5 schema \u7248\u672C\u53EA\u80FD\u53EA\u8BFB\u6253\u5F00", { status: 409 });
      const { commandId, baseRevision } = request || {};
      const hasEnvelope = Array.isArray(request?.commands);
      const command2 = request?.command;
      const payload = hasEnvelope ? {
        projectId: request.projectId,
        baseRevision,
        commandId,
        actor: request.actor,
        sessionId: request.sessionId,
        commands: request.commands
      } : command2;
      if (typeof commandId !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(commandId)) {
        throw new BridgeError("INVALID_COMMAND_ID", "commandId must be 8-128 safe characters", { status: 400 });
      }
      if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
        throw new BridgeError("INVALID_BASE_REVISION", "baseRevision must be a non-negative integer", { status: 400 });
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new BridgeError("INVALID_COMMAND", "command must be a JSON object", { status: 400 });
      }
      const requestDigest = checksum(payload);
      const previous = this.#commands.get(commandId);
      if (previous) {
        if (previous.requestDigest !== requestDigest) {
          throw new BridgeError("COMMAND_ID_REUSE", "commandId was already used for a different command", {
            status: 409,
            details: { commandId, revision: previous.revision }
          });
        }
        return { ...previous, idempotent: true, document: cloneJson(this.document) };
      }
      let touches = [];
      if (hasEnvelope) touches = this.shared.envelopeTouches(payload);
      if (baseRevision !== this.revision) {
        const laterTouches = this.#records.filter((record) => record.type === "prepare" && record.revision > baseRevision).flatMap((record) => Array.isArray(record.touches) ? record.touches : ["*"]);
        const overlaps = (left, right) => left === "*" || right === "*" || left === right || left.endsWith("/*") && right.startsWith(left.slice(0, -1)) || right.endsWith("/*") && left.startsWith(right.slice(0, -1));
        const conflicts = touches.filter((path) => laterTouches.some((changed) => overlaps(path, changed)));
        if (!hasEnvelope || baseRevision > this.revision || conflicts.length) {
          throw new BridgeError("REVISION_CONFLICT", "baseRevision conflicts with newer changes", {
            status: 409,
            details: {
              baseRevision,
              currentRevision: this.revision,
              currentChecksum: this.checksum,
              conflictPaths: conflicts.length ? conflicts : laterTouches,
              incomingCommands: hasEnvelope ? cloneJson(request.commands) : [cloneJson(command2)],
              currentDocument: cloneJson(this.document)
            }
          });
        }
      }
      let next;
      try {
        next = hasEnvelope ? await this.shared.applyEnvelope(cloneJson(this.document), { ...cloneJson(payload), baseRevision: this.revision }, { now: this.clock().toISOString() }) : await this.shared.applyCommand(cloneJson(this.document), cloneJson(command2), {
          actor: request?.actor || "human",
          revision: this.revision + 1,
          now: this.clock().toISOString()
        });
      } catch (error3) {
        if (error3 instanceof BridgeError) throw error3;
        throw new BridgeError(error3?.code || "COMMAND_REJECTED", error3?.message || "Command was rejected", {
          status: error3?.status || 422,
          details: error3?.details,
          cause: error3
        });
      }
      await this.#assertValid(next);
      const revision = this.revision + 1;
      const nextChecksum = checksum(next);
      const prepare = {
        type: "prepare",
        commandId,
        requestDigest,
        baseRevision,
        baseChecksum: this.checksum,
        touches,
        revision,
        checksum: nextChecksum,
        document: next,
        timestamp: this.clock().toISOString()
      };
      await this.#appendRecord(prepare);
      await this.#faultInjector("afterWalPrepare", { prepare, store: this });
      await writeJsonAtomic(this.mapPath, next);
      await this.#faultInjector("afterMapReplace", { prepare, store: this });
      const commit = {
        type: "commit",
        commandId,
        requestDigest,
        revision,
        checksum: nextChecksum,
        timestamp: this.clock().toISOString()
      };
      await this.#appendRecord(commit);
      this.document = cloneJson(next);
      this.checksum = nextChecksum;
      this.revision = revision;
      this.#commands.set(commandId, { revision, checksum: nextChecksum, requestDigest });
      if (revision % this.snapshotEvery === 0) {
        await this.#writeSnapshot("automatic");
        await this.#compactWal();
      }
      this.#emit({ type: "command", commandId, revision, checksum: nextChecksum, actor: request.actor, sessionId: request.sessionId });
      return { revision, checksum: nextChecksum, idempotent: false, document: cloneJson(next) };
    });
  }
  async createSnapshot() {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError("READ_ONLY_SCHEMA", "\u672A\u77E5 schema \u7248\u672C\u4E0D\u80FD\u521B\u5EFA\u5FEB\u7167", { status: 409 });
      return this.#writeSnapshot("manual");
    });
  }
  async #writeSnapshot(reason) {
    const envelope2 = {
      revision: this.revision,
      checksum: this.checksum,
      createdAt: this.clock().toISOString(),
      reason,
      document: this.document
    };
    const path = (0, import_node_path3.join)(this.snapshotDirectory, `rev-${String(this.revision).padStart(12, "0")}-${timestampName(this.clock())}.json`);
    await writeJsonAtomic(path, envelope2);
    await this.#pruneJsonDirectory(this.snapshotDirectory, 20);
    return { path, revision: this.revision, checksum: this.checksum };
  }
  async #compactWal() {
    const committed = new Set(this.#records.filter((record) => record.type === "commit").map((record) => record.commandId));
    const compacted = this.#records.filter((record) => record.type !== "checkpoint").map((record) => {
      if (record.type !== "prepare" || !committed.has(record.commandId) || record.document === void 0) return record;
      const { document, ...receipt } = record;
      return receipt;
    });
    compacted.push({
      type: "checkpoint",
      revision: this.revision,
      checksum: this.checksum,
      document: cloneJson(this.document),
      timestamp: this.clock().toISOString()
    });
    const content = `${compacted.map((record) => JSON.stringify(record)).join("\n")}
`;
    await atomicWriteFile(this.walPath, content);
    this.#records = compacted;
    this.#rebuildCommandIndex();
  }
  async #pruneJsonDirectory(directory, keep) {
    const entries = (await (0, import_promises3.readdir)(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
    await Promise.all(entries.slice(0, Math.max(0, entries.length - keep)).map((name) => (0, import_promises3.unlink)((0, import_node_path3.join)(directory, name))));
  }
  async #ensureDailyBackup() {
    const day = this.clock().toISOString().slice(0, 10);
    const path = (0, import_node_path3.join)(this.backupDirectory, `${day}.json`);
    if (!await exists(path)) {
      await writeJsonAtomic(path, {
        revision: this.revision,
        checksum: this.checksum,
        createdAt: this.clock().toISOString(),
        document: this.document
      });
    }
    await this.#pruneJsonDirectory(this.backupDirectory, 7);
    return path;
  }
  async recover({ source = "snapshot", name } = {}) {
    return this.#exclusive(async () => {
      await this.#reloadState();
      if (this.readOnly) throw new BridgeError("READ_ONLY_SCHEMA", "\u672A\u77E5 schema \u7248\u672C\u4E0D\u80FD\u6267\u884C\u6062\u590D\u5199\u5165", { status: 409 });
      if (!["snapshot", "backup"].includes(source)) {
        throw new BridgeError("INVALID_RECOVERY_SOURCE", "Recovery source must be snapshot or backup", { status: 400 });
      }
      const directory = source === "snapshot" ? this.snapshotDirectory : this.backupDirectory;
      const entries = (await (0, import_promises3.readdir)(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
      const selected = name === void 0 ? entries.at(-1) : (0, import_node_path3.basename)(name);
      if (!selected || !entries.includes(selected) || selected !== (name === void 0 ? selected : name)) {
        throw new BridgeError("RECOVERY_IMAGE_NOT_FOUND", "Requested recovery image was not found", {
          status: 404,
          details: { source, name }
        });
      }
      const envelope2 = await readJson((0, import_node_path3.join)(directory, selected));
      await this.#assertValid(envelope2.document, "INVALID_RECOVERY_IMAGE");
      if (checksum(envelope2.document) !== envelope2.checksum) {
        throw new BridgeError("RECOVERY_CHECKSUM_MISMATCH", "Recovery image checksum does not match", { status: 409 });
      }
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.before-recovery.json");
      const revision = this.revision + 1;
      const commandId = `recover:${(0, import_node_crypto2.randomUUID)()}`;
      const recoveredDocument = cloneJson(envelope2.document);
      if (Number.isSafeInteger(recoveredDocument.revision)) recoveredDocument.revision = revision;
      if (typeof recoveredDocument.updatedAt === "string") recoveredDocument.updatedAt = this.clock().toISOString();
      await this.#assertValid(recoveredDocument, "INVALID_RECOVERY_IMAGE");
      const recoveredChecksum = checksum(recoveredDocument);
      const prepare = {
        type: "prepare",
        operation: "recover",
        commandId,
        requestDigest: checksum({ source, selected, checksum: envelope2.checksum }),
        baseRevision: this.revision,
        revision,
        checksum: recoveredChecksum,
        document: recoveredDocument,
        timestamp: this.clock().toISOString()
      };
      await this.#appendRecord(prepare);
      await writeJsonAtomic(this.mapPath, recoveredDocument);
      await this.#appendRecord({
        type: "commit",
        operation: "recover",
        commandId,
        requestDigest: prepare.requestDigest,
        revision,
        checksum: recoveredChecksum,
        timestamp: this.clock().toISOString()
      });
      this.document = cloneJson(recoveredDocument);
      this.checksum = recoveredChecksum;
      this.revision = revision;
      this.#rebuildCommandIndex();
      await this.#writeSnapshot("recovery");
      this.#emit({ type: "recover", revision, checksum: this.checksum, source, selected });
      return { revision, checksum: this.checksum, source, selected, quarantinePath, document: cloneJson(this.document) };
    });
  }
};

// src/bridge/server.mjs
var import_node_crypto12 = require("node:crypto");
var import_node_http = require("node:http");
var import_promises14 = require("node:fs/promises");
var import_node_path18 = require("node:path");
var import_node_child_process6 = require("node:child_process");
var import_node_os5 = require("node:os");

// src/bridge/logger.mjs
var import_promises4 = require("node:fs/promises");
var import_node_path5 = require("node:path");
var import_node_os = require("node:os");
var KEEP_DAYS = 14;
var MAX_STRING = 1e3;
function logDirectory() {
  return process.env.LIVEDOT_LOG_DIR || (0, import_node_path5.join)((0, import_node_os.homedir)(), ".live-dot-map", "logs");
}
function clean(value, depth = 0) {
  if (value === null || value === void 0) return value;
  if (value instanceof Error) {
    return {
      ...value.code ? { code: String(value.code) } : {},
      message: String(value.message || "").slice(0, MAX_STRING),
      stack: String(value.stack || "").split("\n").slice(0, 6).join("\n")
    };
  }
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}\u2026` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return depth >= 2 ? `[${value.length} \u9879]` : value.slice(0, 20).map((item) => clean(item, depth + 1));
  if (typeof value === "object") {
    if (depth >= 2) return "[\u5D4C\u5957\u5BF9\u8C61]";
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = clean(item, depth + 1);
    return output;
  }
  return String(value);
}
function createLogger({ source = "bridge", dir, clock = () => /* @__PURE__ */ new Date() } = {}) {
  const root = dir || logDirectory();
  let chain = Promise.resolve();
  let prepared = false;
  async function prepare() {
    await (0, import_promises4.mkdir)(root, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1e3;
    const entries = await (0, import_promises4.readdir)(root).catch(() => []);
    for (const entry of entries) {
      const match = /^livedot-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry);
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) {
        await (0, import_promises4.rm)((0, import_node_path5.join)(root, entry), { force: true }).catch(() => void 0);
      }
    }
  }
  function write(level, event, fields = {}, entrySource = source) {
    const at = clock();
    const entry = { at: at.toISOString(), level, source: entrySource, event: String(event).slice(0, 120), ...clean(fields) };
    const file = (0, import_node_path5.join)(root, `livedot-${at.toISOString().slice(0, 10)}.log`);
    chain = chain.then(async () => {
      if (!prepared) {
        prepared = true;
        await prepare();
      }
      await (0, import_promises4.appendFile)(file, `${JSON.stringify(entry)}
`, "utf8");
    }).catch(() => void 0);
    return chain;
  }
  const api = {
    dir: root,
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    flush: () => chain,
    // 派生同文件同队列的子来源（如 client），保证多来源写在一条时间线上。
    as: (childSource) => ({
      dir: root,
      info: (event, fields) => write("info", event, fields, childSource),
      warn: (event, fields) => write("warn", event, fields, childSource),
      error: (event, fields) => write("error", event, fields, childSource),
      flush: () => chain,
      as: api.as
    })
  };
  return api;
}
var noopLogger = {
  dir: null,
  info: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  error: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  as: () => noopLogger
};

// src/bridge/markdown-store.mjs
var import_node_crypto3 = require("node:crypto");
var import_promises5 = require("node:fs/promises");
var import_node_path6 = require("node:path");
var MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
var MAX_MARKDOWN_PATH = 1024;
function inRoot(root, candidate) {
  const value = (0, import_node_path6.relative)(root, candidate);
  return value === "" || value !== ".." && !value.startsWith(`..${import_node_path6.sep}`) && !(0, import_node_path6.isAbsolute)(value);
}
function normalizeRelativePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_MARKDOWN_PATH) {
    throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u65E0\u6548", { status: 400 });
  }
  if (input.includes("\0")) throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u5305\u542B\u975E\u6CD5\u5B57\u7B26", { status: 400 });
  const portable = input.replace(/\\/g, "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable) || (0, import_node_path6.isAbsolute)(input)) {
    throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u5FC5\u987B\u662F\u9879\u76EE\u5185\u76F8\u5BF9\u8DEF\u5F84", { status: 400 });
  }
  const parts = portable.split("/");
  if (parts.some((part) => part === "..")) {
    throw new BridgeError("MARKDOWN_PATH_TRAVERSAL", "Markdown \u8DEF\u5F84\u4E0D\u80FD\u79BB\u5F00\u9879\u76EE\u76EE\u5F55", { status: 403 });
  }
  const normalized = portable.replace(/^\.\//, "").replace(/\/+/g, "/");
  if (!normalized || normalized === "." || normalized.endsWith("/")) {
    throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u5FC5\u987B\u6307\u5411\u6587\u4EF6", { status: 400 });
  }
  if (!/\.md$/i.test(normalized)) {
    throw new BridgeError("MARKDOWN_EXTENSION_REQUIRED", "\u53EA\u5141\u8BB8\u8BFB\u5199 .md \u6587\u4EF6", { status: 415 });
  }
  return normalized;
}
async function ensureNoSymlink(root, candidate, { allowMissing = true } = {}) {
  const rootReal = await (0, import_promises5.realpath)(root);
  if (!inRoot(rootReal, candidate)) {
    throw new BridgeError("MARKDOWN_PATH_OUTSIDE_PROJECT", "Markdown \u8DEF\u5F84\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u5185", { status: 403 });
  }
  let cursor = candidate;
  let candidateStat;
  try {
    candidateStat = await (0, import_promises5.lstat)(candidate);
  } catch (error3) {
    if (error3?.code !== "ENOENT") throw error3;
  }
  if (candidateStat?.isSymbolicLink()) {
    throw new BridgeError("MARKDOWN_SYMLINK_FORBIDDEN", "\u4E0D\u5141\u8BB8\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BBF\u95EE Markdown", { status: 403 });
  }
  if (candidateStat && !candidateStat.isFile()) {
    throw new BridgeError("MARKDOWN_NOT_FILE", "Markdown \u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6", { status: 409 });
  }
  while (cursor !== rootReal && cursor !== (0, import_node_path6.dirname)(cursor)) {
    try {
      const info = await (0, import_promises5.lstat)(cursor);
      if (info.isSymbolicLink()) throw new BridgeError("MARKDOWN_SYMLINK_FORBIDDEN", "\u4E0D\u5141\u8BB8\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BBF\u95EE Markdown", { status: 403 });
      const resolved = await (0, import_promises5.realpath)(cursor);
      if (!inRoot(rootReal, resolved)) throw new BridgeError("MARKDOWN_PATH_OUTSIDE_PROJECT", "Markdown \u8DEF\u5F84\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u5185", { status: 403 });
      break;
    } catch (error3) {
      if (error3?.code !== "ENOENT") throw error3;
      if (!allowMissing) throw new BridgeError("MARKDOWN_NOT_FOUND", "Markdown \u6587\u4EF6\u4E0D\u5B58\u5728", { status: 404 });
      cursor = (0, import_node_path6.dirname)(cursor);
    }
  }
  return { root: rootReal, stat: candidateStat };
}
function digest(content) {
  return (0, import_node_crypto3.createHash)("sha256").update(content, "utf8").digest("hex");
}
function initialMarkdown(path, title) {
  return `# ${String(title || path.split("/").at(-1)?.replace(/\.md$/i, "") || "\u672A\u547D\u540D\u8BB0\u5F55").slice(0, 80)}

`;
}
function result(path, content, metadata, { created = false } = {}) {
  const bytes = Buffer.byteLength(content, "utf8");
  return {
    path,
    content,
    exists: true,
    created,
    size: bytes,
    etag: digest(content),
    updatedAt: metadata?.mtime?.toISOString?.() ?? null
  };
}
var MarkdownStore = class {
  constructor(projectRoot) {
    this.projectRoot = (0, import_node_path6.resolve)(projectRoot);
  }
  async #target(requestedPath, options = {}) {
    const path = normalizeRelativePath(requestedPath);
    const candidate = (0, import_node_path6.resolve)(this.projectRoot, path);
    await ensureNoSymlink(this.projectRoot, candidate, options);
    return { path, candidate };
  }
  #lockPath(path) {
    const lockId = (0, import_node_crypto3.createHash)("sha256").update(path, "utf8").digest("hex");
    return (0, import_node_path6.join)(this.projectRoot, ".live-dot-map", ".bridge", "markdown-locks", `${lockId}.lock`);
  }
  async #readUnlocked(requestedPath, { create = false, title = "" } = {}) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    let metadata;
    try {
      metadata = await (0, import_promises5.stat)(candidate);
    } catch (error3) {
      if (error3?.code !== "ENOENT") throw error3;
      if (!create) return { path, content: "", exists: false, created: false, size: 0, etag: digest(""), updatedAt: null };
      const initial = initialMarkdown(path, title);
      if (Buffer.byteLength(initial, "utf8") > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413 });
      await (0, import_promises5.mkdir)((0, import_node_path6.dirname)(candidate), { recursive: true });
      await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
      try {
        await atomicWriteFile(candidate, initial);
      } catch (writeError) {
        throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u521B\u5EFA\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: writeError });
      }
      metadata = await (0, import_promises5.stat)(candidate);
      return result(path, initial, metadata, { created: true });
    }
    if (create && metadata.size === 0) {
      const initial = initialMarkdown(path, title);
      await atomicWriteFile(candidate, initial).catch((error3) => {
        throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error3 });
      });
      metadata = await (0, import_promises5.stat)(candidate);
      return result(path, initial, metadata, { created: true });
    }
    if (metadata.size > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u6587\u4EF6\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413, details: { size: metadata.size, limit: MAX_MARKDOWN_BYTES } });
    let content;
    try {
      content = await (0, import_promises5.readFile)(candidate, "utf8");
    } catch (error3) {
      throw new BridgeError("MARKDOWN_READ_FAILED", "Markdown \u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error3 });
    }
    if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u6587\u4EF6\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413 });
    return result(path, content, metadata);
  }
  async read(requestedPath, options = {}) {
    const { create = false } = options;
    if (!create) return this.#readUnlocked(requestedPath, options);
    const path = normalizeRelativePath(requestedPath);
    const lockPath = this.#lockPath(path);
    try {
      await ensureDirectory((0, import_node_path6.dirname)(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, () => this.#readUnlocked(path, options), { timeoutMs: 5e3, staleMs: 3e4 });
    } catch (error3) {
      if (error3 instanceof BridgeError) throw error3;
      if (error3?.code === "LOCK_TIMEOUT") throw new BridgeError("MARKDOWN_BUSY", "Markdown \u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", { status: 409, cause: error3 });
      throw new BridgeError("MARKDOWN_READ_FAILED", "Markdown \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error3 });
    }
  }
  async write(requestedPath, content, { baseEtag } = {}) {
    if (typeof content !== "string") throw new BridgeError("MARKDOWN_CONTENT_REQUIRED", "Markdown \u5185\u5BB9\u5FC5\u987B\u662F\u6587\u672C", { status: 400 });
    if (typeof baseEtag !== "string" || baseEtag.length === 0) {
      throw new BridgeError("MARKDOWN_BASE_ETAG_REQUIRED", "\u66FF\u6362 Markdown \u5FC5\u987B\u63D0\u4F9B baseEtag", { status: 400 });
    }
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413, details: { size: bytes, limit: MAX_MARKDOWN_BYTES } });
    const path = normalizeRelativePath(requestedPath);
    const lockPath = this.#lockPath(path);
    try {
      await ensureDirectory((0, import_node_path6.dirname)(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, async () => {
        const { candidate } = await this.#target(path, { allowMissing: true });
        let current;
        try {
          current = await this.read(path);
        } catch (error3) {
          if (error3?.code !== "MARKDOWN_NOT_FOUND") throw error3;
          current = { path, content: "", exists: false, created: false, size: 0, etag: digest(""), updatedAt: null };
        }
        if (String(baseEtag) !== String(current?.etag ?? digest(""))) {
          throw new BridgeError("MARKDOWN_CONFLICT", "Markdown \u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u6216 Agent \u4FEE\u6539", {
            status: 409,
            details: current ? { current: { path: current.path, content: current.content, size: current.size, etag: current.etag, updatedAt: current.updatedAt } } : { current: null }
          });
        }
        await (0, import_promises5.mkdir)((0, import_node_path6.dirname)(candidate), { recursive: true });
        await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
        await atomicWriteFile(candidate, content);
        const metadata = await (0, import_promises5.stat)(candidate);
        return result(path, content, metadata);
      }, { timeoutMs: 5e3, staleMs: 3e4 });
    } catch (error3) {
      if (error3 instanceof BridgeError) throw error3;
      if (error3?.code === "LOCK_TIMEOUT") throw new BridgeError("MARKDOWN_BUSY", "Markdown \u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", { status: 409, cause: error3 });
      throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error3 });
    }
  }
  async reveal(requestedPath) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    const exists3 = await (0, import_promises5.stat)(candidate).then(() => true).catch((error3) => error3?.code === "ENOENT" ? false : Promise.reject(error3));
    return { path, exists: exists3, opened: false };
  }
};

// src/bridge/human-md-updates.mjs
var import_promises6 = require("node:fs/promises");
var import_node_path7 = require("node:path");
var DEFAULT_MAX_LOG_BYTES = 512 * 1024;
var HumanMdUpdateLog = class {
  constructor(options = {}) {
    if (!options?.projectRoot) throw new TypeError("HumanMdUpdateLog \u9700\u8981 projectRoot");
    this.projectRoot = (0, import_node_path7.resolve)(options.projectRoot);
    this.mapKey = String(options.mapKey ?? "default");
    this.maxBytes = Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : DEFAULT_MAX_LOG_BYTES;
    this.logPath = (0, import_node_path7.join)(this.projectRoot, ".live-dot-map", "maps", this.mapKey, ".bridge", "human-md-updates.ndjson");
    this.lockPath = `${this.logPath}.lock`;
  }
  async record({ path, etag, mtime, snippet }) {
    const line = JSON.stringify({
      t: "u",
      path: String(path || ""),
      etag: String(etag || ""),
      mtime: String(mtime || ""),
      snippet: String(snippet || "").replace(/\s+/g, " ").slice(0, 160),
      ts: (/* @__PURE__ */ new Date()).toISOString()
    });
    return this.#withLock(async () => {
      await appendDurable(this.logPath, line);
      await this.#compactIfNeeded();
    });
  }
  async acknowledge(paths) {
    const list = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
    if (!list.length) return { acknowledged: [] };
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    await this.#withLock(async () => {
      for (const path of list) await appendDurable(this.logPath, JSON.stringify({ t: "a", path, ts }));
    });
    return { acknowledged: list };
  }
  /** 未确认的人类 md 写入，按 mtime 倒序。 */
  async unacknowledged() {
    const states = await this.#replay();
    return [...states.values()].filter((state) => state.t === "u" && state.path).map((state) => ({
      id: `md:${state.path}`,
      path: state.path,
      etag: String(state.etag ?? ""),
      mtime: String(state.mtime ?? ""),
      snippet: String(state.snippet ?? ""),
      attention: "new"
    })).sort((left, right) => String(right.mtime).localeCompare(String(left.mtime)));
  }
  async #replay() {
    const states = /* @__PURE__ */ new Map();
    let text = "";
    try {
      text = await (0, import_promises6.readFile)(this.logPath, "utf8");
    } catch (error3) {
      if (error3?.code === "ENOENT") return states;
      throw error3;
    }
    for (const line of text.split("\n")) {
      const raw = line.trim();
      if (!raw) continue;
      let entry;
      try {
        entry = JSON.parse(raw);
      } catch {
        continue;
      }
      if (entry?.t === "u" && typeof entry.path === "string" && entry.path) {
        states.set(entry.path, entry);
      } else if (entry?.t === "a" && typeof entry.path === "string" && entry.path) {
        const previous = states.get(entry.path);
        states.set(entry.path, previous && previous.t === "u" ? { ...previous, t: "a" } : { t: "a", path: entry.path });
      }
    }
    return states;
  }
  async #withLock(operation) {
    await ensureDirectory((0, import_node_path7.join)(this.projectRoot, ".live-dot-map", "maps", this.mapKey, ".bridge"));
    return withFileLock(this.lockPath, operation, { timeoutMs: 5e3, staleMs: 3e4 });
  }
  async #compactIfNeeded() {
    let size = 0;
    try {
      size = (await (0, import_promises6.stat)(this.logPath)).size;
    } catch {
      return;
    }
    if (size <= this.maxBytes) return;
    const states = await this.#replay();
    const pending = [...states.values()].filter((state) => state.t === "u");
    await atomicWriteFile(this.logPath, pending.length ? `${pending.map((state) => JSON.stringify(state)).join("\n")}
` : "");
  }
};

// src/bridge/map-manager.mjs
var import_node_crypto5 = require("node:crypto");
var import_node_path9 = require("node:path");

// src/bridge/bundle-store.mjs
var import_node_fs = require("node:fs");
var import_promises7 = require("node:fs/promises");
var import_node_crypto4 = require("node:crypto");
var import_node_path8 = require("node:path");
var MAX_ASSET_BYTES = 20 * 1024 * 1024;
var MAX_BUNDLE_FILES = 200;
var MAX_MAP_ASSET_BYTES = 1024 * 1024 * 1024;
var MAX_NAME_BYTES = 255;
var OWNER_KINDS = /* @__PURE__ */ new Map([
  ["node", "nodes"],
  ["nodes", "nodes"],
  ["route", "routes"],
  ["routes", "routes"]
]);
var ASSET_TYPES = Object.freeze({
  ".png": { mime: "image/png", kind: "png" },
  ".jpg": { mime: "image/jpeg", kind: "jpeg" },
  ".jpeg": { mime: "image/jpeg", kind: "jpeg" },
  ".webp": { mime: "image/webp", kind: "webp" },
  ".gif": { mime: "image/gif", kind: "gif" },
  ".pdf": { mime: "application/pdf", kind: "pdf" },
  ".docx": { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx" },
  ".svg": { mime: "image/svg+xml", kind: "svg", disposition: "attachment" }
});
var ASSET_EXTENSIONS = new Set(Object.keys(ASSET_TYPES));
var RESERVED_DEVICE_NAMES = /^(con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;
var MAX_MARKDOWN_BYTES2 = 2 * 1024 * 1024;
function bridgeError(code, message, status = 400, details) {
  return new BridgeError(code, message, { status, details });
}
function asOptions(args, keys) {
  if (args.length === 1 && args[0] && typeof args[0] === "object" && !Buffer.isBuffer(args[0])) return { ...args[0] };
  return Object.fromEntries(keys.map((key, index) => [key, args[index]]));
}
function digest2(value) {
  return (0, import_node_crypto4.createHash)("sha256").update(value).digest("hex");
}
function caseKey(value) {
  return String(value).normalize("NFKC").toLocaleLowerCase("en-US");
}
function within(root, candidate) {
  const value = (0, import_node_path8.relative)(root, candidate);
  return value === "" || value !== ".." && !value.startsWith(`..${import_node_path8.sep}`) && !/^[A-Za-z]:[\\/]/.test(value);
}
function decodeForSecurity(input) {
  let current = String(input);
  for (let round = 0; round < 4; round += 1) {
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      break;
    }
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}
function validateSegment(input, label = "\u540D\u79F0") {
  if (typeof input !== "string" || input.length === 0 || Buffer.byteLength(input, "utf8") > MAX_NAME_BYTES) {
    throw bridgeError("BUNDLE_NAME_INVALID", `${label}\u65E0\u6548`, 400);
  }
  const decoded = decodeForSecurity(input);
  if (decoded.includes("\0") || decoded.includes("/") || decoded.includes("\\") || decoded === "." || decoded === "..") {
    throw bridgeError("BUNDLE_PATH_TRAVERSAL", `${label}\u5305\u542B\u975E\u6CD5\u8DEF\u5F84`, 403);
  }
  if (input.includes("\0") || input.includes("/") || input.includes("\\") || input.includes(":")) {
    throw bridgeError("BUNDLE_PATH_INVALID", `${label}\u4E0D\u80FD\u5305\u542B\u8DEF\u5F84\u5206\u9694\u7B26\u3001\u76D8\u7B26\u6216 ADS`, 403);
  }
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(decoded) || decoded === "." || decoded === ".." || decoded.endsWith(".") || decoded.endsWith(" ")) {
    throw bridgeError("BUNDLE_PATH_INVALID", `${label}\u4E0D\u80FD\u4F7F\u7528\u8DEF\u5F84\u7A7F\u8D8A\u3001\u5C3E\u70B9\u6216\u5C3E\u7A7A\u683C`, 403);
  }
  if (RESERVED_DEVICE_NAMES.test(input)) {
    throw bridgeError("BUNDLE_RESERVED_NAME", `${label}\u4E0D\u80FD\u4F7F\u7528 Windows \u4FDD\u7559\u8BBE\u5907\u540D`, 403);
  }
  return input;
}
function normalizeOwnerKind(ownerKind) {
  const value = OWNER_KINDS.get(String(ownerKind || "").toLowerCase());
  if (!value) throw bridgeError("BUNDLE_OWNER_INVALID", "\u8D44\u6599\u5305\u5BF9\u8C61\u7C7B\u578B\u5FC5\u987B\u662F node \u6216 route", 400);
  return value;
}
function validateOwnerId(ownerId) {
  validateSegment(ownerId, "\u5BF9\u8C61 ID");
  if (String(ownerId).startsWith(".")) throw bridgeError("BUNDLE_OWNER_INVALID", "\u5BF9\u8C61 ID \u65E0\u6548", 400);
  return ownerId;
}
function normalizeFileName(fileName, { asset = false } = {}) {
  const value = validateSegment(fileName, "\u8D44\u6599\u5305\u6587\u4EF6\u540D");
  if (value.startsWith(".")) throw bridgeError("BUNDLE_NAME_INVALID", "\u8D44\u6599\u5305\u6587\u4EF6\u540D\u4E0D\u80FD\u4EE5\u70B9\u5F00\u5934", 400);
  if (caseKey(value) === "index.md") return "index.md";
  if (!/\.md$/i.test(value) && !asset) throw bridgeError("BUNDLE_MARKDOWN_REQUIRED", "\u8865\u5145\u8D44\u6599\u5FC5\u987B\u662F .md \u6587\u4EF6", 415);
  if (asset && !ASSET_EXTENSIONS.has((0, import_node_path8.extname)(value).toLowerCase())) {
    throw bridgeError("BUNDLE_ASSET_TYPE_UNSUPPORTED", "\u9644\u4EF6\u7C7B\u578B\u4E0D\u5728\u5141\u8BB8\u6E05\u5355\u5185", 415);
  }
  return value;
}
function titleMarkdown(name, title) {
  const fallback = (0, import_node_path8.basename)(name, (0, import_node_path8.extname)(name)).slice(0, 80) || "\u672A\u547D\u540D\u8D44\u6599";
  return `# ${String(title || fallback).slice(0, 80)}

`;
}
function contentTypeFor(fileName) {
  const type = ASSET_TYPES[(0, import_node_path8.extname)(fileName).toLowerCase()];
  if (!type) throw bridgeError("BUNDLE_ASSET_TYPE_UNSUPPORTED", "\u9644\u4EF6\u7C7B\u578B\u4E0D\u5728\u5141\u8BB8\u6E05\u5355\u5185", 415);
  return type;
}
function headerMatches(kind, header) {
  if (kind === "png") return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (kind === "jpeg") return header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (kind === "webp") return header.length >= 12 && header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP";
  if (kind === "gif") return header.length >= 6 && ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6));
  if (kind === "pdf") return header.subarray(0, 5).toString("ascii") === "%PDF-";
  if (kind === "docx") return header.length >= 4 && header[0] === 80 && header[1] === 75 && header[2] === 3 && header[3] === 4;
  if (kind === "svg") {
    const text = header.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    return /^(?:<\?xml\b[^>]*>\s*)?<svg(?:\s|>)/i.test(text);
  }
  return false;
}
function normalizeMime(mimeType) {
  if (mimeType === void 0 || mimeType === null || mimeType === "") return void 0;
  return String(mimeType).split(";", 1)[0].trim().toLowerCase();
}
function compareStats(left, right) {
  return Number(left.size) === Number(right.size) && Number(left.mtimeMs) === Number(right.mtimeMs) && (left.ino === void 0 || right.ino === void 0 || Number(left.ino) === Number(right.ino));
}
async function safeLstat(path) {
  return (0, import_promises7.lstat)(path).catch((error3) => {
    if (error3?.code === "ENOENT") return null;
    throw error3;
  });
}
var BundleStore = class _BundleStore {
  constructor(options = {}, legacyMapKey = "default") {
    const value = typeof options === "string" ? { projectRoot: options, mapKey: legacyMapKey } : options;
    if (!value?.projectRoot) throw bridgeError("BUNDLE_PROJECT_REQUIRED", "\u8D44\u6599\u5305\u9700\u8981\u9879\u76EE\u6839\u76EE\u5F55", 400);
    this.projectRoot = (0, import_node_path8.resolve)(value.projectRoot);
    this.mapKey = value.mapKey ?? legacyMapKey;
    if (!isSafeMapId(this.mapKey)) throw bridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", 400, { mapKey: this.mapKey });
    this.mapRoot = (0, import_node_path8.resolve)(value.mapDirectory ?? mapDirectory(this.projectRoot, this.mapKey));
    this.clock = value.clock ?? (() => /* @__PURE__ */ new Date());
    this.faultInjector = value.faultInjector ?? (() => void 0);
    this.lockRoot = (0, import_node_path8.join)(this.mapRoot, ".bridge", "bundle-locks");
    this.commandRoot = (0, import_node_path8.join)(this.mapRoot, ".bridge", "bundle-commands");
  }
  static async open(options) {
    const store = new _BundleStore(options);
    await store.initialize();
    return store;
  }
  async initialize() {
    await this.#assertSafePath(this.projectRoot, this.projectRoot, { allowMissing: false });
    await this.#ensureMapRoot();
    return this;
  }
  async #ensureMapRoot() {
    await this.#assertSafePath(this.projectRoot, this.mapRoot, { allowMissing: true });
    await ensureDirectory(this.mapRoot);
    await this.#assertSafePath(this.projectRoot, this.mapRoot, { allowMissing: false });
  }
  async #assertSafePath(root, candidate, { allowMissing = true } = {}) {
    const rootReal = await (0, import_promises7.realpath)(root).catch((error3) => {
      if (error3?.code === "ENOENT" && allowMissing) return (0, import_node_path8.resolve)(root);
      throw error3;
    });
    if (!within(rootReal, (0, import_node_path8.resolve)(candidate))) throw bridgeError("BUNDLE_PATH_OUTSIDE_PROJECT", "\u8D44\u6599\u5305\u8DEF\u5F84\u4E0D\u5728\u9879\u76EE\u5185", 403, { path: candidate });
    let cursor = (0, import_node_path8.resolve)(candidate);
    while (true) {
      const metadata = await safeLstat(cursor);
      if (metadata) {
        if (metadata.isSymbolicLink()) throw bridgeError("BUNDLE_SYMLINK_FORBIDDEN", "\u8D44\u6599\u5305\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u6216 junction \u8BBF\u95EE", 403, { path: cursor });
        if (cursor !== (0, import_node_path8.resolve)(candidate) && !metadata.isDirectory()) throw bridgeError("BUNDLE_PATH_INVALID", "\u8D44\u6599\u5305\u7236\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55", 409, { path: cursor });
        if (cursor === rootReal) break;
      } else if (!allowMissing) {
        throw bridgeError("BUNDLE_NOT_FOUND", "\u8D44\u6599\u5305\u8DEF\u5F84\u4E0D\u5B58\u5728", 404, { path: cursor });
      }
      const parent = (0, import_node_path8.dirname)(cursor);
      if (parent === cursor || !within(rootReal, parent)) break;
      cursor = parent;
    }
  }
  #ownerInfo(input) {
    const ownerKind = normalizeOwnerKind(input.ownerKind);
    const ownerId = validateOwnerId(input.ownerId);
    const directory = (0, import_node_path8.join)(this.mapRoot, ownerKind, ownerId);
    return { ownerKind, ownerId, directory };
  }
  #lockPath(ownerKind, ownerId) {
    return (0, import_node_path8.join)(this.lockRoot, `${digest2(`${ownerKind}/${ownerId}`)}.lock`);
  }
  async #withOwnerLock(info, operation) {
    await this.#ensureMapRoot();
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: true });
    await ensureDirectory(this.lockRoot);
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: false });
    try {
      return await withFileLock(this.#lockPath(info.ownerKind, info.ownerId), operation, { timeoutMs: 1e4, staleMs: 3e4 });
    } catch (error3) {
      if (error3?.code === "LOCK_TIMEOUT") throw bridgeError("BUNDLE_BUSY", "\u8D44\u6599\u5305\u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", 409);
      throw error3;
    }
  }
  async #prepareOwner(info) {
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: true });
    await (0, import_promises7.mkdir)(info.directory, { recursive: true });
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: false });
  }
  async #entries(info, { includeArchived = false } = {}) {
    await this.#assertSafePath(this.projectRoot, info.directory, { allowMissing: true });
    const active = await (0, import_promises7.readdir)(info.directory, { withFileTypes: true }).catch((error3) => {
      if (error3?.code === "ENOENT") return [];
      throw error3;
    });
    const output = [];
    for (const entry of active) {
      if (entry.name === ".archive") continue;
      if (entry.name.startsWith(".")) continue;
      const path = (0, import_node_path8.join)(info.directory, entry.name);
      await this.#assertSafePath(this.projectRoot, path, { allowMissing: false });
      if (!entry.isFile()) continue;
      if (!/\.md$/i.test(entry.name) && !ASSET_EXTENSIONS.has((0, import_node_path8.extname)(entry.name).toLowerCase())) continue;
      output.push({ name: entry.name, path, archived: false });
    }
    if (!includeArchived) return output;
    const archivedRoot = (0, import_node_path8.join)(info.directory, ".archive");
    const archived = await (0, import_promises7.readdir)(archivedRoot, { withFileTypes: true }).catch((error3) => {
      if (error3?.code === "ENOENT") return [];
      throw error3;
    });
    await this.#assertSafePath(this.projectRoot, archivedRoot, { allowMissing: true });
    for (const entry of archived) {
      if (entry.name.startsWith(".") || entry.name.endsWith(".meta.json")) continue;
      const path = (0, import_node_path8.join)(archivedRoot, entry.name);
      await this.#assertSafePath(this.projectRoot, path, { allowMissing: false });
      if (entry.isFile() && (/\.md$/i.test(entry.name) || ASSET_EXTENSIONS.has((0, import_node_path8.extname)(entry.name).toLowerCase()))) {
        output.push({ name: entry.name, path, archived: true });
      }
    }
    return output;
  }
  async #fileInfo(info, entry) {
    const metadata = await (0, import_promises7.stat)(entry.path);
    const isIndex = entry.name === "index.md";
    const isMarkdown = isIndex || /\.md$/i.test(entry.name);
    const type = isMarkdown ? { mime: "text/markdown; charset=utf-8", kind: "markdown" } : contentTypeFor(entry.name);
    const markdownContent = isMarkdown ? entry.content === void 0 ? await (0, import_promises7.readFile)(entry.path) : Buffer.from(entry.content) : void 0;
    return {
      ownerKind: info.ownerKind === "nodes" ? "node" : "route",
      ownerId: info.ownerId,
      name: entry.name,
      fileName: entry.name,
      path: `${info.ownerKind}/${info.ownerId}/${entry.name}`,
      archived: Boolean(entry.archived),
      isIndex,
      kind: type.kind,
      mimeType: type.mime,
      disposition: type.disposition ?? "inline",
      size: metadata.size,
      updatedAt: metadata.mtime?.toISOString?.() ?? null,
      ...isMarkdown ? { etag: digest2(markdownContent) } : {}
    };
  }
  async list(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "options"]);
    const info = this.#ownerInfo(input);
    const includeArchived = Boolean(input.includeArchived ?? input.options?.includeArchived);
    const entries = await this.#entries(info, { includeArchived });
    const result2 = [];
    for (const entry of entries) result2.push(await this.#fileInfo(info, entry));
    result2.sort((left, right) => Number(right.isIndex) - Number(left.isIndex) || left.name.localeCompare(right.name, "en"));
    return result2;
  }
  async #resolveEntry(info, fileName, { archived = false, includeArchived = false, asset = false } = {}) {
    const name = normalizeFileName(fileName, { asset });
    if (name === "index.md" && archived) throw bridgeError("BUNDLE_INDEX_IMMUTABLE", "index.md \u4E0D\u5141\u8BB8\u5F52\u6863", 409);
    const entries = await this.#entries(info, { includeArchived: archived || includeArchived });
    const entry = entries.find((item) => item.archived === archived && caseKey(item.name) === caseKey(name));
    if (!entry) throw bridgeError("BUNDLE_NOT_FOUND", "\u8D44\u6599\u5305\u6587\u4EF6\u4E0D\u5B58\u5728", 404, { ownerKind: info.ownerKind, ownerId: info.ownerId, fileName: name });
    return entry;
  }
  async read(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "options"]);
    const options = input.options ?? {};
    const info = this.#ownerInfo(input);
    const entry = await this.#resolveEntry(info, input.fileName ?? "index.md", {
      archived: Boolean(input.archived ?? options.archived),
      asset: Boolean(input.asset ?? options.asset)
    });
    const data = await (0, import_promises7.readFile)(entry.path);
    const metadata = await this.#fileInfo(info, { ...entry, content: data });
    return { ...metadata, content: metadata.kind === "markdown" ? data.toString("utf8") : data, buffer: data };
  }
  async readMarkdown(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "options"]);
    const result2 = await this.read({ ...input, fileName: input.fileName ?? "index.md" });
    if (result2.kind !== "markdown") throw bridgeError("BUNDLE_MARKDOWN_REQUIRED", "\u76EE\u6807\u4E0D\u662F Markdown \u6587\u4EF6", 415);
    return result2;
  }
  async readAsset(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "options"]);
    const result2 = await this.read({ ...input, asset: true });
    if (result2.kind === "markdown") throw bridgeError("BUNDLE_ASSET_REQUIRED", "\u76EE\u6807\u4E0D\u662F\u9644\u4EF6", 415);
    return result2;
  }
  async createMarkdown(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "content"]);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? "note.md");
    if (name === "index.md") throw bridgeError("BUNDLE_INDEX_CREATE_USE_ENSURE", "\u4E3B\u6587\u6863\u5E94\u901A\u8FC7 ensureIndex \u521B\u5EFA", 409);
    const content = input.content === void 0 ? titleMarkdown(name, input.title) : String(input.content);
    if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES2) throw bridgeError("BUNDLE_MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB", 413);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const entries = await this.#entries(info, { includeArchived: true });
      if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError("BUNDLE_FILE_QUOTA", "\u5355\u8D44\u6599\u5305\u6700\u591A\u4FDD\u5B58 200 \u4E2A\u6587\u4EF6", 413);
      const names = new Set(entries.map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = (0, import_node_path8.join)(info.directory, finalName);
      await atomicWriteFile(target, content);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }
  async ensureIndex(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "content"]);
    const info = this.#ownerInfo(input);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const target = (0, import_node_path8.join)(info.directory, "index.md");
      const current = await safeLstat(target);
      if (current) {
        if (current.isSymbolicLink() || !current.isFile()) throw bridgeError("BUNDLE_SYMLINK_FORBIDDEN", "index.md \u4E0D\u662F\u5B89\u5168\u666E\u901A\u6587\u4EF6", 403);
        return this.#fileInfo(info, { name: "index.md", path: target, archived: false });
      }
      const entries = await this.#entries(info, { includeArchived: true });
      if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError("BUNDLE_FILE_QUOTA", "\u5355\u8D44\u6599\u5305\u6700\u591A\u4FDD\u5B58 200 \u4E2A\u6587\u4EF6", 413);
      const content = input.content === void 0 ? titleMarkdown("index.md", input.title) : String(input.content);
      if (Buffer.byteLength(content, "utf8") > MAX_MARKDOWN_BYTES2) throw bridgeError("BUNDLE_MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB", 413);
      await atomicWriteFile(target, content);
      return this.#fileInfo(info, { name: "index.md", path: target, archived: false });
    });
  }
  async replaceMarkdown(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "content", "baseEtag"]);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? "index.md");
    if (typeof input.content !== "string") throw bridgeError("BUNDLE_CONTENT_REQUIRED", "Markdown \u5185\u5BB9\u5FC5\u987B\u662F\u6587\u672C", 400);
    if (typeof input.baseEtag !== "string" || input.baseEtag.length === 0) {
      throw bridgeError("MARKDOWN_BASE_ETAG_REQUIRED", "\u66FF\u6362 Markdown \u5FC5\u987B\u63D0\u4F9B baseEtag", 400);
    }
    if (Buffer.byteLength(input.content, "utf8") > MAX_MARKDOWN_BYTES2) throw bridgeError("BUNDLE_MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB", 413);
    return this.#withOwnerLock(info, async () => {
      const entry = await this.#resolveEntry(info, name);
      await this.#prepareOwner(info);
      let current;
      try {
        current = await (0, import_promises7.readFile)(entry.path);
      } catch (error3) {
        if (error3?.code === "ENOENT") throw bridgeError("BUNDLE_NOT_FOUND", "\u8D44\u6599\u5305\u6587\u4EF6\u4E0D\u5B58\u5728", 404, { ownerKind: info.ownerKind, ownerId: info.ownerId, fileName: name });
        throw error3;
      }
      const currentEtag = digest2(current);
      if (String(input.baseEtag) !== currentEtag) {
        const currentMetadata = await this.#fileInfo(info, { ...entry, content: current });
        throw bridgeError("MARKDOWN_CONFLICT", "Markdown \u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u6216 Agent \u4FEE\u6539", 409, {
          current: {
            ...currentMetadata,
            content: current.toString("utf8")
          }
        });
      }
      await atomicWriteFile(entry.path, input.content);
      return this.#fileInfo(info, { ...entry, path: entry.path, content: Buffer.from(input.content) });
    });
  }
  async appendMarkdown(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "content", "commandId"]);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName ?? "index.md");
    if (typeof input.content !== "string") throw bridgeError("BUNDLE_CONTENT_REQUIRED", "Markdown \u5185\u5BB9\u5FC5\u987B\u662F\u6587\u672C", 400);
    if (typeof input.commandId !== "string" || input.commandId.length === 0) {
      throw bridgeError("BUNDLE_COMMAND_ID_REQUIRED", "\u8FFD\u52A0 Markdown \u5FC5\u987B\u63D0\u4F9B commandId", 400);
    }
    if (Buffer.byteLength(input.content, "utf8") > MAX_MARKDOWN_BYTES2) throw bridgeError("BUNDLE_MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB", 413);
    return this.#withOwnerLock(info, async () => {
      await this.#prepareOwner(info);
      const commandId = input.commandId;
      const requestDigest = digest2(JSON.stringify({ name, content: input.content }));
      await this.#assertSafePath(this.projectRoot, this.commandRoot, { allowMissing: true });
      await ensureDirectory(this.commandRoot);
      const receiptPath = (0, import_node_path8.join)(this.commandRoot, `${digest2(`${info.ownerKind}/${info.ownerId}/${name}/${commandId}`)}.json`);
      const receipt = await readJson(receiptPath).catch((error3) => error3?.code === "ENOENT" ? null : (() => {
        throw error3;
      })());
      if (receipt?.requestDigest !== void 0 && receipt.requestDigest !== requestDigest) {
        throw bridgeError("BUNDLE_COMMAND_REUSE", "commandId \u5DF2\u7528\u4E8E\u5176\u4ED6 Markdown \u8FFD\u52A0", 409);
      }
      const target = (0, import_node_path8.join)(info.directory, name);
      const current = await safeLstat(target);
      let existing = "";
      if (current) {
        if (current.isSymbolicLink() || !current.isFile()) throw bridgeError("BUNDLE_SYMLINK_FORBIDDEN", "Markdown \u76EE\u6807\u4E0D\u662F\u5B89\u5168\u666E\u901A\u6587\u4EF6", 403);
        existing = await (0, import_promises7.readFile)(target, "utf8");
      } else {
        const entries = await this.#entries(info, { includeArchived: true });
        if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError("BUNDLE_FILE_QUOTA", "\u5355\u8D44\u6599\u5305\u6700\u591A\u4FDD\u5B58 200 \u4E2A\u6587\u4EF6", 413);
      }
      const normalizeBoundary = (value) => String(value).replace(/\r\n?/g, "\n").replace(/^\n+/g, "").replace(/\n+$/g, "");
      const left = normalizeBoundary(existing);
      const right = normalizeBoundary(input.content);
      const next = left.length === 0 ? right : right.length === 0 ? left : `${left}
${right}`;
      if (Buffer.byteLength(next, "utf8") > MAX_MARKDOWN_BYTES2) throw bridgeError("BUNDLE_MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB", 413);
      const beforeEtag = digest2(Buffer.from(existing));
      const afterEtag = digest2(Buffer.from(next));
      if (receipt && receipt.state !== "prepared") {
        return this.#fileInfo(info, { name, path: target, archived: false });
      }
      if (receipt?.state === "prepared") {
        if (beforeEtag === receipt.afterEtag) {
          const result3 = await this.#fileInfo(info, { name, path: target, archived: false });
          await writeJsonAtomic(receiptPath, { ...receipt, state: "committed", result: result3 });
          return result3;
        }
        if (beforeEtag !== receipt.beforeEtag || afterEtag !== receipt.afterEtag) {
          throw bridgeError("BUNDLE_APPEND_RECOVERY_CONFLICT", "Markdown \u8FFD\u52A0\u6062\u590D\u65F6\u53D1\u73B0\u5185\u5BB9\u5DF2\u53D8\u5316", 409);
        }
      } else {
        await writeJsonAtomic(receiptPath, {
          state: "prepared",
          requestDigest,
          beforeEtag,
          afterEtag
        });
      }
      await atomicWriteFile(target, next);
      await this.faultInjector("afterAppendReplaceBeforeReceipt", { info, name, commandId, target });
      const result2 = await this.#fileInfo(info, { name, path: target, archived: false, content: Buffer.from(next) });
      await writeJsonAtomic(receiptPath, { state: "committed", requestDigest, beforeEtag, afterEtag, result: result2 });
      return result2;
    });
  }
  async rename(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "from", "to"]);
    const info = this.#ownerInfo(input);
    const requestedFrom = input.from ?? input.fileName;
    const from = normalizeFileName(requestedFrom, { asset: typeof requestedFrom === "string" && !/\.md$/i.test(requestedFrom) });
    const to = normalizeFileName(input.to ?? input.newName, { asset: !/\.md$/i.test(from) });
    if (from === "index.md" || to === "index.md") throw bridgeError("BUNDLE_INDEX_IMMUTABLE", "index.md \u4E0D\u5141\u8BB8\u6539\u540D", 409);
    if (/\.md$/i.test(from) !== /\.md$/i.test(to)) throw bridgeError("BUNDLE_TYPE_CHANGE_FORBIDDEN", "\u6539\u540D\u4E0D\u80FD\u6539\u53D8 Markdown/\u9644\u4EF6\u7C7B\u578B", 415);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, from, { asset: !/\.md$/i.test(from) });
      if (!/\.md$/i.test(from) && contentTypeFor(from).kind !== contentTypeFor(to).kind) {
        throw bridgeError("BUNDLE_TYPE_CHANGE_FORBIDDEN", "\u9644\u4EF6\u6539\u540D\u4E0D\u80FD\u6539\u53D8\u6587\u4EF6\u7C7B\u578B", 415);
      }
      const names = new Set((await this.#entries(info, { includeArchived: true })).filter((entry) => caseKey(entry.name) !== caseKey(from)).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(to, names);
      const target = (0, import_node_path8.join)(info.directory, finalName);
      await this.#assertSafePath(this.projectRoot, source.path, { allowMissing: false });
      await (0, import_promises7.rename)(source.path, target);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }
  async archive(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName"]);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName, { asset: typeof input.fileName === "string" && !/\.md$/i.test(input.fileName) });
    if (name === "index.md") throw bridgeError("BUNDLE_INDEX_IMMUTABLE", "index.md \u4E0D\u5141\u8BB8\u5F52\u6863", 409);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, name, { asset: !/\.md$/i.test(name) });
      const archiveRoot = (0, import_node_path8.join)(info.directory, ".archive");
      await this.#assertSafePath(this.projectRoot, archiveRoot, { allowMissing: true });
      await ensureDirectory(archiveRoot);
      await this.#assertSafePath(this.projectRoot, archiveRoot, { allowMissing: false });
      const names = new Set((await this.#entries(info, { includeArchived: true })).filter((entry) => entry.archived).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = (0, import_node_path8.join)(archiveRoot, finalName);
      await (0, import_promises7.rename)(source.path, target);
      await writeJsonAtomic(`${target}.meta.json`, { archivedAt: this.clock().toISOString(), originalName: name });
      return this.#fileInfo(info, { name: finalName, path: target, archived: true });
    });
  }
  async restore(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName"]);
    const info = this.#ownerInfo(input);
    const name = normalizeFileName(input.fileName, { asset: typeof input.fileName === "string" && !/\.md$/i.test(input.fileName) });
    if (name === "index.md") throw bridgeError("BUNDLE_INDEX_IMMUTABLE", "index.md \u4E0D\u5141\u8BB8\u6062\u590D", 409);
    return this.#withOwnerLock(info, async () => {
      const source = await this.#resolveEntry(info, name, { archived: true, asset: !/\.md$/i.test(name) });
      await this.#prepareOwner(info);
      const names = new Set((await this.#entries(info)).map((entry) => caseKey(entry.name)));
      const finalName = this.#allocateName(name, names);
      const target = (0, import_node_path8.join)(info.directory, finalName);
      await (0, import_promises7.rename)(source.path, target);
      await (0, import_promises7.rm)(`${source.path}.meta.json`, { force: true }).catch(() => void 0);
      return this.#fileInfo(info, { name: finalName, path: target, archived: false });
    });
  }
  #allocateName(requested, occupied) {
    if (!occupied.has(caseKey(requested))) return requested;
    const extension = (0, import_node_path8.extname)(requested);
    const stem = requested.slice(0, requested.length - extension.length);
    for (let suffix = 2; suffix < 1e5; suffix += 1) {
      const candidate = `${stem}-${suffix}${extension}`;
      if (!occupied.has(caseKey(candidate))) return candidate;
    }
    throw bridgeError("BUNDLE_NAME_EXHAUSTED", "\u8D44\u6599\u5305\u91CD\u540D\u540E\u7F00\u5DF2\u8017\u5C3D", 409);
  }
  async #quota(info, incomingBytes = 0) {
    const entries = await this.#entries(info, { includeArchived: true });
    if (entries.length >= MAX_BUNDLE_FILES) throw bridgeError("BUNDLE_FILE_QUOTA", "\u5355\u8D44\u6599\u5305\u6700\u591A\u4FDD\u5B58 200 \u4E2A\u6587\u4EF6", 413);
    const mapEntries = [];
    for (const ownerKind of ["nodes", "routes"]) {
      const kindRoot = (0, import_node_path8.join)(this.mapRoot, ownerKind);
      await this.#assertSafePath(this.projectRoot, kindRoot, { allowMissing: true });
      const owners = await (0, import_promises7.readdir)(kindRoot, { withFileTypes: true }).catch((error3) => error3?.code === "ENOENT" ? [] : (() => {
        throw error3;
      })());
      for (const owner2 of owners) {
        if (!owner2.isDirectory() || owner2.name.startsWith(".")) continue;
        const ownerInfo = { ownerKind, ownerId: owner2.name, directory: (0, import_node_path8.join)(kindRoot, owner2.name) };
        const ownerEntries = await this.#entries(ownerInfo, { includeArchived: true });
        mapEntries.push(...ownerEntries.filter((entry) => !/\.md$/i.test(entry.name)));
      }
    }
    let total = incomingBytes;
    for (const entry of mapEntries) total += (await (0, import_promises7.stat)(entry.path)).size;
    if (total > MAX_MAP_ASSET_BYTES) throw bridgeError("BUNDLE_SIZE_QUOTA", "\u5355\u5730\u56FE\u9644\u4EF6\u603B\u91CF\u8D85\u8FC7 1 GiB", 413);
  }
  async #withMapLock(operation) {
    await this.#ensureMapRoot();
    await this.#assertSafePath(this.projectRoot, this.lockRoot, { allowMissing: true });
    await ensureDirectory(this.lockRoot);
    try {
      return await withFileLock((0, import_node_path8.join)(this.lockRoot, "map-assets.lock"), operation, { timeoutMs: 1e4, staleMs: 3e4 });
    } catch (error3) {
      if (error3?.code === "LOCK_TIMEOUT") throw bridgeError("BUNDLE_BUSY", "\u5730\u56FE\u9644\u4EF6\u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", 409);
      throw error3;
    }
  }
  async #consumeStream(stream, temporary) {
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function") throw bridgeError("BUNDLE_STREAM_REQUIRED", "\u9644\u4EF6\u5FC5\u987B\u901A\u8FC7\u53EF\u8BFB\u6D41\u5BFC\u5165", 400);
    await ensureDirectory((0, import_node_path8.dirname)(temporary));
    const handle = await (0, import_promises7.open)(temporary, "wx", 384);
    let size = 0;
    const chunks = [];
    let headerSize = 0;
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_ASSET_BYTES) throw bridgeError("BUNDLE_ASSET_TOO_LARGE", "\u5355\u9644\u4EF6\u8D85\u8FC7 20 MiB", 413, { limit: MAX_ASSET_BYTES });
        if (headerSize < 8192) {
          chunks.push(buffer.subarray(0, Math.min(buffer.length, 8192 - headerSize)));
          headerSize += Math.min(buffer.length, 8192 - headerSize);
        }
        await handle.write(buffer);
      }
      await handle.sync();
    } finally {
      await handle.close().catch(() => void 0);
    }
    return { size, header: Buffer.concat(chunks).subarray(0, 8192) };
  }
  async #copySource(sourcePath, temporary) {
    const candidate = (0, import_node_path8.resolve)(this.projectRoot, sourcePath);
    await this.#assertSafePath(this.projectRoot, candidate, { allowMissing: false });
    const before = await (0, import_promises7.stat)(candidate);
    if (!before.isFile()) throw bridgeError("BUNDLE_SOURCE_NOT_FILE", "\u9644\u4EF6\u6E90\u5FC5\u987B\u662F\u666E\u901A\u6587\u4EF6", 400);
    if (before.size > MAX_ASSET_BYTES) throw bridgeError("BUNDLE_ASSET_TOO_LARGE", "\u5355\u9644\u4EF6\u8D85\u8FC7 20 MiB", 413, { limit: MAX_ASSET_BYTES });
    let handle;
    try {
      const flags = import_node_fs.constants.O_RDONLY | (import_node_fs.constants.O_NOFOLLOW ?? 0);
      handle = await (0, import_promises7.open)(candidate, flags);
      const opened = await handle.stat();
      if (!opened.isFile() || !compareStats(before, opened)) throw bridgeError("BUNDLE_SOURCE_CHANGED", "\u9644\u4EF6\u6E90\u5728\u5BFC\u5165\u524D\u5DF2\u53D8\u5316", 409);
      const result2 = await this.#consumeStream(handle.createReadStream(), temporary);
      const after = await (0, import_promises7.stat)(candidate);
      if (!compareStats(before, after) || result2.size !== before.size) throw bridgeError("BUNDLE_SOURCE_CHANGED", "\u9644\u4EF6\u6E90\u5728\u5BFC\u5165\u8FC7\u7A0B\u4E2D\u53D1\u751F\u53D8\u5316", 409);
      return result2;
    } catch (error3) {
      if (error3?.code === "ELOOP") throw bridgeError("BUNDLE_SYMLINK_FORBIDDEN", "\u9644\u4EF6\u6E90\u4E0D\u5141\u8BB8\u662F\u7B26\u53F7\u94FE\u63A5", 403);
      throw error3;
    } finally {
      await handle?.close().catch(() => void 0);
    }
  }
  async importAsset(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "sourcePath", "stream", "mimeType"]);
    const info = this.#ownerInfo(input);
    const requestedName = normalizeFileName(input.fileName, { asset: true });
    const type = contentTypeFor(requestedName);
    const declaredMime = normalizeMime(input.mimeType ?? input.contentType);
    if (declaredMime && declaredMime !== type.mime) throw bridgeError("BUNDLE_MIME_MISMATCH", "\u58F0\u660E MIME \u4E0E\u6269\u5C55\u540D\u4E0D\u4E00\u81F4", 415, { expected: type.mime, received: declaredMime });
    if (!input.sourcePath && !input.stream) throw bridgeError("BUNDLE_SOURCE_REQUIRED", "\u9644\u4EF6\u5BFC\u5165\u9700\u8981 sourcePath \u6216 stream", 400);
    await this.#prepareOwner(info);
    const temporary = (0, import_node_path8.join)(info.directory, `.${(0, import_node_crypto4.randomBytes)(12).toString("hex")}.upload.tmp`);
    let imported;
    try {
      imported = input.sourcePath ? await this.#copySource(input.sourcePath, temporary) : await this.#consumeStream(input.stream, temporary);
      if (!headerMatches(type.kind, imported.header)) throw bridgeError("BUNDLE_FILE_HEADER_MISMATCH", "\u9644\u4EF6\u6587\u4EF6\u5934\u4E0E\u6269\u5C55\u540D\u4E0D\u4E00\u81F4", 415, { expected: type.kind });
      return await this.#withMapLock(() => this.#withOwnerLock(info, async () => {
        await this.#prepareOwner(info);
        await this.#quota(info, imported.size);
        const names = new Set((await this.#entries(info, { includeArchived: true })).map((entry) => caseKey(entry.name)));
        const finalName = this.#allocateName(requestedName, names);
        const target = (0, import_node_path8.join)(info.directory, finalName);
        await this.#assertSafePath(this.projectRoot, target, { allowMissing: true });
        await (0, import_promises7.rename)(temporary, target);
        const result2 = await this.#fileInfo(info, { name: finalName, path: target, archived: false });
        return { ...result2, mimeType: type.mime, disposition: type.disposition ?? "inline" };
      }));
    } finally {
      await (0, import_promises7.rm)(temporary, { force: true }).catch(() => void 0);
    }
  }
  async createReadStream(...args) {
    const input = asOptions(args, ["ownerKind", "ownerId", "fileName", "options"]);
    const options = input.options ?? {};
    const info = this.#ownerInfo(input);
    const entry = await this.#resolveEntry(info, input.fileName, { archived: Boolean(input.archived ?? options.archived), asset: true });
    const metadata = await this.#fileInfo(info, entry);
    return { ...metadata, stream: (0, import_node_fs.createReadStream)(entry.path) };
  }
};

// src/bridge/map-manager.mjs
var MapManager = class _MapManager {
  constructor(options = {}) {
    if (!options.projectRoot) throw new BridgeError("PROJECT_ROOT_REQUIRED", "MapManager \u9700\u8981\u9879\u76EE\u6839\u76EE\u5F55", { status: 400 });
    if (!options.shared) throw new BridgeError("SHARED_ADAPTER_REQUIRED", "MapManager \u9700\u8981 shared adapter", { status: 500 });
    this.projectRoot = (0, import_node_path9.resolve)(options.projectRoot);
    this.shared = options.shared;
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.snapshotEvery = options.snapshotEvery;
    this.pollIntervalMs = options.pollIntervalMs ?? 0;
    this.faultInjector = options.faultInjector;
    this.onEvent = options.onEvent ?? (() => {
    });
    this.onActiveMapChanged = options.onActiveMapChanged ?? (() => {
    });
    this.stores = /* @__PURE__ */ new Map();
    this.bundles = /* @__PURE__ */ new Map();
    this.lastImplicitKey = null;
    this.lockPath = (0, import_node_path9.join)(this.projectRoot, ".live-dot-map", ".bridge", "map-manager.lock");
  }
  static async open(options) {
    const manager = new _MapManager(options);
    await manager.initialize();
    return manager;
  }
  async initialize() {
    await withFileLock(this.lockPath, () => ensureMapsLayout(this.projectRoot));
    return this;
  }
  async #assertMapExists(mapKey) {
    if (!isSafeMapId(mapKey)) throw new BridgeError("INVALID_MAP_KEY", "mapKey \u65E0\u6548", { status: 400 });
    const listed = await listMaps(this.projectRoot);
    if (!listed.maps.some((map) => map.id === mapKey)) {
      throw new BridgeError("MAP_NOT_FOUND", `\u5730\u56FE\u4E0D\u5B58\u5728\uFF1A${mapKey}`, { status: 404 });
    }
  }
  async #openStore(mapKey, mapName) {
    let store = this.stores.get(mapKey);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: this.projectRoot,
        dataDirectory: mapDirectory(this.projectRoot, mapKey),
        mapName,
        mapDir: mapRelativeDirectory(mapKey),
        shared: this.shared,
        snapshotEvery: this.snapshotEvery,
        pollIntervalMs: this.pollIntervalMs,
        clock: this.clock,
        faultInjector: this.faultInjector,
        onEvent: (event) => this.onEvent({ ...event, mapKey })
      });
      this.stores.set(mapKey, store);
    }
    return store;
  }
  async resolve(options = {}) {
    const explicit = typeof options.mapKey === "string" && options.mapKey.length > 0;
    const mapKey = explicit ? options.mapKey : await resolveActiveMap(this.projectRoot);
    await this.#assertMapExists(mapKey);
    if (!explicit && this.lastImplicitKey && this.lastImplicitKey !== mapKey) {
      const stale = this.stores.get(this.lastImplicitKey);
      await stale?.close().catch(() => void 0);
      this.stores.delete(this.lastImplicitKey);
      this.bundles.delete(this.lastImplicitKey);
    }
    if (!explicit) this.lastImplicitKey = mapKey;
    const store = await this.#openStore(mapKey);
    const snapshot = await store.snapshot();
    let bundleStore = this.bundles.get(mapKey);
    if (!bundleStore) {
      bundleStore = await BundleStore.open({ projectRoot: this.projectRoot, mapKey, clock: this.clock });
      this.bundles.set(mapKey, bundleStore);
    }
    return {
      projectRoot: this.projectRoot,
      mapKey,
      documentId: String(snapshot.document.mapId),
      store,
      bundleStore,
      snapshot
    };
  }
  list() {
    return listMaps(this.projectRoot);
  }
  async create(name = "") {
    return withFileLock(this.lockPath, async () => {
      const created = await createMap(this.projectRoot, name, { now: this.clock });
      try {
        const store = await this.#openStore(created.id, created.name);
        const snapshot = await store.snapshot();
        const bundleStore = await BundleStore.open({ projectRoot: this.projectRoot, mapKey: created.id, clock: this.clock });
        this.bundles.set(created.id, bundleStore);
        return { createdMap: created.id, activeMap: await resolveActiveMap(this.projectRoot), documentId: String(snapshot.document.mapId), ...snapshot };
      } catch (error3) {
        throw new BridgeError("MAP_CREATE_FAILED", "\u5730\u56FE\u521D\u59CB\u5316\u5931\u8D25\uFF0C\u5F53\u524D\u5730\u56FE\u672A\u5207\u6362", { status: 500, cause: error3, details: { mapKey: created.id } });
      }
    }).catch((error3) => {
      if (error3?.code === "LOCK_TIMEOUT") throw new BridgeError("MAP_MANAGER_BUSY", "\u5730\u56FE\u7BA1\u7406\u64CD\u4F5C\u7E41\u5FD9\uFF0C\u8BF7\u91CD\u8BD5", { status: 409 });
      throw error3;
    });
  }
  async switch(mapKey) {
    return withFileLock(this.lockPath, async () => {
      const context = await this.resolve({ mapKey });
      await writeActiveMap(this.projectRoot, mapKey);
      this.onActiveMapChanged({ type: "active-map-changed", mapKey, documentId: context.documentId });
      return { activeMap: mapKey, documentId: context.documentId, ...context.snapshot };
    }).catch((error3) => {
      if (error3?.code === "LOCK_TIMEOUT") throw new BridgeError("MAP_MANAGER_BUSY", "\u5730\u56FE\u7BA1\u7406\u64CD\u4F5C\u7E41\u5FD9\uFF0C\u8BF7\u91CD\u8BD5", { status: 409 });
      throw error3;
    });
  }
  async rename(mapKey, name, actor = "human") {
    const context = await this.resolve({ mapKey });
    const displayName = String(name ?? "").trim().slice(0, 80);
    if (!displayName) throw new BridgeError("MAP_NAME_REQUIRED", "\u5730\u56FE\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A", { status: 400 });
    return context.store.execute({
      projectId: context.documentId,
      baseRevision: context.snapshot.revision,
      commandId: `map-rename-${(0, import_node_crypto5.randomUUID)()}`,
      actor,
      sessionId: `map-manager-${(0, import_node_crypto5.randomUUID)()}`,
      commands: [{ op: "set_meta", patch: { name: displayName } }]
    });
  }
  async close() {
    await Promise.all([...this.stores.values()].map((store) => store.close().catch(() => void 0)));
    this.stores.clear();
    this.bundles.clear();
    this.lastImplicitKey = null;
  }
};

// src/bridge/tool-service.mjs
var import_node_crypto7 = require("node:crypto");
var import_node_path11 = require("node:path");

// src/bridge/context-document-provider.mjs
var import_node_crypto6 = require("node:crypto");
var import_promises8 = require("node:fs/promises");
var import_node_path10 = require("node:path");
var MAX_MARKDOWN_BYTES3 = 2 * 1024 * 1024;
var SAFE_OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
var ASSET_TYPES2 = Object.freeze({
  ".png": { kind: "png", mimeType: "image/png" },
  ".jpg": { kind: "jpeg", mimeType: "image/jpeg" },
  ".jpeg": { kind: "jpeg", mimeType: "image/jpeg" },
  ".webp": { kind: "webp", mimeType: "image/webp" },
  ".gif": { kind: "gif", mimeType: "image/gif" },
  ".pdf": { kind: "pdf", mimeType: "application/pdf" },
  ".docx": { kind: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  ".svg": { kind: "svg", mimeType: "image/svg+xml" }
});
var RESERVED_DATA_DIRS = /* @__PURE__ */ new Set([".bridge", ".archive", "backups", "snapshots", "quarantine", "wal", "locks"]);
function contextError(code, message, status = 403, details) {
  return new BridgeError(code, message, { status, details });
}
function hidden(item) {
  return item?.archived === true || item?.shelved === true;
}
function textPath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}
function within2(root, candidate) {
  const value = (0, import_node_path10.relative)(root, candidate);
  return value === "" || value !== ".." && !value.startsWith(`..${import_node_path10.sep}`) && !/^[A-Za-z]:[\\/]/.test(value);
}
function projectRelative(root, candidate) {
  return (0, import_node_path10.relative)(root, candidate).replace(/\\/g, "/");
}
function digest3(content) {
  return (0, import_node_crypto6.createHash)("sha256").update(content).digest("hex");
}
function collectionOwner(collection, item) {
  const ownerId = String(item?.id ?? "");
  if (!ownerId) return null;
  if (!SAFE_OWNER_ID.test(ownerId)) return null;
  if (collection === "nodes") return { ownerKind: "node", directoryKind: "nodes", ownerId };
  if (collection === "routes") return { ownerKind: "route", directoryKind: "routes", ownerId };
  if (collection === "edges") return { ownerKind: "edge", directoryKind: "routes", ownerId };
  return null;
}
function activeObjects(document, includeHistory) {
  const routes = Array.isArray(document?.routes) ? document.routes : [];
  const nodes = Array.isArray(document?.nodes) ? document.nodes : [];
  const edges = Array.isArray(document?.edges) ? document.edges : [];
  const routeById = new Map(routes.map((item) => [String(item?.id), item]));
  const nodeById = new Map(nodes.map((item) => [String(item?.id), item]));
  const routeVisible = (routeId) => includeHistory || typeof routeId !== "string" || !routeId || !hidden(routeById.get(routeId));
  const nodeVisible = (node) => includeHistory || !hidden(node) && routeVisible(typeof node?.route === "string" ? node.route : void 0);
  const edgeVisible = (edge) => {
    if (includeHistory) return true;
    if (hidden(edge) || !routeVisible(typeof edge?.route === "string" ? edge.route : void 0)) return false;
    const from = typeof edge?.from === "string" ? nodeById.get(edge.from) : void 0;
    const to = typeof edge?.to === "string" ? nodeById.get(edge.to) : void 0;
    return (!from || nodeVisible(from)) && (!to || nodeVisible(to));
  };
  const owners = [];
  for (const item of routes) if (includeHistory || !hidden(item)) {
    const owner2 = collectionOwner("routes", item);
    if (owner2) owners.push({ ...owner2, item });
  }
  for (const item of nodes) if (nodeVisible(item)) {
    const owner2 = collectionOwner("nodes", item);
    if (owner2) owners.push({ ...owner2, item });
  }
  for (const item of edges) if (edgeVisible(item)) {
    const owner2 = collectionOwner("edges", item);
    if (owner2) owners.push({ ...owner2, item });
  }
  return { owners, routeVisible, nodeVisible, edgeVisible };
}
async function requireRegularPath(root, candidate, { allowMissing = false } = {}) {
  const rootReal = await (0, import_promises8.realpath)(root).catch((error3) => {
    if (error3?.code === "ENOENT") throw contextError("CONTEXT_PROJECT_NOT_FOUND", "\u4E0A\u4E0B\u6587\u9879\u76EE\u6839\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
    throw error3;
  });
  const resolved = (0, import_node_path10.resolve)(candidate);
  if (!within2(rootReal, resolved)) throw contextError("CONTEXT_PATH_OUTSIDE_PROJECT", "\u4E0A\u4E0B\u6587\u6587\u4EF6\u4E0D\u5728\u9879\u76EE\u6839\u76EE\u5F55\u5185", 403, { path: candidate });
  let cursor = resolved;
  let target;
  while (true) {
    let metadata;
    try {
      metadata = await (0, import_promises8.lstat)(cursor);
    } catch (error3) {
      if (error3?.code !== "ENOENT") throw error3;
      if (!allowMissing) throw contextError("CONTEXT_FILE_NOT_FOUND", "\u4E0A\u4E0B\u6587\u6587\u4EF6\u4E0D\u5B58\u5728", 404, { path: candidate });
    }
    if (metadata) {
      if (metadata.isSymbolicLink()) throw contextError("CONTEXT_SYMLINK_FORBIDDEN", "\u4E0A\u4E0B\u6587\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BFB\u53D6\u6587\u4EF6", 403, { path: candidate });
      if (cursor === resolved) target = metadata;
    }
    if (cursor === rootReal || cursor === dirnameSafe(cursor)) break;
    cursor = dirnameSafe(cursor);
  }
  if (!target && !allowMissing) throw contextError("CONTEXT_FILE_NOT_FOUND", "\u4E0A\u4E0B\u6587\u6587\u4EF6\u4E0D\u5B58\u5728", 404, { path: candidate });
  if (target && !target.isFile()) throw contextError("CONTEXT_NOT_FILE", "\u4E0A\u4E0B\u6587\u8DEF\u5F84\u4E0D\u662F\u666E\u901A\u6587\u4EF6", 409, { path: candidate });
  return { rootReal, resolved, metadata: target };
}
async function requireSafeDirectory(root, candidate, { allowMissing = true } = {}) {
  const rootReal = await (0, import_promises8.realpath)(root).catch((error3) => {
    if (error3?.code === "ENOENT") throw contextError("CONTEXT_PROJECT_NOT_FOUND", "\u4E0A\u4E0B\u6587\u9879\u76EE\u6839\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
    throw error3;
  });
  const resolved = (0, import_node_path10.resolve)(candidate);
  if (!within2(rootReal, resolved)) throw contextError("CONTEXT_PATH_OUTSIDE_PROJECT", "\u4E0A\u4E0B\u6587\u76EE\u5F55\u4E0D\u5728\u9879\u76EE\u6839\u76EE\u5F55\u5185", 403, { path: candidate });
  let cursor = resolved;
  while (true) {
    let metadata;
    try {
      metadata = await (0, import_promises8.lstat)(cursor);
    } catch (error3) {
      if (error3?.code !== "ENOENT") throw error3;
      if (!allowMissing) throw contextError("CONTEXT_DIRECTORY_NOT_FOUND", "\u4E0A\u4E0B\u6587\u76EE\u5F55\u4E0D\u5B58\u5728", 404, { path: candidate });
    }
    if (metadata) {
      if (metadata.isSymbolicLink()) throw contextError("CONTEXT_SYMLINK_FORBIDDEN", "\u4E0A\u4E0B\u6587\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BFB\u53D6\u76EE\u5F55", 403, { path: candidate });
      if (cursor === resolved && !metadata.isDirectory()) throw contextError("CONTEXT_NOT_DIRECTORY", "\u4E0A\u4E0B\u6587\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55", 409, { path: candidate });
    }
    if (cursor === rootReal || cursor === dirnameSafe(cursor)) break;
    cursor = dirnameSafe(cursor);
  }
  return { rootReal, resolved };
}
function dirnameSafe(value) {
  const normalized = (0, import_node_path10.resolve)(value);
  const parent = (0, import_node_path10.resolve)(normalized, "..");
  return parent === normalized ? normalized : parent;
}
function isReservedRelative(relativePath) {
  const parts = relativePath.split("/").filter(Boolean);
  if (!parts.length) return true;
  if (parts.some((part) => part === "." || part === "..")) return true;
  if (parts.length === 1) return true;
  if (parts.some((part) => RESERVED_DATA_DIRS.has(part.toLowerCase()))) return true;
  return false;
}
function normalizedMapRoot(root, mapKey) {
  return (0, import_node_path10.resolve)(root, ".live-dot-map", "maps", mapKey);
}
function isInsideMap(root, mapRoot, candidate) {
  const mapRelative = projectRelative(root, mapRoot).toLowerCase().replace(/\\/g, "/");
  const candidateRelative = projectRelative(root, candidate).toLowerCase().replace(/\\/g, "/");
  return candidateRelative === mapRelative || candidateRelative.startsWith(`${mapRelative}/`);
}
function mergeOwner(entry, owner2) {
  const owners = Array.isArray(entry.owners) ? entry.owners : [];
  const key = `${owner2.ownerKind}:${owner2.ownerId}`;
  if (!owners.some((item) => `${item.ownerKind}:${item.ownerId}` === key)) owners.push({ ownerKind: owner2.ownerKind, ownerId: owner2.ownerId });
  entry.owners = owners;
  if (!entry.ownerKind) {
    entry.ownerKind = owner2.ownerKind;
    entry.ownerId = owner2.ownerId;
  }
}
async function collect({ projectRoot, mapKey, document, includeHistory = false } = {}) {
  if (typeof projectRoot !== "string" || !projectRoot.trim()) throw contextError("CONTEXT_PROJECT_REQUIRED", "\u4E0A\u4E0B\u6587\u9700\u8981\u9879\u76EE\u6839\u76EE\u5F55", 400);
  if (!isSafeMapId(mapKey)) throw contextError("CONTEXT_MAP_INVALID", "\u4E0A\u4E0B\u6587\u5730\u56FE ID \u65E0\u6548", 400, { mapKey });
  if (!document || typeof document !== "object") throw contextError("CONTEXT_DOCUMENT_REQUIRED", "\u4E0A\u4E0B\u6587\u9700\u8981\u5F53\u524D\u5730\u56FE\u6587\u6863", 400);
  const root = (0, import_node_path10.resolve)(projectRoot);
  const mapRoot = normalizedMapRoot(root, mapKey);
  const mapDir = `.live-dot-map/maps/${mapKey}`;
  const result2 = { mapKey, mapDir, markdown: [], assets: [] };
  const markdownByPath = /* @__PURE__ */ new Map();
  const assetsByPath = /* @__PURE__ */ new Map();
  const { owners } = activeObjects(document, includeHistory === true);
  const mapMetadata = await (0, import_promises8.lstat)(mapRoot).catch((error3) => error3?.code === "ENOENT" ? null : (() => {
    throw error3;
  })());
  if (mapMetadata?.isSymbolicLink()) throw contextError("CONTEXT_SYMLINK_FORBIDDEN", "\u5F53\u524D\u5730\u56FE\u76EE\u5F55\u4E0D\u5141\u8BB8\u662F\u7B26\u53F7\u94FE\u63A5", 403, { path: mapRoot });
  if (mapMetadata && !mapMetadata.isDirectory()) throw contextError("CONTEXT_MAP_INVALID", "\u5F53\u524D\u5730\u56FE\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55", 409, { path: mapRoot });
  await requireSafeDirectory(root, mapRoot, { allowMissing: true });
  if (!mapMetadata) return result2;
  const addMarkdown = async (candidate, owner2, source = "bundle", { allowMissing = false } = {}) => {
    const safety = await requireRegularPath(root, candidate, { allowMissing });
    if (!safety.metadata) return;
    if (safety.metadata.size > MAX_MARKDOWN_BYTES3) throw contextError("CONTEXT_MARKDOWN_TOO_LARGE", "\u4E0A\u4E0B\u6587 Markdown \u8D85\u8FC7 2 MiB", 413, { path: candidate, size: safety.metadata.size });
    const content = await (0, import_promises8.readFile)(safety.resolved, "utf8");
    const path = projectRelative(root, safety.resolved);
    const existing = markdownByPath.get(path.toLowerCase());
    if (existing) {
      mergeOwner(existing, owner2);
      if (source === "bundle" && existing.source === "custom") existing.source = "bundle";
      return;
    }
    const info = {
      path,
      text: content,
      source,
      ownerKind: owner2.ownerKind,
      ownerId: owner2.ownerId,
      isIndex: source === "bundle" && path.toLowerCase().endsWith("/index.md"),
      archived: false,
      size: Buffer.byteLength(content, "utf8"),
      etag: digest3(Buffer.from(content, "utf8")),
      updatedAt: safety.metadata.mtime?.toISOString?.() ?? null,
      owners: [{ ownerKind: owner2.ownerKind, ownerId: owner2.ownerId }]
    };
    markdownByPath.set(path.toLowerCase(), info);
    result2.markdown.push(info);
  };
  const addAsset = async (candidate, owner2, name) => {
    const safety = await requireRegularPath(root, candidate);
    if (!safety.metadata) return;
    const relativePath = projectRelative(root, safety.resolved);
    const existing = assetsByPath.get(relativePath.toLowerCase());
    if (existing) {
      mergeOwner(existing, owner2);
      return;
    }
    const type = ASSET_TYPES2[(0, import_node_path10.extname)(name).toLowerCase()] ?? { kind: "file", mimeType: "application/octet-stream" };
    const info = {
      path: relativePath,
      fileName: name,
      name,
      source: "bundle",
      ownerKind: owner2.ownerKind,
      ownerId: owner2.ownerId,
      kind: type.kind,
      mimeType: type.mimeType,
      size: safety.metadata.size,
      updatedAt: safety.metadata.mtime?.toISOString?.() ?? null,
      archived: false,
      owners: [{ ownerKind: owner2.ownerKind, ownerId: owner2.ownerId }]
    };
    assetsByPath.set(relativePath.toLowerCase(), info);
    result2.assets.push(info);
  };
  const scanOwner = async (owner2) => {
    const directory = (0, import_node_path10.join)(mapRoot, owner2.directoryKind, owner2.ownerId);
    const ownerMetadata = await (0, import_promises8.lstat)(directory).catch((error3) => error3?.code === "ENOENT" ? null : (() => {
      throw error3;
    })());
    if (!ownerMetadata) return;
    if (ownerMetadata.isSymbolicLink()) throw contextError("CONTEXT_SYMLINK_FORBIDDEN", "\u8D44\u6599\u5305\u5BF9\u8C61\u76EE\u5F55\u4E0D\u5141\u8BB8\u662F\u7B26\u53F7\u94FE\u63A5", 403, { path: directory });
    if (!ownerMetadata.isDirectory()) throw contextError("CONTEXT_NOT_DIRECTORY", "\u8D44\u6599\u5305\u5BF9\u8C61\u8DEF\u5F84\u4E0D\u662F\u76EE\u5F55", 409, { path: directory });
    const entries = await (0, import_promises8.readdir)(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".archive" || entry.name.startsWith(".")) continue;
      const candidate = (0, import_node_path10.join)(directory, entry.name);
      const metadata = await (0, import_promises8.lstat)(candidate).catch((error3) => error3?.code === "ENOENT" ? null : (() => {
        throw error3;
      })());
      if (!metadata) continue;
      if (metadata.isSymbolicLink()) throw contextError("CONTEXT_SYMLINK_FORBIDDEN", "\u8D44\u6599\u5305\u6587\u4EF6\u4E0D\u5141\u8BB8\u662F\u7B26\u53F7\u94FE\u63A5", 403, { path: candidate });
      if (metadata.isDirectory()) continue;
      if (/\.md$/i.test(entry.name)) await addMarkdown(candidate, owner2, "bundle");
      else if (ASSET_TYPES2[(0, import_node_path10.extname)(entry.name).toLowerCase()]) await addAsset(candidate, owner2, entry.name);
    }
  };
  for (const owner2 of owners) await scanOwner(owner2);
  for (const owner2 of owners) {
    const pointer = textPath(owner2.item?.md);
    if (!pointer || !/\.md$/i.test(pointer)) continue;
    const candidate = (0, import_node_path10.resolve)(root, pointer);
    const relativePath = projectRelative(root, candidate);
    if (isReservedRelative(relativePath)) continue;
    if (!within2(root, candidate)) continue;
    if (relativePath.toLowerCase().startsWith(".live-dot-map/maps/")) {
      if (!isInsideMap(root, mapRoot, candidate)) continue;
    }
    if (relativePath.toLowerCase().startsWith(".live-dot-map/.bridge/")) continue;
    await addMarkdown(candidate, owner2, "custom", { allowMissing: true });
  }
  result2.markdown.sort((left, right) => left.path.localeCompare(right.path, "en"));
  result2.assets.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return result2;
}
var ContextDocumentProvider = class {
  async collect(input) {
    return collect(input);
  }
};

// src/bridge/tool-service.mjs
var schema = (name, description, properties = {}, required2 = []) => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    ...required2.length ? { required: required2 } : {},
    additionalProperties: true
  }
});
var owner = {
  ownerKind: { type: "string", enum: ["node", "route"] },
  ownerId: { type: "string" }
};
var TOOL_DEFINITIONS = Object.freeze([
  schema("map_get_context", "\u8BFB\u53D6\u5F53\u524D\u5730\u56FE\u7684\u7ED3\u6784\u3001\u63A8\u8FDB\u6458\u8981\u4E0E\u660E\u786E\u5173\u8054 Markdown\u3002", { query: { type: "string" }, currentNodeId: { anyOf: [{ type: "string" }, { type: "null" }] }, includeHistory: { type: "boolean" }, limit: { type: "integer", minimum: 1, maximum: 12 } }),
  schema("map_list_human_updates", "\u5217\u51FA\u4EBA\u7C7B\u5C1A\u672A\u786E\u8BA4\u7684\u6807\u6CE8\u3002"),
  schema("map_ack_human_updates", "\u6458\u8981\u660E\u786E\u5F15\u7528\u6807\u6CE8 ID \u540E\u786E\u8BA4\u8BFB\u53D6\u3002", { ids: { type: "array", items: { type: "string" } }, summary: { type: "string" } }, ["ids", "summary"]),
  schema("map_list", "\u5217\u51FA\u9879\u76EE\u5185\u5730\u56FE\u4E0E\u5F53\u524D active-map\u3002"),
  schema("map_create", "\u65B0\u5EFA\u5B8C\u6574\u5730\u56FE\u4F46\u4E0D\u81EA\u52A8\u5207\u6362\u3002", { name: { type: "string" } }),
  schema("map_switch", "\u6821\u9A8C\u76EE\u6807\u5730\u56FE\u540E\u5207\u6362 active-map\u3002", { mapKey: { type: "string" } }, ["mapKey"]),
  schema("map_rename", "\u4FEE\u6539\u5730\u56FE\u663E\u793A\u540D\uFF0C\u4E0D\u6539\u53D8 mapKey\u3002", { mapKey: { type: "string" }, name: { type: "string" } }, ["mapKey", "name"]),
  schema("map_next_candidates", "\u8FD4\u56DE\u5E26\u89E3\u91CA\u7684\u63A8\u8FDB\u5019\u9009\u3002", { query: { type: "string" }, currentNodeId: { anyOf: [{ type: "string" }, { type: "null" }] }, limit: { type: "integer", minimum: 1, maximum: 12 }, includeHistory: { type: "boolean" } }),
  schema("map_apply_commands", "\u901A\u8FC7\u7EDF\u4E00 reducer \u539F\u5B50\u63D0\u4EA4\u5730\u56FE\u547D\u4EE4\u3002", { mapKey: { type: "string" }, documentId: { type: "string" }, baseRevision: { type: "integer", minimum: 0 }, commandId: { type: "string" }, commands: { type: "array", minItems: 1, maxItems: 100, items: { type: "object" } } }, ["commands"]),
  schema("map_validate", "\u6821\u9A8C\u5F53\u524D\u5730\u56FE\u4E0E\u5173\u8054 Markdown \u8BC1\u636E\u3002", { document: { type: "object" } }),
  schema("map_checkpoint", "\u521B\u5EFA\u53EF\u6062\u590D\u68C0\u67E5\u70B9\u3002", { reason: { type: "string" } }),
  schema("map_plan_consolidation", "\u53EA\u8BFB\u751F\u6210\u53EF\u5BA1\u6838\u7684\u6574\u7406\u5EFA\u8BAE\u3002", { maxSuggestions: { type: "integer", minimum: 1, maximum: 20 }, now: { type: "string" } }),
  schema("map_read_markdown", "\u8BFB\u53D6\u5F53\u524D\u5730\u56FE\u8D44\u6599\u5305 Markdown\u3002", { ...owner, fileName: { type: "string" }, path: { type: "string" } }),
  schema("map_write_markdown", "\u7528 baseEtag \u539F\u5B50\u66FF\u6362\u8D44\u6599\u5305 Markdown\u3002", { ...owner, fileName: { type: "string" }, path: { type: "string" }, content: { type: "string" }, baseEtag: { type: "string" } }, ["content", "baseEtag"]),
  schema("map_append_markdown", "\u6309\u8DEF\u5F84\u9501\u5E42\u7B49\u8FFD\u52A0 Markdown\u3002", { ...owner, fileName: { type: "string" }, path: { type: "string" }, content: { type: "string" }, commandId: { type: "string" } }, ["content", "commandId"]),
  schema("map_list_bundle_files", "\u5217\u51FA\u5BF9\u8C61\u8D44\u6599\u5305\u6587\u4EF6\u3002", { ...owner, includeArchived: { type: "boolean" } }, ["ownerKind", "ownerId"]),
  schema("map_create_markdown", "\u5728\u5BF9\u8C61\u8D44\u6599\u5305\u4E2D\u65B0\u5EFA\u8865\u5145 Markdown\u3002", { ...owner, fileName: { type: "string" }, title: { type: "string" }, content: { type: "string" } }, ["ownerKind", "ownerId", "fileName"]),
  schema("map_rename_bundle_file", "\u6539\u540D\u8865\u5145 Markdown \u6216\u9644\u4EF6\u3002", { ...owner, from: { type: "string" }, to: { type: "string" } }, ["ownerKind", "ownerId", "from", "to"]),
  schema("map_archive_bundle_file", "\u5F52\u6863\u8865\u5145 Markdown\u3002", { ...owner, fileName: { type: "string" } }, ["ownerKind", "ownerId", "fileName"]),
  schema("map_restore_bundle_file", "\u6062\u590D\u8865\u5145 Markdown\u3002", { ...owner, fileName: { type: "string" } }, ["ownerKind", "ownerId", "fileName"]),
  schema("map_list_assets", "\u5217\u51FA\u5BF9\u8C61\u8D44\u6599\u5305\u9644\u4EF6\u5143\u6570\u636E\u3002", { ...owner, includeArchived: { type: "boolean" } }, ["ownerKind", "ownerId"]),
  schema("map_import_asset", "\u4ECE\u9879\u76EE\u5185 sourcePath \u6D41\u5F0F\u5BFC\u5165\u9644\u4EF6\u3002", { ...owner, sourcePath: { type: "string" }, fileName: { type: "string" }, mimeType: { type: "string" } }, ["ownerKind", "ownerId", "sourcePath"]),
  schema("map_archive_asset", "\u5F52\u6863\u5BF9\u8C61\u9644\u4EF6\u3002", { ...owner, fileName: { type: "string" } }, ["ownerKind", "ownerId", "fileName"]),
  schema("map_restore_asset", "\u6062\u590D\u5BF9\u8C61\u9644\u4EF6\u3002", { ...owner, fileName: { type: "string" } }, ["ownerKind", "ownerId", "fileName"])
]);
var TOOL_NAMES = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));
var TOOL_NAME_SET = new Set(TOOL_NAMES);
function cleanResult(value) {
  if (!value || typeof value !== "object") return value;
  const { buffer: _buffer, stream: _stream, ...rest } = value;
  return rest;
}
function ownerArgs(args, mapKey) {
  if (args.ownerKind && args.ownerId) return {
    ownerKind: String(args.ownerKind),
    ownerId: String(args.ownerId),
    fileName: String(args.fileName || "index.md")
  };
  const raw = String(args.path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const prefix = `.live-dot-map/maps/${mapKey}/`;
  const relative6 = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\.live-dot-map\//, "");
  const match = relative6.match(/^(nodes|routes)\/([^/]+)\/(.+)$/);
  if (!match) throw new BridgeError("BUNDLE_PATH_REQUIRED", "\u8DEF\u5F84\u5FC5\u987B\u6307\u5411\u5F53\u524D\u5730\u56FE\u7684 nodes|routes/<id>/<file>", { status: 400 });
  return { ownerKind: match[1] === "nodes" ? "node" : "route", ownerId: match[2], fileName: match[3] };
}
function recentMarkdown(markdownList, limit = 6) {
  return (Array.isArray(markdownList) ? markdownList : []).filter((item) => String(item.text ?? "").trim().length > 0).sort((left, right) => new Date(right.updatedAt ?? 0).getTime() - new Date(left.updatedAt ?? 0).getTime()).slice(0, limit).map((item) => ({
    kind: "markdown",
    id: item.path,
    path: item.path,
    score: 0,
    reasons: ["\u6700\u8FD1\u4E66\u5199"],
    source: "markdown",
    relationPath: [],
    snippet: String(item.text ?? "").replace(/\s+/g, " ").slice(0, 320)
  }));
}
async function ensureNodeIndexes(bundleStore, commands) {
  if (!bundleStore || !Array.isArray(commands)) return;
  for (const command2 of commands) {
    if (command2?.op !== "create" || command2?.collection !== "nodes" || typeof command2?.value?.id !== "string") continue;
    try {
      await bundleStore.ensureIndex({ ownerKind: "node", ownerId: command2.value.id, title: String(command2.value.name ?? "") });
    } catch {
    }
  }
}
async function mergeHumanMdUpdates(context, projection) {
  try {
    const log = new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey: context.mapKey });
    const items = await log.unacknowledged();
    if (items.length) {
      const merged = [
        ...Array.isArray(projection.humanUpdates) ? projection.humanUpdates : [],
        ...items.map((item) => ({
          id: item.id,
          text: item.snippet || item.path,
          attention: "new",
          priority: "normal",
          target: { kind: "markdown", path: item.path },
          source: "human"
        }))
      ];
      projection.humanUpdates = merged.slice(0, 12);
    }
  } catch {
  }
  return projection;
}
function markdownSection(text, headings) {
  const wanted = new Set(headings.map((heading) => heading.replace(/\s+/g, "")));
  const lines = String(text ?? "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*#{1,6}\s*(.*?)\s*$/);
    if (!match || !wanted.has(match[1].replace(/[：:]\s*$/, "").replace(/\s+/g, ""))) continue;
    const content = [];
    for (let next = index + 1; next < lines.length && !/^\s*#{1,6}\s+/.test(lines[next]); next += 1) content.push(lines[next]);
    return content.join("\n").trim();
  }
  return "";
}
function attemptEvidence(document, markdown) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, "/"), String(item.text ?? "")]));
  const mapDir = typeof document.mapDir === "string" && document.mapDir ? document.mapDir : ".live-dot-map";
  return (Array.isArray(document.edges) ? document.edges : []).filter((edge) => ["failed", "success", "pending"].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true).map((edge) => {
    const path = String(edge.md || `${mapDir}/routes/${edge.id}/index.md`).replace(/\\/g, "/");
    const text = docs.get(path) || "";
    return {
      id: String(edge.id),
      status: String(edge.status),
      name: String(edge.name || edge.id),
      path,
      evidence: markdownSection(text, ["\u5173\u952E\u8BC1\u636E", "\u8BC1\u636E"]).slice(0, 360),
      result: markdownSection(text, ["\u7ED3\u679C", "\u7ED3\u8BBA"]).slice(0, 360),
      failureReason: markdownSection(text, ["\u5931\u8D25\u539F\u56E0", "\u5931\u8D25\u539F\u56E0/\u6392\u9664\u6761\u4EF6"]).slice(0, 360),
      nextStep: markdownSection(text, ["\u4E0B\u4E00\u6B65", "\u540E\u7EED\u5EFA\u8BAE"]).slice(0, 360),
      hasMarkdown: Boolean(text)
    };
  }).sort((left, right) => (left.status === "failed" ? -1 : 0) - (right.status === "failed" ? -1 : 0) || left.id.localeCompare(right.id)).slice(0, 8);
}
var ToolService = class {
  constructor(options = {}) {
    if (!options.mapManager) throw new BridgeError("MAP_MANAGER_REQUIRED", "ToolService \u9700\u8981 MapManager", { status: 500 });
    if (!options.shared) throw new BridgeError("SHARED_ADAPTER_REQUIRED", "ToolService \u9700\u8981 shared adapter", { status: 500 });
    this.mapManager = options.mapManager;
    this.shared = options.shared;
    this.actor = String(options.actor || "agent:generic").startsWith("agent:") ? String(options.actor || "agent:generic") : "agent:generic";
    this.projectHandle = String(options.projectHandle || "stdio");
    this.contextProvider = options.contextProvider ?? new ContextDocumentProvider();
  }
  async #context(args = {}) {
    return this.mapManager.resolve({ ...typeof args.mapKey === "string" && args.mapKey ? { mapKey: args.mapKey } : {} });
  }
  #envelope(context, args, commands, prefix) {
    const claimed = args.documentId ?? args.projectId;
    if (claimed !== void 0 && String(claimed) !== context.documentId) {
      throw new BridgeError("DOCUMENT_ID_MISMATCH", "documentId \u4E0E\u5F53\u524D mapKey \u4E0D\u5339\u914D", { status: 409 });
    }
    return {
      projectId: context.documentId,
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : context.snapshot.revision,
      commandId: typeof args.commandId === "string" ? args.commandId : `${prefix}-${(0, import_node_crypto7.randomUUID)()}`,
      actor: this.actor,
      sessionId: typeof args.sessionId === "string" ? args.sessionId : `tool-${(0, import_node_crypto7.randomUUID)()}`,
      commands
    };
  }
  async dispatch(name, args = {}) {
    if (!TOOL_NAME_SET.has(name)) throw new BridgeError("UNKNOWN_MCP_TOOL", `\u672A\u77E5\u5730\u56FE\u5DE5\u5177\uFF1A${name}`, { status: 404 });
    if (name === "map_list") return this.mapManager.list();
    if (name === "map_create") return this.mapManager.create(String(args.name || ""));
    if (name === "map_switch") return this.mapManager.switch(String(args.mapKey || ""));
    if (name === "map_rename") return this.mapManager.rename(String(args.mapKey || ""), String(args.name || ""), this.actor);
    const context = await this.#context(args);
    const { store, bundleStore, snapshot, mapKey } = context;
    const document = snapshot.document;
    const collected = async () => this.contextProvider.collect({
      projectRoot: context.projectRoot,
      mapKey,
      document,
      includeHistory: args.includeHistory === true
    });
    if (name === "map_get_context" || name === "map_next_candidates") {
      const documents = await collected();
      const markdown = documents.markdown;
      const queryText = String(args.query ?? "").trim();
      const retrieved = this.shared.retrieveContext(document, queryText, {
        currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId),
        limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
        includeHistory: args.includeHistory === true,
        markdown
      });
      const evidence = attemptEvidence(document, markdown);
      const projection = await mergeHumanMdUpdates(context, { ...this.shared.buildProjectProjection(document, { now: typeof args.now === "string" ? args.now : void 0 }), attemptEvidence: evidence });
      if (name === "map_get_context") return { projectHandle: this.projectHandle, mapKey, documentId: context.documentId, revision: snapshot.revision, projection, attemptEvidence: evidence, assets: documents.assets, ...retrieved, markdown: queryText ? retrieved.markdown : recentMarkdown(markdown) };
      return { projectHandle: this.projectHandle, mapKey, documentId: context.documentId, revision: snapshot.revision, projection, attemptEvidence: evidence, assets: documents.assets, alternatives: this.shared.findExplorationAlternatives(document, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), ...retrieved, autonomy: this.shared.autonomyDecision(document, retrieved.objects) };
    }
    if (name === "map_list_human_updates") {
      const updates = document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(String(ann.attention)));
      const mdItems = await new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey }).unacknowledged().catch(() => []);
      return {
        mapKey,
        documentId: context.documentId,
        revision: snapshot.revision,
        updates: [
          ...updates,
          ...mdItems.map((item) => ({ id: item.id, text: item.snippet || item.path, attention: "new", priority: "normal", target: { kind: "markdown", path: item.path }, source: "human" }))
        ]
      };
    }
    if (name === "map_ack_human_updates") {
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
      const annIds = ids.filter((id) => !id.startsWith("md:"));
      const mdPaths = ids.filter((id) => id.startsWith("md:")).map((id) => id.slice(3));
      if (mdPaths.length) {
        try {
          await new HumanMdUpdateLog({ projectRoot: context.projectRoot, mapKey }).acknowledge(mdPaths);
        } catch {
        }
      }
      return store.execute(this.#envelope(context, args, [{ op: "ack_annotations", ids: annIds, summary: String(args.summary || "") }], "mcp-ack"));
    }
    if (name === "map_apply_commands") {
      const result2 = await store.execute(this.#envelope(context, args, Array.isArray(args.commands) ? args.commands : [], "mcp-apply"));
      await ensureNodeIndexes(bundleStore, Array.isArray(args.commands) ? args.commands : []);
      return result2;
    }
    if (name === "map_validate") {
      const target = args.document || document;
      const validation = await this.shared.validateDocument(target);
      if (target !== document || !validation.ok) return validation;
      const documents = await collected();
      return { ...validation, attemptIssues: this.shared.checkAttemptEvidence(document, documents.markdown) };
    }
    if (name === "map_checkpoint") return store.createSnapshot();
    if (name === "map_plan_consolidation") {
      const documents = await collected();
      return { mapKey, documentId: context.documentId, revision: snapshot.revision, ...this.shared.planConsolidation(document, { now: typeof args.now === "string" ? args.now : void 0, maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 12, markdown: documents.markdown }) };
    }
    const file = ownerArgs(args, mapKey);
    if (name === "map_read_markdown") return cleanResult(await bundleStore.readMarkdown(file));
    if (name === "map_write_markdown") {
      const result2 = await bundleStore.replaceMarkdown({ ...file, content: args.content, baseEtag: args.baseEtag });
      return { ...result2, content: String(args.content) };
    }
    if (name === "map_append_markdown") return bundleStore.appendMarkdown({ ...file, content: args.content, commandId: args.commandId });
    if (name === "map_list_bundle_files") return { mapKey, files: await bundleStore.list({ ...file, includeArchived: args.includeArchived === true }) };
    if (name === "map_create_markdown") return bundleStore.createMarkdown({ ...file, content: args.content, title: args.title });
    if (name === "map_rename_bundle_file") return bundleStore.rename({ ownerKind: file.ownerKind, ownerId: file.ownerId, from: args.from, to: args.to });
    if (name === "map_archive_bundle_file" || name === "map_archive_asset") return bundleStore.archive(file);
    if (name === "map_restore_bundle_file" || name === "map_restore_asset") return bundleStore.restore(file);
    if (name === "map_list_assets") {
      const files = await bundleStore.list({ ...file, includeArchived: args.includeArchived === true });
      return { mapKey, assets: files.filter((entry) => entry.kind !== "markdown") };
    }
    if (name === "map_import_asset") {
      return bundleStore.importAsset({ ...file, fileName: String(args.fileName || (0, import_node_path11.basename)(String(args.sourcePath || ""))), sourcePath: String(args.sourcePath || ""), mimeType: args.mimeType });
    }
    throw new BridgeError("UNKNOWN_MCP_TOOL", `\u672A\u77E5\u5730\u56FE\u5DE5\u5177\uFF1A${name}`, { status: 404 });
  }
};

// src/bridge/archive-lifecycle.mjs
var import_node_crypto8 = require("node:crypto");
var import_promises9 = require("node:fs/promises");
var import_node_path12 = require("node:path");
var PURGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1e3;
var PURGE_COLLECTIONS = /* @__PURE__ */ new Set(["nodes", "routes", "edges", "anns"]);
var ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/;
function error(code, message, status = 409, details) {
  return new BridgeError(code, message, { status, details });
}
function asDate(value, label) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw error("PURGE_TIME_INVALID", `${label} \u65E0\u6548`, 400);
    return value;
  }
  const result2 = new Date(value);
  if (!Number.isFinite(result2.getTime())) throw error("PURGE_TIME_INVALID", `${label} \u65E0\u6548`, 400);
  return result2;
}
function isValidArchivedAt(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime());
}
function isPurgeEligible(item, { now = /* @__PURE__ */ new Date(), retentionMs = PURGE_RETENTION_MS } = {}) {
  if (!item || typeof item !== "object" || item.archived !== true || !isValidArchivedAt(item.archivedAt)) return false;
  const current = asDate(now, "\u5F53\u524D\u65F6\u95F4").getTime();
  const archived = new Date(item.archivedAt).getTime();
  return archived <= current && current - archived >= Number(retentionMs);
}
function safeObjectId(value) {
  const id = String(value ?? "");
  if (!ID.test(id)) throw error("PURGE_ID_INVALID", "\u5F85\u6E05\u9664\u5BF9\u8C61 ID \u65E0\u6548", 400, { id });
  return id;
}
function clone(value) {
  return structuredClone(value);
}
function collectionItems(document, collection) {
  return Array.isArray(document?.[collection]) ? document[collection] : [];
}
function applyPhysicalPurge(document, { collection, id }, now) {
  const next = clone(document);
  const target = collectionItems(next, collection).find((item) => String(item?.id) === id);
  if (!target) throw error("PURGE_NOT_FOUND", `${collection}/${id} \u4E0D\u5B58\u5728`, 404);
  if (target.archived !== true) throw error("PURGE_NOT_ARCHIVED", "\u53EA\u6709\u5DF2\u5F52\u6863\u5BF9\u8C61\u624D\u80FD\u6C38\u4E45\u6E05\u9664", 409);
  const removedNodes = new Set(collection === "nodes" ? [id] : []);
  const removedRoutes = new Set(collection === "routes" ? [id] : []);
  const removedEdges = new Set(collection === "edges" ? [id] : []);
  if (collection === "routes") {
    for (const edge of collectionItems(next, "edges")) {
      if (String(edge?.route ?? "") === id) removedEdges.add(String(edge.id));
    }
  }
  for (const edge of collectionItems(next, "edges")) {
    if (removedNodes.has(String(edge?.from)) || removedNodes.has(String(edge?.to))) {
      removedEdges.add(String(edge.id));
    }
  }
  next[collection] = collectionItems(next, collection).filter((item) => String(item?.id) !== id);
  if (removedNodes.size) {
    next.edges = collectionItems(next, "edges").filter((edge) => !removedEdges.has(String(edge.id)));
    for (const route of collectionItems(next, "routes")) {
      if (removedNodes.has(String(route.currentNodeId))) route.currentNodeId = null;
    }
  } else if (removedRoutes.size) {
    next.edges = collectionItems(next, "edges").filter((edge) => !removedEdges.has(String(edge.id)));
    for (const node of collectionItems(next, "nodes")) {
      if (removedRoutes.has(String(node.route))) node.route = null;
    }
  }
  const shouldRemoveAnnotation = (annotation) => {
    if (annotation?.archived === true) {
    }
    const targetValue = annotation?.target;
    if (targetValue && typeof targetValue === "object") {
      if (targetValue.kind === "node" && removedNodes.has(String(targetValue.id))) return true;
      if (targetValue.kind === "edge" && removedEdges.has(String(targetValue.id))) return true;
      if (targetValue.kind === "route" && removedRoutes.has(String(targetValue.id))) return true;
    }
    return removedRoutes.has(String(annotation?.route ?? ""));
  };
  next.anns = collectionItems(next, "anns").filter((annotation) => !shouldRemoveAnnotation(annotation));
  next.revision = Number.isSafeInteger(next.revision) ? next.revision + 1 : 1;
  next.lastEventId = Number.isSafeInteger(next.lastEventId) ? next.lastEventId + 1 : next.revision;
  next.updatedAt = now;
  return next;
}
function packagePath(mapRoot, collection, id) {
  return (0, import_node_path12.join)(mapRoot, collection, id);
}
function purgePackageOwners(document, collection, id) {
  const owners = collection === "nodes" ? [{ collection: "nodes", id }] : collection === "edges" ? [{ collection: "routes", id }] : [];
  const nodeIds = new Set(collection === "nodes" ? [id] : []);
  const routeIds = new Set(collection === "routes" ? [id] : []);
  for (const edge of collectionItems(document, "edges")) {
    if (collection === "edges" && String(edge?.id) === id || routeIds.has(String(edge?.route ?? "")) || nodeIds.has(String(edge?.from)) || nodeIds.has(String(edge?.to))) {
      const owner2 = { collection: "routes", id: String(edge.id) };
      if (!owners.some((item) => item.collection === owner2.collection && item.id === owner2.id)) owners.push(owner2);
    }
  }
  return owners;
}
async function assertPackagePath(path) {
  const metadata = await (0, import_promises9.lstat)(path).catch((cause) => {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  });
  if (metadata?.isSymbolicLink()) throw error("PURGE_SYMLINK_FORBIDDEN", "\u5F52\u6863\u8D44\u6599\u5305\u4E0D\u80FD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u6E05\u9664", 403, { path });
  return metadata;
}
function recycleFunction(recycleBin) {
  if (typeof recycleBin === "function") return recycleBin;
  if (typeof recycleBin?.recycle === "function") return recycleBin.recycle.bind(recycleBin);
  return null;
}
var ArchiveLifecycle = class {
  constructor(options = {}) {
    if (!options.store) throw error("PURGE_STORE_REQUIRED", "\u5F52\u6863\u751F\u547D\u5468\u671F\u9700\u8981 ProjectStore", 500);
    this.store = options.store;
    this.projectRoot = (0, import_node_path12.resolve)(options.projectRoot ?? this.store.projectRoot);
    this.mapRoot = (0, import_node_path12.resolve)(options.mapRoot ?? this.store.dataDirectory);
    this.shared = options.shared ?? this.store.shared;
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.retentionMs = Number(options.retentionMs ?? PURGE_RETENTION_MS);
    this.recycleBin = options.recycleBin;
    this.faultInjector = options.faultInjector ?? (() => {
    });
    this.stagingRoot = (0, import_node_path12.join)(this.mapRoot, ".bridge", "purge-staging");
    this.lockPath = (0, import_node_path12.join)(this.mapRoot, ".bridge", "purge.lock");
  }
  eligible(item, options = {}) {
    return isPurgeEligible(item, { retentionMs: this.retentionMs, ...options });
  }
  async listEligible({ collection, now = this.clock() } = {}) {
    const snapshot = await this.store.snapshot();
    const collections = collection === void 0 ? ["routes", "nodes", "edges", "anns"] : [collection];
    for (const name of collections) if (!PURGE_COLLECTIONS.has(name)) throw error("PURGE_COLLECTION_UNSUPPORTED", "\u53EA\u80FD\u6E05\u7406\u8DEF\u7EBF\u3001\u8282\u70B9\u3001\u65B9\u6848\u6216\u6807\u6CE8", 400, { collection: name });
    return collections.flatMap((name) => collectionItems(snapshot.document, name).filter((item) => this.eligible(item, { now })).map((item) => ({ collection: name, id: String(item.id), archivedAt: item.archivedAt })));
  }
  async #openPurgeStore() {
    const base = this.shared;
    const physicalShared = {
      ...base,
      applyEnvelope(document, envelope2, options = {}) {
        if (envelope2?.actor !== "system:purge") throw error("PURGE_ACTOR_INVALID", "\u7269\u7406\u6E05\u9664\u53EA\u80FD\u7531\u7CFB\u7EDF\u751F\u547D\u5468\u671F\u670D\u52A1\u6267\u884C", 403);
        const command2 = envelope2?.commands?.[0];
        if (!command2 || command2.op !== "purge" || envelope2.commands.length !== 1) throw error("PURGE_COMMAND_INVALID", "\u7269\u7406\u6E05\u9664\u547D\u4EE4\u65E0\u6548", 400);
        return applyPhysicalPurge(document, command2, options.now ?? (/* @__PURE__ */ new Date()).toISOString());
      }
    };
    return ProjectStore.open({
      projectRoot: this.projectRoot,
      dataDirectory: this.store.dataDirectory,
      mapName: this.store.mapName,
      mapDir: this.store.mapDir,
      shared: physicalShared,
      clock: this.clock,
      snapshotEvery: this.store.snapshotEvery,
      pollIntervalMs: 0,
      faultInjector: this.faultInjector
    });
  }
  async #moveToStaging(collections, txnRoot) {
    await ensureDirectory(txnRoot);
    const moved = [];
    try {
      for (const { collection, id } of collections) {
        const source = packagePath(this.mapRoot, collection, id);
        const metadata = await assertPackagePath(source);
        if (!metadata) continue;
        const target = packagePath(txnRoot, collection, id);
        await assertPackagePath(target);
        if (await exists(target)) throw error("PURGE_STAGING_CONFLICT", "\u6E05\u9664\u6682\u5B58\u76EE\u5F55\u5DF2\u6709\u540C\u540D\u8D44\u6599\u5305", 409, { collection, id });
        await ensureDirectory((0, import_node_path12.join)(txnRoot, collection));
        await (0, import_promises9.rename)(source, target);
        moved.push({ collection, id, source, target });
      }
      return moved;
    } catch (cause) {
      await this.#restorePackages(moved).catch(() => void 0);
      throw cause;
    }
  }
  async #restorePackages(moved) {
    for (const item of [...moved].reverse()) {
      const sourceExists = await exists(item.source);
      const stagedExists = await exists(item.target);
      if (!stagedExists) {
        if (sourceExists) continue;
        throw error("PURGE_PACKAGE_ROLLBACK_FAILED", "\u8D44\u6599\u5305\u5DF2\u4E0D\u5728\u6682\u5B58\u76EE\u5F55\uFF0C\u65E0\u6CD5\u6062\u590D", 500, item);
      }
      if (sourceExists) throw error("PURGE_PACKAGE_ROLLBACK_CONFLICT", "\u8D44\u6599\u5305\u6062\u590D\u76EE\u6807\u5DF2\u88AB\u5360\u7528\uFF0C\u62D2\u7EDD\u8986\u76D6", 409, item);
      await ensureDirectory((0, import_node_path12.join)(this.mapRoot, item.collection));
      await (0, import_promises9.rename)(item.target, item.source);
    }
  }
  async #rollback(snapshotName, moved, mapAttempted) {
    let mapError2;
    if (mapAttempted) {
      try {
        await this.store.recover({ source: "snapshot", name: snapshotName });
      } catch (cause) {
        mapError2 = cause;
      }
    }
    let packageError;
    try {
      await this.#restorePackages(moved);
    } catch (cause) {
      packageError = cause;
    }
    if (mapError2 || packageError) {
      throw error("PURGE_ROLLBACK_FAILED", "\u6C38\u4E45\u6E05\u9664\u5931\u8D25\uFF0C\u81EA\u52A8\u6062\u590D\u672A\u5B8C\u5168\u5B8C\u6210\uFF0C\u9700\u8981\u4EBA\u5DE5\u68C0\u67E5\u6062\u590D\u70B9\u548C\u6682\u5B58\u76EE\u5F55", 500, {
        mapError: mapError2?.code ?? mapError2?.message,
        packageError: packageError?.code ?? packageError?.message
      });
    }
  }
  async purge(options = {}) {
    const collection = String(options.collection ?? "");
    if (!PURGE_COLLECTIONS.has(collection)) throw error("PURGE_COLLECTION_UNSUPPORTED", "\u53EA\u80FD\u6E05\u7406\u8DEF\u7EBF\u3001\u8282\u70B9\u3001\u65B9\u6848\u6216\u6807\u6CE8", 400, { collection });
    const id = safeObjectId(options.id);
    const actor = String(options.actor ?? "system:purge");
    const humanConfirmed = actor === "human" && (options.confirmed === true || options.confirm === true);
    const systemActor = actor === "system:purge" || actor === "system:retention" || actor === "system";
    if (!humanConfirmed && !systemActor) throw error("PURGE_HUMAN_CONFIRMATION_REQUIRED", "\u6C38\u4E45\u6E05\u9664\u9700\u8981\u4EBA\u7C7B\u4E8C\u6B21\u786E\u8BA4\u6216\u7CFB\u7EDF\u4FDD\u7559\u671F\u4EFB\u52A1", 403);
    const recycle = recycleFunction(this.recycleBin);
    if (!recycle) throw error("RECYCLE_BIN_UNAVAILABLE", "\u7CFB\u7EDF\u56DE\u6536\u7AD9\u4E0D\u53EF\u7528\uFF0C\u5DF2\u62D2\u7EDD\u6C38\u4E45\u6E05\u9664", 503);
    return withFileLock(this.lockPath, async () => {
      const now = asDate(options.now ?? this.clock(), "\u5F53\u524D\u65F6\u95F4");
      const before = await this.store.snapshot();
      const target = collectionItems(before.document, collection).find((item) => String(item?.id) === id);
      if (!target) throw error("PURGE_NOT_FOUND", `${collection}/${id} \u4E0D\u5B58\u5728`, 404);
      if (target.archived !== true) throw error("PURGE_NOT_ARCHIVED", "\u53EA\u6709\u5DF2\u5F52\u6863\u5BF9\u8C61\u624D\u80FD\u6C38\u4E45\u6E05\u9664", 409);
      if (!humanConfirmed && !this.eligible(target, { now })) {
        throw error("PURGE_NOT_ELIGIBLE", "\u5BF9\u8C61\u5C1A\u672A\u5F52\u6863\u6EE1 30 \u5929\uFF0C\u4E14\u6CA1\u6709 archivedAt \u7684\u65E7\u5F52\u6863\u6C38\u4E0D\u81EA\u52A8\u6E05\u7406", 409, { collection, id, archivedAt: target.archivedAt });
      }
      const snapshot = await this.store.createSnapshot();
      const snapshotName = String(snapshot.path).split(/[\\/]/).pop();
      const transactionId = `${now.toISOString().replace(/[:.]/g, "-")}-${(0, import_node_crypto8.randomUUID)()}`;
      const txnRoot = (0, import_node_path12.join)(this.stagingRoot, transactionId);
      const packageOwners = purgePackageOwners(before.document, collection, id);
      let moved = [];
      let mapAttempted = false;
      let committedRevision = before.revision;
      try {
        moved = await this.#moveToStaging(packageOwners, txnRoot);
        await this.faultInjector("afterPurgeStaging", { collection, id, txnRoot, moved });
        mapAttempted = true;
        const purgeStore = await this.#openPurgeStore();
        try {
          const committed = await purgeStore.execute({
            projectId: String(before.document.mapId),
            baseRevision: before.revision,
            commandId: String(options.commandId ?? `purge-${(0, import_node_crypto8.randomUUID)()}`),
            actor: "system:purge",
            sessionId: "archive-lifecycle",
            commands: [{ op: "purge", collection, id }]
          });
          committedRevision = committed.revision;
        } finally {
          await purgeStore.close().catch(() => void 0);
        }
        await this.faultInjector("afterPurgeMapCommit", { collection, id, txnRoot, moved });
        const recycled = await recycle(txnRoot, { collection, id, transactionId });
        if (recycled === false) throw error("RECYCLE_BIN_FAILED", "\u7CFB\u7EDF\u56DE\u6536\u7AD9\u62D2\u7EDD\u63A5\u6536\u8D44\u6599\u5305", 503, { transactionId });
        return {
          purged: true,
          collection,
          id,
          // 回收站接管 staging 后不再执行任何可能失败的磁盘读取；否则 helper
          // 已成功但响应构造失败时，生命周期服务将无法从已移动的 staging 回滚。
          revision: committedRevision,
          snapshot: snapshotName,
          transactionId,
          recycled: true
        };
      } catch (cause) {
        await this.#rollback(snapshotName, moved, mapAttempted).catch((rollbackError) => {
          throw rollbackError;
        });
        await (0, import_promises9.rm)(txnRoot, { recursive: true, force: true }).catch(() => void 0);
        if (cause instanceof BridgeError && cause.code.startsWith("PURGE_")) throw cause;
        if (cause?.code === "RECYCLE_BIN_FAILED") throw cause;
        throw new BridgeError("PURGE_FAILED", "\u6C38\u4E45\u6E05\u9664\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u5F52\u6863\u5BF9\u8C61\u548C\u8D44\u6599\u5305", { status: 500, cause });
      }
    }).catch((cause) => {
      if (cause?.code === "LOCK_TIMEOUT") throw error("PURGE_BUSY", "\u6C38\u4E45\u6E05\u9664\u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5", 409);
      throw cause;
    });
  }
};

// src/bridge/recycle-bin.mjs
var import_node_child_process = require("node:child_process");
var import_promises10 = require("node:fs/promises");
var import_node_path13 = require("node:path");
var TRANSACTION_ID = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function failure(code, message, status = 503, details) {
  return new BridgeError(code, message, { status, details });
}
function defaultNativeHelperPath(options = {}) {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  return (0, import_node_path13.join)((0, import_node_path13.resolve)(localAppData), "live-dot-map", "current", "LiveDotMapSetup.exe");
}
async function assertPurgeStagingPath(value) {
  const target = (0, import_node_path13.resolve)(String(value ?? ""));
  const parts = target.split(import_node_path13.sep);
  const marker = parts.findIndex((part) => part.toLowerCase() === ".live-dot-map");
  const suffix = marker >= 0 ? parts.slice(marker) : [];
  if (suffix.length !== 7 || suffix[1].toLowerCase() !== "maps" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suffix[2]) || suffix[3].toLowerCase() !== ".bridge" || suffix[4].toLowerCase() !== "purge-staging" || !TRANSACTION_ID.test(suffix[5]) || suffix[6] !== "") {
    if (suffix.length !== 6 || suffix[1].toLowerCase() !== "maps" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(suffix[2]) || suffix[3].toLowerCase() !== ".bridge" || suffix[4].toLowerCase() !== "purge-staging" || !TRANSACTION_ID.test(suffix[5])) throw failure("PURGE_STAGING_PATH_INVALID", "\u56DE\u6536\u7AD9\u6682\u5B58\u8DEF\u5F84\u4E0D\u7B26\u5408\u4EA7\u54C1\u76EE\u5F55\u7EA6\u675F", 400, { path: target });
  }
  let current = parts[0].endsWith(":") ? `${parts[0]}${import_node_path13.sep}` : parts[0] || import_node_path13.sep;
  for (const part of parts.slice(1)) {
    if (!part) continue;
    current = (0, import_node_path13.join)(current, part);
    const metadata = await (0, import_promises10.lstat)(current).catch((cause) => {
      if (cause?.code === "ENOENT") return null;
      throw cause;
    });
    if (!metadata) throw failure("PURGE_STAGING_MISSING", "\u56DE\u6536\u7AD9\u6682\u5B58\u76EE\u5F55\u4E0D\u5B58\u5728", 404, { path: current });
    if (metadata.isSymbolicLink()) throw failure("PURGE_STAGING_REPARSE_FORBIDDEN", "\u56DE\u6536\u7AD9\u6682\u5B58\u8DEF\u5F84\u4E0D\u80FD\u7ECF\u8FC7\u7B26\u53F7\u94FE\u63A5\u6216\u8054\u63A5", 403, { path: current });
  }
  const leaf = await (0, import_promises10.lstat)(target);
  if (!leaf.isDirectory()) throw failure("PURGE_STAGING_NOT_DIRECTORY", "\u56DE\u6536\u7AD9\u6682\u5B58\u76EE\u6807\u4E0D\u662F\u76EE\u5F55", 400, { path: target });
  return target;
}
function runHelper(spawnImpl, executable, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawnImpl(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill?.();
      if (!settled) {
        settled = true;
        reject(failure("RECYCLE_BIN_TIMEOUT", "\u7CFB\u7EDF\u56DE\u6536\u7AD9\u54CD\u5E94\u8D85\u65F6\uFF0C\u5DF2\u505C\u6B62\u6C38\u4E45\u6E05\u9664"));
      }
    }, timeoutMs);
    child.stdout?.setEncoding?.("utf8");
    child.stderr?.setEncoding?.("utf8");
    child.stdout?.on?.("data", (chunk) => {
      stdout += chunk;
      if (stdout.length > 16384) stdout = stdout.slice(-16384);
    });
    child.stderr?.on?.("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    child.once("error", (cause) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(failure("RECYCLE_BIN_HELPER_FAILED", "\u65E0\u6CD5\u542F\u52A8\u7CFB\u7EDF\u56DE\u6536\u7AD9 helper", 503, { cause: String(cause?.message || cause) }));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
      }
      if (code !== 0 || parsed?.ok !== true) {
        reject(failure("RECYCLE_BIN_FAILED", "\u7CFB\u7EDF\u56DE\u6536\u7AD9\u672A\u63A5\u6536\u6682\u5B58\u8D44\u6599", 503, {
          exitCode: code,
          code: parsed?.code,
          message: parsed?.message || stderr.trim().slice(0, 400)
        }));
        return;
      }
      resolvePromise(true);
    });
  });
}
var NativeRecycleBin = class {
  constructor(options = {}) {
    const candidate = options.helperPath ?? defaultNativeHelperPath(options);
    this.helperPath = candidate ? (0, import_node_path13.resolve)(candidate) : null;
    this.spawnImpl = options.spawnImpl ?? import_node_child_process.spawn;
    this.timeoutMs = Math.max(1e3, Number(options.timeoutMs) || 3e4);
  }
  async recycle(stagingPath) {
    if (process.platform !== "win32" && this.spawnImpl === import_node_child_process.spawn) {
      throw failure("RECYCLE_BIN_UNSUPPORTED", "\u7CFB\u7EDF\u56DE\u6536\u7AD9 helper \u4EC5\u5728 Windows \u5B89\u88C5\u7248\u53EF\u7528");
    }
    if (!this.helperPath) throw failure("RECYCLE_BIN_UNAVAILABLE", "\u672A\u627E\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9 helper");
    await (0, import_promises10.access)(this.helperPath).catch(() => {
      throw failure("RECYCLE_BIN_UNAVAILABLE", "\u672A\u627E\u5230\u7CFB\u7EDF\u56DE\u6536\u7AD9 helper");
    });
    const safePath = await assertPurgeStagingPath(stagingPath);
    return runHelper(this.spawnImpl, this.helperPath, ["--recycle-staging", safePath], this.timeoutMs);
  }
};

// src/bridge/editor-service.mjs
var import_node_child_process2 = require("node:child_process");
var import_node_crypto9 = require("node:crypto");
var import_node_os2 = require("node:os");
var import_promises11 = require("node:fs/promises");
var import_node_path14 = require("node:path");
var SETTINGS_VERSION = 1;
var WINDOWS_EDITOR_IDS = /* @__PURE__ */ new Set(["vscode", "antigravity", "pycharm", "system", "folder", "manual"]);
var EXE_NAME = /^(Code|Antigravity|pycharm64)\.exe$/i;
var EDITOR_ID = /^[a-z][a-z0-9-]{0,31}$/;
var EXTRA_EDITORS = [
  {
    id: "antigravity",
    label: "Antigravity",
    appPaths: ["Antigravity.exe"],
    candidates() {
      const out = [];
      const local = process.env.LOCALAPPDATA;
      const programFiles = process.env.ProgramFiles;
      if (local) out.push((0, import_node_path14.join)(local, "Programs", "Antigravity", "Antigravity.exe"));
      if (programFiles) out.push((0, import_node_path14.join)(programFiles, "Antigravity", "Antigravity.exe"));
      return out;
    }
  },
  {
    id: "pycharm",
    label: "PyCharm",
    appPaths: ["pycharm64.exe"],
    async candidates() {
      const out = [];
      const local = process.env.LOCALAPPDATA;
      if (local) {
        out.push((0, import_node_path14.join)(local, "Programs", "PyCharm", "bin", "pycharm64.exe"));
        const toolbox = (0, import_node_path14.join)(local, "JetBrains", "Toolbox", "apps");
        out.push(...await scanVersionedEditors(toolbox, 3));
      }
      const programFiles = process.env.ProgramFiles;
      if (programFiles) out.push(...await scanVersionedEditors((0, import_node_path14.join)(programFiles, "JetBrains"), 1));
      return out;
    }
  }
];
async function scanVersionedEditors(root, depth) {
  const found = [];
  let entries;
  try {
    entries = await (0, import_promises11.readdir)(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = (0, import_node_path14.join)(root, entry.name);
    if (depth <= 1) {
      found.push((0, import_node_path14.join)(dir, "bin", "pycharm64.exe"));
    } else {
      found.push(...await scanVersionedEditors(dir, depth - 1));
    }
  }
  return found;
}
function bridgeError2(code, message, status = 400, details) {
  return new BridgeError(code, message, { status, details });
}
function defaultSettingsPath() {
  const localAppData = process.env.LOCALAPPDATA || (0, import_node_path14.join)((0, import_node_os2.homedir)(), "AppData", "Local");
  return (0, import_node_path14.join)(localAppData, "live-dot-map", "settings.json");
}
function normalizePathForCompare(path) {
  const value = (0, import_node_path14.resolve)(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}
function isInside(root, candidate, { allowRoot = false } = {}) {
  const rootPath = normalizePathForCompare(root);
  const candidatePath = normalizePathForCompare(candidate);
  const rest = (0, import_node_path14.relative)(rootPath, candidatePath);
  if (!rest) return allowRoot;
  return !rest.startsWith("..") && !(0, import_node_path14.isAbsolute)(rest) && !import_node_path14.win32.isAbsolute(rest);
}
function isAbsoluteAny(path) {
  return (0, import_node_path14.isAbsolute)(path) || import_node_path14.win32.isAbsolute(path);
}
function isRegularFile(metadata) {
  return Boolean(metadata?.isFile?.());
}
function isDirectory(metadata) {
  return Boolean(metadata?.isDirectory?.());
}
function isLink(metadata) {
  return Boolean(metadata?.isSymbolicLink?.() || metadata?.isReparsePoint === true);
}
function stripRegistryCommand(value) {
  let path = String(value ?? "").trim();
  if (!path) return "";
  const quoted = path.match(/^"([^"]+)"/);
  if (quoted) return quoted[1];
  const marker = path.search(/\s+[%\-]/);
  if (marker >= 0) path = path.slice(0, marker);
  return path.replace(/^"|"$/g, "").trim();
}
function normalizeCandidates(value) {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(normalizeCandidates);
  if (typeof value === "object") {
    return normalizeCandidates(value.path ?? value.executable ?? value.defaultValue ?? value.value);
  }
  return [];
}
function parseRegistryOutput(output) {
  const values = [];
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:\(默认\)|\(Default\))\s+REG_SZ\s+(.+)\s*$/i);
    if (match) values.push(stripRegistryCommand(match[1]));
  }
  return values;
}
async function readAppPaths(exeNames, execFile3 = import_node_child_process2.execFile) {
  if (process.platform !== "win32") return [];
  const values = [];
  for (const exeName of exeNames) {
    const roots = [
      `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
      `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`,
      `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`
    ];
    for (const root of roots) {
      try {
        const result2 = await new Promise((resolveResult, reject) => {
          execFile3("reg.exe", ["query", root, "/ve"], { windowsHide: true, shell: false }, (error3, stdout) => {
            if (error3) reject(error3);
            else resolveResult(stdout);
          });
        });
        values.push(...parseRegistryOutput(result2));
      } catch {
      }
    }
  }
  return values;
}
async function readVSCodeAppPaths(execFile3 = import_node_child_process2.execFile) {
  return readAppPaths(["Code.exe"], execFile3);
}
function knownVSCodePaths() {
  const candidates = [];
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env["ProgramFiles(x86)"];
  if (local) candidates.push((0, import_node_path14.join)(local, "Programs", "Microsoft VS Code", "Code.exe"));
  if (programFiles) candidates.push((0, import_node_path14.join)(programFiles, "Microsoft VS Code", "Code.exe"));
  if (programFilesX86) candidates.push((0, import_node_path14.join)(programFilesX86, "Microsoft VS Code", "Code.exe"));
  return candidates;
}
function safeSettings(value) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const manualPath = settings.editors?.manual?.path;
  const preferred = typeof settings.preferredEditorId === "string" && EDITOR_ID.test(settings.preferredEditorId) ? settings.preferredEditorId : null;
  return {
    version: SETTINGS_VERSION,
    preferredEditorId: preferred,
    editors: {
      manual: typeof manualPath === "string" ? { path: manualPath } : {}
    }
  };
}
async function readSettingsFile(path) {
  try {
    return safeSettings(JSON.parse(await (0, import_promises11.readFile)(path, "utf8")));
  } catch (error3) {
    if (error3?.code === "ENOENT" || error3 instanceof SyntaxError) return safeSettings({});
    throw error3;
  }
}
var EditorService = class _EditorService {
  constructor(options = {}) {
    if (!options.projectRoot) throw bridgeError2("PROJECT_ROOT_REQUIRED", "\u7F16\u8F91\u5668\u670D\u52A1\u9700\u8981\u9879\u76EE\u6839\u76EE\u5F55", 400);
    this.projectRoot = (0, import_node_path14.resolve)(options.projectRoot);
    this.settingsPath = (0, import_node_path14.resolve)(options.settingsPath || defaultSettingsPath());
    this.clock = options.clock ?? (() => /* @__PURE__ */ new Date());
    this.spawn = options.spawn ?? import_node_child_process2.spawn;
    this.nativeHelper = options.nativeHelper ?? null;
    this.nativePicker = options.nativePicker ?? null;
    this.registryReader = options.registryReader ?? (() => readVSCodeAppPaths(options.execFile ?? import_node_child_process2.execFile));
    this.extraRegistryReader = options.extraRegistryReader ?? ((exeNames) => readAppPaths(exeNames, options.execFile ?? import_node_child_process2.execFile));
    this.extraEditors = Array.isArray(options.extraEditors) ? options.extraEditors : EXTRA_EDITORS;
    this.extraPaths = /* @__PURE__ */ new Map();
    this.knownPaths = options.knownVSCodePaths ?? knownVSCodePaths;
    this.manualPathValidator = options.manualPathValidator;
    this.settings = null;
    this.vscodePath = void 0;
    this.pendingPickerToken = null;
  }
  static async open(options) {
    const service = new _EditorService(options);
    await service.initialize();
    return service;
  }
  async initialize() {
    await this.#assertProjectRoot();
    this.settings = await readSettingsFile(this.settingsPath);
    return this;
  }
  async #ensureInitialized() {
    if (!this.settings) await this.initialize();
  }
  async #assertProjectRoot() {
    let metadata;
    try {
      metadata = await (0, import_promises11.lstat)(this.projectRoot);
    } catch (error3) {
      if (error3?.code === "ENOENT") throw bridgeError2("PROJECT_NOT_FOUND", "\u9879\u76EE\u76EE\u5F55\u4E0D\u5B58\u5728", 404);
      throw error3;
    }
    if (isLink(metadata) || !isDirectory(metadata)) throw bridgeError2("PROJECT_ROOT_INVALID", "\u9879\u76EE\u76EE\u5F55\u4E0D\u662F\u5B89\u5168\u7684\u666E\u901A\u76EE\u5F55", 403);
    const canonical = await (0, import_promises11.realpath)(this.projectRoot);
    if (!isInside((0, import_node_path14.resolve)(this.projectRoot, ".."), canonical, { allowRoot: true })) {
      throw bridgeError2("PROJECT_ROOT_INVALID", "\u9879\u76EE\u76EE\u5F55\u65E0\u6CD5\u5B89\u5168\u89E3\u6790", 403);
    }
  }
  async #assertNoSymlinkEscape(candidate, { allowMissing = false, root = this.projectRoot } = {}) {
    const canonicalRoot = await (0, import_promises11.realpath)(root);
    let current = (0, import_node_path14.resolve)(candidate);
    let metadata = null;
    while (true) {
      try {
        metadata = await (0, import_promises11.lstat)(current);
        break;
      } catch (error3) {
        if (!allowMissing || error3?.code !== "ENOENT") throw error3;
        const parent = (0, import_node_path14.dirname)(current);
        if (parent === current) throw error3;
        current = parent;
      }
    }
    if (isLink(metadata)) throw bridgeError2("SYMLINK_ESCAPE", "\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u6216\u91CD\u89E3\u6790\u70B9\u6253\u5F00\u6587\u4EF6", 403);
    const canonicalCandidate = await (0, import_promises11.realpath)(current);
    if (!isInside(canonicalRoot, canonicalCandidate, { allowRoot: true })) {
      throw bridgeError2("SYMLINK_ESCAPE", "\u8DEF\u5F84\u89E3\u6790\u540E\u5DF2\u8D8A\u51FA\u9879\u76EE\u76EE\u5F55", 403);
    }
    return canonicalCandidate;
  }
  async #projectPath(relativePath, { kind = "file", allowMissing = false } = {}) {
    if (typeof relativePath !== "string" || !relativePath.trim() || relativePath.includes("\0")) {
      throw bridgeError2("INVALID_EDITOR_PATH", "\u7F16\u8F91\u5668\u76EE\u6807\u8DEF\u5F84\u65E0\u6548", 400);
    }
    if (isAbsoluteAny(relativePath)) throw bridgeError2("EDITOR_PATH_OUTSIDE_PROJECT", "\u7F16\u8F91\u5668\u53EA\u80FD\u6253\u5F00\u9879\u76EE\u5185\u6587\u4EF6", 403);
    const candidate = (0, import_node_path14.resolve)(this.projectRoot, relativePath);
    if (!isInside(this.projectRoot, candidate, { allowRoot: kind === "directory" })) {
      throw bridgeError2("EDITOR_PATH_OUTSIDE_PROJECT", "\u7F16\u8F91\u5668\u53EA\u80FD\u6253\u5F00\u9879\u76EE\u5185\u6587\u4EF6", 403);
    }
    await this.#assertNoSymlinkEscape(candidate, { allowMissing });
    let metadata;
    try {
      metadata = await (0, import_promises11.lstat)(candidate);
    } catch (error3) {
      if (allowMissing && error3?.code === "ENOENT") return candidate;
      if (error3?.code === "ENOENT") throw bridgeError2("EDITOR_TARGET_NOT_FOUND", "\u7F16\u8F91\u5668\u76EE\u6807\u4E0D\u5B58\u5728", 404);
      throw error3;
    }
    if (isLink(metadata)) throw bridgeError2("SYMLINK_ESCAPE", "\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u6216\u91CD\u89E3\u6790\u70B9\u6253\u5F00\u6587\u4EF6", 403);
    if (kind === "file" && !isRegularFile(metadata)) throw bridgeError2("EDITOR_TARGET_NOT_FILE", "\u7F16\u8F91\u5668\u76EE\u6807\u4E0D\u662F\u6587\u4EF6", 400);
    if (kind === "directory" && !isDirectory(metadata)) throw bridgeError2("EDITOR_TARGET_NOT_DIRECTORY", "\u7F16\u8F91\u5668\u76EE\u6807\u4E0D\u662F\u6587\u4EF6\u5939", 400);
    return candidate;
  }
  async #assertExternalExecutable(path) {
    if (typeof path !== "string" || !isAbsoluteAny(path) || !EXE_NAME.test(path.split(/[\\/]/).pop() || "")) {
      throw bridgeError2("EDITOR_EXECUTABLE_INVALID", "\u53EA\u5141\u8BB8\u771F\u5B9E\u7684 Code.exe \u6216\u5DF2\u9009\u62E9\u7684 .exe \u7A0B\u5E8F", 403);
    }
    let metadata;
    try {
      metadata = await (0, import_promises11.lstat)(path);
    } catch (error3) {
      if (error3?.code === "ENOENT") throw bridgeError2("EDITOR_NOT_FOUND", "\u7F16\u8F91\u5668\u7A0B\u5E8F\u4E0D\u5B58\u5728", 404);
      throw error3;
    }
    if (isLink(metadata) || !isRegularFile(metadata)) throw bridgeError2("EDITOR_EXECUTABLE_INVALID", "\u7F16\u8F91\u5668\u7A0B\u5E8F\u4E0D\u662F\u5B89\u5168\u7684\u666E\u901A\u6587\u4EF6", 403);
    const canonical = await (0, import_promises11.realpath)(path);
    if (!isInside((0, import_node_path14.resolve)(path, ".."), canonical, { allowRoot: true })) {
      throw bridgeError2("EDITOR_EXECUTABLE_INVALID", "\u7F16\u8F91\u5668\u7A0B\u5E8F\u65E0\u6CD5\u5B89\u5168\u89E3\u6790", 403);
    }
    return (0, import_node_path14.resolve)(path);
  }
  async #assertManualExecutable(path) {
    if (typeof path !== "string" || !isAbsoluteAny(path) || !/\.exe$/i.test(path)) {
      throw bridgeError2("MANUAL_EDITOR_INVALID", "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F\u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84 .exe \u6587\u4EF6", 403);
    }
    if (this.manualPathValidator) {
      const result2 = await this.manualPathValidator(path);
      if (result2 === false) throw bridgeError2("MANUAL_EDITOR_INVALID", "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F\u672A\u901A\u8FC7\u5B89\u5168\u6821\u9A8C", 403);
    }
    let metadata;
    try {
      metadata = await (0, import_promises11.lstat)(path);
    } catch (error3) {
      if (error3?.code === "ENOENT") throw bridgeError2("EDITOR_NOT_FOUND", "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F\u4E0D\u5B58\u5728", 404);
      throw error3;
    }
    if (isLink(metadata) || !isRegularFile(metadata)) throw bridgeError2("MANUAL_EDITOR_INVALID", "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F\u5FC5\u987B\u662F\u666E\u901A .exe \u6587\u4EF6", 403);
    const canonical = await (0, import_promises11.realpath)(path);
    if (normalizePathForCompare(canonical) !== normalizePathForCompare(path)) {
      throw bridgeError2("MANUAL_EDITOR_INVALID", "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F\u4E0D\u80FD\u662F\u7B26\u53F7\u94FE\u63A5\u6216\u91CD\u89E3\u6790\u70B9", 403);
    }
    return (0, import_node_path14.resolve)(path);
  }
  async #resolveVSCode() {
    if (this.vscodePath) {
      try {
        this.vscodePath = await this.#assertExternalExecutable(this.vscodePath);
        return this.vscodePath;
      } catch {
        this.vscodePath = void 0;
      }
    }
    const registry = await Promise.resolve(this.registryReader()).catch(() => []);
    const known = typeof this.knownPaths === "function" ? await this.knownPaths() : this.knownPaths;
    const candidates = [...normalizeCandidates(registry), ...normalizeCandidates(known)];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const path = stripRegistryCommand(candidate);
      if (!path || seen.has(normalizePathForCompare(path))) continue;
      seen.add(normalizePathForCompare(path));
      try {
        this.vscodePath = await this.#assertExternalExecutable(path);
        return this.vscodePath;
      } catch {
      }
    }
    this.vscodePath = void 0;
    return void 0;
  }
  /* VS Code 之外的编辑器走同一条候选解析+安全校验管线,结果按 id 缓存。 */
  async #resolveExtra(def) {
    const cached = this.extraPaths.get(def.id);
    if (cached) {
      try {
        const verified = await this.#assertExternalExecutable(cached);
        this.extraPaths.set(def.id, verified);
        return verified;
      } catch {
        this.extraPaths.delete(def.id);
      }
    }
    const registry = await Promise.resolve(this.extraRegistryReader(def.appPaths || [])).catch(() => []);
    const known = typeof def.candidates === "function" ? await def.candidates() : def.candidates;
    const candidates = [...normalizeCandidates(registry), ...normalizeCandidates(known)];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const path = stripRegistryCommand(candidate);
      if (!path || seen.has(normalizePathForCompare(path))) continue;
      seen.add(normalizePathForCompare(path));
      try {
        const resolved = await this.#assertExternalExecutable(path);
        this.extraPaths.set(def.id, resolved);
        return resolved;
      } catch {
      }
    }
    this.extraPaths.delete(def.id);
    return void 0;
  }
  async list() {
    await this.#ensureInitialized();
    const vscode = await this.#resolveVSCode();
    const manualPath = this.settings.editors.manual.path;
    let manualAvailable = false;
    if (manualPath) {
      try {
        await this.#assertManualExecutable(manualPath);
        manualAvailable = true;
      } catch {
      }
    }
    const editors = [
      ...vscode ? [{ id: "vscode", label: "VS Code", kind: "editor", available: true }] : []
    ];
    for (const def of this.extraEditors) {
      if (await this.#resolveExtra(def)) editors.push({ id: def.id, label: def.label, kind: "editor", available: true });
    }
    editors.push(
      { id: "system", label: "\u7528\u9ED8\u8BA4\u5E94\u7528\u6253\u5F00", kind: "system", available: Boolean(this.nativeHelper) },
      { id: "folder", label: "\u5728\u6587\u4EF6\u5939\u4E2D\u663E\u793A", kind: "folder", available: Boolean(this.nativeHelper) },
      {
        id: "manual",
        label: manualAvailable ? "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F" : "\u624B\u52A8\u9009\u62E9\u7A0B\u5E8F\u2026",
        kind: "manual",
        available: manualAvailable && Boolean(this.nativeHelper),
        needsPicker: !manualAvailable
      }
    );
    const firstEditor = editors.find((editor) => editor.kind === "editor" && editor.available);
    const preferredEditorId = editors.some((editor) => editor.id === this.settings.preferredEditorId && editor.available) ? this.settings.preferredEditorId : firstEditor ? firstEditor.id : "system";
    return { editors, preferredEditorId };
  }
  async listEditors() {
    return this.list();
  }
  async setPreferredEditor(editorId) {
    await this.#ensureInitialized();
    if (typeof editorId !== "string" || !WINDOWS_EDITOR_IDS.has(editorId)) {
      throw bridgeError2("EDITOR_ID_INVALID", "\u7F16\u8F91\u5668\u6807\u8BC6\u65E0\u6548", 400);
    }
    const listing = await this.list();
    if (!listing.editors.some((editor) => editor.id === editorId && editor.available)) {
      throw bridgeError2("EDITOR_NOT_AVAILABLE", "\u8BE5\u7F16\u8F91\u5668\u5F53\u524D\u4E0D\u53EF\u7528", 409);
    }
    this.settings.preferredEditorId = editorId;
    await this.#writeSettings();
    return { preferredEditorId: editorId };
  }
  async pickManualEditor() {
    await this.#ensureInitialized();
    const pickerToken = (0, import_node_crypto9.randomUUID)();
    this.pendingPickerToken = pickerToken;
    let picked;
    try {
      if (this.nativePicker) picked = await this.nativePicker();
      else picked = await this.#callNative("pick-editor");
    } catch (error3) {
      this.pendingPickerToken = null;
      throw error3;
    }
    if (picked?.cancelled === true) {
      this.pendingPickerToken = null;
      return { cancelled: true };
    }
    const path = typeof picked === "string" ? picked : picked?.path;
    return this.registerManual({ path, pickerToken });
  }
  // Deliberately does not accept a path from a browser-facing request. The
  // only supported registration path is the result of the native picker.
  async registerManual({ path, pickerToken } = {}) {
    if (!pickerToken || pickerToken !== this.pendingPickerToken) {
      throw bridgeError2("NATIVE_PICKER_REQUIRED", "\u624B\u52A8\u7A0B\u5E8F\u5FC5\u987B\u7531\u672C\u4EA7\u54C1\u539F\u751F\u9009\u62E9\u5668\u767B\u8BB0", 403);
    }
    this.pendingPickerToken = null;
    const manualPath = await this.#assertManualExecutable(path);
    await this.#ensureInitialized();
    this.settings.editors.manual = { path: manualPath };
    await this.#writeSettings();
    return { id: "manual", label: "\u624B\u52A8\u9009\u62E9\u7684\u7A0B\u5E8F", available: true };
  }
  async #writeSettings() {
    await (0, import_promises11.mkdir)((0, import_node_path14.dirname)(this.settingsPath), { recursive: true });
    const output = {
      version: SETTINGS_VERSION,
      preferredEditorId: this.settings.preferredEditorId || null,
      editors: {
        manual: this.settings.editors.manual?.path ? { path: this.settings.editors.manual.path } : {}
      }
    };
    await atomicWriteFile(this.settingsPath, `${JSON.stringify(output, null, 2)}
`);
  }
  async #callNative(operation, payload = {}) {
    if (typeof this.nativeHelper === "function") return this.nativeHelper({ operation, ...payload });
    if (typeof this.nativeHelper?.run === "function") return this.nativeHelper.run({ operation, ...payload });
    throw bridgeError2("NATIVE_HELPER_UNAVAILABLE", "\u672C\u673A\u539F\u751F\u52A9\u624B\u4E0D\u53EF\u7528\uFF0C\u5DF2\u62D2\u7EDD\u6267\u884C", 503);
  }
  #launch(executable, args) {
    const child = this.spawn(executable, args, {
      shell: false,
      windowsHide: false,
      detached: true,
      stdio: "ignore"
    });
    child?.unref?.();
    return { launched: true };
  }
  async open({ editorId, relativePath, targetKind = "file" } = {}) {
    await this.#ensureInitialized();
    if (typeof editorId !== "string" || !WINDOWS_EDITOR_IDS.has(editorId)) {
      throw bridgeError2("EDITOR_ID_INVALID", "\u7F16\u8F91\u5668\u6807\u8BC6\u65E0\u6548", 400);
    }
    if (editorId === "folder") {
      const candidate = await this.#projectPath(relativePath, { kind: targetKind === "directory" ? "directory" : "file" });
      const metadata = await (0, import_promises11.stat)(candidate);
      const folder = isDirectory(metadata) ? candidate : (0, import_node_path14.dirname)(candidate);
      await this.#assertNoSymlinkEscape(folder);
      await this.#callNative("open-folder", { targetPath: folder });
      return { editorId, launched: true };
    }
    const target = await this.#projectPath(relativePath, { kind: "file" });
    if (editorId === "vscode") {
      const executable = await this.#resolveVSCode();
      if (!executable) throw bridgeError2("EDITOR_NOT_AVAILABLE", "\u672A\u68C0\u6D4B\u5230 VS Code", 503);
      return { editorId, ...this.#launch(executable, ["--reuse-window", target]) };
    }
    const extraDef = this.extraEditors.find((def) => def.id === editorId);
    if (extraDef) {
      const executable = await this.#resolveExtra(extraDef);
      if (!executable) throw bridgeError2("EDITOR_NOT_AVAILABLE", `\u672A\u68C0\u6D4B\u5230 ${extraDef.label}`, 503);
      return { editorId, ...this.#launch(executable, [target]) };
    }
    if (editorId === "system") {
      await this.#callNative("open-default", { targetPath: target });
      return { editorId, launched: true };
    }
    const manualPath = await this.#assertManualExecutable(this.settings.editors.manual.path);
    await this.#callNative("open-manual", { executablePath: manualPath, targetPath: target });
    return { editorId, launched: true };
  }
  async saveAs({ relativePath } = {}) {
    await this.#ensureInitialized();
    const sourcePath = await this.#projectPath(relativePath, { kind: "file" });
    const result2 = await this.#callNative("save-as", {
      sourcePath,
      suggestedName: sourcePath.split(/[\\/]/).pop() || "document.md"
    });
    if (result2?.cancelled === true) return { exported: false, cancelled: true };
    const destinationPath = typeof result2 === "string" ? result2 : result2?.destinationPath ?? result2?.path;
    if (!destinationPath || !isAbsoluteAny(destinationPath) || destinationPath.includes("\0")) {
      throw bridgeError2("SAVE_AS_INVALID_RESULT", "\u539F\u751F\u52A9\u624B\u6CA1\u6709\u8FD4\u56DE\u6709\u6548\u7684\u5BFC\u51FA\u8DEF\u5F84", 502);
    }
    return { exported: true, fileName: destinationPath.split(/[\\/]/).pop() || null };
  }
};

// src/bridge/native-helper.mjs
var import_node_child_process3 = require("node:child_process");
var import_promises12 = require("node:fs/promises");
var import_node_path15 = require("node:path");
function error2(code, message, status = 503, details) {
  return new BridgeError(code, message, { status, details });
}
var MODES = Object.freeze({
  "pick-editor": (request) => ["--pick-editor"],
  "save-as": (request) => ["--save-as", (0, import_node_path15.resolve)(String(request.sourcePath || ""))],
  "open-default": (request) => ["--open-default", (0, import_node_path15.resolve)(String(request.targetPath || ""))],
  "open-folder": (request) => ["--open-folder", (0, import_node_path15.resolve)(String(request.targetPath || ""))],
  "open-manual": (request) => ["--open-manual", (0, import_node_path15.resolve)(String(request.executablePath || "")), (0, import_node_path15.resolve)(String(request.targetPath || ""))]
});
var NativeWindowsHelper = class {
  constructor(options = {}) {
    const candidate = options.helperPath ?? defaultNativeHelperPath(options);
    this.helperPath = candidate ? (0, import_node_path15.resolve)(candidate) : null;
    this.spawnImpl = options.spawnImpl ?? import_node_child_process3.spawn;
    this.timeoutMs = Math.max(1e3, Number(options.timeoutMs) || 12e4);
  }
  async run(request = {}) {
    const buildArgs = MODES[request.operation];
    if (!buildArgs) throw error2("NATIVE_HELPER_OPERATION_INVALID", "\u539F\u751F\u52A9\u624B\u64CD\u4F5C\u65E0\u6548", 400);
    if (!this.helperPath) throw error2("NATIVE_HELPER_UNAVAILABLE", "\u672A\u627E\u5230\u672C\u4EA7\u54C1\u539F\u751F\u52A9\u624B");
    await (0, import_promises12.access)(this.helperPath).catch(() => {
      throw error2("NATIVE_HELPER_UNAVAILABLE", "\u672A\u627E\u5230\u672C\u4EA7\u54C1\u539F\u751F\u52A9\u624B");
    });
    const args = buildArgs(request);
    if (args.some((value, index) => index > 0 && (!value || value === (0, import_node_path15.resolve)("")))) {
      throw error2("NATIVE_HELPER_ARGUMENT_REQUIRED", "\u539F\u751F\u52A9\u624B\u7F3A\u5C11\u76EE\u6807\u8DEF\u5F84", 400);
    }
    return new Promise((resolvePromise, reject) => {
      const child = this.spawnImpl(this.helperPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill?.();
        if (!settled) {
          settled = true;
          reject(error2("NATIVE_HELPER_TIMEOUT", "\u672C\u673A\u64CD\u4F5C\u7B49\u5F85\u8D85\u65F6"));
        }
      }, this.timeoutMs);
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => {
        stdout += chunk;
        if (stdout.length > 16384) stdout = stdout.slice(-16384);
      });
      child.stderr?.on?.("data", (chunk) => {
        stderr += chunk;
        if (stderr.length > 4096) stderr = stderr.slice(-4096);
      });
      child.once("error", (cause) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(error2("NATIVE_HELPER_FAILED", "\u65E0\u6CD5\u542F\u52A8\u672C\u4EA7\u54C1\u539F\u751F\u52A9\u624B", 503, { cause: String(cause?.message || cause) }));
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        let parsed;
        try {
          parsed = JSON.parse(stdout.trim());
        } catch {
          parsed = null;
        }
        if (code !== 0 || !parsed || parsed.ok !== true && parsed.cancelled !== true) {
          reject(error2(parsed?.code || "NATIVE_HELPER_FAILED", parsed?.message || stderr.trim().slice(0, 400) || "\u672C\u673A\u64CD\u4F5C\u5931\u8D25", 503));
          return;
        }
        resolvePromise(parsed);
      });
    });
  }
};

// src/bridge/shared-adapter.mjs
var REQUIRED_EXPORTS = ["validateMapDocument", "applyMapCommand", "applyCommandEnvelope", "envelopeTouches", "createEmptyMap", "migrateMapV1", "retrieveContext", "checkAttemptEvidence", "buildProjectProjection", "findExplorationAlternatives", "autonomyDecision", "planConsolidation"];
async function loadSharedAdapter() {
  let shared;
  try {
    shared = await Promise.resolve().then(() => (init_shared(), shared_exports));
  } catch (error3) {
    throw new BridgeError(
      "SHARED_MODULE_UNAVAILABLE",
      "src/shared/index.mjs is not available; inject a shared adapter while testing",
      { details: { requiredExports: REQUIRED_EXPORTS }, cause: error3 }
    );
  }
  const missing = REQUIRED_EXPORTS.filter((name) => typeof shared[name] !== "function");
  if (missing.length) {
    throw new BridgeError("SHARED_CONTRACT_MISMATCH", "Shared map module does not satisfy the bridge contract", {
      details: { requiredExports: REQUIRED_EXPORTS, missing }
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
    migrateDocument: shared.migrateMapV1
  };
}
var sharedBridgeContract = Object.freeze({
  validateMapDocument: "(value) => { ok: boolean, errors: Array }",
  applyMapCommand: "(document, command) => nextDocument; throws typed Error on invalid command",
  applyCommandEnvelope: "(document, envelope) => nextDocument; applies one transaction revision",
  envelopeTouches: "(envelope) => string[]; stable conflict paths",
  createEmptyMap: "({ name, now }) => document",
  migrateMapV1: "(document, { now }) => version-2 document"
});

// agent-kit/lib/installer.mjs
var import_node_crypto11 = require("node:crypto");
var import_node_child_process5 = require("node:child_process");
var import_promises13 = require("node:fs/promises");
var import_node_fs2 = require("node:fs");
var import_node_path17 = require("node:path");
var import_node_os4 = require("node:os");
var import_node_url = require("node:url");

// agent-kit/lib/bridge-client.mjs
var import_node_crypto10 = require("node:crypto");

// agent-kit/lib/tool-definitions.generated.mjs
var MCP_TOOL_DEFINITIONS = Object.freeze([
  {
    "name": "map_get_context",
    "description": "\u8BFB\u53D6\u5F53\u524D\u5730\u56FE\u7684\u7ED3\u6784\u3001\u63A8\u8FDB\u6458\u8981\u4E0E\u660E\u786E\u5173\u8054 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "currentNodeId": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "includeHistory": {
          "type": "boolean"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_list_human_updates",
    "description": "\u5217\u51FA\u4EBA\u7C7B\u5C1A\u672A\u786E\u8BA4\u7684\u6807\u6CE8\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": true
    }
  },
  {
    "name": "map_ack_human_updates",
    "description": "\u6458\u8981\u660E\u786E\u5F15\u7528\u6807\u6CE8 ID \u540E\u786E\u8BA4\u8BFB\u53D6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "summary": {
          "type": "string"
        }
      },
      "required": [
        "ids",
        "summary"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_list",
    "description": "\u5217\u51FA\u9879\u76EE\u5185\u5730\u56FE\u4E0E\u5F53\u524D active-map\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": true
    }
  },
  {
    "name": "map_create",
    "description": "\u65B0\u5EFA\u5B8C\u6574\u5730\u56FE\u4F46\u4E0D\u81EA\u52A8\u5207\u6362\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_switch",
    "description": "\u6821\u9A8C\u76EE\u6807\u5730\u56FE\u540E\u5207\u6362 active-map\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mapKey": {
          "type": "string"
        }
      },
      "required": [
        "mapKey"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_rename",
    "description": "\u4FEE\u6539\u5730\u56FE\u663E\u793A\u540D\uFF0C\u4E0D\u6539\u53D8 mapKey\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mapKey": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "mapKey",
        "name"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_next_candidates",
    "description": "\u8FD4\u56DE\u5E26\u89E3\u91CA\u7684\u63A8\u8FDB\u5019\u9009\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string"
        },
        "currentNodeId": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        },
        "includeHistory": {
          "type": "boolean"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_apply_commands",
    "description": "\u901A\u8FC7\u7EDF\u4E00 reducer \u539F\u5B50\u63D0\u4EA4\u5730\u56FE\u547D\u4EE4\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mapKey": {
          "type": "string"
        },
        "documentId": {
          "type": "string"
        },
        "baseRevision": {
          "type": "integer",
          "minimum": 0
        },
        "commandId": {
          "type": "string"
        },
        "commands": {
          "type": "array",
          "minItems": 1,
          "maxItems": 100,
          "items": {
            "type": "object"
          }
        }
      },
      "required": [
        "commands"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_validate",
    "description": "\u6821\u9A8C\u5F53\u524D\u5730\u56FE\u4E0E\u5173\u8054 Markdown \u8BC1\u636E\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_checkpoint",
    "description": "\u521B\u5EFA\u53EF\u6062\u590D\u68C0\u67E5\u70B9\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_plan_consolidation",
    "description": "\u53EA\u8BFB\u751F\u6210\u53EF\u5BA1\u6838\u7684\u6574\u7406\u5EFA\u8BAE\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "maxSuggestions": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        },
        "now": {
          "type": "string"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_read_markdown",
    "description": "\u8BFB\u53D6\u5F53\u524D\u5730\u56FE\u8D44\u6599\u5305 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        },
        "path": {
          "type": "string"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_write_markdown",
    "description": "\u7528 baseEtag \u539F\u5B50\u66FF\u6362\u8D44\u6599\u5305 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "baseEtag": {
          "type": "string"
        }
      },
      "required": [
        "content",
        "baseEtag"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_append_markdown",
    "description": "\u6309\u8DEF\u5F84\u9501\u5E42\u7B49\u8FFD\u52A0 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "commandId": {
          "type": "string"
        }
      },
      "required": [
        "content",
        "commandId"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_list_bundle_files",
    "description": "\u5217\u51FA\u5BF9\u8C61\u8D44\u6599\u5305\u6587\u4EF6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "includeArchived": {
          "type": "boolean"
        }
      },
      "required": [
        "ownerKind",
        "ownerId"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_create_markdown",
    "description": "\u5728\u5BF9\u8C61\u8D44\u6599\u5305\u4E2D\u65B0\u5EFA\u8865\u5145 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "content": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "fileName"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_rename_bundle_file",
    "description": "\u6539\u540D\u8865\u5145 Markdown \u6216\u9644\u4EF6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "from": {
          "type": "string"
        },
        "to": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "from",
        "to"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_archive_bundle_file",
    "description": "\u5F52\u6863\u8865\u5145 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "fileName"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_restore_bundle_file",
    "description": "\u6062\u590D\u8865\u5145 Markdown\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "fileName"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_list_assets",
    "description": "\u5217\u51FA\u5BF9\u8C61\u8D44\u6599\u5305\u9644\u4EF6\u5143\u6570\u636E\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "includeArchived": {
          "type": "boolean"
        }
      },
      "required": [
        "ownerKind",
        "ownerId"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_import_asset",
    "description": "\u4ECE\u9879\u76EE\u5185 sourcePath \u6D41\u5F0F\u5BFC\u5165\u9644\u4EF6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "sourcePath": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "sourcePath"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_archive_asset",
    "description": "\u5F52\u6863\u5BF9\u8C61\u9644\u4EF6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "fileName"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_restore_asset",
    "description": "\u6062\u590D\u5BF9\u8C61\u9644\u4EF6\u3002",
    "inputSchema": {
      "type": "object",
      "properties": {
        "ownerKind": {
          "type": "string",
          "enum": [
            "node",
            "route"
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "fileName": {
          "type": "string"
        }
      },
      "required": [
        "ownerKind",
        "ownerId",
        "fileName"
      ],
      "additionalProperties": true
    }
  }
]);
var MCP_TOOL_NAMES = Object.freeze(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));

// agent-kit/lib/bridge-client.mjs
var BridgeClientError = class extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, { cause });
    this.name = "BridgeClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
};
function isLoopbackHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
function assertLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch (error3) {
    throw new BridgeClientError("INVALID_BRIDGE_URL", "\u672C\u5730\u6865\u5730\u5740\u4E0D\u662F\u6709\u6548 URL", { status: 400, cause: error3 });
  }
  if (!["http:", "https:"].includes(url.protocol) || !isLoopbackHost(url.hostname)) {
    throw new BridgeClientError("NON_LOOPBACK_BRIDGE", "\u672C\u5730\u6865\u53EA\u5141\u8BB8\u76D1\u542C loopback \u5730\u5740", {
      status: 400,
      details: { hostname: url.hostname, protocol: url.protocol }
    });
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url;
}
function projectIdForRoot(projectRoot) {
  const digest5 = (0, import_node_crypto10.createHash)("sha256").update(String(projectRoot)).digest("hex").slice(0, 32);
  return `project:${digest5}`;
}

// agent-kit/lib/shortcut.mjs
var import_node_child_process4 = require("node:child_process");
var import_node_os3 = require("node:os");
var import_node_path16 = require("node:path");
function windowsDesktopDirectory({ platform = process.platform, env = process.env, exec = import_node_child_process4.execFileSync } = {}) {
  if (platform !== "win32") return (0, import_node_path16.join)((0, import_node_os3.homedir)(), "Desktop");
  try {
    const output = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8", timeout: 5e3 });
    const path = String(output || "").trim();
    if (path) return path;
  } catch {
  }
  return (0, import_node_path16.join)(env.USERPROFILE || (0, import_node_os3.homedir)(), "Desktop");
}

// agent-kit/lib/portable-node.mjs
var PORTABLE_NODE_MANIFEST = Object.freeze({
  "win32-x64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-win-x64.zip", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-x64.zip", sha256: "66dda1717cae30a13be6bb17ad96ee54b69f2c23c85acd9c3299b095fa26b452" }),
  "win32-arm64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-win-arm64.zip", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-win-arm64.zip", sha256: "010d488af3adad98e44b2d3f61afb7e3d87b5a620f7a406fe75ab0909b72e7ca" }),
  "darwin-x64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-darwin-x64.tar.gz", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-darwin-x64.tar.gz", sha256: "cd5e9a80a38ccffc036a87b232a5402339c7bf8fa9a494ae0731a1a671687718" }),
  "darwin-arm64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-darwin-arm64.tar.gz", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-darwin-arm64.tar.gz", sha256: "98eb624b52efec2530079e1d11296ec0ac20771b94b087d21649250339cf5332" }),
  "linux-x64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-linux-x64.tar.xz", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-linux-x64.tar.xz", sha256: "595272130310cbe12301430756f23d153f7ab95d00174c02adc11a2e3703d183" }),
  "linux-arm64": Object.freeze({ version: "20.12.2", archive: "node-v20.12.2-linux-arm64.tar.xz", url: "https://nodejs.org/dist/v20.12.2/node-v20.12.2-linux-arm64.tar.xz", sha256: "b5fc7983fb9506b8c3de53dfa85ff63f9f49cedc94984e29e4c89328536ba4b9" })
});
function manifestKey(platform = process.platform, arch = process.arch) {
  const normalizedArch = arch === "ia32" ? "x86" : arch;
  return `${platform}-${normalizedArch}`;
}
function portableManifestFor({ platform = process.platform, arch = process.arch, manifest = PORTABLE_NODE_MANIFEST } = {}) {
  return manifest[manifestKey(platform, arch)] || null;
}
function runtimePlan({ nodeVersion = process.versions.node, offline = true, platform = process.platform, arch = process.arch } = {}) {
  const [major, minor] = String(nodeVersion).split(".").map(Number);
  if (Number.isFinite(major) && (major > 20 || major === 20 && minor >= 12)) return { use: "system-node", version: nodeVersion, offline };
  const entry = portableManifestFor({ platform, arch });
  return {
    use: entry ? "portable-node" : "manual-intervention",
    version: entry?.version || null,
    archive: entry?.archive || null,
    download: !offline,
    reason: offline ? "offline-by-default" : void 0
  };
}

// agent-kit/map.template.json
var map_template_default = {
  mapId: "map-template",
  version: 2,
  revision: 0,
  lastEventId: 0,
  mapDir: ".live-dot-map/maps/default",
  bundleLayoutVersion: 1,
  name: "\u672A\u547D\u540D\u5730\u56FE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  view: { x: 0, y: 0, k: 1 },
  ui: { showAnns: true, showRoutes: true, showNums: false, showFailed: true },
  counters: { num: 2, edge: 1, ann: 1, nodeName: 1, edgeName: 1, routeName: 1 },
  routes: [
    {
      id: "r1",
      name: "\u4E3B\u8DEF\u7EBF",
      source: null,
      main: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "migration",
      updatedBy: "migration",
      updatedRevision: 0
    }
  ],
  nodes: [
    {
      id: "n1",
      num: "01",
      name: "\u5F00\u59CB",
      kind: "goal",
      type: "\u76EE\u7684",
      route: "r1",
      x: 0,
      y: 0,
      md: ".live-dot-map/maps/default/nodes/n1/index.md",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: "migration",
      updatedBy: "migration",
      updatedRevision: 0
    }
  ],
  edges: [],
  anns: []
};

// agent-kit/lib/installer.mjs
var ADAPTERS = Object.freeze(["codex", "claude-code", "kimi-code"]);
var OPTIONAL_ADAPTERS = Object.freeze(["codebuddy"]);
var ALL_ADAPTERS = Object.freeze([...ADAPTERS, ...OPTIONAL_ADAPTERS]);
var skillTargetPaths = (home, id) => id === "codex" ? (0, import_node_path17.join)(home, ".codex", "skills", "live-dot-map", "SKILL.md") : id === "claude-code" ? (0, import_node_path17.join)(home, ".claude", "skills", "live-dot-map", "SKILL.md") : id === "kimi-code" ? (0, import_node_path17.join)(home, ".kimi-code", "plugins", "live-dot-map", "skills", "live-dot-map", "SKILL.md") : (0, import_node_path17.join)(home, ".codebuddy", "plugins", "live-dot-map", "skills", "live-dot-map", "SKILL.md");
var kimiPluginRoot = (home) => (0, import_node_path17.join)(home, ".kimi-code", "plugins", "live-dot-map");
var codebuddyPluginRoot = (home) => (0, import_node_path17.join)(home, ".codebuddy", "plugins", "live-dot-map");
var ADAPTER_PROBES = Object.freeze({
  codex: ["codex"],
  "claude-code": ["claude", "claude-code"],
  "kimi-code": ["kimi", "kimi-code"],
  codebuddy: ["codebuddy", "codebuddy-code", "workbuddy"]
});
async function exists2(path) {
  try {
    await (0, import_promises13.access)(path, import_node_fs2.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function atomicText(path, text) {
  await (0, import_promises13.mkdir)((0, import_node_path17.dirname)(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${(0, import_node_crypto11.randomUUID)()}`;
  await (0, import_promises13.writeFile)(temp, text, { encoding: "utf8", flag: "wx" });
  await (0, import_promises13.rename)(temp, path);
}
async function atomicJson(path, value) {
  await atomicText(path, `${JSON.stringify(value, null, 2)}
`);
}
async function readJson2(path, fallback = {}) {
  try {
    const value = JSON.parse(await (0, import_promises13.readFile)(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function sha256(bytes) {
  return (0, import_node_crypto11.createHash)("sha256").update(bytes).digest("hex");
}
async function captureFile(path) {
  try {
    const metadata = await (0, import_promises13.stat)(path);
    if (metadata.isDirectory()) return { path, exists: true, kind: "directory", sha256: null, content: null };
    const bytes = await (0, import_promises13.readFile)(path);
    return { path, exists: true, kind: "file", sha256: sha256(bytes), content: bytes.toString("base64") };
  } catch {
    return { path, exists: false, kind: "missing", sha256: null, content: null };
  }
}
async function restoreCapturedFile(entry) {
  if (entry?.kind === "directory") return;
  if (entry?.exists) {
    await (0, import_promises13.mkdir)((0, import_node_path17.dirname)(entry.path), { recursive: true });
    await (0, import_promises13.writeFile)(entry.path, Buffer.from(String(entry.content || ""), "base64"));
  } else {
    await (0, import_promises13.rm)(entry.path, { force: true }).catch(() => void 0);
  }
}
var adapterConfigPaths = (home, id) => id === "codex" ? [(0, import_node_path17.join)(home, ".codex", "config.toml"), (0, import_node_path17.join)(home, ".codex", "hooks.json")] : id === "claude-code" ? [(0, import_node_path17.join)(home, ".claude", "settings.json")] : id === "kimi-code" ? [(0, import_node_path17.join)(home, ".kimi-code", "mcp.json"), (0, import_node_path17.join)(kimiPluginRoot(home), "kimi.plugin.json")] : [(0, import_node_path17.join)(home, ".codebuddy", "settings.json"), (0, import_node_path17.join)(codebuddyPluginRoot(home), ".codebuddy-plugin", "plugin.json"), (0, import_node_path17.join)(codebuddyPluginRoot(home), ".workbuddy-plugin", "plugin.json"), (0, import_node_path17.join)(codebuddyPluginRoot(home), "hooks", "hooks.json")];
function seaRuntime() {
  return process.env.LIVEDOT_SEA === "1";
}
function runtimeArgs(runtime) {
  return seaRuntime() ? [] : [runtime];
}
function command(nodeCommand, runtime, agent, event) {
  const invocation = [nodeCommand, ...runtimeArgs(runtime), "hook", "--event", event, "--agent", agent].map((part) => /[\s"]/.test(part) ? `"${part}"` : part).join(" ");
  return process.platform === "win32" ? ["cmd", "/d", "/s", "/c", invocation].join(" ") : invocation;
}
function execProbe(file, args = []) {
  return new Promise((resolve16) => {
    (0, import_node_child_process5.execFile)(file, args, { windowsHide: true, timeout: 4e3 }, (error3, stdout = "") => {
      resolve16(!error3 && String(stdout).trim().length > 0);
    });
  });
}
function execText(file, args = [], timeout = 2500) {
  return new Promise((resolve16) => {
    (0, import_node_child_process5.execFile)(file, args, { windowsHide: true, timeout, encoding: "utf8" }, (error3, stdout = "") => {
      resolve16(error3 ? "" : String(stdout));
    });
  });
}
async function commandExists(file) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  return execProbe(locator, [file]);
}
async function discoverEmbeddedCodeBuddy({ platform = process.platform } = {}) {
  if (platform !== "win32") return null;
  const registryRoots = [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"
  ];
  const outputs = await Promise.all(registryRoots.map((root) => execText("reg.exe", ["query", root, "/s", "/v", "DisplayIcon"])));
  const iconPaths = outputs.flatMap((output) => String(output).split(/\r?\n/).flatMap((line) => {
    if (!/workbuddy/i.test(line) || !/REG_SZ/i.test(line)) return [];
    const match = line.match(/REG_SZ\s+(.+)$/i);
    if (!match) return [];
    return [match[1].trim().replace(/^"|"$/g, "").replace(/,\d+$/, "")];
  }));
  for (const iconPath of iconPaths) {
    const installRoot = (0, import_node_path17.dirname)(iconPath);
    const candidate = (0, import_node_path17.join)(installRoot, "resources", "app.asar.unpacked", "cli", "bin", "codebuddy");
    if (await exists2(candidate)) return candidate;
  }
  return null;
}
async function detectInstalledAdapters({ projectRoot = process.cwd(), platform = process.platform, homeRoot = (0, import_node_os4.homedir)() } = {}) {
  const root = (0, import_node_path17.resolve)(projectRoot);
  const home = (0, import_node_path17.resolve)(homeRoot);
  const checks = await Promise.all(ALL_ADAPTERS.map(async (id) => {
    const configPaths = adapterConfigPaths(home, id);
    const configured = (await Promise.all(configPaths.map(async (path) => {
      const text = await (0, import_promises13.readFile)(path, "utf8").catch(() => "");
      return text.includes("livedot-map");
    }))).some(Boolean);
    const probes = platform === "win32" || platform === "darwin" || platform === "linux" ? ADAPTER_PROBES[id] : [];
    let executable = false;
    for (const probe of probes) {
      if (await commandExists(probe)) {
        executable = true;
        break;
      }
    }
    const embeddedPath = id === "codebuddy" && !executable ? await discoverEmbeddedCodeBuddy({ platform }) : null;
    return [id, { id, configured, executable: executable || Boolean(embeddedPath), executableSource: embeddedPath ? "workbuddy-embedded" : null, discovered: configured || executable || Boolean(embeddedPath) }];
  }));
  return Object.fromEntries(checks);
}
function hooksFor(nodeCommand, runtime, agent) {
  return Object.fromEntries([
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "user-prompt"],
    ["Stop", "stop"]
  ].map(([name, event]) => [name, [{ hooks: [{ type: "command", command: command(nodeCommand, runtime, agent, event), timeout: 30 }] }]]));
}
var HOOK_EVENTS = Object.freeze({
  SessionStart: ["session-start", "sessionstart"],
  UserPromptSubmit: ["user-prompt", "userpromptsubmit"],
  Stop: ["stop"]
});
function isLiveDotHookCommand(value, eventName) {
  const commandText = String(value ?? "").trim();
  if (!commandText) return false;
  const normalized = commandText.replace(/["']/g, "").replace(/\\/g, "/").toLowerCase();
  const eventTokens = HOOK_EVENTS[eventName] || [];
  const hasEvent = eventTokens.some((token) => new RegExp(`(?:^|[^a-z0-9])${token}(?:$|[^a-z0-9])`, "i").test(normalized));
  if (!hasEvent) return false;
  const hasProductScript = /(?:^|\/)livedot\.mjs(?:$|\s)/i.test(normalized);
  const hasProductExecutable = /(?:^|\/)livedot(?:-bridge(?:-[a-z0-9_-]+)?|)\.exe(?:$|\s)/i.test(normalized);
  const hasScopedLegacyLauncher = /(?:^|\/)hook\.cmd(?:$|\s)/i.test(normalized) && /(?:^|\/)(?:\.live-dot-map|live-dot-map|livedotmap)(?:\/|$)/i.test(normalized);
  if (!(hasProductScript || hasProductExecutable || hasScopedLegacyLauncher)) return false;
  return /(?:^|[^a-z0-9])hook(?:$|[^a-z0-9])/i.test(normalized) || hasScopedLegacyLauncher;
}
function stripOwnedHookGroup(group, eventName) {
  if (!group || typeof group !== "object" || Array.isArray(group) || !Array.isArray(group.hooks)) return group;
  const kept = group.hooks.filter((hook) => !(hook && typeof hook === "object" && hook.type === "command" && isLiveDotHookCommand(hook.command, eventName)));
  if (!kept.length) return null;
  return { ...group, hooks: kept };
}
function mergeHooks(existing, additions) {
  const hooks = { ...existing?.hooks || {} };
  for (const [event, groups] of Object.entries(additions)) {
    const prior = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = prior.map((group) => stripOwnedHookGroup(group, event)).filter((group) => group !== null);
    hooks[event] = [...kept, ...groups];
  }
  return { ...existing, hooks };
}
function mcpAgentOf(server) {
  const args = Array.isArray(server?.args) ? server.args : [];
  const index = args.indexOf("--agent");
  return index >= 0 ? args[index + 1] : null;
}
function mcpServerKey(mcp, agent) {
  const base = mcp?.mcpServers?.["livedot-map"];
  if (!base || mcpAgentOf(base) === agent) return "livedot-map";
  return `livedot-map-${agent}`;
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
async function writeCodexConfig(home, nodeCommand, runtime) {
  const path = (0, import_node_path17.join)(home, ".codex", "config.toml");
  const begin = "# BEGIN LIVE-DOT-MAP";
  const end = "# END LIVE-DOT-MAP";
  const old = await (0, import_promises13.readFile)(path, "utf8").catch(() => "");
  const stripped = old.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\s*`, "g"), "").trimEnd();
  const block = [begin, '[mcp_servers."livedot-map"]', `command = ${tomlString(nodeCommand)}`, `args = [${[...runtimeArgs(runtime), "mcp", "--agent", "codex"].map(tomlString).join(", ")}]`, "required = false", end].join("\n");
  await atomicText(path, `${stripped ? `${stripped}

` : ""}${block}
`);
  const hooksPath = (0, import_node_path17.join)(home, ".codex", "hooks.json");
  await atomicJson(hooksPath, mergeHooks(await readJson2(hooksPath), hooksFor(nodeCommand, runtime, "codex")));
  return [path, hooksPath];
}
async function writeClaudeConfig(home, nodeCommand, runtime) {
  const settingsPath = (0, import_node_path17.join)(home, ".claude", "settings.json");
  const settings = await readJson2(settingsPath);
  const mcp = { mcpServers: settings.mcpServers && typeof settings.mcpServers === "object" ? settings.mcpServers : {} };
  const key = mcpServerKey(mcp, "claude");
  mcp.mcpServers = { ...mcp.mcpServers || {}, [key]: { type: "stdio", command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "claude"] } };
  settings.mcpServers = mcp.mcpServers;
  await atomicJson(settingsPath, mergeHooks(settings, hooksFor(nodeCommand, runtime, "claude")));
  return [settingsPath];
}
async function writeKimiConfig(home, nodeCommand, runtime) {
  const mcpPath = (0, import_node_path17.join)(home, ".kimi-code", "mcp.json");
  const mcp = await readJson2(mcpPath);
  mcp.mcpServers = { ...mcp.mcpServers || {}, "livedot-map": { command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "kimi"] } };
  await atomicJson(mcpPath, mcp);
  const plugin = kimiPluginRoot(home);
  const pluginRuntime = (0, import_node_path17.join)(plugin, "runtime", "livedot.mjs");
  await (0, import_promises13.mkdir)((0, import_node_path17.dirname)(pluginRuntime), { recursive: true });
  if (!seaRuntime()) await (0, import_promises13.copyFile)(runtime, pluginRuntime);
  const manifest = {
    name: "livedot-map",
    version: "2.0.0",
    description: "\u6D3B\u70B9\u5730\u56FE\u4EBA\u673A\u534F\u4F5C\u95ED\u73AF",
    mcpServers: { "livedot-map": { command: nodeCommand, args: [...seaRuntime() ? [] : ["./runtime/livedot.mjs"], "mcp", "--agent", "kimi"] } },
    hooks: [
      { event: "SessionStart", command: command(nodeCommand, runtime, "kimi", "session-start"), timeout: 30 },
      { event: "UserPromptSubmit", command: command(nodeCommand, runtime, "kimi", "user-prompt"), timeout: 30 },
      { event: "Stop", command: command(nodeCommand, runtime, "kimi", "stop"), timeout: 30 }
    ]
  };
  await atomicJson((0, import_node_path17.join)(plugin, "kimi.plugin.json"), manifest);
  return [mcpPath, (0, import_node_path17.join)(plugin, "kimi.plugin.json")];
}
async function writeCodeBuddyConfig(home, nodeCommand, runtime) {
  const settingsPath = (0, import_node_path17.join)(home, ".codebuddy", "settings.json");
  const settings = await readJson2(settingsPath);
  const mcp = { mcpServers: settings.mcpServers && typeof settings.mcpServers === "object" ? settings.mcpServers : {} };
  const key = mcpServerKey(mcp, "codebuddy");
  mcp.mcpServers = { ...mcp.mcpServers || {}, [key]: { type: "stdio", command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "codebuddy"] } };
  settings.mcpServers = mcp.mcpServers;
  await atomicJson(settingsPath, mergeHooks(settings, hooksFor(nodeCommand, runtime, "codebuddy")));
  const plugin = codebuddyPluginRoot(home);
  const manifest = {
    name: "livedot-map",
    version: "2.0.0",
    description: "\u6D3B\u70B9\u5730\u56FE\u4EBA\u673A\u534F\u4F5C\u95ED\u73AF\uFF08\u817E\u8BAF\u7CFB Agent\uFF09",
    hooks: "./hooks/hooks.json",
    mcpServers: { "livedot-map": { command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "codebuddy"] } }
  };
  await atomicJson((0, import_node_path17.join)(plugin, ".codebuddy-plugin", "plugin.json"), manifest);
  await atomicJson((0, import_node_path17.join)(plugin, ".workbuddy-plugin", "plugin.json"), manifest);
  await atomicJson((0, import_node_path17.join)(plugin, "hooks", "hooks.json"), { hooks: hooksFor(nodeCommand, runtime, "codebuddy") });
  return [settingsPath, (0, import_node_path17.join)(plugin, ".codebuddy-plugin", "plugin.json"), (0, import_node_path17.join)(plugin, ".workbuddy-plugin", "plugin.json"), (0, import_node_path17.join)(plugin, "hooks", "hooks.json")];
}
async function installProject({
  projectRoot = process.cwd(),
  sourceRoot,
  runtimeSource,
  appPath,
  bridgeUrl = "",
  bridgeClient,
  register = true,
  createDesktopShortcut = true,
  offline = true,
  platform = process.platform,
  env = process.env,
  exec,
  discoverAgents = true,
  detectedAgents = null,
  homeRoot = (0, import_node_os4.homedir)()
} = {}) {
  const root = (0, import_node_path17.resolve)(projectRoot);
  const home = (0, import_node_path17.resolve)(homeRoot);
  if (!await exists2(root)) throw new Error(`\u9879\u76EE\u76EE\u5F55\u4E0D\u5B58\u5728: ${root}`);
  const source = (0, import_node_path17.resolve)(sourceRoot instanceof URL ? (0, import_node_url.fileURLToPath)(sourceRoot) : sourceRoot || process.cwd());
  const sourceRuntime = (0, import_node_path17.resolve)(runtimeSource || (0, import_node_path17.resolve)(source, "livedot.mjs"));
  const canonicalCandidates = [(0, import_node_path17.resolve)(source, "skills", "live-dot-map", "SKILL.md"), (0, import_node_path17.resolve)(source, "agent-kit", "skills", "live-dot-map", "SKILL.md")];
  let canonicalSkill = null;
  for (const candidate of canonicalCandidates) if (await exists2(candidate)) {
    canonicalSkill = candidate;
    break;
  }
  if (!canonicalSkill || !await exists2(canonicalSkill)) throw new Error(`\u7F3A\u5C11 canonical Skill: ${canonicalCandidates[0]}`);
  if (!seaRuntime() && !await exists2(sourceRuntime)) throw new Error(`\u7F3A\u5C11\u5DF2\u6784\u5EFA\u8FD0\u884C\u65F6: ${sourceRuntime}`);
  const dataDir = (0, import_node_path17.join)(root, ".live-dot-map");
  const globalDataDir = (0, import_node_path17.join)(home, ".live-dot-map");
  const runtime = seaRuntime() ? null : (0, import_node_path17.join)(globalDataDir, "livedot.mjs");
  await (0, import_promises13.mkdir)(dataDir, { recursive: true });
  const projectId = projectIdForRoot(root);
  const mapPath = (0, import_node_path17.join)(dataDir, "map.json");
  const configPath = (0, import_node_path17.join)(dataDir, "agent-kit.json");
  const old = await readJson2(configPath);
  const url = bridgeUrl || old?.bridge?.url || "http://127.0.0.1:0";
  assertLoopbackUrl(url);
  const nodeCommand = process.execPath;
  const detected = detectedAgents && typeof detectedAgents === "object" ? detectedAgents : discoverAgents ? await detectInstalledAdapters({ projectRoot: root, platform, homeRoot: home }) : Object.fromEntries(ALL_ADAPTERS.map((id) => [id, { id, configured: false, executable: false, discovered: true }]));
  const installed = {};
  for (const id of ALL_ADAPTERS) if (detected[id]?.discovered) installed[id] = true;
  const backupPath = (0, import_node_path17.join)(globalDataDir, "backups", `agent-kit-install-${projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  const beforeBackup = await captureFile(backupPath);
  const oldRuntime = runtime ? await captureFile(runtime) : { exists: false, kind: "missing", path: null };
  const oldMap = await captureFile(mapPath);
  const mapsLayoutExists = await exists2((0, import_node_path17.join)(dataDir, "maps"));
  let createdMapsLayout = false;
  const touched = /* @__PURE__ */ new Set([configPath, ...runtime ? [runtime] : []]);
  for (const id of /* @__PURE__ */ new Set([...Object.keys(old.installed || {}), ...Object.keys(installed)])) for (const path of adapterConfigPaths(home, id)) touched.add(path);
  for (const id of Object.keys(installed)) touched.add(skillTargetPaths(home, id));
  const existingBackup = await readJson2(backupPath, null);
  const backupFiles = new Map(Array.isArray(existingBackup?.files) ? existingBackup.files.map((entry) => [entry.path, entry]) : []);
  for (const path of touched) if (!backupFiles.has(path)) backupFiles.set(path, await captureFile(path));
  const backup = existingBackup?.version === 1 && Array.isArray(existingBackup.files) ? { ...existingBackup, files: [...backupFiles.values()] } : { version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), projectRoot: root, files: [...backupFiles.values()] };
  const rollback = async () => {
    for (const entry of backup.files) await restoreCapturedFile(entry);
    await restoreCapturedFile(beforeBackup);
    if (!oldMap.exists) await (0, import_promises13.rm)(mapPath, { force: true }).catch(() => void 0);
    if (createdMapsLayout) {
      await (0, import_promises13.rm)((0, import_node_path17.join)(dataDir, "maps"), { recursive: true, force: true }).catch(() => void 0);
      await (0, import_promises13.rm)((0, import_node_path17.join)(dataDir, "active-map"), { force: true }).catch(() => void 0);
    }
    if (runtime && !oldRuntime.exists) await (0, import_promises13.rm)(runtime, { force: true }).catch(() => void 0);
  };
  try {
    await atomicJson(backupPath, backup);
    if (runtime && (0, import_node_path17.resolve)(sourceRuntime) !== (0, import_node_path17.resolve)(runtime)) {
      await (0, import_promises13.mkdir)(globalDataDir, { recursive: true });
      await (0, import_promises13.copyFile)(sourceRuntime, runtime);
    }
    for (const id of Object.keys(installed)) {
      const target = skillTargetPaths(home, id);
      await (0, import_promises13.mkdir)((0, import_node_path17.dirname)(target), { recursive: true });
      await (0, import_promises13.copyFile)(canonicalSkill, target);
    }
    if (!oldMap.exists && !mapsLayoutExists) {
      const map = structuredClone(map_template_default);
      if (map.version !== 2) throw new Error("\u5185\u7F6E map.json \u6A21\u677F\u4E0D\u662F v2");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      map.mapId = projectId;
      map.name = (0, import_node_path17.basename)(root);
      map.createdAt = now;
      map.updatedAt = now;
      map.mapDir = ".live-dot-map/maps/default";
      for (const collection of ["routes", "nodes", "edges", "anns"]) for (const item of Array.isArray(map[collection]) ? map[collection] : []) {
        item.createdAt = now;
        item.updatedAt = now;
        item.updatedBy = "installer";
        if (typeof item.md === "string" && item.md.startsWith(".live-dot-map/")) {
          item.md = `.live-dot-map/maps/default${item.md.slice(".live-dot-map".length)}`;
        }
      }
      await atomicJson((0, import_node_path17.join)(dataDir, "maps", "default", "map.json"), map);
      await atomicText((0, import_node_path17.join)(dataDir, "active-map"), "default\n");
      createdMapsLayout = true;
    }
    if (installed.codex) await writeCodexConfig(home, nodeCommand, runtime);
    if (installed["claude-code"]) await writeClaudeConfig(home, nodeCommand, runtime);
    if (installed["kimi-code"]) await writeKimiConfig(home, nodeCommand, runtime);
    if (installed.codebuddy) await writeCodeBuddyConfig(home, nodeCommand, runtime);
    const config = {
      ...old,
      version: 2,
      projectId: old.projectId || projectId,
      projectRoot: root,
      runtime,
      runtimeMode: seaRuntime() ? "sea" : "node",
      nodeCommand,
      homeRoot: home,
      detectedAgents: detected,
      trust: { ...old.trust && typeof old.trust === "object" ? old.trust : {}, ...Object.fromEntries(Object.keys(installed).map((id) => [id, { acknowledged: old.trust?.[id]?.acknowledged === true, updatedAt: old.trust?.[id]?.updatedAt || null }])) },
      bridge: { url, tokenEnv: "LIVEDOT_BRIDGE_TOKEN", sessionEnv: "LIVEDOT_SESSION_ID" },
      installed,
      installBackup: backupPath,
      installedFiles: Object.fromEntries([...touched].map((path) => [path, null])),
      installedAt: old.installedAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    for (const path of touched) {
      const current = await captureFile(path);
      config.installedFiles[path] = current.sha256;
    }
    await atomicJson(configPath, config);
    const result2 = {
      ok: true,
      projectRoot: root,
      projectId: config.projectId,
      configPath,
      runtime,
      installed,
      detectedAgents: detected,
      bridge: { registered: true, mode: "project-config" },
      shortcut: null,
      trustRequired: Object.fromEntries(Object.keys(installed).map((id) => [id, id === "codex" ? "\u5728 Codex \u5168\u5C40 hooks \u4E2D\u786E\u8BA4\u6D3B\u70B9\u5730\u56FE hook\uFF08\u4E00\u6B21\u6027\uFF09" : id === "claude-code" ? "\u5728 Claude Code \u8BBE\u7F6E\u4E2D\u786E\u8BA4 hooks \u4E0E MCP\uFF08\u4E00\u6B21\u6027\uFF09" : id === "kimi-code" ? `\u5728 Kimi \u6267\u884C /plugins install ${kimiPluginRoot(home)}` : "\u5728 WorkBuddy/CodeBuddy \u63D2\u4EF6\u9762\u677F\u5BA1\u6838\u5E76\u542F\u7528 hooks \u4E0E MCP"])),
      runtimePlan: runtimePlan({ offline })
    };
    if (register && bridgeClient) {
      result2.bridge.registration = await bridgeClient.openProject(root);
      result2.bridge.mode = "live-bridge";
    }
    if (createDesktopShortcut && platform === "win32") {
      result2.shortcut = { ok: true, skipped: true, reason: "product-installer-manages-shortcut" };
    }
    return result2;
  } catch (error3) {
    await rollback();
    throw error3;
  }
}
async function uninstallProject({ projectRoot = process.cwd(), platform = process.platform, env = process.env, exec } = {}) {
  const root = (0, import_node_path17.resolve)(projectRoot);
  const dataDir = (0, import_node_path17.join)(root, ".live-dot-map");
  const configPath = (0, import_node_path17.join)(dataDir, "agent-kit.json");
  const config = await readJson2(configPath, null);
  if (!config || typeof config !== "object") return { ok: false, reason: "not-installed", projectRoot: root, mapPreserved: await exists2((0, import_node_path17.join)(dataDir, "map.json")) || await exists2((0, import_node_path17.join)(dataDir, "maps")) };
  const backupPath = typeof config.installBackup === "string" ? config.installBackup : (0, import_node_path17.join)(dataDir, "backups", "agent-kit-install.json");
  const backup = await readJson2(backupPath, null);
  const installedFiles = config.installedFiles && typeof config.installedFiles === "object" ? config.installedFiles : {};
  const restored = [];
  const skipped = [];
  for (const entry of Array.isArray(backup?.files) ? backup.files : []) {
    if (!entry?.path || entry.path === (0, import_node_path17.join)(dataDir, "map.json") || entry.path === backupPath) continue;
    const current = await captureFile(entry.path);
    const expected = installedFiles[entry.path];
    let configOwned = false;
    if (entry.path === configPath && current.exists) {
      try {
        const parsed = JSON.parse(Buffer.from(String(current.content || ""), "base64").toString("utf8"));
        configOwned = parsed?.installBackup === backupPath && parsed?.projectRoot === root;
      } catch {
      }
    }
    if (expected && current.sha256 === expected || configOwned) {
      await restoreCapturedFile(entry);
      restored.push(entry.path);
    } else if (!current.exists && !entry.exists) {
      restored.push(entry.path);
    } else if (current.sha256 === entry.sha256) {
      await restoreCapturedFile(entry);
      restored.push(entry.path);
    } else {
      skipped.push({ path: entry.path, reason: "after-install-change" });
    }
  }
  const launcherPaths = [(0, import_node_path17.join)(dataDir, "\u542F\u52A8\u6D3B\u70B9\u5730\u56FE.cmd"), (0, import_node_path17.join)(dataDir, "\u6253\u5F00\u6D3B\u70B9\u5730\u56FE.cmd")];
  if (platform === "win32") {
    const desktop = windowsDesktopDirectory({ platform, env, exec });
    launcherPaths.push((0, import_node_path17.join)(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.lnk"), (0, import_node_path17.join)(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.cmd"));
  }
  for (const path of launcherPaths) {
    const current = await captureFile(path);
    if (!current.exists) continue;
    const looksOwned = path.includes(dataDir) || current.content?.includes(Buffer.from("livedot.mjs").toString("base64"));
    if (looksOwned) {
      await (0, import_promises13.rm)(path, { force: true });
      restored.push(path);
    }
  }
  const mapPreserved = await exists2((0, import_node_path17.join)(dataDir, "map.json")) || await exists2((0, import_node_path17.join)(dataDir, "maps"));
  return { ok: skipped.length === 0, projectRoot: root, restored, skipped, mapPreserved, backupPath };
}
async function doctorProject({ projectRoot = process.cwd(), checkBridge = false, bridgeClient, offline = true, homeRoot = (0, import_node_os4.homedir)() } = {}) {
  const root = (0, import_node_path17.resolve)(projectRoot);
  const home = (0, import_node_path17.resolve)(homeRoot);
  const configPath = (0, import_node_path17.join)(root, ".live-dot-map", "agent-kit.json");
  const config = await readJson2(configPath, null);
  const installed = config?.installed && typeof config.installed === "object" ? config.installed : {};
  const expected = [
    ["agent-kit-config", configPath]
  ];
  if (config?.runtimeMode !== "sea" && config?.runtime !== null) expected.push(["runtime", (0, import_node_path17.join)(home, ".live-dot-map", "livedot.mjs")]);
  if (installed.codex) expected.push(["codex-hooks", (0, import_node_path17.join)(home, ".codex", "hooks.json")], ["codex-mcp", (0, import_node_path17.join)(home, ".codex", "config.toml")]);
  if (installed["claude-code"]) expected.push(["claude-hooks", (0, import_node_path17.join)(home, ".claude", "settings.json")]);
  if (installed["kimi-code"]) expected.push(["kimi-mcp", (0, import_node_path17.join)(home, ".kimi-code", "mcp.json")], ["kimi-plugin", (0, import_node_path17.join)(kimiPluginRoot(home), "kimi.plugin.json")]);
  if (installed.codebuddy) expected.push(["codebuddy-hooks", (0, import_node_path17.join)(home, ".codebuddy", "settings.json")], ["codebuddy-plugin", (0, import_node_path17.join)(codebuddyPluginRoot(home), ".codebuddy-plugin", "plugin.json")]);
  const checks = [{ name: "project-root", ok: await exists2(root), detail: root }];
  for (const [name, path] of expected) checks.push({ name, ok: await exists2(path), detail: path });
  checks.push({ name: "map", ok: await exists2((0, import_node_path17.join)(root, ".live-dot-map", "map.json")) || await exists2((0, import_node_path17.join)(root, ".live-dot-map", "maps")), detail: (0, import_node_path17.join)(root, ".live-dot-map") });
  const detectedAgents = await detectInstalledAdapters({ projectRoot: root, homeRoot: home });
  checks.push({ name: "agent-discovery", ok: Object.values(detectedAgents).every((item) => !item.discovered || Boolean(installed[item.id])), detail: detectedAgents });
  checks.push({ name: "node", ok: runtimePlan({ offline }).use === "system-node", detail: process.versions.node });
  checks.push({ name: "portable-node-manifest", ok: Boolean(portableManifestFor()), detail: portableManifestFor()?.version || "unavailable" });
  if (checkBridge) {
    try {
      const health = await bridgeClient.health();
      checks.push({ name: "bridge-health", ok: true, detail: health?.status || health });
    } catch (error3) {
      checks.push({ name: "bridge-health", ok: false, detail: error3?.message });
    }
  }
  return { ok: checks.every((check) => check.ok), projectRoot: root, configPath, checks, runtime: runtimePlan({ offline }) };
}

// src/bridge/server.mjs
var SESSION_COOKIE = "ldm_bridge_session";
var DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;
var DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1e3;
var RECENT_PROJECTS_FILE = () => process.env.LIVEDOT_RECENT_PROJECTS_FILE || (0, import_node_path18.join)((0, import_node_os5.homedir)(), ".live-dot-map", "recent-projects.json");
async function recordRecentProject(root) {
  let recent = [];
  try {
    const parsed = JSON.parse(await (0, import_promises14.readFile)(RECENT_PROJECTS_FILE(), "utf8"));
    if (Array.isArray(parsed)) recent = parsed.filter((item) => typeof item === "string");
  } catch {
  }
  recent = [root, ...recent.filter((item) => item !== root)].slice(0, 15);
  await (0, import_promises14.mkdir)((0, import_node_path18.dirname)(RECENT_PROJECTS_FILE()), { recursive: true });
  await (0, import_promises14.writeFile)(RECENT_PROJECTS_FILE(), `${JSON.stringify(recent, null, 2)}
`, "utf8");
}
async function readRecentProjects() {
  try {
    const parsed = JSON.parse(await (0, import_promises14.readFile)(RECENT_PROJECTS_FILE(), "utf8"));
    const list = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    const valid = [];
    for (const item of list) {
      try {
        await canonicalDirectory(item);
        valid.push(item);
      } catch {
      }
    }
    return valid;
  } catch {
    return [];
  }
}
function buildPickFolderScript(marker) {
  const markerEscaped = marker.replaceAll("\\", "\\\\").replaceAll("'", "''");
  return `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace LdmFolderPicker {
  // \u73B0\u4EE3\u300C\u9009\u62E9\u6587\u4EF6\u5939\u300D\u5BF9\u8BDD\u6846\uFF1ACOM IFileOpenDialog + FOS_PICKFOLDERS\u3002
  // \u672A\u7528\u5230\u7684\u65B9\u6CD5\u53EA\u58F0\u660E\u5360\u4F4D\u7B7E\u540D\u4EE5\u7EF4\u6301 vtable \u987A\u5E8F\uFF08\u6C38\u8FDC\u4E0D\u4F1A\u88AB\u8C03\u7528\uFF09\u3002
  public static class ModernFolderPicker {
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    private class FileOpenDialogComClass { }

    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog {
      [PreserveSig] int Show(IntPtr parent);
      void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
      void SetFileTypeIndex(uint iFileType);
      void GetFileTypeIndex(out uint piFileType);
      void Advise(IntPtr pfde, out uint pdwCookie);
      void Unadvise(uint dwCookie);
      void SetOptions(uint fos);
      void GetOptions(out uint pfos);
      void SetDefaultFolder(IntPtr psi);
      void SetFolder(IntPtr psi);
      void GetFolder(out IntPtr ppsi);
      void GetCurrentSelection(out IntPtr ppsi);
      void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
      void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
      void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
      void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
      void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
      void GetResult(out IShellItem ppsi);
      void AddPlace(IntPtr psi, int fdap);
      void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
      void Close(int hr);
      void SetClientGuid(ref Guid guid);
      void ClearClientData();
      void SetFilter(IntPtr pFilter);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem {
      void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
      void GetParent(out IShellItem ppsi);
      void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
      void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
      void Compare(IntPtr psi, uint hint, out int piOrder);
    }

    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000040;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    // \u7528\u6237\u53D6\u6D88\u8FD4\u56DE null\uFF08Show \u8FD4\u56DE 0x800704C7\uFF09\uFF1BCOM \u521B\u5EFA/\u8C03\u7528\u5931\u8D25\u629B\u5F02\u5E38\uFF0C\u7531\u8C03\u7528\u65B9\u56DE\u843D\u8001\u5BF9\u8BDD\u6846\u3002
    public static string Pick(IntPtr owner, string title) {
      var dialog = (IFileOpenDialog)new FileOpenDialogComClass();
      try {
        dialog.SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        dialog.SetTitle(title);
        int hr = dialog.Show(owner);
        if (hr != 0) return null;
        IShellItem item;
        dialog.GetResult(out item);
        string path;
        item.GetDisplayName(SIGDN_FILESYSPATH, out path);
        return path;
      } finally {
        Marshal.FinalReleaseComObject(dialog);
      }
    }
  }
}
'@

# \u7F6E\u9876\u9690\u5F62 owner \u7A97\u4F53\uFF1A\u5BF9\u8BDD\u6846\u4EE5\u5B83\u4E3A\u7236\u7A97\u53E3\uFF0CZ \u5E8F\u538B\u8FC7\u753B\u5E03\u6D4F\u89C8\u5668\u7A97\u53E3\u3002
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'
$owner.Show()

$path = $null
$mode = 'modern'
try {
  try {
    $path = [LdmFolderPicker.ModernFolderPicker]::Pick($owner.Handle, '\u9009\u62E9\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u6587\u4EF6\u5939')
  } catch {
    # \u73B0\u4EE3\u5BF9\u8BDD\u6846\u4E0D\u53EF\u7528\uFF08\u5F02\u5E38\uFF09\uFF0C\u56DE\u843D\u8001\u5F0F FolderBrowserDialog\uFF0C\u540C\u6837\u6302\u7F6E\u9876 owner\u3002
    $mode = 'fallback'
    Write-Output ('PICK:DIAG \u73B0\u4EE3\u5BF9\u8BDD\u6846\u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u843D\uFF1A' + $_.Exception.Message)
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = '\u9009\u62E9\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u6587\u4EF6\u5939'
    $d.ShowNewFolderButton = $true
    if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $path = $d.SelectedPath }
  }
} finally {
  $owner.Dispose()
}

if ($path) {
  [System.IO.File]::WriteAllText('${markerEscaped}', $path, [System.Text.Encoding]::UTF8)
  Write-Output ('PICK:OK ' + $mode)
} else {
  Write-Output ('PICK:CANCEL ' + $mode)
}
`;
}
async function pickProjectFolder({ logger = noopLogger } = {}) {
  const tmpDir = (0, import_node_path18.join)((0, import_node_os5.homedir)(), ".live-dot-map", "tmp");
  await (0, import_promises14.mkdir)(tmpDir, { recursive: true });
  const marker = (0, import_node_path18.join)(tmpDir, `pick-${(0, import_node_crypto12.randomUUID)()}.txt`);
  const script = buildPickFolderScript(marker);
  const run = await new Promise((resolveRun, rejectRun) => {
    const child = (0, import_node_child_process6.spawn)("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4096) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
      }
    }, 3e5);
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
  const statusLine = run.stdout.split(/\r?\n/).find((line) => /^PICK:(OK|CANCEL)/.test(line));
  const mode = statusLine && statusLine.includes("fallback") ? "fallback" : "modern";
  const diag = run.stdout.split(/\r?\n/).filter((line) => line.startsWith("PICK:DIAG")).join(" | ");
  if (run.code !== 0) {
    await logger.warn("project.pick", { outcome: "error", exitCode: run.code, stderr: run.stderr.slice(0, 400), diag });
    await (0, import_promises14.rm)(marker, { force: true }).catch(() => void 0);
    return { cancelled: true };
  }
  try {
    const text = (await (0, import_promises14.readFile)(marker, "utf8")).trim();
    await (0, import_promises14.rm)(marker, { force: true }).catch(() => void 0);
    if (text) {
      await logger.info("project.pick", { outcome: "ok", mode, path: text, diag });
      return { cancelled: false, path: text };
    }
    await logger.info("project.pick", { outcome: "cancelled", mode, diag });
    return { cancelled: true };
  } catch (error3) {
    await logger.warn("project.pick", { outcome: "error", message: String(error3?.message || error3).slice(0, 400) });
    return { cancelled: true };
  }
}
function randomToken(bytes = 32) {
  return (0, import_node_crypto12.randomBytes)(bytes).toString("base64url");
}
async function recordAgentHealth(root, actor, event, status, error3) {
  const path = (0, import_node_path18.join)(root, ".live-dot-map", ".bridge", "agent-health.json");
  const prior = await (0, import_promises14.readFile)(path, "utf8").then((text) => JSON.parse(text)).catch(() => ({}));
  const records = prior.records && typeof prior.records === "object" && !Array.isArray(prior.records) ? prior.records : {};
  records[String(actor).replace(/^agent:/, "")] = {
    status,
    actor,
    event,
    boundary: String(event).startsWith("mcp:") ? "mcp" : "hook",
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...status === "error" ? { code: error3?.code || "BRIDGE_MCP_FAILED", message: String(error3?.message || error3 || "\u672A\u77E5\u9519\u8BEF").slice(0, 400) } : {}
  };
  await (0, import_promises14.mkdir)((0, import_node_path18.join)(root, ".live-dot-map", ".bridge"), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomToken(8)}.tmp`;
  try {
    await (0, import_promises14.writeFile)(temporary, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), records }, null, 2)}
`, "utf8");
    await (0, import_promises14.rename)(temporary, path);
  } catch {
  }
}
async function readAgentHealth(root) {
  return (0, import_promises14.readFile)((0, import_node_path18.join)(root, ".live-dot-map", ".bridge", "agent-health.json"), "utf8").then((text) => {
    const value = JSON.parse(text);
    return value && typeof value.records === "object" && !Array.isArray(value.records) ? value.records : {};
  }).catch(() => ({}));
}
async function readObject(path) {
  try {
    const value = JSON.parse(await (0, import_promises14.readFile)(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function runtimeSources({ sourceRoot, runtimeSource } = {}) {
  const entry = process.argv[1] ? (0, import_node_path18.resolve)(process.argv[1]) : "";
  const entryRoot = entry ? (0, import_node_path18.dirname)(entry) : "";
  const roots = [
    sourceRoot,
    process.env.LIVEDOT_AGENT_KIT_SOURCE,
    process.cwd(),
    entryRoot
  ].filter(Boolean).map((value) => (0, import_node_path18.resolve)(value));
  const uniqueRoots = [...new Set(roots)];
  const runtimes = [
    runtimeSource,
    process.env.LIVEDOT_RUNTIME_SOURCE,
    ...uniqueRoots.map((root) => (0, import_node_path18.join)(root, "livedot.mjs"))
  ].filter(Boolean).map((value) => (0, import_node_path18.resolve)(value));
  return { sourceRoot: uniqueRoots[0] || process.cwd(), runtimeSource: runtimes[0] || "" };
}
async function ensureProjectAgentConfig(projectRoot, {
  platform = process.platform,
  sourceRoot,
  runtimeSource,
  homeRoot,
  detect = detectInstalledAdapters,
  install = installProject
} = {}) {
  const root = (0, import_node_path18.resolve)(projectRoot);
  try {
    const detected = await detect({ projectRoot: root, platform, ...homeRoot ? { homeRoot } : {} });
    const available = Object.values(detected || {}).filter((item) => item?.discovered === true);
    const configPath = (0, import_node_path18.join)(root, ".live-dot-map", "agent-kit.json");
    const existing = await readObject(configPath);
    if (!available.length) {
      return { ok: true, status: "none", changed: false, projectRoot: root, detectedAgents: detected || {}, configured: existing?.installed || {} };
    }
    const installed = existing?.installed && typeof existing.installed === "object" ? existing.installed : {};
    const alreadyConfigured = existing?.version === 2 && available.every((item) => installed[item.id] === true);
    if (alreadyConfigured) {
      return { ok: true, status: "ready", changed: false, projectRoot: root, detectedAgents: detected || {}, configured: installed, trust: existing?.trust || {} };
    }
    const sources = runtimeSources({ sourceRoot, runtimeSource });
    const result2 = await install({
      projectRoot: root,
      ...homeRoot ? { homeRoot } : {},
      sourceRoot: sources.sourceRoot,
      runtimeSource: sources.runtimeSource,
      createDesktopShortcut: false,
      register: false,
      offline: true,
      platform,
      discoverAgents: true,
      detectedAgents: detected
    });
    return {
      ok: true,
      status: "configured",
      changed: true,
      projectRoot: root,
      detectedAgents: result2.detectedAgents || detected || {},
      configured: result2.installed || {},
      trust: existing?.trust || {},
      trustRequired: result2.trustRequired || {}
    };
  } catch (error3) {
    return {
      ok: false,
      status: "error",
      changed: false,
      projectRoot: root,
      code: error3?.code || "AGENT_SETUP_FAILED",
      message: String(error3?.message || error3 || "Agent \u63A5\u5165\u914D\u7F6E\u5931\u8D25").slice(0, 400)
    };
  }
}
function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && (0, import_node_crypto12.timingSafeEqual)(a, b);
}
function parseCookies(header = "") {
  if (header.length > 8192) throw new BridgeError("COOKIE_HEADER_TOO_LARGE", "Cookie header is too large", { status: 400 });
  const cookies = /* @__PURE__ */ new Map();
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    cookies.set(key, value);
  }
  return cookies;
}
async function readJsonBody(request, limit) {
  const contentType = request.headers["content-type"] || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new BridgeError("JSON_REQUIRED", "Content-Type must be application/json", { status: 415 });
  }
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    throw new BridgeError("BODY_TOO_LARGE", "Request body exceeds the configured limit", { status: 413 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      throw new BridgeError("BODY_TOO_LARGE", "Request body exceeds the configured limit", { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value;
  } catch (error3) {
    throw new BridgeError("INVALID_JSON", "Request body must be a valid JSON object", { status: 400, cause: error3 });
  }
}
var EventHub = class {
  #clients = /* @__PURE__ */ new Map();
  #heartbeat;
  constructor(heartbeatMs = 3e3) {
    this.#heartbeat = setInterval(() => {
      const payload = `event: heartbeat
data: ${JSON.stringify({ at: Date.now() })}

`;
      for (const clients of this.#clients.values()) {
        for (const response of clients) if (!response.destroyed) response.write(payload);
      }
    }, heartbeatMs);
    this.#heartbeat.unref?.();
  }
  subscribe(root, response) {
    let clients = this.#clients.get(root);
    if (!clients) this.#clients.set(root, clients = /* @__PURE__ */ new Set());
    clients.add(response);
    response.once("close", () => clients.delete(response));
  }
  publish(root, event) {
    const payload = `event: ${event.type}
data: ${JSON.stringify(event)}

`;
    for (const response of this.#clients.get(root) || []) {
      if (!response.destroyed) response.write(payload);
    }
  }
  close() {
    clearInterval(this.#heartbeat);
    for (const clients of this.#clients.values()) {
      for (const response of clients) {
        if (!response.destroyed) response.destroy();
      }
    }
    this.#clients.clear();
  }
};
function setSecurityHeaders(response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
}
function sendJson(response, status, value) {
  const data = Buffer.from(JSON.stringify(value));
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", data.length);
  response.end(data);
}
function sendError(response, error3) {
  const bridgeError3 = asBridgeError(error3);
  const body = {
    error: {
      code: bridgeError3.code,
      message: bridgeError3.status >= 500 ? "Local bridge request failed" : bridgeError3.message
    }
  };
  if (bridgeError3.details !== void 0 && bridgeError3.status < 500) body.error.details = bridgeError3.details;
  sendJson(response, bridgeError3.status || 500, body);
}
function requireMethod(request, method) {
  if (request.method !== method) {
    throw new BridgeError("METHOD_NOT_ALLOWED", `Expected ${method}`, { status: 405 });
  }
}
async function createBridgeServer({
  allowedProjectRoots,
  allowedOrigins = [],
  shared,
  bodyLimit = DEFAULT_BODY_LIMIT,
  sessionTtlMs = DEFAULT_SESSION_TTL,
  snapshotEvery = 20,
  pollIntervalMs = 250,
  heartbeatMs = 3e3,
  activeMapPollIntervalMs = 250,
  clock = () => /* @__PURE__ */ new Date(),
  faultInjector,
  host = "127.0.0.1",
  listenPort = 0,
  controlToken = null,
  projectRegistry = null,
  sessionStore = null,
  recentProjectsStore = { record: recordRecentProject, list: readRecentProjects },
  recycleBin = null,
  nativeHelper = null,
  editorOpener = null,
  retentionEnabled = true,
  retentionInitialDelayMs = 3e4,
  retentionIntervalMs = 6 * 60 * 60 * 1e3,
  appHtml = null,
  staticAssets = {},
  agentSetup = ensureProjectAgentConfig,
  logger = noopLogger
} = {}) {
  if (!Array.isArray(allowedProjectRoots) || allowedProjectRoots.length === 0) {
    throw new BridgeError("ALLOWLIST_REQUIRED", "At least one project root must be allowlisted");
  }
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    throw new BridgeError("INVALID_LISTEN_PORT", "Bridge listenPort must be an integer between 0 and 65535", { status: 400 });
  }
  const adapter = shared || await loadSharedAdapter();
  const roots = /* @__PURE__ */ new Map();
  for (const root of allowedProjectRoots) roots.set(await canonicalDirectory(root), true);
  const bootstrapTickets = /* @__PURE__ */ new Map();
  function issueBootstrapTicket(projectRoot = null, projectHandle = null) {
    const token = randomToken();
    bootstrapTickets.set(token, { projectRoot, projectHandle, createdAt: clock().getTime() });
    return token;
  }
  const bootstrapToken = issueBootstrapTicket(null);
  let port;
  const sessions = /* @__PURE__ */ new Map();
  const mapManagers = /* @__PURE__ */ new Map();
  const knownActiveMaps = /* @__PURE__ */ new Map();
  const markdownStores = /* @__PURE__ */ new Map();
  const humanMdLogs = /* @__PURE__ */ new Map();
  const editorServices = /* @__PURE__ */ new Map();
  const events = new EventHub(heartbeatMs);
  const configuredOrigins = new Set(allowedOrigins);
  const recycleService = recycleBin ?? (process.platform === "win32" ? new NativeRecycleBin() : null);
  const nativeWindowsHelper = nativeHelper ?? (process.platform === "win32" ? new NativeWindowsHelper() : null);
  let retentionStartTimer = null;
  let retentionTimer = null;
  let activeMapTimer = null;
  function allowedHosts() {
    return /* @__PURE__ */ new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  }
  function validateHost(request) {
    const value = String(request.headers.host || "").toLowerCase();
    if (!allowedHosts().has(value)) {
      throw new BridgeError("INVALID_HOST", "Host header is not an allowed loopback host", { status: 403 });
    }
  }
  function validateOrigin(request, response, { required: required2 = true } = {}) {
    const origin = request.headers.origin;
    if (!origin) {
      if (required2) throw new BridgeError("ORIGIN_REQUIRED", "Origin header is required", { status: 403 });
      return;
    }
    const allowed = /* @__PURE__ */ new Set([
      ...configuredOrigins,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      `http://[::1]:${port}`
    ]);
    if (!allowed.has(origin)) throw new BridgeError("INVALID_ORIGIN", "Origin is not allowed", { status: 403 });
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Vary", "Origin");
  }
  function readSession(request, response = null) {
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (sessionStore) {
      const persisted = sessionId && sessionStore.get(sessionId);
      if (!persisted) throw new BridgeError("UNAUTHENTICATED", "A valid local bridge session is required", { status: 401 });
      const projects = /* @__PURE__ */ new Map();
      for (const handle of persisted.projectHandles) {
        try {
          const registered = projectRegistry?.resolve(handle);
          if (registered) projects.set(handle, { projectRoot: registered.projectRoot });
        } catch {
        }
      }
      if (response) {
        response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1e3)}`);
      }
      return {
        sessionId,
        session: {
          csrfToken: persisted.csrfToken,
          expiresAt: Date.parse(persisted.expiresAt),
          projectRoot: null,
          projects
        }
      };
    }
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= clock().getTime()) {
      if (sessionId) sessions.delete(sessionId);
      throw new BridgeError("UNAUTHENTICATED", "A valid local bridge session is required", { status: 401 });
    }
    return { sessionId, session };
  }
  function authenticate(request, url = null, response = null) {
    const { sessionId, session } = readSession(request, response);
    const projectHandle = String(request.headers["x-livedot-project-handle"] || url?.searchParams?.get("projectHandle") || "");
    if (session.projects?.size) {
      if (!projectHandle) throw new BridgeError("PROJECT_HANDLE_REQUIRED", "A projectHandle is required for this request", { status: 400 });
      const project = session.projects.get(projectHandle);
      if (!project) throw new BridgeError("PROJECT_NOT_AUTHORIZED", "This browser session is not authorized for the requested project", { status: 403 });
      return {
        ...session,
        sessionId,
        projectHandle,
        projectRoot: project.projectRoot,
        activeMapId: String(request.headers["x-livedot-map-key"] || url?.searchParams?.get("mapKey") || "") || null
      };
    }
    session.sessionId = sessionId;
    return session;
  }
  async function authorizeOpenedProject(session, projectRoot) {
    if (!projectRegistry) {
      session.projectRoot = projectRoot;
      return {};
    }
    const registered = await projectRegistry.register(projectRoot);
    session.projects?.set(registered.projectHandle, { projectRoot: registered.projectRoot });
    let reconnectTicket;
    if (sessionStore && session.sessionId) {
      const authorized = sessionStore.authorize(session.sessionId, registered.projectHandle);
      reconnectTicket = authorized?.reconnectTicket;
      await sessionStore.flush();
    }
    return {
      projectHandle: registered.projectHandle,
      ...reconnectTicket ? { reconnectTicket } : {}
    };
  }
  function validateCsrf(request, session) {
    const token = request.headers["x-csrf-token"];
    if (!token || !constantEqual(token, session.csrfToken)) {
      throw new BridgeError("INVALID_CSRF", "CSRF token is missing or invalid", { status: 403 });
    }
  }
  const storeKey = (root, mapId) => `${root}::${mapId}`;
  async function mapManagerFor(root) {
    let manager = mapManagers.get(root);
    if (!manager) {
      manager = await MapManager.open({
        projectRoot: root,
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          storeKey(root, event.mapKey),
          event.type === "external" ? { ...event, type: "revision", source: "external" } : event
        ),
        onActiveMapChanged: (event) => {
          knownActiveMaps.set(root, event.mapKey);
          events.publish(`project::${root}`, event);
        }
      });
      mapManagers.set(root, manager);
      knownActiveMaps.set(root, await resolveActiveMap(root));
    }
    return manager;
  }
  async function openMapStore(root, mapId, { mapName } = {}) {
    return (await (await mapManagerFor(root)).resolve({ mapKey: mapId })).store;
  }
  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
    if (!session.activeMapId) session.activeMapId = await resolveActiveMap(session.projectRoot);
    else {
      if (!isSafeMapId(session.activeMapId)) throw new BridgeError("INVALID_MAP_KEY", "mapKey is invalid", { status: 400 });
      const available = await listMaps(session.projectRoot);
      if (!available.maps.some((map) => map.id === session.activeMapId)) {
        throw new BridgeError("MAP_NOT_FOUND", `Map does not exist: ${session.activeMapId}`, { status: 404 });
      }
    }
    return openMapStore(session.projectRoot, session.activeMapId);
  }
  async function activeBundleStore(session) {
    await activeStore(session);
    return (await (await mapManagerFor(session.projectRoot)).resolve({ mapKey: session.activeMapId })).bundleStore;
  }
  async function editorServiceFor(projectRoot) {
    let service = editorServices.get(projectRoot);
    if (!service) {
      service = await EditorService.open({
        projectRoot,
        nativeHelper: nativeWindowsHelper,
        ...typeof editorOpener === "function" ? { spawn: editorOpener } : {}
      });
      editorServices.set(projectRoot, service);
    }
    return service;
  }
  async function mapMarkdownPath(session, requested) {
    const text = String(requested || "").replace(/\\/g, "/");
    const match = text.match(/^\.live-dot-map\/(nodes|routes)\/(.+)$/);
    if (!match) return requested;
    const active = session.activeMapId ?? await resolveActiveMap(session.projectRoot);
    return `${mapRelativeDirectory(active)}/${match[1]}/${match[2]}`;
  }
  async function openProject(requestedRoot) {
    let root;
    try {
      root = await canonicalDirectory(requestedRoot);
    } catch (error3) {
      if (error3?.code === "ENOENT") throw new BridgeError("PROJECT_NOT_FOUND", `Project directory does not exist: ${requestedRoot}`, { status: 404 });
      throw new BridgeError("PROJECT_NOT_ALLOWED", "Project root is not accessible", { status: 403 });
    }
    if (!roots.has(root)) roots.set(root, true);
    await recentProjectsStore.record(root).catch(() => void 0);
    const { activeMap } = await ensureMapsLayout(root);
    const store = await openMapStore(root, activeMap);
    markdownStoreFor(root);
    logger.info("project.open", { root, map: activeMap });
    return { root, store, mapId: activeMap };
  }
  function markdownStoreFor(root) {
    if (!root) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
    let store = markdownStores.get(root);
    if (!store) {
      store = new MarkdownStore(root);
      markdownStores.set(root, store);
    }
    return store;
  }
  async function humanMdLogFor(session) {
    const mapKey = session.activeMapId ?? await resolveActiveMap(session.projectRoot);
    const key = `${session.projectRoot}/${mapKey}`;
    let log = humanMdLogs.get(key);
    if (!log) {
      log = new HumanMdUpdateLog({ projectRoot: session.projectRoot, mapKey });
      humanMdLogs.set(key, log);
    }
    return log;
  }
  const UPDATE_BASE = (process.env.LIVEDOT_UPDATE_BASE || "https://livedotmap.top/windows-installer").replace(/\/+$/, "");
  async function readLocalPayloadVersion() {
    try {
      const parsed = JSON.parse(await (0, import_promises14.readFile)((0, import_node_path18.join)(process.cwd(), "payload-manifest.json"), "utf8"));
      return typeof parsed.version === "string" ? parsed.version : null;
    } catch {
      return null;
    }
  }
  function compareVersions(a, b) {
    const left = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
    const right = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i += 1) {
      const delta = (left[i] || 0) - (right[i] || 0);
      if (delta !== 0) return delta > 0 ? 1 : -1;
    }
    return 0;
  }
  async function fetchUpdateManifest() {
    const response = await fetch(`${UPDATE_BASE}/update-manifest.json`, { signal: AbortSignal.timeout(8e3) });
    if (!response.ok) throw new BridgeError("UPDATE_MANIFEST_UNAVAILABLE", `Update manifest unavailable (HTTP ${response.status})`, { status: 502 });
    const manifest = await response.json();
    if (!manifest || typeof manifest !== "object" || typeof manifest.version !== "string" || !manifest.files || typeof manifest.files !== "object") {
      throw new BridgeError("UPDATE_MANIFEST_INVALID", "Update manifest is invalid", { status: 502 });
    }
    return manifest;
  }
  async function checkUpdate() {
    const current = await readLocalPayloadVersion();
    try {
      const manifest = await fetchUpdateManifest();
      const latest = manifest.version;
      const available = current !== null && compareVersions(latest, current) > 0;
      return { ok: true, current, latest, available, fileCount: available ? Object.keys(manifest.files).length : 0 };
    } catch (error3) {
      return { ok: false, current, latest: null, available: false, error: error3 instanceof Error ? error3.message : String(error3) };
    }
  }
  async function applyUpdate() {
    const current = await readLocalPayloadVersion();
    const manifest = await fetchUpdateManifest();
    if (current !== null && compareVersions(manifest.version, current) <= 0) {
      throw new BridgeError("ALREADY_UP_TO_DATE", `Current version ${current} is up to date`, { status: 409 });
    }
    const updater = (0, import_node_path18.resolve)((0, import_node_path18.join)(process.cwd(), "..", "LiveDotMapSetup.exe"));
    try {
      await (0, import_promises14.access)(updater);
    } catch {
      throw new BridgeError("UPDATER_UNAVAILABLE", "Installer entry not found; updates are only available in installed mode", { status: 501 });
    }
    const tempRoot = (0, import_node_path18.join)(process.env.TEMP || process.env.TMP || (0, import_node_os5.homedir)(), `livedot-update-${manifest.version}-${(0, import_node_crypto12.randomUUID)()}`);
    const payloadDir = (0, import_node_path18.join)(tempRoot, "payload");
    await (0, import_promises14.mkdir)(payloadDir, { recursive: true });
    try {
      for (const [relative6, meta] of Object.entries(manifest.files)) {
        if (!meta || typeof meta !== "object" || typeof meta.sha256 !== "string" || typeof meta.url !== "string") {
          throw new BridgeError("UPDATE_MANIFEST_INVALID", `Invalid file entry: ${relative6}`, { status: 502 });
        }
        if (relative6.includes("..") || relative6.startsWith("/") || /^[a-zA-Z]:/.test(relative6)) {
          throw new BridgeError("UPDATE_MANIFEST_INVALID", `Unsafe file path: ${relative6}`, { status: 502 });
        }
        const target = (0, import_node_path18.join)(payloadDir, relative6);
        await (0, import_promises14.mkdir)((0, import_node_path18.dirname)(target), { recursive: true });
        const response = await fetch(`${UPDATE_BASE}/${meta.url}`, { signal: AbortSignal.timeout(6e5) });
        if (!response.ok) throw new BridgeError("UPDATE_DOWNLOAD_FAILED", `Download failed for ${relative6} (HTTP ${response.status})`, { status: 502 });
        const buffer = Buffer.from(await response.arrayBuffer());
        const actual = (0, import_node_crypto12.createHash)("sha256").update(buffer).digest("hex");
        if (actual !== meta.sha256.toLowerCase()) throw new BridgeError("UPDATE_CHECKSUM_MISMATCH", `Checksum mismatch for ${relative6}`, { status: 502 });
        await (0, import_promises14.writeFile)(target, buffer);
      }
    } catch (error3) {
      await (0, import_promises14.rm)(tempRoot, { recursive: true, force: true }).catch(() => void 0);
      throw error3;
    }
    const child = (0, import_node_child_process6.spawn)(updater, ["--update", tempRoot], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { ok: true, version: manifest.version, restarting: true };
  }
  function scheduleRestart() {
    setTimeout(() => {
      if (activeMapTimer) clearInterval(activeMapTimer);
      if (retentionStartTimer) clearTimeout(retentionStartTimer);
      if (retentionTimer) clearInterval(retentionTimer);
      events.close();
      Promise.all([...mapManagers.values()].map((manager) => manager.close())).catch(() => void 0).finally(() => {
        Promise.resolve(sessionStore?.flush()).catch(() => void 0).finally(() => {
          if (!sessionStore) sessions.clear();
          server.close(() => process.exit(0));
          server.closeAllConnections?.();
          setTimeout(() => process.exit(0), 1500).unref?.();
        });
      });
    }, 500);
  }
  const clientLog = logger.as("client");
  const server = (0, import_node_http.createServer)(async (request, response) => {
    setSecurityHeaders(response);
    const httpStart = Date.now();
    let httpLogged = false;
    response.once("finish", () => {
      if (httpLogged) return;
      httpLogged = true;
      const status = response.statusCode;
      const fields = { method: request.method, path: String(request.url || "").split("?")[0], status, ms: Date.now() - httpStart };
      if (status >= 500) logger.error("http", fields);
      else if (status >= 400) logger.warn("http", fields);
      else logger.info("http", fields);
    });
    try {
      validateHost(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const aliases = /* @__PURE__ */ new Map([
        ["/api/v1/health", "/health"],
        ["/api/v1/session", "/session"],
        ["/api/v1/session/reconnect", "/session/reconnect"],
        ["/api/v1/projects/open", "/open"],
        ["/api/v1/projects/pick", "/projects/pick"],
        ["/api/v1/projects/recent", "/projects/recent"],
        ["/api/v1/maps", "/maps"],
        ["/api/v1/maps/create", "/maps/create"],
        ["/api/v1/maps/switch", "/maps/switch"],
        ["/api/v1/maps/rename", "/maps/rename"],
        ["/api/v1/snapshot", "/snapshot"],
        ["/api/v1/commands", "/commands"],
        ["/api/v1/events", "/events"],
        ["/api/v1/recover", "/recover"],
        ["/api/v1/agents", "/agents"],
        ["/api/v1/markdown", "/markdown"],
        ["/api/v1/markdown/reveal", "/markdown/reveal"],
        ["/api/v1/bundles", "/bundles"],
        ["/api/v1/bundles/markdown/read", "/bundles/markdown/read"],
        ["/api/v1/bundles/markdown/create", "/bundles/markdown/create"],
        ["/api/v1/bundles/markdown/replace", "/bundles/markdown/replace"],
        ["/api/v1/bundles/markdown/append", "/bundles/markdown/append"],
        ["/api/v1/bundles/rename", "/bundles/rename"],
        ["/api/v1/bundles/archive", "/bundles/archive"],
        ["/api/v1/bundles/restore", "/bundles/restore"],
        ["/api/v1/archive", "/archive"],
        ["/api/v1/archive/restore", "/archive/restore"],
        ["/api/v1/archive/purge", "/archive/purge"],
        ["/api/v1/editors", "/editors"],
        ["/api/v1/editors/open", "/editors/open"],
        ["/api/v1/editors/preferred", "/editors/preferred"],
        ["/api/v1/editors/pick", "/editors/pick"],
        ["/api/v1/editors/save-as", "/editors/save-as"],
        ["/api/v1/assets/import", "/assets/import"],
        ["/api/v1/assets/read", "/assets/read"],
        ["/api/v1/update/check", "/update/check"],
        ["/api/v1/update/apply", "/update/apply"],
        ["/api/v1/logs/client", "/logs/client"],
        ["/api/v1/control/status", "/control/status"],
        ["/api/v1/control/open-project", "/control/open-project"]
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;
      if (pathname === "/control/status" || pathname === "/control/open-project") {
        if (!controlToken || !constantEqual(request.headers["x-livedot-control"], controlToken)) {
          throw new BridgeError("INVALID_CONTROL_TOKEN", "Bridge control authentication failed", { status: 401 });
        }
        if (pathname === "/control/status") {
          requireMethod(request, "GET");
          sendJson(response, 200, { ok: true, service: "live-dot-map-bridge", pid: process.pid, port });
          return;
        }
        requireMethod(request, "POST");
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== "string" || !body.projectRoot.trim()) {
          throw new BridgeError("PROJECT_ROOT_REQUIRED", "projectRoot is required", { status: 400 });
        }
        let projectHandle = typeof body.projectHandle === "string" ? body.projectHandle : null;
        if (projectRegistry) {
          if (projectHandle) await projectRegistry.refresh?.();
          const registered = projectHandle ? projectRegistry.resolve(projectHandle) : await projectRegistry.register(body.projectRoot);
          const canonical = await canonicalDirectory(body.projectRoot);
          if (registered.projectRoot !== canonical) {
            throw new BridgeError("PROJECT_HANDLE_MISMATCH", "Project handle does not match the requested project", { status: 403 });
          }
          projectHandle = registered.projectHandle;
        }
        const opened = await openProject(body.projectRoot);
        const ticket = issueBootstrapTicket(opened.root, projectHandle);
        sendJson(response, 201, {
          ok: true,
          bootstrapToken: ticket,
          ...projectHandle ? { projectHandle } : {}
        });
        return;
      }
      if (request.method === "OPTIONS") {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-LiveDot-Project-Handle, X-LiveDot-Map-Key, Authorization");
        response.setHeader("Access-Control-Max-Age", "600");
        response.end();
        return;
      }
      if (pathname === "/health") {
        requireMethod(request, "GET");
        validateOrigin(request, response, { required: false });
        sendJson(response, 200, { ok: true, service: "live-dot-map-bridge", version: 2 });
        return;
      }
      if ((pathname === "/" || pathname === "/app.html") && appHtml) {
        requireMethod(request, "GET");
        const data = Buffer.from(appHtml);
        response.statusCode = 200;
        response.removeHeader("Content-Security-Policy");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Content-Length", data.length);
        response.end(data);
        return;
      }
      if (Object.hasOwn(staticAssets, pathname)) {
        requireMethod(request, "GET");
        const asset = staticAssets[pathname];
        const data = Buffer.isBuffer(asset.body) ? asset.body : Buffer.from(asset.body);
        response.statusCode = 200;
        response.removeHeader("Content-Security-Policy");
        response.setHeader("Content-Type", asset.type);
        response.setHeader("Content-Length", data.length);
        response.end(data);
        return;
      }
      validateOrigin(request, response, { required: request.method !== "GET" && request.method !== "HEAD" });
      if (pathname === "/update/check") {
        requireMethod(request, "GET");
        validateOrigin(request, response, { required: false });
        sendJson(response, 200, await checkUpdate());
        return;
      }
      if (pathname === "/session") {
        if (request.method === "GET") {
          validateOrigin(request, response, { required: false });
          const { session: current } = readSession(request, response);
          sendJson(response, 200, {
            csrfToken: current.csrfToken,
            expiresAt: new Date(current.expiresAt).toISOString(),
            projects: current.projects ? [...current.projects.keys()] : [],
            projectRoot: current.projectRoot,
            resumed: true
          });
          return;
        }
        requireMethod(request, "POST");
        const authorization = request.headers.authorization || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        const ticket = [...bootstrapTickets.entries()].find(([candidate]) => constantEqual(token, candidate));
        if (!ticket) throw new BridgeError("INVALID_BOOTSTRAP_TOKEN", "Bootstrap token is invalid or has already been consumed", { status: 401 });
        bootstrapTickets.delete(ticket[0]);
        const existingId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
        if (sessionStore && existingId && ticket[1].projectHandle && ticket[1].projectRoot) {
          const authorized = sessionStore.authorize(existingId, ticket[1].projectHandle);
          if (authorized) {
            await sessionStore.persistIfDue();
            response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${existingId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1e3)}`);
            sendJson(response, 200, {
              csrfToken: authorized.csrfToken,
              expiresAt: authorized.expiresAt,
              projectHandle: ticket[1].projectHandle,
              reconnectTicket: authorized.reconnectTicket,
              resumed: true
            });
            return;
          }
        }
        const existing = existingId && sessions.get(existingId);
        if (existing && existing.expiresAt > clock().getTime() && ticket[1].projectHandle && ticket[1].projectRoot) {
          existing.projects ??= /* @__PURE__ */ new Map();
          existing.projects.set(ticket[1].projectHandle, { projectRoot: ticket[1].projectRoot });
          response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${existingId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1e3)}`);
          sendJson(response, 200, {
            csrfToken: existing.csrfToken,
            expiresAt: new Date(existing.expiresAt).toISOString(),
            projectHandle: ticket[1].projectHandle,
            resumed: true
          });
          return;
        }
        const createdSession = sessionStore ? sessionStore.create({ projectHandle: ticket[1].projectHandle }) : null;
        const sessionId = createdSession?.sessionId || randomToken();
        const csrfToken = createdSession?.record.csrfToken || randomToken();
        const expiresAt = createdSession ? Date.parse(createdSession.record.expiresAt) : clock().getTime() + sessionTtlMs;
        const projects = /* @__PURE__ */ new Map();
        if (ticket[1].projectHandle && ticket[1].projectRoot) projects.set(ticket[1].projectHandle, { projectRoot: ticket[1].projectRoot });
        if (!sessionStore) sessions.set(sessionId, { csrfToken, expiresAt, projectRoot: ticket[1].projectHandle ? null : ticket[1].projectRoot, projects });
        else await sessionStore.flush();
        const cookieTtl = sessionStore?.ttlMs || sessionTtlMs;
        response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(cookieTtl / 1e3)}`);
        sendJson(response, 201, {
          csrfToken,
          expiresAt: new Date(expiresAt).toISOString(),
          projectRoot: ticket[1].projectHandle ? void 0 : ticket[1].projectRoot,
          projectHandle: ticket[1].projectHandle,
          reconnectTicket: createdSession?.reconnectTicket,
          resumed: false
        });
        return;
      }
      if (pathname === "/session/reconnect") {
        requireMethod(request, "POST");
        if (!sessionStore || !projectRegistry) throw new BridgeError("RECONNECT_UNAVAILABLE", "Persistent reconnect is not configured", { status: 503 });
        const peer = String(request.socket.remoteAddress || "");
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) {
          throw new BridgeError("LOOPBACK_REQUIRED", "Reconnect is only available from loopback", { status: 403 });
        }
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectHandle !== "string" || typeof body.reconnectTicket !== "string") {
          throw new BridgeError("RECONNECT_CREDENTIALS_REQUIRED", "projectHandle and reconnectTicket are required", { status: 400 });
        }
        projectRegistry.resolve(body.projectHandle);
        const reconnected = sessionStore.reconnect({ reconnectTicket: body.reconnectTicket, projectHandle: body.projectHandle, peer });
        await sessionStore.flush();
        response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${reconnected.sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionStore.ttlMs / 1e3)}`);
        sendJson(response, 201, {
          csrfToken: reconnected.record.csrfToken,
          expiresAt: reconnected.record.expiresAt,
          projectHandle: body.projectHandle,
          reconnectTicket: reconnected.reconnectTicket
        });
        return;
      }
      const session = authenticate(request, url, response);
      if (pathname === "/update/apply") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const applied = await applyUpdate();
        sendJson(response, 200, applied);
        scheduleRestart();
        return;
      }
      if (pathname === "/projects/pick") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const picked = await pickProjectFolder({ logger });
        if (picked.cancelled) {
          sendJson(response, 200, { cancelled: true, projectRoot: session.projectRoot });
          return;
        }
        const { root, store, mapId } = await openProject(picked.path);
        const binding = await authorizeOpenedProject(session, root);
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === "function" ? await agentSetup(root).catch((error3) => ({ ok: false, status: "error", changed: false, code: error3?.code || "AGENT_SETUP_FAILED", message: String(error3?.message || error3).slice(0, 400) })) : { ok: true, status: "none", changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { cancelled: false, projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...binding, ...snapshot });
        return;
      }
      if (pathname === "/projects/recent") {
        requireMethod(request, "GET");
        sendJson(response, 200, { projectRoot: session.projectRoot, recent: await recentProjectsStore.list() });
        return;
      }
      if (pathname === "/maps") {
        requireMethod(request, "GET");
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const { activeMap, maps } = await (await mapManagerFor(session.projectRoot)).list();
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap, maps });
        return;
      }
      if (pathname === "/maps/create") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const created = await (await mapManagerFor(session.projectRoot)).create(typeof body.name === "string" ? body.name : "");
        logger.info("map.create", { root: session.projectRoot, map: created.createdMap });
        sendJson(response, 200, {
          projectRoot: session.projectRoot,
          ...created,
          projectId: created.documentId
        });
        return;
      }
      if (pathname === "/maps/switch") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const switched = await (await mapManagerFor(session.projectRoot)).switch(String(body.mapId || ""));
        session.activeMapId = body.mapId;
        logger.info("map.switch", { root: session.projectRoot, map: body.mapId });
        sendJson(response, 200, { projectRoot: session.projectRoot, ...switched, projectId: switched.documentId });
        return;
      }
      if (pathname === "/maps/rename") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const executed = await (await mapManagerFor(session.projectRoot)).rename(String(body.mapId || ""), name, "human");
        logger.info("map.rename", { root: session.projectRoot, map: body.mapId, revision: executed.revision });
        sendJson(response, 200, { ok: true, mapId: body.mapId, name: name.slice(0, 80), revision: executed.revision });
        return;
      }
      if (pathname === "/open") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== "string") throw new BridgeError("PROJECT_ROOT_REQUIRED", "projectRoot is required", { status: 400 });
        const { root, store, mapId } = await openProject(body.projectRoot);
        const binding = await authorizeOpenedProject(session, root);
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === "function" ? await agentSetup(root).catch((error3) => ({ ok: false, status: "error", changed: false, code: error3?.code || "AGENT_SETUP_FAILED", message: String(error3?.message || error3).slice(0, 400) })) : { ok: true, status: "none", changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...binding, ...snapshot });
        return;
      }
      if (pathname === "/logs/client") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, 256 * 1024);
        const entries = Array.isArray(body.entries) ? body.entries.slice(0, 50) : [];
        const levels = /* @__PURE__ */ new Set(["info", "warn", "error"]);
        let accepted = 0;
        for (const item of entries) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const { level, event, at, ...fields } = item;
          if (typeof event !== "string" || !event) continue;
          const write = levels.has(level) ? level : "info";
          await clientLog[write](String(event), { ...typeof at === "string" ? { clientAt: at } : {}, ...fields });
          accepted += 1;
        }
        sendJson(response, 200, { ok: true, accepted });
        return;
      }
      if (pathname === "/agents") {
        requireMethod(request, "GET");
        const root = session.projectRoot;
        if (!root) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const detected = await detectInstalledAdapters({ projectRoot: root });
        let config = {};
        try {
          const parsed = JSON.parse(await (0, import_promises14.readFile)((0, import_node_path18.join)(root, ".live-dot-map", "agent-kit.json"), "utf8"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
        } catch {
        }
        const trust = config.trust && typeof config.trust === "object" ? config.trust : {};
        const healthRecords = await readAgentHealth(root);
        const agents = Object.values(detected).filter((item) => item.id !== "codebuddy" || item.discovered).map((item) => {
          const id = String(item.id);
          const health = healthRecords[id] || healthRecords[id.replace(/-code$/, "")] || (id === "claude-code" ? healthRecords.claude : id === "kimi-code" ? healthRecords.kimi : null);
          let state = "not_installed";
          if (item.configured && !item.executable) state = "error";
          else if (item.configured && item.executable) state = trust[id]?.acknowledged === true ? "connected" : "awaiting_trust";
          else if (item.executable) state = "discovered";
          if (health?.status === "error") state = "error";
          return { ...item, state, trustAcknowledged: trust[id]?.acknowledged === true, health: health || null };
        });
        sendJson(response, 200, { projectRoot: root, agents, states: {
          not_installed: "\u672A\u5B89\u88C5",
          discovered: "\u5DF2\u53D1\u73B0",
          awaiting_trust: "\u5F85\u4FE1\u4EFB",
          connected: "\u5DF2\u8FDE\u63A5",
          error: "\u5F02\u5E38"
        } });
        return;
      }
      if (pathname === "/snapshot") {
        const store = await activeStore(session);
        const activeMap = session.activeMapId || await resolveActiveMap(session.projectRoot);
        if (request.method === "GET") {
          sendJson(response, 200, { activeMap, ...await store.snapshot() });
          return;
        }
        requireMethod(request, "POST");
        validateCsrf(request, session);
        sendJson(response, 201, { activeMap, ...await store.createSnapshot() });
        return;
      }
      if (pathname === "/archive") {
        requireMethod(request, "GET");
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        const lifecycle = new ArchiveLifecycle({ store, projectRoot: session.projectRoot, shared: adapter, clock, recycleBin: recycleService });
        const collections = ["routes", "nodes", "edges", "anns"];
        const archived = collections.flatMap((collection) => (Array.isArray(snapshot.document[collection]) ? snapshot.document[collection] : []).filter((item) => item?.archived === true).map((item) => ({
          collection,
          id: String(item.id),
          name: String(item.name || item.text || item.id),
          archivedAt: typeof item.archivedAt === "string" ? item.archivedAt : null,
          archivedBy: typeof item.archivedBy === "string" ? item.archivedBy : null,
          archiveReason: typeof item.archiveReason === "string" ? item.archiveReason : null,
          purgeEligible: lifecycle.eligible(item, { now: clock() })
        })));
        sendJson(response, 200, { mapKey: session.activeMapId, documentId: snapshot.document.mapId, revision: snapshot.revision, archived });
        return;
      }
      if (pathname === "/archive/restore") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        const collection = String(body.collection || "");
        const id = String(body.id || "");
        const result2 = await store.execute({
          projectId: String(snapshot.document.mapId),
          baseRevision: snapshot.revision,
          commandId: `human-restore-${(0, import_node_crypto12.randomUUID)()}`,
          actor: "human",
          sessionId: "browser-archive-settings",
          commands: [{ op: "restore", collection, id }]
        });
        sendJson(response, 200, result2);
        return;
      }
      if (pathname === "/archive/purge") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const id = String(body.id || "");
        if (body.confirmed !== true || String(body.confirmation || "") !== id) {
          throw new BridgeError("PURGE_HUMAN_CONFIRMATION_REQUIRED", "\u6C38\u4E45\u6E05\u9664\u9700\u8981\u518D\u6B21\u8F93\u5165\u5BF9\u8C61 ID \u786E\u8BA4", { status: 403 });
        }
        const store = await activeStore(session);
        const lifecycle = new ArchiveLifecycle({ store, projectRoot: session.projectRoot, shared: adapter, clock, recycleBin: recycleService });
        const result2 = await lifecycle.purge({
          collection: String(body.collection || ""),
          id,
          actor: "human",
          confirmed: true,
          commandId: `human-purge-${(0, import_node_crypto12.randomUUID)()}`
        });
        sendJson(response, 200, result2);
        return;
      }
      if (pathname === "/editors") {
        requireMethod(request, "GET");
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).list());
        return;
      }
      if (pathname === "/editors/open") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).open({
          editorId: String(body.editorId || ""),
          relativePath: String(body.relativePath || ""),
          targetKind: body.targetKind === "directory" ? "directory" : "file"
        }));
        return;
      }
      if (pathname === "/editors/preferred") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).setPreferredEditor(String(body.editorId || "")));
        return;
      }
      if (pathname === "/editors/pick") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).pickManualEditor());
        return;
      }
      if (pathname === "/editors/save-as") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await (await editorServiceFor(session.projectRoot)).saveAs({ relativePath: String(body.relativePath || "") }));
        return;
      }
      if (pathname === "/markdown") {
        const markdown = markdownStoreFor(session.projectRoot);
        if (request.method === "GET") {
          const requestedPath = url.searchParams.get("path");
          if (!requestedPath) throw new BridgeError("MARKDOWN_PATH_REQUIRED", "path is required", { status: 400 });
          const created = url.searchParams.get("create") === "1" || url.searchParams.get("create") === "true";
          const title = url.searchParams.get("title") || "";
          sendJson(response, 200, await markdown.read(await mapMarkdownPath(session, requestedPath), { create: created, title }));
          return;
        }
        if (request.method === "PUT" || request.method === "POST") {
          requireMethod(request, request.method);
          validateCsrf(request, session);
          const body = await readJsonBody(request, bodyLimit);
          if (typeof body.path !== "string") throw new BridgeError("MARKDOWN_PATH_REQUIRED", "path is required", { status: 400 });
          const saved = await markdown.write(await mapMarkdownPath(session, body.path), body.content, { baseEtag: body.baseEtag ?? body.etag });
          try {
            await (await humanMdLogFor(session)).record({
              path: saved.path,
              etag: saved.etag,
              mtime: saved.updatedAt,
              snippet: String(saved.content ?? "")
            });
          } catch (error3) {
            logger.warn("human-md-updates.record", { path: saved.path, error: error3?.message });
          }
          sendJson(response, 200, saved);
          return;
        }
        throw new BridgeError("METHOD_NOT_ALLOWED", "Expected GET, PUT or POST", { status: 405 });
      }
      if (pathname === "/markdown/reveal") {
        const markdown = markdownStoreFor(session.projectRoot);
        if (request.method === "GET") {
          const requestedPath = url.searchParams.get("path");
          if (!requestedPath) throw new BridgeError("MARKDOWN_PATH_REQUIRED", "path is required", { status: 400 });
          sendJson(response, 200, await markdown.reveal(await mapMarkdownPath(session, requestedPath)));
          return;
        }
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.path !== "string") throw new BridgeError("MARKDOWN_PATH_REQUIRED", "path is required", { status: 400 });
        const path = await mapMarkdownPath(session, body.path);
        const metadata = await markdown.reveal(path);
        const opened = await (await editorServiceFor(session.projectRoot)).open({ editorId: "folder", relativePath: path });
        sendJson(response, 200, { ...metadata, opened: opened.launched === true });
        return;
      }
      if (pathname === "/bundles") {
        requireMethod(request, "GET");
        const ownerKind = url.searchParams.get("ownerKind");
        const ownerId = url.searchParams.get("ownerId");
        if (!ownerKind || !ownerId) throw new BridgeError("BUNDLE_OWNER_REQUIRED", "ownerKind and ownerId are required", { status: 400 });
        const bundle = await activeBundleStore(session);
        sendJson(response, 200, {
          files: await bundle.list({ ownerKind, ownerId, includeArchived: url.searchParams.get("includeArchived") === "true" })
        });
        return;
      }
      if (pathname === "/bundles/markdown/read") {
        requireMethod(request, "GET");
        const ownerKind = url.searchParams.get("ownerKind");
        const ownerId = url.searchParams.get("ownerId");
        const fileName = url.searchParams.get("fileName") || "index.md";
        if (!ownerKind || !ownerId) throw new BridgeError("BUNDLE_OWNER_REQUIRED", "ownerKind and ownerId are required", { status: 400 });
        const bundle = await activeBundleStore(session);
        const { buffer: _buffer, ...markdown } = await bundle.readMarkdown({
          ownerKind,
          ownerId,
          fileName,
          archived: url.searchParams.get("archived") === "true"
        });
        sendJson(response, 200, markdown);
        return;
      }
      if (pathname === "/bundles/markdown/create" || pathname === "/bundles/markdown/replace" || pathname === "/bundles/markdown/append" || pathname === "/bundles/rename" || pathname === "/bundles/archive" || pathname === "/bundles/restore") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        const bundle = await activeBundleStore(session);
        let result2;
        if (pathname === "/bundles/markdown/create") result2 = await bundle.createMarkdown(body);
        else if (pathname === "/bundles/markdown/replace") result2 = await bundle.replaceMarkdown(body);
        else if (pathname === "/bundles/markdown/append") result2 = await bundle.appendMarkdown(body);
        else if (pathname === "/bundles/rename") result2 = await bundle.rename(body);
        else if (pathname === "/bundles/archive") result2 = await bundle.archive(body);
        else result2 = await bundle.restore(body);
        sendJson(response, 200, result2);
        return;
      }
      if (pathname === "/assets/import") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const ownerKind = url.searchParams.get("ownerKind");
        const ownerId = url.searchParams.get("ownerId");
        const fileName = url.searchParams.get("fileName");
        if (!ownerKind || !ownerId || !fileName) throw new BridgeError("ASSET_FIELDS_REQUIRED", "ownerKind, ownerId and fileName are required", { status: 400 });
        const bundle = await activeBundleStore(session);
        const result2 = await bundle.importAsset({
          ownerKind,
          ownerId,
          fileName,
          stream: request,
          mimeType: String(request.headers["content-type"] || "")
        });
        sendJson(response, 201, result2);
        return;
      }
      if (pathname === "/assets/read") {
        requireMethod(request, "GET");
        const ownerKind = url.searchParams.get("ownerKind");
        const ownerId = url.searchParams.get("ownerId");
        const fileName = url.searchParams.get("fileName");
        if (!ownerKind || !ownerId || !fileName) throw new BridgeError("ASSET_FIELDS_REQUIRED", "ownerKind, ownerId and fileName are required", { status: 400 });
        const bundle = await activeBundleStore(session);
        const asset = await bundle.readAsset({ ownerKind, ownerId, fileName, archived: url.searchParams.get("archived") === "true" });
        response.statusCode = 200;
        response.setHeader("Content-Type", asset.mimeType);
        response.setHeader("Content-Length", asset.buffer.length);
        response.setHeader("Content-Disposition", `${asset.disposition}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`);
        response.end(asset.buffer);
        return;
      }
      if (pathname === "/commands") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        const current = await store.snapshot();
        const claimedDocumentId = body.documentId ?? body.projectId;
        if (claimedDocumentId !== void 0 && String(claimedDocumentId) !== String(current.document.mapId)) {
          throw new BridgeError("DOCUMENT_ID_MISMATCH", "documentId does not match the routed map", { status: 409 });
        }
        const executed = await store.execute({ ...body, actor: "human" });
        logger.info("commands", { count: Array.isArray(body.commands) ? body.commands.length : 0, revision: executed?.revision, actor: "human" });
        if (Array.isArray(body.commands)) {
          try {
            const bundle = await activeBundleStore(session);
            for (const command2 of body.commands) {
              if (command2?.op === "create" && command2?.collection === "nodes" && typeof command2?.value?.id === "string") {
                await bundle.ensureIndex({ ownerKind: "node", ownerId: command2.value.id, title: String(command2.value.name || "") }).catch((error3) => {
                  logger.warn("bundle.ensureIndex", { ownerId: command2.value.id, error: error3?.message });
                });
              }
            }
          } catch (error3) {
            logger.warn("bundle.ensureIndex.failed", { error: error3?.message });
          }
        }
        sendJson(response, 200, executed);
        return;
      }
      if (pathname === "/events") {
        requireMethod(request, "GET");
        const store = await activeStore(session);
        const snapshot = await store.snapshot();
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();
        response.write(`event: ready
data: ${JSON.stringify({ projectHandle: session.projectHandle, mapKey: session.activeMapId, revision: snapshot.revision, checksum: snapshot.checksum })}

`);
        events.subscribe(storeKey(session.projectRoot, session.activeMapId), response);
        events.subscribe(`project::${session.projectRoot}`, response);
        return;
      }
      if (pathname === "/recover") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await store.recover(body));
        return;
      }
      if (pathname === "/api/v1/mcp") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        try {
          const tool = String(body.tool || body.name || "");
          const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
          const manager = await mapManagerFor(session.projectRoot);
          const service = new ToolService({
            mapManager: manager,
            shared: adapter,
            actor: "agent:bridge",
            projectHandle: session.projectHandle || "browser"
          });
          const result2 = await service.dispatch(tool, {
            ...args,
            mapKey: typeof args.mapKey === "string" && args.mapKey ? args.mapKey : session.activeMapId
          });
          if (tool === "map_switch" && result2?.activeMap) session.activeMapId = result2.activeMap;
          await recordAgentHealth(session.projectRoot, "agent:bridge", `mcp:${tool}`, "ok");
          logger.info("mcp", { tool, ok: true });
          sendJson(response, 200, { tool, result: result2 });
          return;
        } catch (error3) {
          await recordAgentHealth(session.projectRoot, "agent:bridge", `mcp:${String(body.tool || body.name || "unknown")}`, "error", error3);
          logger.error("mcp", { tool: String(body.tool || body.name || "unknown"), error: error3 });
          throw error3;
        }
      }
      throw new BridgeError("NOT_FOUND", "Endpoint not found", { status: 404 });
    } catch (error3) {
      if ((asBridgeError(error3).status || 500) >= 500) {
        logger.error("request.error", { method: request.method, path: String(request.url || "").split("?")[0], error: error3 });
      }
      if (!response.headersSent) sendError(response, error3);
      else response.end();
    }
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 1e4;
  server.requestTimeout = 15e3;
  server.keepAliveTimeout = 5e3;
  await new Promise((resolve16, reject) => {
    server.once("error", reject);
    server.listen(listenPort, host, resolve16);
  });
  port = server.address().port;
  async function pollActiveMaps() {
    for (const [root, manager] of mapManagers) {
      try {
        const mapKey = await resolveActiveMap(root);
        const previous = knownActiveMaps.get(root);
        if (!previous) {
          knownActiveMaps.set(root, mapKey);
          continue;
        }
        if (previous === mapKey) continue;
        const context = await manager.resolve({ mapKey });
        knownActiveMaps.set(root, mapKey);
        events.publish(`project::${root}`, {
          type: "active-map-changed",
          mapKey,
          documentId: context.documentId,
          source: "external"
        });
      } catch (error3) {
        logger.warn("map.pointer.watch", { root, error: error3 });
      }
    }
  }
  if (Number(activeMapPollIntervalMs) > 0) {
    activeMapTimer = setInterval(
      () => pollActiveMaps().catch((error3) => logger.warn("map.pointer.watch", { error: error3 })),
      Math.max(50, Number(activeMapPollIntervalMs))
    );
    activeMapTimer.unref?.();
  }
  async function runRetentionSweep() {
    if (!recycleService) return;
    for (const projectRoot of roots.keys()) {
      try {
        const manager = await mapManagerFor(projectRoot);
        const listed = await manager.list();
        for (const map of listed.maps) {
          const context = await manager.resolve({ mapKey: map.id });
          const lifecycle = new ArchiveLifecycle({ store: context.store, projectRoot, shared: adapter, clock, recycleBin: recycleService });
          for (const item of await lifecycle.listEligible({ now: clock() })) {
            await lifecycle.purge({ ...item, actor: "system:retention", now: clock(), commandId: `retention-purge-${(0, import_node_crypto12.randomUUID)()}` });
          }
        }
      } catch (error3) {
        logger.warn("archive.retention", { root: projectRoot, error: error3 });
      }
    }
  }
  if (retentionEnabled && Number(retentionIntervalMs) > 0) {
    retentionStartTimer = setTimeout(() => {
      runRetentionSweep().catch((error3) => logger.warn("archive.retention", { error: error3 }));
      retentionTimer = setInterval(() => runRetentionSweep().catch((error3) => logger.warn("archive.retention", { error: error3 })), Number(retentionIntervalMs));
      retentionTimer.unref?.();
    }, Math.max(0, Number(retentionInitialDelayMs) || 0));
    retentionStartTimer.unref?.();
  }
  return {
    host,
    port,
    origin: `http://${host}:${port}`,
    bootstrapToken,
    issueBootstrapTicket,
    close: async () => {
      if (activeMapTimer) clearInterval(activeMapTimer);
      if (retentionStartTimer) clearTimeout(retentionStartTimer);
      if (retentionTimer) clearInterval(retentionTimer);
      events.close();
      await Promise.all([...mapManagers.values()].map((manager) => manager.close()));
      if (sessionStore) await sessionStore.flush();
      else sessions.clear();
      await new Promise((resolve16, reject) => {
        server.close((error3) => error3 ? reject(error3) : resolve16());
        server.closeAllConnections?.();
      });
    }
  };
}

// src/bridge/project-registry.mjs
var import_node_crypto14 = require("node:crypto");
var import_promises16 = require("node:fs/promises");
var import_node_path20 = require("node:path");

// src/bridge/runtime-state.mjs
var import_node_crypto13 = require("node:crypto");
var import_node_child_process7 = require("node:child_process");
var import_promises15 = require("node:fs/promises");
var import_node_path19 = require("node:path");
var import_node_os6 = require("node:os");
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process7.execFile);
var SCHEMA_VERSION = 1;
function defaultRuntimeStateDir() {
  if (process.env.LIVEDOT_RUNTIME_STATE_DIR) return (0, import_node_path19.resolve)(process.env.LIVEDOT_RUNTIME_STATE_DIR);
  const localAppData = process.env.LOCALAPPDATA || (0, import_node_path19.join)((0, import_node_os6.homedir)(), "AppData", "Local");
  return (0, import_node_path19.join)(localAppData, "live-dot-map", "run");
}
async function privateDirectory(path) {
  await (0, import_promises15.mkdir)(path, { recursive: true, mode: 448 });
  await (0, import_promises15.chmod)(path, 448).catch(() => void 0);
}
async function atomicPrivateWrite(path, value) {
  await privateDirectory((0, import_node_path19.dirname)(path));
  const temporary = `${path}.${process.pid}.${(0, import_node_crypto13.randomUUID)()}.tmp`;
  await (0, import_promises15.writeFile)(temporary, value, { encoding: "utf8", mode: 384, flag: "wx" });
  await (0, import_promises15.chmod)(temporary, 384).catch(() => void 0);
  await (0, import_promises15.rename)(temporary, path);
  await (0, import_promises15.chmod)(path, 384).catch(() => void 0);
}
function runtimePaths(runtimeStateDir = defaultRuntimeStateDir()) {
  const root = (0, import_node_path19.resolve)(runtimeStateDir);
  return {
    root,
    bridge: (0, import_node_path19.join)(root, "bridge.json"),
    controlToken: (0, import_node_path19.join)(root, "control.token"),
    lock: (0, import_node_path19.join)(root, "singleton.lock"),
    sessions: (0, import_node_path19.join)(root, "sessions.json"),
    projects: (0, import_node_path19.join)(root, "projects.json")
  };
}
async function readBridgeState(runtimeStateDir) {
  const paths = runtimePaths(runtimeStateDir);
  let parsed;
  try {
    parsed = JSON.parse(await (0, import_promises15.readFile)(paths.bridge, "utf8"));
  } catch (error3) {
    if (error3?.code === "ENOENT") return null;
    throw new BridgeError("BRIDGE_STATE_CORRUPT", "Bridge runtime state is unreadable", { cause: error3 });
  }
  if (parsed?.schemaVersion !== SCHEMA_VERSION || !Number.isInteger(parsed.pid) || parsed.pid <= 0 || !Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535 || typeof parsed.startedAt !== "string") {
    throw new BridgeError("BRIDGE_STATE_CORRUPT", "Bridge runtime state has an invalid shape");
  }
  return parsed;
}
async function writeBridgeState(runtimeStateDir, { pid, port, startedAt = (/* @__PURE__ */ new Date()).toISOString() }) {
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BridgeError("INVALID_BRIDGE_STATE", "Bridge pid and port must be valid positive integers");
  }
  const state = { schemaVersion: SCHEMA_VERSION, pid, port, startedAt };
  await atomicPrivateWrite(runtimePaths(runtimeStateDir).bridge, `${JSON.stringify(state, null, 2)}
`);
  return state;
}
async function readOrCreateControlToken(runtimeStateDir) {
  const path = runtimePaths(runtimeStateDir).controlToken;
  try {
    const value = (await (0, import_promises15.readFile)(path, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{43,}$/.test(value)) throw new Error("invalid token");
    return value;
  } catch (error3) {
    if (error3?.code !== "ENOENT") {
      throw new BridgeError("CONTROL_TOKEN_CORRUPT", "Bridge control token is unreadable or invalid", { cause: error3 });
    }
  }
  const token = (0, import_node_crypto13.randomBytes)(32).toString("base64url");
  try {
    await privateDirectory((0, import_node_path19.dirname)(path));
    await (0, import_promises15.writeFile)(path, `${token}
`, { encoding: "utf8", mode: 384, flag: "wx" });
    await (0, import_promises15.chmod)(path, 384).catch(() => void 0);
    return token;
  } catch (error3) {
    if (error3?.code !== "EEXIST") throw error3;
    const existing = (await (0, import_promises15.readFile)(path, "utf8")).trim();
    if (!/^[A-Za-z0-9_-]{43,}$/.test(existing)) throw new BridgeError("CONTROL_TOKEN_CORRUPT", "Bridge control token is invalid");
    return existing;
  }
}
async function acquireSingletonLock(runtimeStateDir) {
  const path = runtimePaths(runtimeStateDir).lock;
  await privateDirectory((0, import_node_path19.dirname)(path));
  let handle;
  try {
    handle = await (0, import_promises15.open)(path, "wx", 384);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, acquiredAt: (/* @__PURE__ */ new Date()).toISOString() })}
`, "utf8");
  } catch (error3) {
    await handle?.close().catch(() => void 0);
    if (error3?.code === "EEXIST") throw new BridgeError("BRIDGE_START_IN_PROGRESS", "Another Bridge process is starting", { status: 409 });
    throw error3;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => void 0);
    await (0, import_promises15.rm)(path, { force: true }).catch(() => void 0);
  };
}
function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error3) {
    return error3?.code === "EPERM";
  }
}
async function checkBridgeProcess(pid) {
  if (!isProcessAlive(pid)) return "other";
  try {
    let image = "";
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("powershell", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`
      ], { timeout: 5e3 });
      image = String(stdout).trim();
    } else {
      const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "comm="], { timeout: 5e3 });
      image = String(stdout).trim();
    }
    if (!image) return "unknown";
    const base = image.split(/[\\/]/).pop().toLowerCase();
    return base.startsWith("livedot-bridge") || base === "node" || base === "node.exe" ? "bridge" : "other";
  } catch {
    return "unknown";
  }
}
async function clearStaleSingletonLock(runtimeStateDir, expectedPid, options = {}) {
  if (!options.force && isProcessAlive(expectedPid)) return false;
  const path = runtimePaths(runtimeStateDir).lock;
  let lock;
  try {
    lock = JSON.parse(await (0, import_promises15.readFile)(path, "utf8"));
  } catch (error3) {
    if (error3?.code === "ENOENT") return true;
    throw new BridgeError("BRIDGE_LOCK_CORRUPT", "Bridge singleton lock is unreadable", { cause: error3 });
  }
  if (lock?.pid !== expectedPid) return false;
  await (0, import_promises15.rm)(path, { force: true });
  return true;
}
async function removeBridgeState(runtimeStateDir, expectedPid) {
  const paths = runtimePaths(runtimeStateDir);
  const current = await readBridgeState(runtimeStateDir).catch(() => null);
  if (current && expectedPid && current.pid !== expectedPid) return false;
  await (0, import_promises15.rm)(paths.bridge, { force: true });
  return true;
}

// src/bridge/project-registry.mjs
var SCHEMA_VERSION2 = 1;
function handleValue() {
  return `ph_${(0, import_node_crypto14.randomBytes)(24).toString("base64url")}`;
}
async function atomicWrite(path, data) {
  await (0, import_promises16.mkdir)((0, import_node_path20.dirname)(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${(0, import_node_crypto14.randomUUID)()}.tmp`;
  await (0, import_promises16.writeFile)(temporary, data, { encoding: "utf8", mode: 384, flag: "wx" });
  await (0, import_promises16.chmod)(temporary, 384).catch(() => void 0);
  await (0, import_promises16.rename)(temporary, path);
  await (0, import_promises16.chmod)(path, 384).catch(() => void 0);
}
var ProjectRegistry = class _ProjectRegistry {
  constructor({ filePath, entries = [], canonicalize = canonicalDirectory } = {}) {
    this.filePath = filePath;
    this.canonicalize = canonicalize;
    this.byHandle = new Map(entries.map((entry) => [entry.projectHandle, entry]));
    this.byRoot = new Map(entries.map((entry) => [entry.projectRoot, entry]));
    this.writeQueue = Promise.resolve();
  }
  static async open({ runtimeStateDir, filePath = runtimePaths(runtimeStateDir).projects, canonicalize } = {}) {
    let entries = [];
    try {
      const parsed = JSON.parse(await (0, import_promises16.readFile)(filePath, "utf8"));
      if (parsed?.schemaVersion !== SCHEMA_VERSION2 || !Array.isArray(parsed.projects)) throw new Error("invalid shape");
      entries = parsed.projects;
      for (const entry of entries) {
        if (!/^ph_[A-Za-z0-9_-]{32}$/.test(entry?.projectHandle) || typeof entry?.projectRoot !== "string") {
          throw new Error("invalid project entry");
        }
      }
    } catch (error3) {
      if (error3?.code !== "ENOENT") {
        throw new BridgeError("PROJECT_REGISTRY_CORRUPT", "Project authorization registry is unreadable or invalid", { cause: error3 });
      }
    }
    return new _ProjectRegistry({ filePath, entries, canonicalize });
  }
  async register(requestedRoot) {
    const projectRoot = await this.canonicalize(requestedRoot);
    await this.refresh();
    const existing = this.byRoot.get(projectRoot);
    if (existing) return { ...existing };
    const entry = {
      projectHandle: handleValue(),
      projectRoot,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.byHandle.set(entry.projectHandle, entry);
    this.byRoot.set(projectRoot, entry);
    try {
      await this.persist();
    } catch (error3) {
      this.byHandle.delete(entry.projectHandle);
      this.byRoot.delete(projectRoot);
      throw error3;
    }
    return { ...entry };
  }
  resolve(projectHandle) {
    const entry = this.byHandle.get(String(projectHandle));
    if (!entry) throw new BridgeError("PROJECT_HANDLE_NOT_FOUND", "Project handle is unknown or no longer authorized", { status: 404 });
    return { ...entry };
  }
  list() {
    return [...this.byHandle.values()].map((entry) => ({ ...entry }));
  }
  async refresh() {
    let parsed;
    try {
      parsed = JSON.parse(await (0, import_promises16.readFile)(this.filePath, "utf8"));
    } catch (error3) {
      if (error3?.code === "ENOENT") return;
      throw new BridgeError("PROJECT_REGISTRY_CORRUPT", "Project authorization registry is unreadable or invalid", { cause: error3 });
    }
    if (parsed?.schemaVersion !== SCHEMA_VERSION2 || !Array.isArray(parsed.projects)) {
      throw new BridgeError("PROJECT_REGISTRY_CORRUPT", "Project authorization registry has an invalid shape");
    }
    for (const entry of parsed.projects) {
      if (!/^ph_[A-Za-z0-9_-]{32}$/.test(entry?.projectHandle) || typeof entry?.projectRoot !== "string") {
        throw new BridgeError("PROJECT_REGISTRY_CORRUPT", "Project authorization registry contains an invalid entry");
      }
      this.byHandle.set(entry.projectHandle, entry);
      this.byRoot.set(entry.projectRoot, entry);
    }
  }
  async persist() {
    const payload = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION2, projects: this.list() }, null, 2)}
`;
    this.writeQueue = this.writeQueue.then(() => atomicWrite(this.filePath, payload));
    await this.writeQueue;
  }
};

// src/bridge/session-store.mjs
var import_node_crypto15 = require("node:crypto");
var import_promises17 = require("node:fs/promises");
var import_node_path21 = require("node:path");
var SCHEMA_VERSION3 = 1;
var DAY = 24 * 60 * 60 * 1e3;
var secret = () => (0, import_node_crypto15.randomBytes)(32).toString("base64url");
var digest4 = (value) => (0, import_node_crypto15.createHash)("sha256").update(String(value)).digest("base64url");
async function atomicWrite2(path, content) {
  await (0, import_promises17.mkdir)((0, import_node_path21.dirname)(path), { recursive: true, mode: 448 });
  const temporary = `${path}.${process.pid}.${(0, import_node_crypto15.randomUUID)()}.tmp`;
  await (0, import_promises17.writeFile)(temporary, content, { encoding: "utf8", mode: 384, flag: "wx" });
  await (0, import_promises17.chmod)(temporary, 384).catch(() => void 0);
  await (0, import_promises17.rename)(temporary, path);
  await (0, import_promises17.chmod)(path, 384).catch(() => void 0);
}
var SessionStore = class _SessionStore {
  constructor({ filePath, sessions = [], clock = () => /* @__PURE__ */ new Date(), ttlMs = 7 * DAY, persistIntervalMs = 6e4, maxSessions = 64 } = {}) {
    this.filePath = filePath;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.persistIntervalMs = persistIntervalMs;
    this.maxSessions = maxSessions;
    this.sessions = new Map(sessions.map((session) => [session.sessionIdHash, session]));
    this.lastPersistedAt = 0;
    this.dirty = false;
    this.writeQueue = Promise.resolve();
    this.reconnectAttempts = /* @__PURE__ */ new Map();
    this.prune();
  }
  static async open(options = {}) {
    const filePath = options.filePath || runtimePaths(options.runtimeStateDir).sessions;
    let sessions = [];
    try {
      const parsed = JSON.parse(await (0, import_promises17.readFile)(filePath, "utf8"));
      if (parsed?.schemaVersion !== SCHEMA_VERSION3 || !Array.isArray(parsed.sessions)) throw new Error("invalid shape");
      sessions = parsed.sessions;
      for (const session of sessions) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(session?.sessionIdHash) || typeof session?.csrfToken !== "string" || !Array.isArray(session?.projectHandles)) {
          throw new Error("invalid session");
        }
      }
    } catch (error3) {
      if (error3?.code !== "ENOENT") throw new BridgeError("SESSION_STORE_CORRUPT", "Browser session store is unreadable or invalid", { cause: error3 });
    }
    return new _SessionStore({ ...options, filePath, sessions });
  }
  now() {
    return this.clock().getTime();
  }
  create({ projectHandle = null } = {}) {
    const sessionId = secret();
    const reconnectTicket = secret();
    const now = this.now();
    const record = {
      schemaVersion: SCHEMA_VERSION3,
      sessionIdHash: digest4(sessionId),
      csrfToken: secret(),
      projectHandles: projectHandle ? [projectHandle] : [],
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.ttlMs).toISOString(),
      reconnectTicketHash: digest4(reconnectTicket),
      revokedAt: null
    };
    this.sessions.set(record.sessionIdHash, record);
    this.prune();
    this.dirty = true;
    return { sessionId, reconnectTicket, record: structuredClone(record) };
  }
  get(sessionId, { touch: touch2 = true } = {}) {
    const record = this.sessions.get(digest4(sessionId));
    if (!record || record.revokedAt) return null;
    const now = this.now();
    if (Date.parse(record.expiresAt) <= now) {
      this.sessions.delete(record.sessionIdHash);
      this.dirty = true;
      return null;
    }
    if (touch2) {
      record.lastSeenAt = new Date(now).toISOString();
      record.expiresAt = new Date(now + this.ttlMs).toISOString();
      this.dirty = true;
      void this.persistIfDue();
    }
    return structuredClone(record);
  }
  authorize(sessionId, projectHandle) {
    const key = digest4(sessionId);
    const record = this.sessions.get(key);
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= this.now()) return null;
    if (!record.projectHandles.includes(projectHandle)) record.projectHandles.push(projectHandle);
    record.lastSeenAt = new Date(this.now()).toISOString();
    record.expiresAt = new Date(this.now() + this.ttlMs).toISOString();
    const reconnectTicket = secret();
    record.reconnectTicketHash = digest4(reconnectTicket);
    this.dirty = true;
    return { ...structuredClone(record), reconnectTicket };
  }
  reconnect({ reconnectTicket, projectHandle, peer = "loopback" }) {
    const now = this.now();
    const rateKey = `${peer}|${projectHandle}`;
    const recent = (this.reconnectAttempts.get(rateKey) || []).filter((at) => now - at < 6e4);
    if (recent.length >= 5) throw new BridgeError("RECONNECT_RATE_LIMITED", "Too many reconnect attempts", { status: 429 });
    recent.push(now);
    this.reconnectAttempts.set(rateKey, recent);
    const ticketHash = digest4(reconnectTicket);
    const current = [...this.sessions.values()].find((record) => record.reconnectTicketHash === ticketHash && !record.revokedAt);
    if (!current || Date.parse(current.expiresAt) <= now || !current.projectHandles.includes(projectHandle)) {
      throw new BridgeError("INVALID_RECONNECT_TICKET", "Reconnect ticket is invalid or expired", { status: 401 });
    }
    current.revokedAt = new Date(now).toISOString();
    const created = this.create({ projectHandle });
    for (const handle of current.projectHandles) {
      if (!created.record.projectHandles.includes(handle)) created.record.projectHandles.push(handle);
    }
    const stored = this.sessions.get(created.record.sessionIdHash);
    stored.projectHandles = [...created.record.projectHandles];
    this.dirty = true;
    return created;
  }
  prune() {
    const now = this.now();
    for (const [key, record] of this.sessions) {
      if (record.revokedAt || Date.parse(record.expiresAt) <= now) this.sessions.delete(key);
    }
    const ordered = [...this.sessions.values()].sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt));
    while (ordered.length > this.maxSessions) {
      const oldest = ordered.shift();
      this.sessions.delete(oldest.sessionIdHash);
    }
  }
  async persistIfDue() {
    if (!this.dirty || this.now() - this.lastPersistedAt < this.persistIntervalMs) return false;
    await this.flush();
    return true;
  }
  async flush() {
    this.prune();
    const payload = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION3, sessions: [...this.sessions.values()] }, null, 2)}
`;
    this.writeQueue = this.writeQueue.then(() => atomicWrite2(this.filePath, payload));
    await this.writeQueue;
    this.lastPersistedAt = this.now();
    this.dirty = false;
  }
};

// src/cli/livedot.ts
if ((0, import_node_sea.isSea)()) process.env.LIVEDOT_SEA = "1";
function parseArgs(values) {
  const [command2 = "help", ...rest] = values;
  const args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return { command: command2, args };
}
function required(args, name) {
  const value = args[name];
  if (typeof value !== "string" || !value) throw new Error(`\u7F3A\u5C11 --${name}`);
  return value;
}
async function openThroughRunningBridge(state, controlToken, projectRoot, projectHandle) {
  const origin = `http://127.0.0.1:${state.port}`;
  const signal = AbortSignal.timeout(2e3);
  const status = await fetch(`${origin}/api/v1/control/status`, {
    headers: { "X-LiveDot-Control": controlToken },
    signal
  });
  if (!status.ok) throw new Error(`\u5DF2\u8BB0\u5F55\u7684 Bridge \u672A\u901A\u8FC7\u8EAB\u4EFD\u9A8C\u8BC1\uFF08HTTP ${status.status}\uFF09`);
  const statusBody = await status.json();
  if (Number(statusBody.pid) !== state.pid) throw new Error("\u6301\u4E45\u5316\u7AEF\u53E3\u4E0A\u7684 Bridge PID \u4E0E\u8FD0\u884C\u72B6\u6001\u4E0D\u4E00\u81F4");
  const opened = await fetch(`${origin}/api/v1/control/open-project`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-LiveDot-Control": controlToken },
    body: JSON.stringify({ projectRoot, projectHandle }),
    signal: AbortSignal.timeout(1e4)
  });
  const body = await opened.json().catch(() => ({}));
  if (opened.ok && typeof body.bootstrapToken === "string") {
    const url = `${origin}/app.html?token=${encodeURIComponent(body.bootstrapToken)}`;
    return { ok: true, reused: true, pid: state.pid, origin, projectHandle, url };
  }
  const detail = body.error && typeof body.error === "object" ? body.error : {};
  const code = typeof detail.code === "string" ? detail.code : "";
  const message = typeof detail.message === "string" ? detail.message : "";
  throw Object.assign(
    new Error(`Bridge \u65E0\u6CD5\u6253\u5F00\u9879\u76EE\uFF08HTTP ${opened.status}${code ? ` ${code}` : ""}${message ? `\uFF1A${message}` : ""}\uFF09`),
    { httpStatus: opened.status, errorCode: code }
  );
}
var REUSABLE_RETRY_STATUS = /* @__PURE__ */ new Set([409, 503]);
async function openThroughRunningBridgeWithRetry(state, controlToken, projectRoot, projectHandle) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    try {
      return await openThroughRunningBridge(state, controlToken, projectRoot, projectHandle);
    } catch (error3) {
      lastError = error3;
      const status = error3?.httpStatus;
      if (typeof status !== "number" || !REUSABLE_RETRY_STATUS.has(status)) throw error3;
    }
  }
  throw lastError;
}
async function recordAgentHealth2(root, actor, event, status, error3) {
  const path = (0, import_node_path22.join)(root, ".live-dot-map", ".bridge", "agent-health.json");
  const prior = await (0, import_promises18.readFile)(path, "utf8").then((text) => JSON.parse(text)).catch(() => ({}));
  const records = prior.records && typeof prior.records === "object" && !Array.isArray(prior.records) ? prior.records : {};
  const value = error3;
  records[actor.replace(/^agent:/, "")] = {
    status,
    actor,
    event,
    boundary: event.startsWith("hook:") ? "hook" : "mcp",
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...status === "error" ? { code: value?.code ?? "HOOK_FAILED", message: String(value?.message ?? value ?? "\u672A\u77E5\u9519\u8BEF").slice(0, 400) } : {}
  };
  await (0, import_promises18.mkdir)((0, import_node_path22.dirname)(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${(0, import_node_crypto16.randomUUID)()}.tmp`;
  try {
    await (0, import_promises18.writeFile)(temporary, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), records }, null, 2)}
`, "utf8");
    await (0, import_promises18.rename)(temporary, path);
  } catch {
  }
}
async function inspectProjectQualification(projectRoot) {
  const root = (0, import_node_path22.resolve)(projectRoot);
  const rootMetadata = await (0, import_promises18.lstat)(root).catch(() => null);
  if (!rootMetadata || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    return { ok: false, code: "PROJECT_NOT_FOUND", message: "\u5F53\u524D\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u6709\u6548\u9879\u76EE\u76EE\u5F55\u3002" };
  }
  const dataDirectory = (0, import_node_path22.join)(root, ".live-dot-map");
  const dataMetadata = await (0, import_promises18.lstat)(dataDirectory).catch(() => null);
  if (!dataMetadata) return { ok: false, code: "PROJECT_NOT_INITIALIZED", message: "\u5F53\u524D\u76EE\u5F55\u8FD8\u6CA1\u6709\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u3002" };
  if (!dataMetadata.isDirectory() || dataMetadata.isSymbolicLink()) {
    return { ok: false, code: "PROJECT_LAYOUT_INVALID", message: "\u6D3B\u70B9\u5730\u56FE\u6570\u636E\u76EE\u5F55\u4E0D\u662F\u53EF\u5B89\u5168\u8BFB\u53D6\u7684\u76EE\u5F55\u3002" };
  }
  const marker = async (path) => {
    const metadata = await (0, import_promises18.lstat)(path).catch(() => null);
    return Boolean(metadata && (metadata.isFile() || metadata.isSymbolicLink()));
  };
  const legacy = await marker((0, import_node_path22.join)(dataDirectory, "map.json"));
  const mapsPath = (0, import_node_path22.join)(dataDirectory, "maps");
  const mapsMetadata = await (0, import_promises18.lstat)(mapsPath).catch(() => null);
  let packageMap = false;
  if (mapsMetadata?.isDirectory() && !mapsMetadata.isSymbolicLink()) {
    const entries = await (0, import_promises18.readdir)(mapsPath, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (await marker((0, import_node_path22.join)(mapsPath, entry.name, "map.json"))) {
        packageMap = true;
        break;
      }
    }
  }
  if (!legacy && !packageMap) {
    return { ok: false, code: "PROJECT_NOT_INITIALIZED", message: "\u5F53\u524D\u76EE\u5F55\u4E0D\u662F\u5DF2\u521D\u59CB\u5316\u7684\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u3002" };
  }
  const writableTarget = packageMap ? await (0, import_promises18.access)(mapsPath, import_node_fs3.constants.W_OK).then(() => true).catch(() => false) : await (0, import_promises18.access)(dataDirectory, import_node_fs3.constants.W_OK).then(() => true).catch(() => false);
  if (!writableTarget) return { ok: false, code: "PROJECT_READONLY", message: "\u5F53\u524D\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u76EE\u5F55\u4E0D\u53EF\u5199\u3002" };
  return { ok: true };
}
function unavailableToolResult(qualification) {
  const code = qualification.code ?? "PROJECT_NOT_INITIALIZED";
  const message = qualification.message ?? "\u5F53\u524D\u76EE\u5F55\u6CA1\u6709\u53EF\u7528\u7684\u6D3B\u70B9\u5730\u56FE\u9879\u76EE\u3002";
  return {
    isError: true,
    content: [{ type: "text", text: `[\u6D3B\u70B9\u5730\u56FE] ${message}` }],
    structuredContent: { ok: false, error: { code, message } }
  };
}
function envelope(projectId, revision, actor, sessionId, commands) {
  return { projectId, baseRevision: revision, commandId: `cmd-${(0, import_node_crypto16.randomUUID)()}`, actor, sessionId, commands };
}
function compactHookContext(value) {
  const context = value && typeof value === "object" ? value : {};
  const objects = Array.isArray(context.objects) ? context.objects : [];
  const markdown = Array.isArray(context.markdown) ? context.markdown : [];
  return {
    revision: context.revision,
    projection: context.projection,
    objects: objects.slice(0, 6).map((item) => ({
      kind: item.kind,
      id: item.id,
      score: item.score,
      source: item.source,
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 3) : [],
      relationPath: Array.isArray(item.relationPath) ? item.relationPath.slice(0, 3) : []
    })),
    markdown: markdown.slice(0, 2).map((item) => ({
      path: item.path,
      score: item.score,
      reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 2) : [],
      snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 360) : ""
    }))
  };
}
var toolDefinitions = TOOL_DEFINITIONS;
async function runMcp(projectRoot, actor) {
  const root = (0, import_node_path22.resolve)(projectRoot);
  const qualification = await inspectProjectQualification(root);
  const logger = qualification.ok ? createLogger({ source: "agent" }) : noopLogger;
  let manager = null;
  let tools = null;
  if (qualification.ok) await logger.info("agent.mcp.start", { project: root, actor, pid: process.pid });
  const lines = (0, import_node_readline.createInterface)({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      continue;
    }
    if (!("id" in request)) continue;
    const id = request.id;
    try {
      let result2;
      if (request.method === "initialize") result2 = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "live-dot-map", version: "2.0.0" } };
      else if (request.method === "tools/list") result2 = { tools: toolDefinitions };
      else if (request.method === "tools/call") {
        if (!qualification.ok) {
          result2 = unavailableToolResult(qualification);
        } else {
          const params = request.params;
          if (!manager) {
            const shared = await loadSharedAdapter();
            manager = await MapManager.open({ projectRoot: root, shared, pollIntervalMs: 0 });
            tools = new ToolService({ mapManager: manager, shared, actor, projectHandle: "stdio" });
          }
          const value = await tools.dispatch(String(params.name), params.arguments ?? {});
          result2 = { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
        }
      } else throw Object.assign(new Error(`\u672A\u77E5\u65B9\u6CD5 ${String(request.method)}`), { code: -32601 });
      if (qualification.ok) await recordAgentHealth2(root, actor, `mcp:${String(request.method === "tools/call" ? request.params?.name ?? "call" : request.method)}`, "ok");
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: result2 })}
`);
    } catch (error3) {
      const value = error3;
      if (qualification.ok) {
        await recordAgentHealth2(root, actor, `mcp:${String(request.params?.name ?? request.method ?? "unknown")}`, "error", value);
        await logger.error("agent.mcp", { tool: String(request.params?.name ?? request.method ?? "unknown"), error: value });
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: typeof value.code === "number" ? value.code : -32e3, message: value.message, data: { code: value.code, details: value.details } } })}
`);
    }
  }
  await manager?.close().catch(() => void 0);
}
async function runHook(kind, args) {
  const root = (0, import_node_path22.resolve)(required(args, "project"));
  const actor = `agent:${String(args.agent || "generic")}`;
  const sessionId = String(args.session || `session-${(0, import_node_crypto16.randomUUID)()}`);
  const qualification = await inspectProjectQualification(root);
  if (!qualification.ok) return;
  const logger = createLogger({ source: "agent" });
  await logger.info("agent.hook.start", { event: kind, actor, project: root });
  const shared = await loadSharedAdapter();
  const manager = await MapManager.open({ projectRoot: root, shared, pollIntervalMs: 0 });
  const resolvedMap = await manager.resolve();
  const store = resolvedMap.store;
  const tools = new ToolService({ mapManager: manager, shared, actor, projectHandle: "hook" });
  const snapshot = await store.snapshot();
  const document = snapshot.document;
  if (kind === "session-start") {
    const watermarkPath = (0, import_node_path22.join)(root, ".live-dot-map", "agent-read.json");
    let watermark = 0;
    try {
      const parsed = JSON.parse(await (0, import_promises18.readFile)(watermarkPath, "utf8"));
      if (typeof parsed?.updatedAt === "string") watermark = Date.parse(parsed.updatedAt);
    } catch {
    }
    const since = watermark || Date.now();
    const changes = [];
    const collections = [["nodes", "\u8282\u70B9"], ["edges", "\u65B9\u6848"], ["anns", "\u6807\u6CE8"], ["routes", "\u8DEF\u7EBF"]];
    for (const [collection, label] of collections) {
      for (const item of Array.isArray(document[collection]) ? document[collection] : []) {
        const updated = Date.parse(String(item.updatedAt));
        if (Number.isFinite(updated) && updated > since) {
          changes.push({
            label,
            id: String(item.id),
            name: String(item.name ?? item.text ?? ""),
            status: item.status ? String(item.status) : "",
            attention: item.attention ? String(item.attention) : ""
          });
        }
      }
    }
    const newAnns = document.anns.filter((ann) => ann.source === "human" && ann.attention === "new");
    let deliveredIds = [];
    if (newAnns.length) {
      await store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: "deliver_annotations", ids: newAnns.map((ann) => String(ann.id)), deliveryId: sessionId }]));
      deliveredIds = newAnns.map((ann) => String(ann.id));
    }
    if (changes.length || deliveredIds.length) {
      await (0, import_promises18.mkdir)((0, import_node_path22.dirname)(watermarkPath), { recursive: true });
      await (0, import_promises18.writeFile)(watermarkPath, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)}
`, "utf8");
      const newCount = changes.filter((item) => item.label === "\u6807\u6CE8" && item.attention === "new").length;
      const lines = changes.slice(0, 20).map((item) => `${item.label} ${item.id}${item.name ? `\u300C${item.name}\u300D` : ""}${item.status ? `(${item.status})` : ""}`);
      const output = {
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: [
          `[\u6D3B\u70B9\u5730\u56FE] \u81EA\u4E0A\u6B21\u4EE5\u6765\u6709 ${changes.length} \u5904\u66F4\u65B0\uFF08${newCount} \u6761\u65B0\u6807\u6CE8\u4F18\u5148\uFF09\uFF1A`,
          ...lines,
          ...deliveredIds.length ? [`\u4EBA\u7C7B\u6807\u6CE8\u5DF2\u4EA4\u4ED8\uFF08\u6458\u8981\u4E2D\u8BF7\u9010\u5B57\u5F15\u7528\uFF09\uFF1A${deliveredIds.join("\u3001")}`] : [],
          changes.length > 20 ? `\u2026\u5171 ${changes.length} \u5904` : "",
          "\u8BE6\u7EC6\u8BF7\u8BFB .live-dot-map/map.json\u3002"
        ].filter(Boolean).join("\n") }
      };
      process.stdout.write(`${JSON.stringify(output)}
`);
    }
    await recordAgentHealth2(root, actor, "hook:session-start", "ok");
    await manager.close();
    return;
  }
  if (kind === "user-prompt") {
    let prompt = typeof args.prompt === "string" ? args.prompt : "";
    if (!prompt && !process.stdin.isTTY) {
      let raw = "";
      for await (const chunk of process.stdin) raw += chunk;
      try {
        const input = JSON.parse(raw);
        prompt = String(input.prompt ?? input.user_prompt ?? input.input ?? raw);
      } catch {
        prompt = raw;
      }
    }
    const context = await tools.dispatch("map_get_context", { query: prompt });
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: JSON.stringify(compactHookContext(context)) } })}
`);
    await recordAgentHealth2(root, actor, "hook:user-prompt", "ok");
    await manager.close();
    return;
  }
  if (kind === "stop") {
    let hookInput = {};
    if (!process.stdin.isTTY) {
      let raw = "";
      for await (const chunk of process.stdin) raw += chunk;
      try {
        hookInput = raw ? JSON.parse(raw) : {};
      } catch {
        hookInput = {};
      }
    }
    const updates = await tools.dispatch("map_list_human_updates", {});
    const validation = await tools.dispatch("map_validate", {});
    const attemptIssues = Array.isArray(validation.attemptIssues) ? validation.attemptIssues : [];
    const incomplete = Array.isArray(updates.updates) && updates.updates.length > 0 || attemptIssues.length > 0 || validation.ok === false;
    const attempt = Number(args.attempt || process.env.LIVEDOT_STOP_ATTEMPT || (hookInput.stop_hook_active ? 2 : 1)) || 1;
    if (incomplete && attempt >= 2) {
      const current = await store.snapshot();
      await store.execute(envelope(String(current.document.mapId), current.revision, actor, sessionId, [{
        op: "set_ui",
        patch: { collaboration: { status: "incomplete", agent: actor, sessionId, at: (/* @__PURE__ */ new Date()).toISOString(), reason: attemptIssues.length ? `\u5927\u5C1D\u8BD5\u8BC1\u636E\u672A\u95ED\u73AF\uFF1A${attemptIssues.map((item) => `${item.edgeId}\uFF08${(item.missing || []).join("\u3001")}\uFF09`).join("\uFF1B")}` : "\u4EBA\u7C7B\u6807\u6CE8\u672A\u5B8C\u6210\u6458\u8981\u5F15\u7528\u4E0E\u786E\u8BA4" } }
      }]));
    }
    const reason = incomplete ? attemptIssues.length ? attempt < 2 ? "\u5927\u5C1D\u8BD5\u7F3A\u5C11\u8BC1\u636E/\u7ED3\u679C/\u4E0B\u4E00\u6B65 Markdown\uFF1B\u8BF7\u5148\u8865\u9F50\u65B9\u6848\u8BB0\u5F55\u3002" : "\u7B2C\u4E8C\u6B21\u68C0\u67E5\u4ECD\u6709\u5927\u5C1D\u8BD5\u8BC1\u636E\u7F3A\u53E3\uFF0C\u5141\u8BB8\u7ED3\u675F\u4F46\u753B\u5E03\u4FDD\u6301\u7EA2\u8272\u3002" : attempt < 2 ? "\u4ECD\u6709\u4EBA\u7C7B\u6807\u6CE8\u672A\u5B8C\u6210\u6458\u8981\u5F15\u7528\u4E0E ack\uFF1B\u8BF7\u5148\u95ED\u73AF\u5730\u56FE\u3002" : "\u7B2C\u4E8C\u6B21\u68C0\u67E5\u4ECD\u672A\u95ED\u73AF\uFF0C\u5141\u8BB8\u7ED3\u675F\u4F46\u753B\u5E03\u4FDD\u6301\u7EA2\u8272\u3002" : "\u5730\u56FE\u95ED\u73AF\u5B8C\u6210\u3002";
    const output = incomplete && attempt < 2 ? { decision: "block", reason } : { systemMessage: reason };
    process.stdout.write(`${JSON.stringify(output)}
`);
    await recordAgentHealth2(root, actor, "hook:stop", incomplete ? "error" : "ok", incomplete ? new Error(reason) : void 0);
    await manager.close();
  }
}
async function main() {
  const { command: command2, args } = parseArgs(process.argv.slice(2));
  if (command2 === "serve") {
    const logger = createLogger({ source: "bridge" });
    const projectRoot = (0, import_node_path22.resolve)(required(args, "project"));
    const runtimeStateDir = typeof args["runtime-state-dir"] === "string" ? (0, import_node_path22.resolve)(args["runtime-state-dir"]) : void 0;
    const controlToken = await readOrCreateControlToken(runtimeStateDir);
    const registry = await ProjectRegistry.open({ runtimeStateDir });
    const sessionStore = await SessionStore.open({ runtimeStateDir });
    const registered = await registry.register(projectRoot);
    let state = await readBridgeState(runtimeStateDir);
    if (state) {
      try {
        const reused = await openThroughRunningBridgeWithRetry(state, controlToken, projectRoot, registered.projectHandle);
        process.stdout.write(`${JSON.stringify(reused)}
`);
        await logger.flush();
        return;
      } catch (error3) {
        const identity = isProcessAlive(state.pid) ? await checkBridgeProcess(state.pid) : "other";
        if (identity !== "other") {
          throw new Error(`\u73B0\u6709 Bridge \u8FDB\u7A0B\u4ECD\u5728\u8FD0\u884C\u4F46\u65E0\u6CD5\u5B89\u5168\u590D\u7528\uFF1A${error3 instanceof Error ? error3.message : String(error3)}`);
        }
        if (!await clearStaleSingletonLock(runtimeStateDir, state.pid, { force: true })) {
          throw new Error("Bridge \u72B6\u6001\u5DF2\u5931\u6548\uFF0C\u4F46\u5355\u4F8B\u9501\u4E0D\u80FD\u5B89\u5168\u56DE\u6536");
        }
        await removeBridgeState(runtimeStateDir, state.pid);
      }
    }
    let releaseLock = null;
    try {
      releaseLock = await acquireSingletonLock(runtimeStateDir);
    } catch (error3) {
      if (error3?.code !== "BRIDGE_START_IN_PROGRESS") throw error3;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
        state = await readBridgeState(runtimeStateDir);
        if (!state) continue;
        try {
          const reused = await openThroughRunningBridge(state, controlToken, projectRoot, registered.projectHandle);
          process.stdout.write(`${JSON.stringify(reused)}
`);
          await logger.flush();
          return;
        } catch {
        }
      }
      throw new Error("Bridge \u6B63\u5728\u542F\u52A8\uFF0C\u4F46\u5728 2 \u79D2\u5185\u6CA1\u6709\u8FDB\u5165\u53EF\u590D\u7528\u72B6\u6001");
    }
    const appPath = (0, import_node_path22.resolve)(typeof args.app === "string" ? args.app : (0, import_node_path22.join)(process.cwd(), "app.html"));
    const appHtml = await (0, import_promises18.readFile)(appPath, "utf8");
    const assetRoot = (0, import_node_path22.dirname)(appPath);
    const staticAssets = {};
    for (const [urlPath, file, type] of [
      ["/sw.js", "sw.js", "text/javascript; charset=utf-8"],
      ["/manifest.webmanifest", "manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/icons/icon-192.png", (0, import_node_path22.join)("icons", "icon-192.png"), "image/png"],
      ["/icons/icon-512.png", (0, import_node_path22.join)("icons", "icon-512.png"), "image/png"]
    ]) {
      try {
        staticAssets[urlPath] = { body: await (0, import_promises18.readFile)((0, import_node_path22.join)(assetRoot, file)), type };
      } catch {
      }
    }
    let bridge;
    try {
      bridge = await createBridgeServer({
        allowedProjectRoots: [projectRoot],
        appHtml,
        staticAssets,
        logger,
        controlToken,
        projectRegistry: registry,
        sessionStore,
        listenPort: state?.port ?? 0
      });
      state = await writeBridgeState(runtimeStateDir, { pid: process.pid, port: bridge.port });
    } catch (error3) {
      await releaseLock?.();
      if (error3?.code === "EADDRINUSE" && state?.port) {
        throw new Error(`Bridge \u56FA\u5B9A\u7AEF\u53E3 ${state.port} \u88AB\u5176\u4ED6\u7A0B\u5E8F\u5360\u7528\uFF1B\u4E3A\u4FDD\u62A4\u6D4F\u89C8\u5668\u8349\u7A3F\uFF0C\u672A\u5207\u6362\u5230\u968F\u673A\u7AEF\u53E3`);
      }
      throw error3;
    }
    const bootstrapToken = bridge.issueBootstrapTicket(projectRoot, registered.projectHandle);
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bootstrapToken)}`;
    await logger.info("bridge.start", { origin: bridge.origin, pid: process.pid });
    process.stdout.write(`${JSON.stringify({ ok: true, reused: false, pid: process.pid, origin: bridge.origin, projectHandle: registered.projectHandle, url })}
`);
    const shutdown = async () => {
      await logger.info("bridge.stop", { pid: process.pid });
      await logger.flush();
      await bridge.close();
      await releaseLock?.();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  if (command2 === "mcp") {
    const project = (0, import_node_path22.resolve)(typeof args.project === "string" && args.project.trim() ? args.project : process.cwd());
    return runMcp(project, `agent:${String(args.agent || "generic")}`);
  }
  if (command2 === "hook") {
    const project = (0, import_node_path22.resolve)(typeof args.project === "string" && args.project.trim() ? args.project : process.cwd());
    return runHook(String(args.event || "session-start"), { ...args, project });
  }
  if (command2 === "install") {
    const root = (0, import_node_path22.resolve)(typeof args.project === "string" ? args.project : process.cwd());
    const runtimeSource = process.env.LIVEDOT_RUNTIME_SOURCE || process.argv[1] || process.cwd();
    const appPath = (0, import_node_path22.resolve)(typeof args.app === "string" ? args.app : (0, import_node_path22.join)((0, import_node_path22.dirname)(runtimeSource), "app.html"));
    const install = installProject;
    const result2 = await install({ projectRoot: root, runtimeSource, appPath, createDesktopShortcut: args["no-shortcut"] !== true, register: false });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    return;
  }
  if (command2 === "doctor") {
    const root = (0, import_node_path22.resolve)(required(args, "project"));
    const result2 = await doctorProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    if (!result2.ok) process.exitCode = 1;
    return;
  }
  if (command2 === "uninstall") {
    const root = (0, import_node_path22.resolve)(required(args, "project"));
    const result2 = await uninstallProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    if (!result2.ok && result2.reason !== "not-installed") process.exitCode = 1;
    return;
  }
  process.stdout.write("\u6D3B\u70B9\u5730\u56FE v2\n  livedot.mjs install --project <path> --app <app.html>\n  livedot.mjs serve --project <path> --app <app.html>\n  livedot.mjs mcp --project <path> --agent codex|claude|kimi\n  livedot.mjs hook --event session-start|user-prompt|stop --project <path>\n  livedot.mjs doctor --project <path>\n  livedot.mjs uninstall --project <path>\n");
}
void main().catch(async (error3) => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "hook" || parsed.command === "mcp") {
    const project = (0, import_node_path22.resolve)(typeof parsed.args.project === "string" && parsed.args.project.trim() ? parsed.args.project : process.cwd());
    await recordAgentHealth2(project, `agent:${String(parsed.args.agent || "generic")}`, `${parsed.command === "hook" ? `hook:${String(parsed.args.event || "unknown")}` : "mcp:process"}`, "error", error3).catch(() => void 0);
  }
  await createLogger({ source: parsed.command === "serve" ? "bridge" : "agent" }).error("process.error", { command: parsed.command, error: error3 });
  console.error(error3 instanceof Error ? error3.message : error3);
  process.exitCode = 1;
});
