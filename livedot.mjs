#!/usr/bin/env node
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
function clone(value) {
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
    output[key] = clone(value);
  }
  return output;
}
function documentMapDir(document) {
  const value = document.mapDir;
  return typeof value === "string" && value ? value : ".live-dot-map";
}
function stableMarkdownPath(collection, id, mapDir = ".live-dot-map") {
  if (!ID.test(id)) throw mapError("INVALID_ID", 400, "\u5BF9\u8C61 ID \u65E0\u6548");
  return collection === "nodes" ? `${mapDir}/nodes/${id}.md` : `${mapDir}/routes/${id}.md`;
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
    migrated.acknowledgements = Array.isArray(item.acknowledgements) ? clone(item.acknowledgements) : [];
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
  const mapId = typeof old.mapId === "string" && ID.test(old.mapId) ? old.mapId : `map-${fnv1a(`${String(old.name ?? "\u672A\u547D\u540D\u5730\u56FE")}:${createdAt}`)}`;
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
  if (typeof item.id !== "string" || !ID.test(item.id)) errors.push(`${label}.id \u65E0\u6548`);
  else if (ids.has(item.id)) errors.push(`\u91CD\u590D id: ${item.id}`);
  else ids.add(item.id);
  if (typeof item.createdAt !== "string" || !ISO_MS.test(item.createdAt)) errors.push(`${label}.createdAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedAt !== "string" || !ISO_MS.test(item.updatedAt)) errors.push(`${label}.updatedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedBy !== "string") errors.push(`${label}.updatedBy \u7F3A\u5931`);
  if (item.createdBy !== void 0 && typeof item.createdBy !== "string") errors.push(`${label}.createdBy \u65E0\u6548`);
  if (!Number.isInteger(item.updatedRevision) || Number(item.updatedRevision) < 0) errors.push(`${label}.updatedRevision \u65E0\u6548`);
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
  if (typeof value.mapId !== "string" || !ID.test(value.mapId)) errors.push("mapId \u65E0\u6548");
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
    if (node.milestone !== void 0) {
      const milestone = node.milestone;
      if (!isObject(milestone) || !["pending", "approved", "changes_requested"].includes(String(milestone.status))) {
        errors.push(`nodes[${i}].milestone \u65E0\u6548`);
      } else {
        if (milestone.origin !== void 0 && !["human_created", "agent_created"].includes(String(milestone.origin))) errors.push(`nodes[${i}].milestone.origin \u65E0\u6548`);
        if (milestone.level !== void 0 && !["project", "route", "work"].includes(String(milestone.level))) errors.push(`nodes[${i}].milestone.level \u65E0\u6548`);
        if (milestone.createdBy !== void 0 && typeof milestone.createdBy !== "string") errors.push(`nodes[${i}].milestone.createdBy \u65E0\u6548`);
        if (milestone.updatedBy !== void 0 && typeof milestone.updatedBy !== "string") errors.push(`nodes[${i}].milestone.updatedBy \u65E0\u6548`);
      }
    }
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
function assertName(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_NAME) throw mapError("INVALID_NAME", 422, "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u4E14\u4E0D\u80FD\u8D85\u8FC7 80 \u5B57");
}
function isAgent(actor) {
  return typeof actor === "string" && actor.startsWith("agent:");
}
function milestoneOrigin(actor) {
  if (actor === "human") return "human_created";
  if (isAgent(actor)) return "agent_created";
  return void 0;
}
function normalizeMilestone(value, actor, now, revision, existing) {
  if (!isObject(value)) throw mapError("INVALID_MILESTONE", 422, "\u91CC\u7A0B\u7891\u5FC5\u987B\u662F\u5BF9\u8C61");
  const merged = { ...existing ?? {}, ...cleanRecord(value, "milestone") };
  if (!["pending", "approved", "changes_requested"].includes(String(merged.status))) throw mapError("INVALID_MILESTONE", 422, "\u91CC\u7A0B\u7891\u72B6\u6001\u65E0\u6548");
  if (merged.level !== void 0 && !["project", "route", "work"].includes(String(merged.level))) throw mapError("INVALID_MILESTONE_LEVEL", 422, "\u91CC\u7A0B\u7891\u5C42\u7EA7\u5FC5\u987B\u662F project\u3001route \u6216 work");
  const origin = milestoneOrigin(actor);
  if (existing?.origin !== void 0) merged.origin = existing.origin;
  else if (origin) merged.origin = origin;
  merged.level = merged.level === void 0 ? "project" : merged.level;
  if (existing?.createdBy !== void 0) merged.createdBy = existing.createdBy;
  else merged.createdBy = actor;
  merged.updatedBy = actor;
  if (existing?.createdAt !== void 0) merged.createdAt = existing.createdAt;
  else merged.createdAt = now;
  merged.updatedAt = now;
  merged.updatedRevision = revision;
  return merged;
}
function assertAgentMilestoneAllowed(value) {
  if (!isObject(value)) return;
  const level = value.level;
  if (level === "work") {
    throw mapError("AGENT_WORK_MILESTONE_FORBIDDEN", 422, "Agent \u53EA\u80FD\u521B\u5EFA\u9879\u76EE\u7EA7\u6216\u8DEF\u7EBF\u7EA7\u5927\u8282\u70B9\uFF0C\u4E0D\u80FD\u628A\u6267\u884C\u788E\u7247\u5EFA\u6210\u91CC\u7A0B\u7891", {
      suggestion: "\u5408\u5E76\u4E3A\u9879\u76EE/\u8DEF\u7EBF\u9636\u6BB5\uFF0C\u6216\u628A\u6267\u884C\u7EC6\u8282\u5199\u5165 Markdown"
    });
  }
}
function assertAgentCurationAllowed(value, actor) {
  if (!isAgent(actor)) return;
  const fields = ["archived", "shelved"].filter((field) => value[field] === true);
  if (!fields.length) return;
  throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "Agent \u4E0D\u80FD\u76F4\u63A5\u5F52\u6863\u6216\u6401\u7F6E\u5730\u56FE\u8BB0\u5FC6\uFF0C\u5FC5\u987B\u7B49\u5F85\u4EBA\u5728\u753B\u5E03\u5BA1\u6838\u540E\u63D0\u4EA4", {
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
    if (typeof value.id !== "string" || !ID.test(value.id)) throw mapError("INVALID_ID", 422, "\u65B0\u5BF9\u8C61 ID \u65E0\u6548");
    if (getList(document, command2.collection).some((v) => v.id === value.id)) throw mapError("DUPLICATE_ID", 409, `\u5BF9\u8C61 ${value.id} \u5DF2\u5B58\u5728`);
    if (command2.collection !== "anns") assertName(value.name);
    if (command2.collection === "nodes") {
      if (value.kind !== void 0 && !["goal", "problem", "result"].includes(String(value.kind))) throw mapError("INVALID_NODE_KIND", 422, "\u8282\u70B9 kind \u5FC5\u987B\u662F goal\u3001problem \u6216 result");
      value.kind = normalizeNodeKind(value.kind ?? value.type);
    }
    if (command2.collection === "nodes" && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === "work") assertAgentMilestoneAllowed(value);
    }
    assertAgentCurationAllowed(value, actor);
    const item = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command2.collection === "nodes" && value.milestone !== void 0) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command2.collection === "nodes" && item.md === void 0) item.md = stableMarkdownPath("nodes", String(item.id), documentMapDir(document));
    if (command2.collection === "edges" && item.md === void 0) item.md = stableMarkdownPath("edges", String(item.id), documentMapDir(document));
    if (command2.collection === "anns") {
      if (typeof item.text !== "string" || item.text.length > MAX_ANN) throw mapError("INVALID_ANNOTATION", 422, "\u6807\u6CE8\u65E0\u6548\u6216\u8FC7\u957F");
      item.source = actor === "human" ? "human" : actor;
      item.priority = item.priority ?? "normal";
      item.attention = actor === "human" ? "new" : item.attention ?? "acknowledged";
      item.acknowledgements = [];
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
    }
    assertAgentCurationAllowed(patch, actor);
    if (command2.collection === "nodes" && isObject(patch.milestone)) {
      if (isAgent(actor)) {
        assertAgentMilestoneAllowed(patch.milestone);
      }
      patch.milestone = normalizeMilestone(patch.milestone, actor, now, revision, isObject(item.milestone) ? item.milestone : void 0);
    }
    Object.assign(item, patch);
    if (command2.collection === "anns" && actor === "human") {
      item.source = "human";
      item.attention = "new";
      if (!Array.isArray(item.acknowledgements)) item.acknowledgements = [];
    }
    touch(item, actor, revision, now);
    return;
  }
  if (command2.op === "delete") {
    if (actor.startsWith("agent:")) throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "Agent \u4E0D\u80FD\u76F4\u63A5\u5220\u9664\u5BF9\u8C61");
    const list = getList(document, command2.collection);
    const index = list.findIndex((entry) => entry.id === command2.id);
    if (index < 0) return;
    if (command2.collection === "nodes") {
      for (const route of document.routes) {
        if (route.currentNodeId === command2.id) {
          delete route.currentNodeId;
          touch(route, actor, revision, now);
        }
      }
      document.edges = document.edges.filter((edge) => edge.from !== command2.id);
      for (const edge of document.edges) {
        if (edge.to === command2.id) {
          edge.to = null;
          edge.status = "pending";
          edge.dx = typeof edge.dx === "number" ? edge.dx : 120;
          edge.dy = typeof edge.dy === "number" ? edge.dy : 0;
          touch(edge, actor, revision, now);
        }
      }
      document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === "node" && ann.target.id === command2.id));
    }
    if (command2.collection === "edges") document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === "edge" && ann.target.id === command2.id));
    list.splice(index, 1);
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
    const node = findItem(document, "nodes", command2.nodeId);
    node.milestoneSuggestion = { status: command2.status, reviewNote: command2.reviewNote ?? null, suggestedBy: actor, suggestedAt: now };
    touch(node, actor, revision, now);
    return;
  }
  throw mapError("UNKNOWN_COMMAND", 400, `\u4E0D\u652F\u6301\u7684\u5730\u56FE\u547D\u4EE4\uFF1A${String(command2?.op ?? "")}`);
}
function applyMapCommand(document, command2, options = {}) {
  const validation = validateMapDocument(document);
  if (!validation.ok) throw mapError("INVALID_MAP", 422, "\u5F53\u524D\u5730\u56FE\u65E0\u6548", validation.errors);
  const next = clone(document);
  const revision = options.revision ?? next.revision + 1;
  const now = utcNow(options.now);
  applyOne(next, command2, options.actor ?? "human", revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const result2 = validateMapDocument(next);
  if (!result2.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", result2.errors);
  return next;
}
function applyCommandEnvelope(document, envelope2, options = {}) {
  if (!envelope2 || !Array.isArray(envelope2.commands) || envelope2.commands.length === 0 || envelope2.commands.length > 100) throw mapError("INVALID_ENVELOPE", 400, "commands \u5FC5\u987B\u5305\u542B 1\u2013100 \u6761\u547D\u4EE4");
  if (!ID.test(envelope2.projectId) || !ID.test(envelope2.commandId) || !ID.test(envelope2.sessionId)) throw mapError("INVALID_ENVELOPE", 400, "projectId/commandId/sessionId \u65E0\u6548");
  if (!Number.isInteger(envelope2.baseRevision) || envelope2.baseRevision < 0) throw mapError("INVALID_ENVELOPE", 400, "baseRevision \u65E0\u6548");
  const agentInitialMap = isAgent(envelope2.actor) && (document.nodes.length === 0 || isObject(document.ui?.initialization) && document.ui.initialization.status === "in_progress");
  if (isAgent(envelope2.actor)) {
    const objectCommands = envelope2.commands.filter((command2) => ["create", "update", "delete"].includes(command2.op));
    const nodeCreates = envelope2.commands.filter((command2) => command2.op === "create" && command2.collection === "nodes");
    const milestoneCreates = nodeCreates.filter((command2) => isObject(command2.value) && command2.value.milestone !== void 0);
    if (objectCommands.length > MAX_AGENT_OBJECTS_PER_ENVELOPE) throw mapError("AGENT_BATCH_LIMIT", 422, "Agent \u5355\u6B21\u6700\u591A\u4FEE\u6539 10 \u4E2A\u5BF9\u8C61\uFF0C\u8BF7\u5148\u5408\u5E76\u6216\u8BA9\u4EBA\u9009\u62E9", { maxObjects: MAX_AGENT_OBJECTS_PER_ENVELOPE, suggestion: "\u538B\u7F29\u6267\u884C\u788E\u7247\uFF0C\u4FDD\u7559\u9879\u76EE/\u8DEF\u7EBF\u7EA7\u7ED3\u8BBA" });
    if (nodeCreates.length > MAX_AGENT_NEW_NODES_PER_ENVELOPE) throw mapError("AGENT_NODE_LIMIT", 422, "Agent \u5355\u6B21\u6700\u591A\u65B0\u589E 5 \u4E2A\u6D3B\u8DC3\u8282\u70B9\uFF0C\u8BF7\u5148\u5408\u5E76\u6216\u5206\u9636\u6BB5\u63D0\u4EA4", { maxNodes: MAX_AGENT_NEW_NODES_PER_ENVELOPE, suggestion: "\u53EA\u4FDD\u7559\u76EE\u6807\u3001\u9636\u6BB5\u3001\u7ED3\u679C\u6216\u5BA1\u6838\u95E8" });
    if (milestoneCreates.length > MAX_AGENT_MILESTONES_PER_ENVELOPE) throw mapError("AGENT_MILESTONE_LIMIT", 422, "Agent \u5355\u6B21\u6700\u591A\u65B0\u589E 2 \u4E2A\u91CC\u7A0B\u7891\u5927\u8282\u70B9", { maxMilestones: MAX_AGENT_MILESTONES_PER_ENVELOPE, suggestion: "\u66F4\u65B0\u6216\u5408\u5E76\u5DF2\u6709\u9636\u6BB5\uFF0C\u4E0D\u8981\u521B\u5EFA\u6267\u884C\u788E\u7247" });
    const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true).length;
    if (activeNodes + nodeCreates.length >= MAX_ACTIVE_NODES && nodeCreates.length) throw mapError("AGENT_ACTIVE_NODE_LIMIT", 422, "\u6D3B\u8DC3\u8282\u70B9\u5C06\u8FBE\u5230 30 \u4E2A\uFF0CAgent \u5FC5\u987B\u5148\u6574\u7406\u3001\u5408\u5E76\u6216\u5F52\u6863", { maxActiveNodes: MAX_ACTIVE_NODES, suggestion: "\u8BF7\u8BA9\u4EBA\u9009\u62E9\u6574\u7406\u8DEF\u7EBF" });
    if (agentInitialMap && activeNodes + nodeCreates.length > MAX_INITIAL_MAP_NODES) throw mapError("AGENT_INITIAL_MAP_LIMIT", 422, "\u9996\u6B21\u521D\u59CB\u5316\u5730\u56FE\u6700\u591A\u4FDD\u7559 15 \u4E2A\u6D3B\u8DC3\u8282\u70B9\uFF0C\u8BF7\u538B\u7F29\u4E3A\u76EE\u6807\u3001\u9636\u6BB5\u3001\u8DEF\u7EBF\u548C\u5F85\u5224\u65AD\u4E8B\u9879", { maxInitialNodes: MAX_INITIAL_MAP_NODES, suggestion: "\u4E0D\u8981\u6309\u6587\u4EF6\u3001\u76EE\u5F55\u3001\u51FD\u6570\u6216\u804A\u5929\u8F6E\u6B21\u5EFA\u8282\u70B9" });
  }
  const revision = document.revision + 1;
  const now = utcNow(options.now);
  let next = clone(document);
  if (agentInitialMap && !isObject(next.ui.initialization)) next.ui.initialization = { status: "in_progress", startedBy: envelope2.actor, startedAt: now };
  for (const command2 of envelope2.commands) applyOne(next, command2, envelope2.actor, revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const validation = validateMapDocument(next);
  if (!validation.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", validation.errors);
  return next;
}
function commandTouches(command2) {
  if (command2.op === "create" || command2.op === "delete") return [`${command2.collection}/${command2.op === "create" ? String(command2.value.id ?? "*") : command2.id}/*`];
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
  const active = all.filter(({ item, kind }) => options.includeHistory || !(item.archived === true || item.shelved === true) && !(kind === "edges" && document.routes.some((route) => route.id === item.route && route.archived === true)));
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
    if (kind === "nodes" && isObject(item.milestone) && item.milestone.status === "pending") {
      score += 500;
      reasons.push("\u91CC\u7A0B\u7891\u5F85\u5BA1\u6838");
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
      ranked.push({ kind, id, score, reasons, source: typeof item.source === "string" ? item.source : typeof item.createdBy === "string" ? item.createdBy : kind, relationPath, value: clone(item) });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const markdownScores = bm25(terms, options.markdown ?? []);
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
  const failedContexts = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && edge.status === "failed").map((edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const sourceRouteId = routeForNode(sourceNodeId) ?? resolveRouteId(edge, sourceNodeId);
    const terms = tokenize(String(edge.name ?? ""));
    return { edge, sourceNodeId, sourceRouteId, terms, key: `${sourceNodeId ?? ""}:${normalizeName(edge.name)}` };
  });
  const requestedSource = typeof currentNodeId === "string" && currentNodeId ? currentNodeId : null;
  const requestedRoute = routeForNode(requestedSource);
  const relevantFailures = failedContexts.filter((failure) => !requestedSource || failure.sourceNodeId === requestedSource || failure.sourceNodeId === null && failure.sourceRouteId === requestedRoute);
  const sourceIds = /* @__PURE__ */ new Set([...requestedSource ? [requestedSource] : [], ...relevantFailures.flatMap((failure) => failure.sourceNodeId ? [failure.sourceNodeId] : [])]);
  const sourceRouteIds = /* @__PURE__ */ new Set([...requestedRoute ? [requestedRoute] : [], ...relevantFailures.flatMap((failure) => failure.sourceRouteId ? [failure.sourceRouteId] : [])]);
  const failedTerms = new Set(relevantFailures.flatMap((failure) => failure.terms));
  const failedKeys = new Set(relevantFailures.map((failure) => failure.key));
  const active = document.edges.filter((edge) => {
    if (edge.archived === true || edge.shelved === true || !["pending", "success"].includes(String(edge.status))) return false;
    const edgeRouteId = typeof edge.route === "string" ? edge.route : null;
    if (edgeRouteId && routeById.get(edgeRouteId)?.archived === true) return false;
    return true;
  });
  const rank = (edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const candidateRouteId = resolveRouteId(edge, sourceNodeId);
    const terms = tokenize(String(edge.name ?? ""));
    const overlap = terms.filter((term) => failedTerms.has(term)).length;
    const sameSource = Boolean(sourceNodeId && sourceIds.has(sourceNodeId));
    const matchingFailure = relevantFailures.map((failure) => ({ failure, overlap: terms.filter((term) => failure.terms.includes(term)).length })).sort((a, b) => Number(b.failure.sourceNodeId === sourceNodeId) - Number(a.failure.sourceNodeId === sourceNodeId) || b.overlap - a.overlap || String(a.failure.edge.id).localeCompare(String(b.failure.edge.id)))[0]?.failure;
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
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeById = new Map(activeRoutes.map((route) => [String(route.id), route]));
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || !document.routes.some((route) => route.id === edge.route && route.archived === true)));
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
  const humanUpdates = document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(String(ann.attention))).sort((a, b) => (String(a.attention) === "new" ? -1 : 1) - (String(b.attention) === "new" ? -1 : 1) || updatedTime(b) - updatedTime(a)).slice(0, 6).map((ann) => ({ id: String(ann.id), text: String(ann.text ?? ""), attention: String(ann.attention), priority: String(ann.priority ?? "normal"), target: clone(ann.target) }));
  const problems = activeNodes.filter((node) => normalizeNodeKind(node.kind ?? node.type) === "problem" && node.resolved !== true).sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 12).map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), kind: "problem", resolved: false, routeId: typeof node.route === "string" ? node.route : null, updatedAt: String(node.updatedAt ?? "") }));
  const milestones = activeNodes.filter((node) => isObject(node.milestone) && ["pending", "changes_requested"].includes(String(node.milestone.status))).sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6).map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), status: String(node.milestone.status), origin: String(node.milestone.origin ?? "unknown"), routeId: typeof node.route === "string" ? node.route : null }));
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
  if (document.anns.some((ann) => ann.attention === "new" || ann.attention === "delivered")) reasons.push("\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u7684\u4EBA\u7C7B\u6807\u6CE8");
  if (document.nodes.some((node) => isObject(node.milestone) && node.milestone.status === "pending")) reasons.push("\u5B58\u5728\u5F85\u5BA1\u6838\u91CC\u7A0B\u7891");
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
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true).length;
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
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && !document.routes.some((route) => route.id === edge.route && (route.archived === true || route.shelved === true)));
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
    if (command2.op !== "update" || command2.patch.archived !== true) continue;
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
  const routes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeIds = new Set(routes.map((route) => String(route.id)));
  const nodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const edges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || routeIds.has(String(edge.route))));
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
    const owner = [...document.nodes, ...document.edges].find((item) => String(item.md ?? "").replace(/\\/g, "/") === path);
    const objectIds = owner ? [String(owner.id)] : [];
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
var MAP_VERSION, COLLECTIONS, ID, ISO_MS, DANGEROUS_KEYS, MAX_NAME, MAX_ANN, MAX_AGENT_OBJECTS_PER_ENVELOPE, MAX_AGENT_NEW_NODES_PER_ENVELOPE, MAX_AGENT_MILESTONES_PER_ENVELOPE, MAX_ACTIVE_NODES, MAX_INITIAL_MAP_NODES;
var init_shared = __esm({
  "src/shared/index.mjs"() {
    "use strict";
    MAP_VERSION = 2;
    COLLECTIONS = ["routes", "nodes", "edges", "anns"];
    ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
    ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
    MAX_NAME = 80;
    MAX_ANN = 4e3;
    MAX_AGENT_OBJECTS_PER_ENVELOPE = 10;
    MAX_AGENT_NEW_NODES_PER_ENVELOPE = 5;
    MAX_AGENT_MILESTONES_PER_ENVELOPE = 2;
    MAX_ACTIVE_NODES = 30;
    MAX_INITIAL_MAP_NODES = 15;
  }
});

// src/cli/livedot.ts
import { randomUUID as randomUUID5 } from "node:crypto";
import { mkdir as mkdir6, readFile as readFile7, readdir as readdir5, rename as rename5, stat as stat6, writeFile as writeFile4 } from "node:fs/promises";
import { dirname as dirname7, extname as extname2, join as join9, resolve as resolve6 } from "node:path";
import { createInterface } from "node:readline";
import { isSea } from "node:sea";

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
function asBridgeError(error) {
  if (error instanceof BridgeError) return error;
  return new BridgeError("INTERNAL_ERROR", "Local bridge request failed", {
    cause: error
  });
}

// src/bridge/project-store.mjs
import { randomUUID } from "node:crypto";
import { lstat as lstat2, readdir as readdir2, readFile as readFile3, realpath as realpath2, stat as stat2, unlink as unlink2 } from "node:fs/promises";
import { basename, join as join3 } from "node:path";
import { isAbsolute, relative, resolve } from "node:path";

// src/bridge/fs-utils.mjs
import { createHash, randomBytes } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, join } from "node:path";
function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}
function checksum(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
function cloneJson(value) {
  return structuredClone(value);
}
var MAX_JSON_BYTES = 64 * 1024 * 1024;
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function ensureDirectory(path) {
  await mkdir(path, { recursive: true });
}
async function canonicalDirectory(path) {
  return realpath(path);
}
async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}
async function atomicWriteFile(path, data, { mode = 384 } = {}) {
  await ensureDirectory(dirname(path));
  const temporary = join(dirname(path), `.${randomBytes(12).toString("hex")}.tmp`);
  let handle;
  try {
    handle = await open(temporary, "wx", mode);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = void 0;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } catch (error) {
    await handle?.close().catch(() => {
    });
    await unlink(temporary).catch(() => {
    });
    throw error;
  }
}
async function appendDurable(path, line) {
  await ensureDirectory(dirname(path));
  const handle = await open(path, "a", 384);
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
    const [metadata, content] = await Promise.all([stat(path), readFile(path, "utf8")]);
    try {
      const owner = JSON.parse(content);
      if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          return false;
        } catch (error) {
          return error?.code === "ESRCH";
        }
      }
    } catch {
    }
    return Date.now() - metadata.mtimeMs > staleMs;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return true;
  }
}
async function withFileLock(path, operation, { timeoutMs = 5e3, staleMs = 3e4 } = {}) {
  await ensureDirectory(dirname(path));
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(path, "wx", 384);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: (/* @__PURE__ */ new Date()).toISOString() }));
      await handle.sync();
    } catch (error) {
      if (error?.code !== "EEXIST") {
        await handle?.close().catch(() => {
        });
        handle = void 0;
        await unlink(path).catch(() => {
        });
        throw error;
      }
      if (await lockOwnerIsGone(path, staleMs)) {
        await unlink(path).catch((unlinkError) => {
          if (unlinkError?.code !== "ENOENT") throw unlinkError;
        });
        continue;
      }
      if (Date.now() >= deadline) {
        const timeout = new Error("Timed out waiting for the project write lock");
        timeout.code = "LOCK_TIMEOUT";
        throw timeout;
      }
      await new Promise((resolve7) => setTimeout(resolve7, 20));
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close().catch(() => {
    });
    await unlink(path).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}
async function readJson(path, { maxBytes = MAX_JSON_BYTES } = {}) {
  const metadata = await stat(path);
  if (metadata.size > maxBytes) {
    const error = new RangeError(`JSON file exceeds ${maxBytes} bytes`);
    error.code = "FILE_TOO_LARGE";
    error.details = { path, size: metadata.size, limit: maxBytes };
    throw error;
  }
  return JSON.parse(await readFile(path, "utf8"));
}
async function writeJsonAtomic(path, value) {
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}
`);
}
async function quarantineCopy(source, quarantineDirectory, label, content) {
  await ensureDirectory(quarantineDirectory);
  const safeLabel = String(label).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const target = join(
    quarantineDirectory,
    `${(/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-")}-${randomBytes(4).toString("hex")}-${safeLabel}`
  );
  if (content === void 0) await copyFile(source, target);
  else await writeFile(target, content, { mode: 384 });
  return target;
}

// src/bridge/maps.mjs
import { copyFile as copyFile2, cp, lstat, readdir, readFile as readFile2, rename as rename2, rm } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
var DATA_DIRECTORY = ".live-dot-map";
var MAPS_DIRECTORY = "maps";
var ACTIVE_MAP_FILE = "active-map";
var LEGACY_NODES_PREFIX = ".live-dot-map/nodes/";
var LEGACY_ROUTES_PREFIX = ".live-dot-map/routes/";
var MAP_ID = /^[a-z0-9][a-z0-9-_]{0,63}$/;
function isSafeMapId(id) {
  return typeof id === "string" && MAP_ID.test(id);
}
function mapsRoot(projectRoot) {
  return join2(projectRoot, DATA_DIRECTORY, MAPS_DIRECTORY);
}
function mapDirectory(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400, details: { mapId } });
  }
  return join2(mapsRoot(projectRoot), mapId);
}
function mapRelativeDirectory(mapId) {
  return `${DATA_DIRECTORY}/${MAPS_DIRECTORY}/${mapId}`;
}
async function readActiveMap(projectRoot) {
  try {
    const value = (await readFile2(join2(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), "utf8")).trim();
    return isSafeMapId(value) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}
async function resolveActiveMap(projectRoot) {
  return await readActiveMap(projectRoot) ?? "default";
}
async function writeActiveMap(projectRoot, mapId) {
  if (!isSafeMapId(mapId)) {
    throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400, details: { mapId } });
  }
  await atomicWriteFile(join2(projectRoot, DATA_DIRECTORY, ACTIVE_MAP_FILE), `${mapId}
`);
}
function slugifyMapName(name, now = () => /* @__PURE__ */ new Date()) {
  const base = String(name ?? "").toLowerCase().normalize("NFKC").replace(/[^a-z0-9-_]+/g, "-").replace(/-{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "").slice(0, 64);
  const candidate = base.replace(/^[^a-z0-9]+/, "");
  if (candidate && MAP_ID.test(candidate)) return candidate;
  return `map-${now().getTime().toString(36)}`;
}
async function listMapIds(projectRoot) {
  const entries = await readdir(mapsRoot(projectRoot), { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && isSafeMapId(entry.name)).map((entry) => entry.name).sort();
}
async function listMaps(projectRoot) {
  const active = await resolveActiveMap(projectRoot);
  const ids = await listMapIds(projectRoot);
  const maps = [];
  for (const id of ids) {
    const document = await readJson(join2(mapsRoot(projectRoot), id, "map.json")).catch(() => null);
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
  const taken = new Set(await listMapIds(projectRoot));
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  await ensureDirectory(mapDirectory(projectRoot, id));
  return { id, name: displayName };
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
async function rejectSymlink(path) {
  const metadata = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (metadata?.isSymbolicLink()) {
    throw new BridgeError("SYMLINK_ESCAPE", "\u672C\u5730\u6865\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8FC1\u79FB\u9879\u76EE\u6570\u636E", { status: 403, details: { path } });
  }
}
async function migrateLegacyLayout(projectRoot) {
  const dataDirectory = join2(projectRoot, DATA_DIRECTORY);
  const target = mapDirectory(projectRoot, "default");
  const mapDir = mapRelativeDirectory("default");
  for (const path of [
    join2(dataDirectory, "map.json"),
    join2(dataDirectory, "nodes"),
    join2(dataDirectory, "routes"),
    join2(dataDirectory, ".bridge")
  ]) await rejectSymlink(path);
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join2(dataDirectory, ".bridge", "backups", `pre-maps-migration-${stamp}`);
  await ensureDirectory(backupDirectory);
  await copyFile2(join2(dataDirectory, "map.json"), join2(backupDirectory, "map.json"));
  for (const name of ["nodes", "routes"]) {
    const source = join2(dataDirectory, name);
    if (await exists(source)) await cp(source, join2(backupDirectory, name), { recursive: true });
  }
  const legacyWal = join2(dataDirectory, ".bridge", "wal.ndjson");
  if (await exists(legacyWal)) await copyFile2(legacyWal, join2(backupDirectory, "wal.ndjson"));
  const moves = [
    [join2(dataDirectory, "map.json"), join2(target, "map.json")],
    [join2(dataDirectory, "nodes"), join2(target, "nodes")],
    [join2(dataDirectory, "routes"), join2(target, "routes")],
    [join2(dataDirectory, ".bridge", "snapshots"), join2(target, ".bridge", "snapshots")],
    [join2(dataDirectory, ".bridge", "backups"), join2(target, ".bridge", "backups")],
    [join2(dataDirectory, ".bridge", "quarantine"), join2(target, ".bridge", "quarantine")],
    [legacyWal, join2(target, ".bridge", "wal.ndjson.legacy-migrated")]
  ];
  const completed = [];
  try {
    await ensureDirectory(join2(target, ".bridge"));
    for (const [source, destination] of moves) {
      if (!await exists(source)) continue;
      await ensureDirectory(dirname2(destination));
      await rename2(source, destination);
      completed.push([destination, source]);
    }
    const document = await readJson(join2(target, "map.json"));
    rewriteMarkdownPaths(document, mapDir);
    await writeJsonAtomic(join2(target, "map.json"), document);
    await writeActiveMap(projectRoot, "default");
  } catch (error) {
    for (const [destination, source] of completed.reverse()) {
      await rename2(destination, source).catch(() => void 0);
    }
    await rm(join2(dataDirectory, ACTIVE_MAP_FILE), { force: true }).catch(() => void 0);
    await rm(mapsRoot(projectRoot), { recursive: true, force: true }).catch(() => void 0);
    throw new BridgeError("MAPS_MIGRATION_FAILED", `\u591A\u5730\u56FE\u8FC1\u79FB\u5931\u8D25\uFF0C\u5DF2\u56DE\u6EDA\uFF1B\u5B8C\u6574\u5907\u4EFD\u5728 ${backupDirectory}`, {
      status: 500,
      cause: error,
      details: { backupDirectory, causeMessage: String(error?.message || error) }
    });
  }
  return { backupDirectory };
}
async function ensureMapsLayout(projectRoot) {
  const dataDirectory = join2(projectRoot, DATA_DIRECTORY);
  await ensureDirectory(dataDirectory);
  const existing = await listMapIds(projectRoot);
  if (existing.length) {
    const active = await readActiveMap(projectRoot);
    if (!active || !existing.includes(active)) {
      const fallback = existing.includes("default") ? "default" : existing[0];
      await writeActiveMap(projectRoot, fallback);
      return { migrated: false, activeMap: fallback };
    }
    return { migrated: false, activeMap: active };
  }
  if (await exists(join2(dataDirectory, "map.json"))) {
    await migrateLegacyLayout(projectRoot);
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
    this.dataDirectory = dataDirectory ?? join3(projectRoot, MAP_DIRECTORY);
    this.mapPath = join3(this.dataDirectory, "map.json");
    this.bridgeDirectory = join3(this.dataDirectory, BRIDGE_DIRECTORY);
    this.walPath = join3(this.bridgeDirectory, "wal.ndjson");
    this.lockPath = join3(this.bridgeDirectory, "write.lock");
    this.snapshotDirectory = join3(this.bridgeDirectory, "snapshots");
    this.backupDirectory = join3(this.bridgeDirectory, "backups");
    this.quarantineDirectory = join3(this.bridgeDirectory, "quarantine");
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
      metadata = await stat2(this.mapPath);
    } catch {
      return;
    }
    const signature = `${metadata.dev ?? ""}:${metadata.ino ?? ""}:${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
    if (signature === this.#diskSignature) return;
    await this.snapshot();
  }
  async #captureDiskSignature() {
    try {
      const metadata = await stat2(this.mapPath);
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
    const canonicalRoot = await realpath2(this.projectRoot);
    const directories = [this.dataDirectory, this.bridgeDirectory, this.snapshotDirectory, this.backupDirectory, this.quarantineDirectory];
    const files = [this.mapPath, this.walPath, this.lockPath];
    const rejectSymlink2 = async (path) => {
      try {
        if ((await lstat2(path)).isSymbolicLink()) {
          throw new BridgeError("SYMLINK_ESCAPE", "\u672C\u5730\u6865\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BFB\u5199\u9879\u76EE\u6570\u636E", { status: 403, details: { path } });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    };
    for (const path of [...directories, ...files]) await rejectSymlink2(path);
    for (const path of directories) {
      await ensureDirectory(path);
      await rejectSymlink2(path);
      const canonical = await realpath2(path);
      const escaped = relative(canonicalRoot, canonical);
      if (escaped.startsWith("..") || isAbsolute(escaped) || resolve(canonical) === resolve(canonicalRoot)) {
        throw new BridgeError("PATH_ESCAPE", "\u672C\u5730\u6865\u6570\u636E\u76EE\u5F55\u5FC5\u987B\u4F4D\u4E8E\u6CE8\u518C\u9879\u76EE\u5185", { status: 403, details: { path } });
      }
    }
  }
  #createEmptyDocument() {
    return this.shared.createEmptyMap({
      name: this.mapName ?? basename(this.projectRoot),
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
      } catch (error) {
        if (document?.version !== 1 && error instanceof BridgeError && error.details?.readOnly === true) {
          this.readOnly = true;
        } else {
          if (document?.version !== 1 || typeof this.shared.migrateDocument !== "function") throw error;
          await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.v1-before-migration.json");
          document = await this.shared.migrateDocument(document, { now: this.clock().toISOString() });
          await this.#assertValid(document, "MIGRATION_INVALID");
          await writeJsonAtomic(this.mapPath, document);
        }
      }
    } catch (error) {
      if (error?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error.details });
      }
      let raw = "";
      try {
        raw = await readFile3(this.mapPath, "utf8");
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
          if (error instanceof BridgeError) throw error;
          throw new BridgeError("CORRUPT_MAP", "map.json \u65E0\u6CD5\u89E3\u6790\u6216\u6062\u590D\uFF08\u635F\u574F\u6587\u4EF6\u5DF2\u9694\u79BB\uFF0C\u53EF\u624B\u5DE5\u68C0\u67E5\uFF09", {
            status: 409,
            cause: error,
            details: { causeMessage: String(error?.message || error), quarantinePath }
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
    } catch (error) {
      throw new BridgeError(code, "Map document validation threw an error", {
        status: 422,
        details: { validationError: error.message },
        cause: error
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
    const metadata = await stat2(this.walPath);
    if (metadata.size > 128 * 1024 * 1024) {
      throw new BridgeError("WAL_TOO_LARGE", "WAL \u8D85\u8FC7 128 MiB \u5B89\u5168\u4E0A\u9650\uFF0C\u9700\u8981\u4EBA\u5DE5\u6062\u590D", { status: 413, details: { size: metadata.size } });
    }
    const content = await readFile3(this.walPath, "utf8");
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
    } catch (error) {
      if (error?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "\u5916\u90E8 map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error.details });
      }
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.external-corrupt.json").catch(() => void 0);
      if (error instanceof BridgeError) {
        error.details = { ...error.details, quarantinePath };
        throw error;
      }
      throw new BridgeError("CORRUPT_MAP", "External map.json change is not valid JSON", {
        status: 409,
        details: { quarantinePath },
        cause: error
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
    const locked = () => withFileLock(this.lockPath, operation).catch((error) => {
      if (error?.code === "LOCK_TIMEOUT") {
        throw new BridgeError("PROJECT_BUSY", "Another local bridge process is writing this project", {
          status: 503,
          cause: error
        });
      }
      throw error;
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
    } catch (error) {
      if (error?.code === "FILE_TOO_LARGE") {
        throw new BridgeError("MAP_TOO_LARGE", "map.json \u8D85\u8FC7 64 MiB \u5B89\u5168\u4E0A\u9650", { status: 413, details: error.details });
      }
      let raw = "";
      try {
        raw = await readFile3(this.mapPath, "utf8");
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
        if (error instanceof BridgeError) {
          error.details = { ...error.details, quarantinePath };
          throw error;
        }
        throw new BridgeError("CORRUPT_MAP", "map.json is not valid JSON", {
          status: 409,
          details: { quarantinePath },
          cause: error
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
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError(error?.code || "COMMAND_REJECTED", error?.message || "Command was rejected", {
          status: error?.status || 422,
          details: error?.details,
          cause: error
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
    const path = join3(this.snapshotDirectory, `rev-${String(this.revision).padStart(12, "0")}-${timestampName(this.clock())}.json`);
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
    const entries = (await readdir2(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
    await Promise.all(entries.slice(0, Math.max(0, entries.length - keep)).map((name) => unlink2(join3(directory, name))));
  }
  async #ensureDailyBackup() {
    const day = this.clock().toISOString().slice(0, 10);
    const path = join3(this.backupDirectory, `${day}.json`);
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
      const entries = (await readdir2(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
      const selected = name === void 0 ? entries.at(-1) : basename(name);
      if (!selected || !entries.includes(selected) || selected !== (name === void 0 ? selected : name)) {
        throw new BridgeError("RECOVERY_IMAGE_NOT_FOUND", "Requested recovery image was not found", {
          status: 404,
          details: { source, name }
        });
      }
      const envelope2 = await readJson(join3(directory, selected));
      await this.#assertValid(envelope2.document, "INVALID_RECOVERY_IMAGE");
      if (checksum(envelope2.document) !== envelope2.checksum) {
        throw new BridgeError("RECOVERY_CHECKSUM_MISMATCH", "Recovery image checksum does not match", { status: 409 });
      }
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.before-recovery.json");
      const revision = this.revision + 1;
      const commandId = `recover:${randomUUID()}`;
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
import { randomBytes as randomBytes2, randomUUID as randomUUID4, createHash as createHash5, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { access as access2, mkdir as mkdir5, readFile as readFile6, readdir as readdir4, rename as rename4, rm as rm4, stat as stat5, writeFile as writeFile3 } from "node:fs/promises";
import { dirname as dirname6, extname, join as join8, resolve as resolve5 } from "node:path";
import { spawn as spawn2 } from "node:child_process";
import { homedir as homedir4 } from "node:os";

// src/bridge/logger.mjs
import { appendFile, mkdir as mkdir2, readdir as readdir3, rm as rm2 } from "node:fs/promises";
import { join as join4 } from "node:path";
import { homedir } from "node:os";
var KEEP_DAYS = 14;
var MAX_STRING = 1e3;
function logDirectory() {
  return process.env.LIVEDOT_LOG_DIR || join4(homedir(), ".live-dot-map", "logs");
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
    await mkdir2(root, { recursive: true });
    const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1e3;
    const entries = await readdir3(root).catch(() => []);
    for (const entry of entries) {
      const match = /^livedot-(\d{4}-\d{2}-\d{2})\.log$/.exec(entry);
      if (match && Date.parse(`${match[1]}T00:00:00Z`) < cutoff) {
        await rm2(join4(root, entry), { force: true }).catch(() => void 0);
      }
    }
  }
  function write(level, event, fields = {}, entrySource = source) {
    const at = clock();
    const entry = { at: at.toISOString(), level, source: entrySource, event: String(event).slice(0, 120), ...clean(fields) };
    const file = join4(root, `livedot-${at.toISOString().slice(0, 10)}.log`);
    chain = chain.then(async () => {
      if (!prepared) {
        prepared = true;
        await prepare();
      }
      await appendFile(file, `${JSON.stringify(entry)}
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
import { createHash as createHash2 } from "node:crypto";
import { spawn } from "node:child_process";
import {
  lstat as lstat3,
  mkdir as mkdir3,
  readFile as readFile4,
  realpath as realpath3,
  stat as stat3
} from "node:fs/promises";
import { dirname as dirname3, isAbsolute as isAbsolute2, join as join5, relative as relative2, resolve as resolve2, sep } from "node:path";
var MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
var MAX_MARKDOWN_PATH = 1024;
function inRoot(root, candidate) {
  const value = relative2(root, candidate);
  return value === "" || value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute2(value);
}
function normalizeRelativePath(input) {
  if (typeof input !== "string" || input.length === 0 || input.length > MAX_MARKDOWN_PATH) {
    throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u65E0\u6548", { status: 400 });
  }
  if (input.includes("\0")) throw new BridgeError("MARKDOWN_PATH_INVALID", "Markdown \u8DEF\u5F84\u5305\u542B\u975E\u6CD5\u5B57\u7B26", { status: 400 });
  const portable = input.replace(/\\/g, "/");
  if (portable.startsWith("/") || /^[A-Za-z]:\//.test(portable) || isAbsolute2(input)) {
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
  const rootReal = await realpath3(root);
  if (!inRoot(rootReal, candidate)) {
    throw new BridgeError("MARKDOWN_PATH_OUTSIDE_PROJECT", "Markdown \u8DEF\u5F84\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u5185", { status: 403 });
  }
  let cursor = candidate;
  let candidateStat;
  try {
    candidateStat = await lstat3(candidate);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (candidateStat?.isSymbolicLink()) {
    throw new BridgeError("MARKDOWN_SYMLINK_FORBIDDEN", "\u4E0D\u5141\u8BB8\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BBF\u95EE Markdown", { status: 403 });
  }
  if (candidateStat && !candidateStat.isFile()) {
    throw new BridgeError("MARKDOWN_NOT_FILE", "Markdown \u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6", { status: 409 });
  }
  while (cursor !== rootReal && cursor !== dirname3(cursor)) {
    try {
      const info = await lstat3(cursor);
      if (info.isSymbolicLink()) throw new BridgeError("MARKDOWN_SYMLINK_FORBIDDEN", "\u4E0D\u5141\u8BB8\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BBF\u95EE Markdown", { status: 403 });
      const resolved = await realpath3(cursor);
      if (!inRoot(rootReal, resolved)) throw new BridgeError("MARKDOWN_PATH_OUTSIDE_PROJECT", "Markdown \u8DEF\u5F84\u4E0D\u5728\u5F53\u524D\u9879\u76EE\u5185", { status: 403 });
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!allowMissing) throw new BridgeError("MARKDOWN_NOT_FOUND", "Markdown \u6587\u4EF6\u4E0D\u5B58\u5728", { status: 404 });
      cursor = dirname3(cursor);
    }
  }
  return { root: rootReal, stat: candidateStat };
}
function digest(content) {
  return createHash2("sha256").update(content, "utf8").digest("hex");
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
    this.projectRoot = resolve2(projectRoot);
  }
  async #target(requestedPath, options = {}) {
    const path = normalizeRelativePath(requestedPath);
    const candidate = resolve2(this.projectRoot, path);
    await ensureNoSymlink(this.projectRoot, candidate, options);
    return { path, candidate };
  }
  #lockPath(path) {
    const lockId = createHash2("sha256").update(path, "utf8").digest("hex");
    return join5(this.projectRoot, ".live-dot-map", ".bridge", "markdown-locks", `${lockId}.lock`);
  }
  async #readUnlocked(requestedPath, { create = false, title = "" } = {}) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    let metadata;
    try {
      metadata = await stat3(candidate);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      if (!create) return { path, content: "", exists: false, created: false, size: 0, etag: digest(""), updatedAt: null };
      const initial = initialMarkdown(path, title);
      if (Buffer.byteLength(initial, "utf8") > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413 });
      await mkdir3(dirname3(candidate), { recursive: true });
      await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
      try {
        await atomicWriteFile(candidate, initial);
      } catch (writeError) {
        throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u521B\u5EFA\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: writeError });
      }
      metadata = await stat3(candidate);
      return result(path, initial, metadata, { created: true });
    }
    if (create && metadata.size === 0) {
      const initial = initialMarkdown(path, title);
      await atomicWriteFile(candidate, initial).catch((error) => {
        throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error });
      });
      metadata = await stat3(candidate);
      return result(path, initial, metadata, { created: true });
    }
    if (metadata.size > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u6587\u4EF6\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413, details: { size: metadata.size, limit: MAX_MARKDOWN_BYTES } });
    let content;
    try {
      content = await readFile4(candidate, "utf8");
    } catch (error) {
      throw new BridgeError("MARKDOWN_READ_FAILED", "Markdown \u8BFB\u53D6\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error });
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
      await ensureDirectory(dirname3(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, () => this.#readUnlocked(path, options), { timeoutMs: 5e3, staleMs: 3e4 });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error?.code === "LOCK_TIMEOUT") throw new BridgeError("MARKDOWN_BUSY", "Markdown \u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", { status: 409, cause: error });
      throw new BridgeError("MARKDOWN_READ_FAILED", "Markdown \u521D\u59CB\u5316\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error });
    }
  }
  async write(requestedPath, content, { baseEtag } = {}) {
    if (typeof content !== "string") throw new BridgeError("MARKDOWN_CONTENT_REQUIRED", "Markdown \u5185\u5BB9\u5FC5\u987B\u662F\u6587\u672C", { status: 400 });
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > MAX_MARKDOWN_BYTES) throw new BridgeError("MARKDOWN_TOO_LARGE", "Markdown \u5185\u5BB9\u8D85\u8FC7 2 MiB \u9650\u5236", { status: 413, details: { size: bytes, limit: MAX_MARKDOWN_BYTES } });
    const path = normalizeRelativePath(requestedPath);
    const lockPath = this.#lockPath(path);
    try {
      await ensureDirectory(dirname3(lockPath));
      await ensureNoSymlink(this.projectRoot, lockPath, { allowMissing: true });
      return await withFileLock(lockPath, async () => {
        const { candidate } = await this.#target(path, { allowMissing: true });
        let current;
        try {
          current = await this.read(path);
        } catch (error) {
          if (error?.code !== "MARKDOWN_NOT_FOUND") throw error;
          current = { path, content: "", exists: false, created: false, size: 0, etag: digest(""), updatedAt: null };
        }
        if (baseEtag !== void 0 && String(baseEtag) !== String(current?.etag ?? digest(""))) {
          throw new BridgeError("MARKDOWN_CONFLICT", "Markdown \u5DF2\u88AB\u5176\u4ED6\u7A97\u53E3\u6216 Agent \u4FEE\u6539", {
            status: 409,
            details: current ? { current: { path: current.path, content: current.content, size: current.size, etag: current.etag, updatedAt: current.updatedAt } } : { current: null }
          });
        }
        await mkdir3(dirname3(candidate), { recursive: true });
        await ensureNoSymlink(this.projectRoot, candidate, { allowMissing: true });
        await atomicWriteFile(candidate, content);
        const metadata = await stat3(candidate);
        return result(path, content, metadata);
      }, { timeoutMs: 5e3, staleMs: 3e4 });
    } catch (error) {
      if (error instanceof BridgeError) throw error;
      if (error?.code === "LOCK_TIMEOUT") throw new BridgeError("MARKDOWN_BUSY", "Markdown \u6B63\u5728\u88AB\u5176\u4ED6\u5199\u5165\u5360\u7528\uFF0C\u8BF7\u91CD\u8BD5", { status: 409, cause: error });
      throw new BridgeError("MARKDOWN_WRITE_FAILED", "Markdown \u4FDD\u5B58\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5", { status: 503, cause: error });
    }
  }
  async reveal(requestedPath, { open: open2 = false } = {}) {
    const { path, candidate } = await this.#target(requestedPath, { allowMissing: true });
    const exists3 = await stat3(candidate).then(() => true).catch((error) => error?.code === "ENOENT" ? false : Promise.reject(error));
    let opened = false;
    if (open2) {
      const target = exists3 ? candidate : dirname3(candidate);
      try {
        const child = process.platform === "win32" ? spawn("explorer.exe", ["/select,", target], { detached: true, stdio: "ignore" }) : process.platform === "darwin" ? spawn("open", ["-R", target], { detached: true, stdio: "ignore" }) : spawn("xdg-open", [dirname3(target)], { detached: true, stdio: "ignore" });
        child.once("error", () => {
        });
        child.unref();
        opened = true;
      } catch {
        opened = false;
      }
    }
    return { path, exists: exists3, opened };
  }
};

// src/bridge/shared-adapter.mjs
var REQUIRED_EXPORTS = ["validateMapDocument", "applyMapCommand", "applyCommandEnvelope", "envelopeTouches", "createEmptyMap", "migrateMapV1", "retrieveContext", "checkAttemptEvidence", "buildProjectProjection", "findExplorationAlternatives", "autonomyDecision", "planConsolidation"];
async function loadSharedAdapter() {
  let shared;
  try {
    shared = await Promise.resolve().then(() => (init_shared(), shared_exports));
  } catch (error) {
    throw new BridgeError(
      "SHARED_MODULE_UNAVAILABLE",
      "src/shared/index.mjs is not available; inject a shared adapter while testing",
      { details: { requiredExports: REQUIRED_EXPORTS }, cause: error }
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
import { createHash as createHash4, randomUUID as randomUUID3 } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile as copyFile3, mkdir as mkdir4, readFile as readFile5, rename as rename3, rm as rm3, stat as stat4, writeFile as writeFile2 } from "node:fs/promises";
import { constants } from "node:fs";
import { basename as basename2, dirname as dirname5, join as join7, resolve as resolve4 } from "node:path";
import { homedir as homedir3 } from "node:os";
import { fileURLToPath } from "node:url";

// agent-kit/lib/bridge-client.mjs
import { createHash as createHash3, randomUUID as randomUUID2 } from "node:crypto";
var MCP_TOOL_NAMES = Object.freeze([
  "map_get_context",
  "map_list_human_updates",
  "map_ack_human_updates",
  "map_next_candidates",
  "map_apply_commands",
  "map_validate",
  "map_checkpoint",
  "map_plan_consolidation"
]);
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
  } catch (error) {
    throw new BridgeClientError("INVALID_BRIDGE_URL", "\u672C\u5730\u6865\u5730\u5740\u4E0D\u662F\u6709\u6548 URL", { status: 400, cause: error });
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
  const digest2 = createHash3("sha256").update(String(projectRoot)).digest("hex").slice(0, 32);
  return `project:${digest2}`;
}

// agent-kit/lib/shortcut.mjs
import { execFileSync } from "node:child_process";
import { homedir as homedir2 } from "node:os";
import { dirname as dirname4, join as join6, resolve as resolve3 } from "node:path";
function windowsDesktopDirectory({ platform = process.platform, env = process.env, exec = execFileSync } = {}) {
  if (platform !== "win32") return join6(homedir2(), "Desktop");
  try {
    const output = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8", timeout: 5e3 });
    const path = String(output || "").trim();
    if (path) return path;
  } catch {
  }
  return join6(env.USERPROFILE || homedir2(), "Desktop");
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
      md: ".live-dot-map/nodes/n1.md",
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
var skillTargetPaths = (home, id) => id === "codex" ? join7(home, ".codex", "skills", "live-dot-map", "SKILL.md") : id === "claude-code" ? join7(home, ".claude", "skills", "live-dot-map", "SKILL.md") : id === "kimi-code" ? join7(home, ".kimi-code", "plugins", "live-dot-map", "skills", "live-dot-map", "SKILL.md") : join7(home, ".codebuddy", "plugins", "live-dot-map", "skills", "live-dot-map", "SKILL.md");
var kimiPluginRoot = (home) => join7(home, ".kimi-code", "plugins", "live-dot-map");
var codebuddyPluginRoot = (home) => join7(home, ".codebuddy", "plugins", "live-dot-map");
var ADAPTER_PROBES = Object.freeze({
  codex: ["codex"],
  "claude-code": ["claude", "claude-code"],
  "kimi-code": ["kimi", "kimi-code"],
  codebuddy: ["codebuddy", "codebuddy-code", "workbuddy"]
});
async function exists2(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
async function atomicText(path, text) {
  await mkdir4(dirname5(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID3()}`;
  await writeFile2(temp, text, { encoding: "utf8", flag: "wx" });
  await rename3(temp, path);
}
async function atomicJson(path, value) {
  await atomicText(path, `${JSON.stringify(value, null, 2)}
`);
}
async function readJson2(path, fallback = {}) {
  try {
    const value = JSON.parse(await readFile5(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function sha256(bytes) {
  return createHash4("sha256").update(bytes).digest("hex");
}
async function captureFile(path) {
  try {
    const metadata = await stat4(path);
    if (metadata.isDirectory()) return { path, exists: true, kind: "directory", sha256: null, content: null };
    const bytes = await readFile5(path);
    return { path, exists: true, kind: "file", sha256: sha256(bytes), content: bytes.toString("base64") };
  } catch {
    return { path, exists: false, kind: "missing", sha256: null, content: null };
  }
}
async function restoreCapturedFile(entry) {
  if (entry?.kind === "directory") return;
  if (entry?.exists) {
    await mkdir4(dirname5(entry.path), { recursive: true });
    await writeFile2(entry.path, Buffer.from(String(entry.content || ""), "base64"));
  } else {
    await rm3(entry.path, { force: true }).catch(() => void 0);
  }
}
var adapterConfigPaths = (home, id) => id === "codex" ? [join7(home, ".codex", "config.toml"), join7(home, ".codex", "hooks.json")] : id === "claude-code" ? [join7(home, ".claude", "settings.json")] : id === "kimi-code" ? [join7(home, ".kimi-code", "mcp.json"), join7(kimiPluginRoot(home), "kimi.plugin.json")] : [join7(home, ".codebuddy", "settings.json"), join7(codebuddyPluginRoot(home), ".codebuddy-plugin", "plugin.json"), join7(codebuddyPluginRoot(home), ".workbuddy-plugin", "plugin.json"), join7(codebuddyPluginRoot(home), "hooks", "hooks.json")];
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
  return new Promise((resolve7) => {
    execFile(file, args, { windowsHide: true, timeout: 4e3 }, (error, stdout = "") => {
      resolve7(!error && String(stdout).trim().length > 0);
    });
  });
}
function execText(file, args = [], timeout = 2500) {
  return new Promise((resolve7) => {
    execFile(file, args, { windowsHide: true, timeout, encoding: "utf8" }, (error, stdout = "") => {
      resolve7(error ? "" : String(stdout));
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
    const installRoot = dirname5(iconPath);
    const candidate = join7(installRoot, "resources", "app.asar.unpacked", "cli", "bin", "codebuddy");
    if (await exists2(candidate)) return candidate;
  }
  return null;
}
async function detectInstalledAdapters({ projectRoot = process.cwd(), platform = process.platform, homeRoot = homedir3() } = {}) {
  const root = resolve4(projectRoot);
  const home = resolve4(homeRoot);
  const checks = await Promise.all(ALL_ADAPTERS.map(async (id) => {
    const configPaths = adapterConfigPaths(home, id);
    const configured = (await Promise.all(configPaths.map(async (path) => {
      const text = await readFile5(path, "utf8").catch(() => "");
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
function mergeHooks(existing, additions) {
  const hooks = { ...existing?.hooks || {} };
  for (const [event, groups] of Object.entries(additions)) {
    const prior = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = prior.filter((group) => {
      const serialized = JSON.stringify(group);
      return !serialized.includes("livedot.mjs") && !serialized.includes("hook.cmd");
    });
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
  const path = join7(home, ".codex", "config.toml");
  const begin = "# BEGIN LIVE-DOT-MAP";
  const end = "# END LIVE-DOT-MAP";
  const old = await readFile5(path, "utf8").catch(() => "");
  const stripped = old.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\s*`, "g"), "").trimEnd();
  const block = [begin, '[mcp_servers."livedot-map"]', `command = ${tomlString(nodeCommand)}`, `args = [${[...runtimeArgs(runtime), "mcp", "--agent", "codex"].map(tomlString).join(", ")}]`, "required = true", end].join("\n");
  await atomicText(path, `${stripped ? `${stripped}

` : ""}${block}
`);
  const hooksPath = join7(home, ".codex", "hooks.json");
  await atomicJson(hooksPath, mergeHooks(await readJson2(hooksPath), hooksFor(nodeCommand, runtime, "codex")));
  return [path, hooksPath];
}
async function writeClaudeConfig(home, nodeCommand, runtime) {
  const settingsPath = join7(home, ".claude", "settings.json");
  const settings = await readJson2(settingsPath);
  const mcp = { mcpServers: settings.mcpServers && typeof settings.mcpServers === "object" ? settings.mcpServers : {} };
  const key = mcpServerKey(mcp, "claude");
  mcp.mcpServers = { ...mcp.mcpServers || {}, [key]: { type: "stdio", command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "claude"] } };
  settings.mcpServers = mcp.mcpServers;
  await atomicJson(settingsPath, mergeHooks(settings, hooksFor(nodeCommand, runtime, "claude")));
  return [settingsPath];
}
async function writeKimiConfig(home, nodeCommand, runtime) {
  const mcpPath = join7(home, ".kimi-code", "mcp.json");
  const mcp = await readJson2(mcpPath);
  mcp.mcpServers = { ...mcp.mcpServers || {}, "livedot-map": { command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--agent", "kimi"] } };
  await atomicJson(mcpPath, mcp);
  const plugin = kimiPluginRoot(home);
  const pluginRuntime = join7(plugin, "runtime", "livedot.mjs");
  await mkdir4(dirname5(pluginRuntime), { recursive: true });
  if (!seaRuntime()) await copyFile3(runtime, pluginRuntime);
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
  await atomicJson(join7(plugin, "kimi.plugin.json"), manifest);
  return [mcpPath, join7(plugin, "kimi.plugin.json")];
}
async function writeCodeBuddyConfig(home, nodeCommand, runtime) {
  const settingsPath = join7(home, ".codebuddy", "settings.json");
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
  await atomicJson(join7(plugin, ".codebuddy-plugin", "plugin.json"), manifest);
  await atomicJson(join7(plugin, ".workbuddy-plugin", "plugin.json"), manifest);
  await atomicJson(join7(plugin, "hooks", "hooks.json"), { hooks: hooksFor(nodeCommand, runtime, "codebuddy") });
  return [settingsPath, join7(plugin, ".codebuddy-plugin", "plugin.json"), join7(plugin, ".workbuddy-plugin", "plugin.json"), join7(plugin, "hooks", "hooks.json")];
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
  homeRoot = homedir3()
} = {}) {
  const root = resolve4(projectRoot);
  const home = resolve4(homeRoot);
  if (!await exists2(root)) throw new Error(`\u9879\u76EE\u76EE\u5F55\u4E0D\u5B58\u5728: ${root}`);
  const source = resolve4(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : sourceRoot || process.cwd());
  const sourceRuntime = resolve4(runtimeSource || resolve4(source, "livedot.mjs"));
  const canonicalCandidates = [resolve4(source, "skills", "live-dot-map", "SKILL.md"), resolve4(source, "agent-kit", "skills", "live-dot-map", "SKILL.md")];
  let canonicalSkill = null;
  for (const candidate of canonicalCandidates) if (await exists2(candidate)) {
    canonicalSkill = candidate;
    break;
  }
  if (!canonicalSkill || !await exists2(canonicalSkill)) throw new Error(`\u7F3A\u5C11 canonical Skill: ${canonicalCandidates[0]}`);
  if (!seaRuntime() && !await exists2(sourceRuntime)) throw new Error(`\u7F3A\u5C11\u5DF2\u6784\u5EFA\u8FD0\u884C\u65F6: ${sourceRuntime}`);
  const dataDir = join7(root, ".live-dot-map");
  const globalDataDir = join7(home, ".live-dot-map");
  const runtime = seaRuntime() ? null : join7(globalDataDir, "livedot.mjs");
  await mkdir4(dataDir, { recursive: true });
  const projectId = projectIdForRoot(root);
  const mapPath = join7(dataDir, "map.json");
  const configPath = join7(dataDir, "agent-kit.json");
  const old = await readJson2(configPath);
  const url = bridgeUrl || old?.bridge?.url || "http://127.0.0.1:0";
  assertLoopbackUrl(url);
  const nodeCommand = process.execPath;
  const detected = detectedAgents && typeof detectedAgents === "object" ? detectedAgents : discoverAgents ? await detectInstalledAdapters({ projectRoot: root, platform, homeRoot: home }) : Object.fromEntries(ALL_ADAPTERS.map((id) => [id, { id, configured: false, executable: false, discovered: true }]));
  const installed = {};
  for (const id of ALL_ADAPTERS) if (detected[id]?.discovered) installed[id] = true;
  const backupPath = join7(globalDataDir, "backups", `agent-kit-install-${projectId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  const beforeBackup = await captureFile(backupPath);
  const oldRuntime = runtime ? await captureFile(runtime) : { exists: false, kind: "missing", path: null };
  const oldMap = await captureFile(mapPath);
  const mapsLayoutExists = await exists2(join7(dataDir, "maps"));
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
    if (!oldMap.exists) await rm3(mapPath, { force: true }).catch(() => void 0);
    if (createdMapsLayout) {
      await rm3(join7(dataDir, "maps"), { recursive: true, force: true }).catch(() => void 0);
      await rm3(join7(dataDir, "active-map"), { force: true }).catch(() => void 0);
    }
    if (runtime && !oldRuntime.exists) await rm3(runtime, { force: true }).catch(() => void 0);
  };
  try {
    await atomicJson(backupPath, backup);
    if (runtime && resolve4(sourceRuntime) !== resolve4(runtime)) {
      await mkdir4(globalDataDir, { recursive: true });
      await copyFile3(sourceRuntime, runtime);
    }
    for (const id of Object.keys(installed)) {
      const target = skillTargetPaths(home, id);
      await mkdir4(dirname5(target), { recursive: true });
      await copyFile3(canonicalSkill, target);
    }
    if (!oldMap.exists && !mapsLayoutExists) {
      const map = structuredClone(map_template_default);
      if (map.version !== 2) throw new Error("\u5185\u7F6E map.json \u6A21\u677F\u4E0D\u662F v2");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      map.mapId = projectId;
      map.name = basename2(root);
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
      await atomicJson(join7(dataDir, "maps", "default", "map.json"), map);
      await atomicText(join7(dataDir, "active-map"), "default\n");
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
  } catch (error) {
    await rollback();
    throw error;
  }
}
async function uninstallProject({ projectRoot = process.cwd(), platform = process.platform, env = process.env, exec } = {}) {
  const root = resolve4(projectRoot);
  const dataDir = join7(root, ".live-dot-map");
  const configPath = join7(dataDir, "agent-kit.json");
  const config = await readJson2(configPath, null);
  if (!config || typeof config !== "object") return { ok: false, reason: "not-installed", projectRoot: root, mapPreserved: await exists2(join7(dataDir, "map.json")) || await exists2(join7(dataDir, "maps")) };
  const backupPath = typeof config.installBackup === "string" ? config.installBackup : join7(dataDir, "backups", "agent-kit-install.json");
  const backup = await readJson2(backupPath, null);
  const installedFiles = config.installedFiles && typeof config.installedFiles === "object" ? config.installedFiles : {};
  const restored = [];
  const skipped = [];
  for (const entry of Array.isArray(backup?.files) ? backup.files : []) {
    if (!entry?.path || entry.path === join7(dataDir, "map.json") || entry.path === backupPath) continue;
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
  const launcherPaths = [join7(dataDir, "\u542F\u52A8\u6D3B\u70B9\u5730\u56FE.cmd"), join7(dataDir, "\u6253\u5F00\u6D3B\u70B9\u5730\u56FE.cmd")];
  if (platform === "win32") {
    const desktop = windowsDesktopDirectory({ platform, env, exec });
    launcherPaths.push(join7(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.lnk"), join7(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.cmd"));
  }
  for (const path of launcherPaths) {
    const current = await captureFile(path);
    if (!current.exists) continue;
    const looksOwned = path.includes(dataDir) || current.content?.includes(Buffer.from("livedot.mjs").toString("base64"));
    if (looksOwned) {
      await rm3(path, { force: true });
      restored.push(path);
    }
  }
  const mapPreserved = await exists2(join7(dataDir, "map.json")) || await exists2(join7(dataDir, "maps"));
  return { ok: skipped.length === 0, projectRoot: root, restored, skipped, mapPreserved, backupPath };
}
async function doctorProject({ projectRoot = process.cwd(), checkBridge = false, bridgeClient, offline = true, homeRoot = homedir3() } = {}) {
  const root = resolve4(projectRoot);
  const home = resolve4(homeRoot);
  const configPath = join7(root, ".live-dot-map", "agent-kit.json");
  const config = await readJson2(configPath, null);
  const installed = config?.installed && typeof config.installed === "object" ? config.installed : {};
  const expected = [
    ["agent-kit-config", configPath]
  ];
  if (config?.runtimeMode !== "sea" && config?.runtime !== null) expected.push(["runtime", join7(home, ".live-dot-map", "livedot.mjs")]);
  if (installed.codex) expected.push(["codex-hooks", join7(home, ".codex", "hooks.json")], ["codex-mcp", join7(home, ".codex", "config.toml")]);
  if (installed["claude-code"]) expected.push(["claude-hooks", join7(home, ".claude", "settings.json")]);
  if (installed["kimi-code"]) expected.push(["kimi-mcp", join7(home, ".kimi-code", "mcp.json")], ["kimi-plugin", join7(kimiPluginRoot(home), "kimi.plugin.json")]);
  if (installed.codebuddy) expected.push(["codebuddy-hooks", join7(home, ".codebuddy", "settings.json")], ["codebuddy-plugin", join7(codebuddyPluginRoot(home), ".codebuddy-plugin", "plugin.json")]);
  const checks = [{ name: "project-root", ok: await exists2(root), detail: root }];
  for (const [name, path] of expected) checks.push({ name, ok: await exists2(path), detail: path });
  checks.push({ name: "map", ok: await exists2(join7(root, ".live-dot-map", "map.json")) || await exists2(join7(root, ".live-dot-map", "maps")), detail: join7(root, ".live-dot-map") });
  const detectedAgents = await detectInstalledAdapters({ projectRoot: root, homeRoot: home });
  checks.push({ name: "agent-discovery", ok: Object.values(detectedAgents).every((item) => !item.discovered || Boolean(installed[item.id])), detail: detectedAgents });
  checks.push({ name: "node", ok: runtimePlan({ offline }).use === "system-node", detail: process.versions.node });
  checks.push({ name: "portable-node-manifest", ok: Boolean(portableManifestFor()), detail: portableManifestFor()?.version || "unavailable" });
  if (checkBridge) {
    try {
      const health = await bridgeClient.health();
      checks.push({ name: "bridge-health", ok: true, detail: health?.status || health });
    } catch (error) {
      checks.push({ name: "bridge-health", ok: false, detail: error?.message });
    }
  }
  return { ok: checks.every((check) => check.ok), projectRoot: root, configPath, checks, runtime: runtimePlan({ offline }) };
}

// src/bridge/server.mjs
var SESSION_COOKIE = "ldm_bridge_session";
var DEFAULT_BODY_LIMIT = 16 * 1024 * 1024;
var DEFAULT_SESSION_TTL = 8 * 60 * 60 * 1e3;
var RECENT_PROJECTS_FILE = () => process.env.LIVEDOT_RECENT_PROJECTS_FILE || join8(homedir4(), ".live-dot-map", "recent-projects.json");
async function recordRecentProject(root) {
  let recent = [];
  try {
    const parsed = JSON.parse(await readFile6(RECENT_PROJECTS_FILE(), "utf8"));
    if (Array.isArray(parsed)) recent = parsed.filter((item) => typeof item === "string");
  } catch {
  }
  recent = [root, ...recent.filter((item) => item !== root)].slice(0, 15);
  await mkdir5(dirname6(RECENT_PROJECTS_FILE()), { recursive: true });
  await writeFile3(RECENT_PROJECTS_FILE(), `${JSON.stringify(recent, null, 2)}
`, "utf8");
}
async function readRecentProjects() {
  try {
    const parsed = JSON.parse(await readFile6(RECENT_PROJECTS_FILE(), "utf8"));
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
  const tmpDir = join8(homedir4(), ".live-dot-map", "tmp");
  await mkdir5(tmpDir, { recursive: true });
  const marker = join8(tmpDir, `pick-${randomUUID4()}.txt`);
  const script = buildPickFolderScript(marker);
  const run = await new Promise((resolveRun, rejectRun) => {
    const child = spawn2("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], { windowsHide: true });
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
    await rm4(marker, { force: true }).catch(() => void 0);
    return { cancelled: true };
  }
  try {
    const text = (await readFile6(marker, "utf8")).trim();
    await rm4(marker, { force: true }).catch(() => void 0);
    if (text) {
      await logger.info("project.pick", { outcome: "ok", mode, path: text, diag });
      return { cancelled: false, path: text };
    }
    await logger.info("project.pick", { outcome: "cancelled", mode, diag });
    return { cancelled: true };
  } catch (error) {
    await logger.warn("project.pick", { outcome: "error", message: String(error?.message || error).slice(0, 400) });
    return { cancelled: true };
  }
}
function randomToken(bytes = 32) {
  return randomBytes2(bytes).toString("base64url");
}
async function markdownDocuments(root, limit = 200) {
  const output = [];
  const ignored = /* @__PURE__ */ new Set([".git", "node_modules", ".next", "dist", "out", ".bridge", "backups", "snapshots", "quarantine"]);
  const walk = async (directory, depth) => {
    if (depth > 5 || output.length >= limit) return;
    const entries = await readdir4(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit || ignored.has(entry.name)) continue;
      const full = join8(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        const metadata = await stat5(full).catch(() => null);
        if (!metadata || metadata.size > 2e6) continue;
        const text = await readFile6(full, "utf8").catch(() => "");
        if (text && text.length <= 2e6) output.push({ path: full.slice(root.length + 1).replace(/\\/g, "/"), text });
      }
    }
  };
  await walk(root, 0);
  return output;
}
function markdownSection(text, headings) {
  const wanted = new Set(headings.map((heading) => heading.replace(/\s+/g, "")));
  const lines = String(text || "").split(/\r?\n/);
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
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, "/"), String(item.text || "")]));
  const mapDir = typeof document?.mapDir === "string" && document.mapDir ? document.mapDir : ".live-dot-map";
  return (Array.isArray(document.edges) ? document.edges : []).filter((edge) => ["failed", "success", "pending"].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true).map((edge) => {
    const path = String(edge.md || `${mapDir}/routes/${edge.id}.md`).replace(/\\/g, "/");
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
  }).sort((a, b) => (a.status === "failed" ? -1 : 0) - (b.status === "failed" ? -1 : 0) || a.id.localeCompare(b.id)).slice(0, 8);
}
async function recordAgentHealth(root, actor, event, status, error) {
  const path = join8(root, ".live-dot-map", ".bridge", "agent-health.json");
  const prior = await readFile6(path, "utf8").then((text) => JSON.parse(text)).catch(() => ({}));
  const records = prior.records && typeof prior.records === "object" && !Array.isArray(prior.records) ? prior.records : {};
  records[String(actor).replace(/^agent:/, "")] = {
    status,
    actor,
    event,
    boundary: String(event).startsWith("mcp:") ? "mcp" : "hook",
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...status === "error" ? { code: error?.code || "BRIDGE_MCP_FAILED", message: String(error?.message || error || "\u672A\u77E5\u9519\u8BEF").slice(0, 400) } : {}
  };
  await mkdir5(join8(root, ".live-dot-map", ".bridge"), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomToken(8)}.tmp`;
  try {
    await writeFile3(temporary, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), records }, null, 2)}
`, "utf8");
    await rename4(temporary, path);
  } catch {
  }
}
async function readAgentHealth(root) {
  return readFile6(join8(root, ".live-dot-map", ".bridge", "agent-health.json"), "utf8").then((text) => {
    const value = JSON.parse(text);
    return value && typeof value.records === "object" && !Array.isArray(value.records) ? value.records : {};
  }).catch(() => ({}));
}
async function readObject(path) {
  try {
    const value = JSON.parse(await readFile6(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function runtimeSources({ sourceRoot, runtimeSource } = {}) {
  const entry = process.argv[1] ? resolve5(process.argv[1]) : "";
  const entryRoot = entry ? dirname6(entry) : "";
  const roots = [
    sourceRoot,
    process.env.LIVEDOT_AGENT_KIT_SOURCE,
    process.cwd(),
    entryRoot
  ].filter(Boolean).map((value) => resolve5(value));
  const uniqueRoots = [...new Set(roots)];
  const runtimes = [
    runtimeSource,
    process.env.LIVEDOT_RUNTIME_SOURCE,
    ...uniqueRoots.map((root) => join8(root, "livedot.mjs"))
  ].filter(Boolean).map((value) => resolve5(value));
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
  const root = resolve5(projectRoot);
  try {
    const detected = await detect({ projectRoot: root, platform, ...homeRoot ? { homeRoot } : {} });
    const available = Object.values(detected || {}).filter((item) => item?.discovered === true);
    const configPath = join8(root, ".live-dot-map", "agent-kit.json");
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
  } catch (error) {
    return {
      ok: false,
      status: "error",
      changed: false,
      projectRoot: root,
      code: error?.code || "AGENT_SETUP_FAILED",
      message: String(error?.message || error || "Agent \u63A5\u5165\u914D\u7F6E\u5931\u8D25").slice(0, 400)
    };
  }
}
function constantEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
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
  } catch (error) {
    throw new BridgeError("INVALID_JSON", "Request body must be a valid JSON object", { status: 400, cause: error });
  }
}
var EventHub = class {
  #clients = /* @__PURE__ */ new Map();
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
function sendError(response, error) {
  const bridgeError = asBridgeError(error);
  const body = {
    error: {
      code: bridgeError.code,
      message: bridgeError.status >= 500 ? "Local bridge request failed" : bridgeError.message
    }
  };
  if (bridgeError.details !== void 0 && bridgeError.status < 500) body.error.details = bridgeError.details;
  sendJson(response, bridgeError.status || 500, body);
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
  clock = () => /* @__PURE__ */ new Date(),
  faultInjector,
  host = "127.0.0.1",
  appHtml = null,
  staticAssets = {},
  agentSetup = ensureProjectAgentConfig,
  logger = noopLogger
} = {}) {
  if (!Array.isArray(allowedProjectRoots) || allowedProjectRoots.length === 0) {
    throw new BridgeError("ALLOWLIST_REQUIRED", "At least one project root must be allowlisted");
  }
  const adapter = shared || await loadSharedAdapter();
  const roots = /* @__PURE__ */ new Map();
  for (const root of allowedProjectRoots) roots.set(await canonicalDirectory(root), true);
  const bootstrapToken = randomToken();
  let bootstrapConsumed = false;
  let port;
  const sessions = /* @__PURE__ */ new Map();
  const stores = /* @__PURE__ */ new Map();
  const markdownStores = /* @__PURE__ */ new Map();
  const events = new EventHub();
  const configuredOrigins = new Set(allowedOrigins);
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
  function authenticate(request) {
    const sessionId = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const session = sessionId && sessions.get(sessionId);
    if (!session || session.expiresAt <= clock().getTime()) {
      if (sessionId) sessions.delete(sessionId);
      throw new BridgeError("UNAUTHENTICATED", "A valid local bridge session is required", { status: 401 });
    }
    return session;
  }
  function validateCsrf(request, session) {
    const token = request.headers["x-csrf-token"];
    if (!token || !constantEqual(token, session.csrfToken)) {
      throw new BridgeError("INVALID_CSRF", "CSRF token is missing or invalid", { status: 403 });
    }
  }
  const storeKey = (root, mapId) => `${root}::${mapId}`;
  async function openMapStore(root, mapId, { mapName } = {}) {
    const key = storeKey(root, mapId);
    let store = stores.get(key);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: root,
        dataDirectory: mapDirectory(root, mapId),
        mapName,
        mapDir: mapRelativeDirectory(mapId),
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          key,
          event.type === "external" ? { ...event, type: "revision", source: "external" } : event
        )
      });
      stores.set(key, store);
    }
    return store;
  }
  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
    if (!session.activeMapId) session.activeMapId = await resolveActiveMap(session.projectRoot);
    const store = stores.get(storeKey(session.projectRoot, session.activeMapId));
    if (!store) return openMapStore(session.projectRoot, session.activeMapId);
    return store;
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
    } catch (error) {
      if (error?.code === "ENOENT") throw new BridgeError("PROJECT_NOT_FOUND", `Project directory does not exist: ${requestedRoot}`, { status: 404 });
      throw new BridgeError("PROJECT_NOT_ALLOWED", "Project root is not accessible", { status: 403 });
    }
    if (!roots.has(root)) roots.set(root, true);
    await recordRecentProject(root).catch(() => void 0);
    const { activeMap } = await ensureMapsLayout(root);
    const store = await openMapStore(root, activeMap);
    if (!markdownStores.has(root)) markdownStores.set(root, new MarkdownStore(root));
    logger.info("project.open", { root, map: activeMap });
    return { root, store, mapId: activeMap };
  }
  const UPDATE_BASE = (process.env.LIVEDOT_UPDATE_BASE || "https://livedotmap.top/windows-installer").replace(/\/+$/, "");
  async function readLocalPayloadVersion() {
    try {
      const parsed = JSON.parse(await readFile6(join8(process.cwd(), "payload-manifest.json"), "utf8"));
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
    } catch (error) {
      return { ok: false, current, latest: null, available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  async function applyUpdate() {
    const current = await readLocalPayloadVersion();
    const manifest = await fetchUpdateManifest();
    if (current !== null && compareVersions(manifest.version, current) <= 0) {
      throw new BridgeError("ALREADY_UP_TO_DATE", `Current version ${current} is up to date`, { status: 409 });
    }
    const updater = resolve5(join8(process.cwd(), "..", "LiveDotMapSetup.exe"));
    try {
      await access2(updater);
    } catch {
      throw new BridgeError("UPDATER_UNAVAILABLE", "Installer entry not found; updates are only available in installed mode", { status: 501 });
    }
    const tempRoot = join8(process.env.TEMP || process.env.TMP || homedir4(), `livedot-update-${manifest.version}-${randomUUID4()}`);
    const payloadDir = join8(tempRoot, "payload");
    await mkdir5(payloadDir, { recursive: true });
    try {
      for (const [relative3, meta] of Object.entries(manifest.files)) {
        if (!meta || typeof meta !== "object" || typeof meta.sha256 !== "string" || typeof meta.url !== "string") {
          throw new BridgeError("UPDATE_MANIFEST_INVALID", `Invalid file entry: ${relative3}`, { status: 502 });
        }
        if (relative3.includes("..") || relative3.startsWith("/") || /^[a-zA-Z]:/.test(relative3)) {
          throw new BridgeError("UPDATE_MANIFEST_INVALID", `Unsafe file path: ${relative3}`, { status: 502 });
        }
        const target = join8(payloadDir, relative3);
        await mkdir5(dirname6(target), { recursive: true });
        const response = await fetch(`${UPDATE_BASE}/${meta.url}`, { signal: AbortSignal.timeout(6e5) });
        if (!response.ok) throw new BridgeError("UPDATE_DOWNLOAD_FAILED", `Download failed for ${relative3} (HTTP ${response.status})`, { status: 502 });
        const buffer = Buffer.from(await response.arrayBuffer());
        const actual = createHash5("sha256").update(buffer).digest("hex");
        if (actual !== meta.sha256.toLowerCase()) throw new BridgeError("UPDATE_CHECKSUM_MISMATCH", `Checksum mismatch for ${relative3}`, { status: 502 });
        await writeFile3(target, buffer);
      }
    } catch (error) {
      await rm4(tempRoot, { recursive: true, force: true }).catch(() => void 0);
      throw error;
    }
    const child = spawn2(updater, ["--update", tempRoot], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return { ok: true, version: manifest.version, restarting: true };
  }
  function scheduleRestart() {
    setTimeout(() => {
      events.close();
      Promise.all([...stores.values()].map((store) => store.close())).catch(() => void 0).finally(() => {
        sessions.clear();
        server.close(() => process.exit(0));
        server.closeAllConnections?.();
        setTimeout(() => process.exit(0), 1500).unref?.();
      });
    }, 500);
  }
  const clientLog = logger.as("client");
  const server = createServer(async (request, response) => {
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
        ["/api/v1/update/check", "/update/check"],
        ["/api/v1/update/apply", "/update/apply"],
        ["/api/v1/logs/client", "/logs/client"]
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;
      if (request.method === "OPTIONS") {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, Authorization");
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
          const current = authenticate(request);
          sendJson(response, 200, {
            csrfToken: current.csrfToken,
            expiresAt: new Date(current.expiresAt).toISOString(),
            projectRoot: current.projectRoot,
            resumed: true
          });
          return;
        }
        requireMethod(request, "POST");
        if (bootstrapConsumed) throw new BridgeError("BOOTSTRAP_CONSUMED", "Bootstrap token has already been consumed", { status: 401 });
        const authorization = request.headers.authorization || "";
        const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        if (!constantEqual(token, bootstrapToken)) throw new BridgeError("INVALID_BOOTSTRAP_TOKEN", "Bootstrap token is invalid", { status: 401 });
        bootstrapConsumed = true;
        const sessionId = randomToken();
        const csrfToken = randomToken();
        const expiresAt = clock().getTime() + sessionTtlMs;
        sessions.set(sessionId, { csrfToken, expiresAt, projectRoot: null });
        response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtlMs / 1e3)}`);
        sendJson(response, 201, { csrfToken, expiresAt: new Date(expiresAt).toISOString(), resumed: false });
        return;
      }
      const session = authenticate(request);
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
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === "function" ? await agentSetup(root).catch((error) => ({ ok: false, status: "error", changed: false, code: error?.code || "AGENT_SETUP_FAILED", message: String(error?.message || error).slice(0, 400) })) : { ok: true, status: "none", changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { cancelled: false, projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...snapshot });
        return;
      }
      if (pathname === "/projects/recent") {
        requireMethod(request, "GET");
        sendJson(response, 200, { projectRoot: session.projectRoot, recent: await readRecentProjects() });
        return;
      }
      if (pathname === "/maps") {
        requireMethod(request, "GET");
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const { activeMap, maps } = await listMaps(session.projectRoot);
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap, maps });
        return;
      }
      if (pathname === "/maps/create") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        const created = await createMap(session.projectRoot, typeof body.name === "string" ? body.name : "");
        await writeActiveMap(session.projectRoot, created.id);
        session.activeMapId = created.id;
        const store = await openMapStore(session.projectRoot, created.id, { mapName: created.name });
        const snapshot = await store.snapshot();
        logger.info("map.create", { root: session.projectRoot, map: created.id });
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap: created.id, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }
      if (pathname === "/maps/switch") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        if (!isSafeMapId(body.mapId)) throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400 });
        if (!(await listMaps(session.projectRoot)).maps.some((map) => map.id === body.mapId)) {
          throw new BridgeError("MAP_NOT_FOUND", `\u5730\u56FE\u4E0D\u5B58\u5728\uFF1A${body.mapId}`, { status: 404 });
        }
        await writeActiveMap(session.projectRoot, body.mapId);
        session.activeMapId = body.mapId;
        const store = await openMapStore(session.projectRoot, body.mapId);
        const snapshot = await store.snapshot();
        logger.info("map.switch", { root: session.projectRoot, map: body.mapId });
        sendJson(response, 200, { projectRoot: session.projectRoot, activeMap: body.mapId, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }
      if (pathname === "/maps/rename") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const body = await readJsonBody(request, bodyLimit);
        if (!isSafeMapId(body.mapId)) throw new BridgeError("INVALID_MAP_ID", "\u5730\u56FE ID \u65E0\u6548", { status: 400 });
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name) throw new BridgeError("MAP_NAME_REQUIRED", "\u5730\u56FE\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A", { status: 400 });
        if (!(await listMaps(session.projectRoot)).maps.some((map) => map.id === body.mapId)) {
          throw new BridgeError("MAP_NOT_FOUND", `\u5730\u56FE\u4E0D\u5B58\u5728\uFF1A${body.mapId}`, { status: 404 });
        }
        const store = await openMapStore(session.projectRoot, body.mapId);
        const current = await store.snapshot();
        const executed = await store.execute({
          commandId: `map-rename-${randomToken(12)}`,
          baseRevision: current.revision,
          command: { op: "set_meta", patch: { name: name.slice(0, 80) } },
          actor: "human"
        });
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
        session.projectRoot = root;
        session.activeMapId = mapId;
        const snapshot = await store.snapshot();
        const setup = typeof agentSetup === "function" ? await agentSetup(root).catch((error) => ({ ok: false, status: "error", changed: false, code: error?.code || "AGENT_SETUP_FAILED", message: String(error?.message || error).slice(0, 400) })) : { ok: true, status: "none", changed: false, projectRoot: root, detectedAgents: {} };
        sendJson(response, 200, { projectRoot: root, activeMap: mapId, projectId: snapshot.document.mapId, agentSetup: setup, ...snapshot });
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
          const parsed = JSON.parse(await readFile6(join8(root, ".live-dot-map", "agent-kit.json"), "utf8"));
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
        if (request.method === "GET") {
          sendJson(response, 200, await store.snapshot());
          return;
        }
        requireMethod(request, "POST");
        validateCsrf(request, session);
        sendJson(response, 201, await store.createSnapshot());
        return;
      }
      if (pathname === "/markdown") {
        const markdown = markdownStores.get(session.projectRoot);
        if (!markdown) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
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
          sendJson(response, 200, await markdown.write(await mapMarkdownPath(session, body.path), body.content, { baseEtag: body.baseEtag ?? body.etag }));
          return;
        }
        throw new BridgeError("METHOD_NOT_ALLOWED", "Expected GET, PUT or POST", { status: 405 });
      }
      if (pathname === "/markdown/reveal") {
        const markdown = markdownStores.get(session.projectRoot);
        if (!markdown) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
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
        sendJson(response, 200, await markdown.reveal(await mapMarkdownPath(session, body.path), { open: true }));
        return;
      }
      if (pathname === "/commands") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        const executed = await store.execute({ ...body, actor: "human" });
        logger.info("commands", { count: Array.isArray(body.commands) ? body.commands.length : 0, revision: executed?.revision, actor: "human" });
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
data: ${JSON.stringify({ revision: snapshot.revision, checksum: snapshot.checksum })}

`);
        events.subscribe(storeKey(session.projectRoot, session.activeMapId), response);
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
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        try {
          const tool = body.tool || body.name;
          const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
          const snapshot = await store.snapshot();
          const agentEnvelope = (commands, prefix) => ({
            projectId: snapshot.document.mapId,
            baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
            commandId: typeof args.commandId === "string" ? args.commandId : `${prefix}-${randomToken(12)}`,
            actor: "agent:bridge",
            sessionId: "agent-bridge",
            commands
          });
          let result2;
          if (tool === "map_get_context") {
            const markdown = Array.isArray(args.markdown) ? args.markdown : await markdownDocuments(session.projectRoot);
            const context = adapter.retrieveContext(snapshot.document, String(args.query || ""), { markdown, currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId) });
            const projection = { ...adapter.buildProjectProjection(snapshot.document, { now: typeof args.now === "string" ? args.now : void 0 }), attemptEvidence: attemptEvidence(snapshot.document, markdown) };
            result2 = { revision: snapshot.revision, projection, attemptEvidence: projection.attemptEvidence, ...context };
          } else if (tool === "map_read_markdown") {
            const markdown = markdownStores.get(session.projectRoot);
            if (!markdown) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
            result2 = await markdown.read(await mapMarkdownPath(session, String(args.path || "")), { create: args.create === true, title: String(args.title || "") });
          } else if (tool === "map_write_markdown") {
            const markdown = markdownStores.get(session.projectRoot);
            if (!markdown) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
            result2 = await markdown.write(await mapMarkdownPath(session, String(args.path || "")), args.content, { baseEtag: args.baseEtag ?? args.etag });
          } else if (tool === "map_list_human_updates") {
            result2 = { revision: snapshot.revision, updates: snapshot.document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(ann.attention)) };
          } else if (tool === "map_ack_human_updates") {
            result2 = await store.execute(agentEnvelope([{
              op: "ack_annotations",
              ids: Array.isArray(args.ids) ? args.ids.map(String) : [],
              summary: String(args.summary || "")
            }], "mcp-ack"));
          } else if (tool === "map_next_candidates") {
            const markdown = Array.isArray(args.markdown) ? args.markdown : await markdownDocuments(session.projectRoot);
            const context = adapter.retrieveContext(snapshot.document, String(args.query || ""), {
              currentNodeId: args.currentNodeId === null || args.currentNodeId === void 0 ? null : String(args.currentNodeId),
              limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
              includeHistory: args.includeHistory === true,
              markdown
            });
            result2 = { revision: snapshot.revision, projection: adapter.buildProjectProjection(snapshot.document), attemptEvidence: attemptEvidence(snapshot.document, markdown), alternatives: adapter.findExplorationAlternatives(snapshot.document, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), ...context, autonomy: adapter.autonomyDecision(snapshot.document, context.objects) };
          } else if (tool === "map_apply_commands") {
            result2 = await store.execute(agentEnvelope(Array.isArray(args.commands) ? args.commands : [], "mcp-apply"));
          } else if (tool === "map_validate") {
            const target = args.document || snapshot.document;
            const validation = await adapter.validateDocument(target);
            result2 = target === snapshot.document ? { ...validation, attemptIssues: validation.ok ? adapter.checkAttemptEvidence(snapshot.document, await markdownDocuments(session.projectRoot)) : [] } : validation;
          } else if (tool === "map_checkpoint") {
            result2 = await store.createSnapshot();
          } else if (tool === "map_plan_consolidation") {
            const markdown = await markdownDocuments(session.projectRoot);
            result2 = { revision: snapshot.revision, ...adapter.planConsolidation(snapshot.document, {
              now: typeof args.now === "string" ? args.now : void 0,
              maxSuggestions: Number.isInteger(args.maxSuggestions) ? args.maxSuggestions : 12,
              markdown
            }) };
          } else {
            throw new BridgeError("UNKNOWN_MCP_TOOL", "Unknown MCP tool", { status: 404 });
          }
          await recordAgentHealth(session.projectRoot, "agent:bridge", `mcp:${String(tool)}`, "ok");
          logger.info("mcp", { tool: String(tool), ok: true });
          sendJson(response, 200, { tool, result: result2 });
          return;
        } catch (error) {
          await recordAgentHealth(session.projectRoot, "agent:bridge", `mcp:${String(body.tool || body.name || "unknown")}`, "error", error);
          logger.error("mcp", { tool: String(body.tool || body.name || "unknown"), error });
          throw error;
        }
      }
      throw new BridgeError("NOT_FOUND", "Endpoint not found", { status: 404 });
    } catch (error) {
      if ((asBridgeError(error).status || 500) >= 500) {
        logger.error("request.error", { method: request.method, path: String(request.url || "").split("?")[0], error });
      }
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 1e4;
  server.requestTimeout = 15e3;
  server.keepAliveTimeout = 5e3;
  await new Promise((resolve7, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve7);
  });
  port = server.address().port;
  return {
    host,
    port,
    origin: `http://${host}:${port}`,
    bootstrapToken,
    close: async () => {
      events.close();
      await Promise.all([...stores.values()].map((store) => store.close()));
      sessions.clear();
      await new Promise((resolve7, reject) => {
        server.close((error) => error ? reject(error) : resolve7());
        server.closeAllConnections?.();
      });
    }
  };
}

// src/shared/index.ts
var MAP_VERSION2 = 2;
var COLLECTIONS2 = ["routes", "nodes", "edges", "anns"];
var ID2 = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
var ISO_MS2 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var MAX_NAME2 = 80;
var MAX_ANN2 = 4e3;
function clone2(value) {
  return structuredClone(value);
}
function fnv1a2(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function mapError2(code, status, message, details) {
  return Object.assign(new Error(message), { code, status, details });
}
function documentMapDir2(document) {
  const value = document.mapDir;
  return typeof value === "string" && value ? value : ".live-dot-map";
}
function stableMarkdownPath2(collection, id, mapDir = ".live-dot-map") {
  if (!ID2.test(id)) throw mapError2("INVALID_ID", 400, "\u5BF9\u8C61 ID \u65E0\u6548");
  return collection === "nodes" ? `${mapDir}/nodes/${id}.md` : `${mapDir}/routes/${id}.md`;
}
function isObject2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function validateBaseObject2(item, label, ids, errors) {
  if (!isObject2(item)) {
    errors.push(`${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
    return false;
  }
  if (typeof item.id !== "string" || !ID2.test(item.id)) errors.push(`${label}.id \u65E0\u6548`);
  else if (ids.has(item.id)) errors.push(`\u91CD\u590D id: ${item.id}`);
  else ids.add(item.id);
  if (typeof item.createdAt !== "string" || !ISO_MS2.test(item.createdAt)) errors.push(`${label}.createdAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedAt !== "string" || !ISO_MS2.test(item.updatedAt)) errors.push(`${label}.updatedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC`);
  if (typeof item.updatedBy !== "string") errors.push(`${label}.updatedBy \u7F3A\u5931`);
  if (item.createdBy !== void 0 && typeof item.createdBy !== "string") errors.push(`${label}.createdBy \u65E0\u6548`);
  if (!Number.isInteger(item.updatedRevision) || Number(item.updatedRevision) < 0) errors.push(`${label}.updatedRevision \u65E0\u6548`);
  return true;
}
function normalizeNodeKind2(value) {
  if (value === "goal" || value === "problem" || value === "result") return value;
  if (value === "\u95EE\u9898" || value === "problem") return "problem";
  if (value === "\u7ED3\u679C" || value === "result") return "result";
  return "goal";
}
function validateMapDocument2(value) {
  const errors = [];
  if (!isObject2(value)) return { ok: false, errors: ["map.json \u5FC5\u987B\u662F\u5BF9\u8C61"] };
  if (value.version !== MAP_VERSION2) return { ok: false, readOnly: true, errors: [`\u4E0D\u652F\u6301 schema version ${String(value.version)}`] };
  if (typeof value.mapId !== "string" || !ID2.test(value.mapId)) errors.push("mapId \u65E0\u6548");
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) errors.push("revision \u65E0\u6548");
  if (!Number.isInteger(value.lastEventId) || Number(value.lastEventId) < 0) errors.push("lastEventId \u65E0\u6548");
  if (typeof value.name !== "string" || value.name.length > MAX_NAME2) errors.push("name \u65E0\u6548\u6216\u8FC7\u957F");
  if (typeof value.createdAt !== "string" || !ISO_MS2.test(value.createdAt)) errors.push("createdAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC");
  if (typeof value.updatedAt !== "string" || !ISO_MS2.test(value.updatedAt)) errors.push("updatedAt \u5FC5\u987B\u662F\u6BEB\u79D2 UTC");
  if (!isObject2(value.view)) errors.push("view \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!isObject2(value.ui)) errors.push("ui \u5FC5\u987B\u662F\u5BF9\u8C61");
  if (!isObject2(value.counters)) errors.push("counters \u5FC5\u987B\u662F\u5BF9\u8C61");
  const ids = /* @__PURE__ */ new Set();
  const byCollection = { routes: [], nodes: [], edges: [], anns: [] };
  for (const collection of COLLECTIONS2) {
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
      if (validateBaseObject2(list[i], `${collection}[${i}]`, ids, errors)) byCollection[collection].push(list[i]);
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
    if (node.milestone !== void 0) {
      const milestone = node.milestone;
      if (!isObject2(milestone) || !["pending", "approved", "changes_requested"].includes(String(milestone.status))) {
        errors.push(`nodes[${i}].milestone \u65E0\u6548`);
      } else {
        if (milestone.origin !== void 0 && !["human_created", "agent_created"].includes(String(milestone.origin))) errors.push(`nodes[${i}].milestone.origin \u65E0\u6548`);
        if (milestone.level !== void 0 && !["project", "route", "work"].includes(String(milestone.level))) errors.push(`nodes[${i}].milestone.level \u65E0\u6548`);
        if (milestone.createdBy !== void 0 && typeof milestone.createdBy !== "string") errors.push(`nodes[${i}].milestone.createdBy \u65E0\u6548`);
        if (milestone.updatedBy !== void 0 && typeof milestone.updatedBy !== "string") errors.push(`nodes[${i}].milestone.updatedBy \u65E0\u6548`);
      }
    }
  }
  for (const [i, ann] of byCollection.anns.entries()) {
    if (typeof ann.text !== "string" || ann.text.length > MAX_ANN2) errors.push(`anns[${i}].text \u65E0\u6548\u6216\u8FC7\u957F`);
    if (!["new", "delivered", "acknowledged", "resolved"].includes(String(ann.attention))) errors.push(`anns[${i}].attention \u65E0\u6548`);
    const target = ann.target;
    if (!isObject2(target) || !["node", "edge", "canvas"].includes(String(target.kind))) errors.push(`anns[${i}].target \u65E0\u6548`);
    else if (target.kind === "node" && !nodeIds.has(String(target.id))) errors.push(`anns[${i}] \u8282\u70B9\u76EE\u6807\u4E0D\u5B58\u5728`);
    else if (target.kind === "edge" && !byCollection.edges.some((e) => e.id === target.id)) errors.push(`anns[${i}] \u65B9\u6848\u76EE\u6807\u4E0D\u5B58\u5728`);
  }
  return { ok: errors.length === 0, errors };
}
function tokenize2(text) {
  const normalized = text.toLowerCase().normalize("NFKC");
  const words = normalized.match(/[a-z0-9_:-]+/g) ?? [];
  const chinese = [...normalized.matchAll(/[\p{Script=Han}]+/gu)].flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.length < 2 ? chars : chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
  });
  return [.../* @__PURE__ */ new Set([...words, ...chinese])];
}
function objectText2(item) {
  return [item.id, item.name, item.kind, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === "string").join(" ");
}
function ageScore2(updatedAt, now) {
  if (typeof updatedAt !== "string") return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 864e5);
  return Math.max(0, 60 - Math.floor(days) * 5);
}
function headingContent2(text, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text).match(new RegExp(`^\\s*[-#]*\\s*${escaped}\\s*[:\uFF1A]?\\s*([\\s\\S]*?)(?=\\n\\s*[-#]+\\s|\\n\\s*[\\u4e00-\\u9fffA-Za-z][^\\n]{0,40}[:\uFF1A]\\s|$)`, "im"));
  return match?.[1]?.trim() ?? "";
}
function checkAttemptEvidence2(document, markdown = []) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, "/"), String(item.text ?? "")]));
  const issues = [];
  for (const edge of document.edges) {
    const actor = String(edge.updatedBy ?? edge.createdBy ?? "");
    if (!actor.startsWith("agent:") || !["pending", "success", "failed"].includes(String(edge.status))) continue;
    const status = String(edge.status);
    const path = String(edge.md ?? stableMarkdownPath2("edges", String(edge.id), documentMapDir2(document))).replace(/\\/g, "/");
    const text = docs.get(path) ?? "";
    const required2 = status === "pending" ? ["\u5173\u952E\u8BC1\u636E", "\u4E0B\u4E00\u6B65"] : ["\u5173\u952E\u8BC1\u636E", "\u7ED3\u679C", "\u4E0B\u4E00\u6B65"];
    if (status === "failed") required2.push("\u5931\u8D25\u539F\u56E0");
    if (status === "success") required2.push("\u8BC4\u5206");
    const missing = required2.filter((heading) => !headingContent2(text, heading));
    if (!text) missing.splice(0, missing.length, "Markdown \u6587\u4EF6");
    if (missing.length) issues.push({ edgeId: String(edge.id), status, path, missing, reason: `Agent \u65B9\u6848 ${String(edge.id)} \u7F3A\u5C11\uFF1A${missing.join("\u3001")}` });
  }
  return issues;
}
function bm252(query, docs) {
  if (query.length === 0 || docs.length === 0) return [];
  const tokenized = docs.map((doc) => tokenize2(doc.text));
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
function retrieveContext2(document, query, options = {}) {
  const normalizedQuery = typeof query === "string" ? query : "";
  const terms = tokenize2(normalizedQuery);
  const queryLower = normalizedQuery.toLowerCase();
  const limit = Math.max(1, Math.min(12, Number.isInteger(options.limit) ? Number(options.limit) : 12));
  const now = new Date(options.now ?? Date.now());
  const all = COLLECTIONS2.flatMap((kind) => document[kind].map((item) => ({ kind, item })));
  const active = all.filter(({ item, kind }) => options.includeHistory || !(item.archived === true || item.shelved === true) && !(kind === "edges" && document.routes.some((route) => route.id === item.route && route.archived === true)));
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
    const text = objectText2(item).toLowerCase();
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
    if (kind === "anns" && isObject2(item.target) && seeds.has(String(item.target.id))) {
      score += 800;
      reasons.push("\u6807\u6CE8\u5C5E\u4E8E\u660E\u786E\u76EE\u6807");
    }
    if (kind === "nodes" && normalizeNodeKind2(item.kind ?? item.type) === "problem" && item.resolved !== true) {
      score += 700;
      reasons.push("\u672A\u89E3\u51B3\u95EE\u9898\u8282\u70B9");
    }
    if (kind === "nodes" && isObject2(item.milestone) && item.milestone.status === "pending") {
      score += 500;
      reasons.push("\u91CC\u7A0B\u7891\u5F85\u5BA1\u6838");
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
    const recent = ageScore2(item.updatedAt, now);
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
  const markdownScores = bm252(terms, options.markdown ?? []);
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
function findExplorationAlternatives2(document, currentNodeId = null, options = {}) {
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
  const failedContexts = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && edge.status === "failed").map((edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const sourceRouteId = routeForNode(sourceNodeId) ?? resolveRouteId(edge, sourceNodeId);
    const terms = tokenize2(String(edge.name ?? ""));
    return { edge, sourceNodeId, sourceRouteId, terms, key: `${sourceNodeId ?? ""}:${normalizeName(edge.name)}` };
  });
  const requestedSource = typeof currentNodeId === "string" && currentNodeId ? currentNodeId : null;
  const requestedRoute = routeForNode(requestedSource);
  const relevantFailures = failedContexts.filter((failure) => !requestedSource || failure.sourceNodeId === requestedSource || failure.sourceNodeId === null && failure.sourceRouteId === requestedRoute);
  const sourceIds = /* @__PURE__ */ new Set([...requestedSource ? [requestedSource] : [], ...relevantFailures.flatMap((failure) => failure.sourceNodeId ? [failure.sourceNodeId] : [])]);
  const sourceRouteIds = /* @__PURE__ */ new Set([...requestedRoute ? [requestedRoute] : [], ...relevantFailures.flatMap((failure) => failure.sourceRouteId ? [failure.sourceRouteId] : [])]);
  const failedTerms = new Set(relevantFailures.flatMap((failure) => failure.terms));
  const failedKeys = new Set(relevantFailures.map((failure) => failure.key));
  const active = document.edges.filter((edge) => {
    if (edge.archived === true || edge.shelved === true || !["pending", "success"].includes(String(edge.status))) return false;
    const edgeRouteId = typeof edge.route === "string" ? edge.route : null;
    if (edgeRouteId && routeById.get(edgeRouteId)?.archived === true) return false;
    return true;
  });
  const rank = (edge) => {
    const sourceNodeId = resolveSourceNode(edge);
    const candidateRouteId = resolveRouteId(edge, sourceNodeId);
    const terms = tokenize2(String(edge.name ?? ""));
    const overlap = terms.filter((term) => failedTerms.has(term)).length;
    const sameSource = Boolean(sourceNodeId && sourceIds.has(sourceNodeId));
    const matchingFailure = relevantFailures.map((failure) => ({ failure, overlap: terms.filter((term) => failure.terms.includes(term)).length })).sort((a, b) => Number(b.failure.sourceNodeId === sourceNodeId) - Number(a.failure.sourceNodeId === sourceNodeId) || b.overlap - a.overlap || String(a.failure.edge.id).localeCompare(String(b.failure.edge.id)))[0]?.failure;
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
function buildProjectProjection2(document, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const maxRoutes = Math.max(1, Math.min(12, Number.isInteger(options.maxRoutes) ? Number(options.maxRoutes) : 6));
  const maxCandidates = Math.max(1, Math.min(12, Number.isInteger(options.maxCandidates) ? Number(options.maxCandidates) : 6));
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeById = new Map(activeRoutes.map((route) => [String(route.id), route]));
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || !document.routes.some((route) => route.id === edge.route && route.archived === true)));
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
  const humanUpdates = document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(String(ann.attention))).sort((a, b) => (String(a.attention) === "new" ? -1 : 1) - (String(b.attention) === "new" ? -1 : 1) || updatedTime(b) - updatedTime(a)).slice(0, 6).map((ann) => ({ id: String(ann.id), text: String(ann.text ?? ""), attention: String(ann.attention), priority: String(ann.priority ?? "normal"), target: clone2(ann.target) }));
  const problems = activeNodes.filter((node) => normalizeNodeKind2(node.kind ?? node.type) === "problem" && node.resolved !== true).sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 12).map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), kind: "problem", resolved: false, routeId: typeof node.route === "string" ? node.route : null, updatedAt: String(node.updatedAt ?? "") }));
  const milestones = activeNodes.filter((node) => isObject2(node.milestone) && ["pending", "changes_requested"].includes(String(node.milestone.status))).sort((a, b) => updatedTime(b) - updatedTime(a) || String(a.id).localeCompare(String(b.id))).slice(0, 6).map((node) => ({ id: String(node.id), name: String(node.name ?? node.id), status: String(node.milestone.status), origin: String(node.milestone.origin ?? "unknown"), routeId: typeof node.route === "string" ? node.route : null }));
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
function autonomyDecision2(document, candidates) {
  const reasons = [];
  if (document.anns.some((ann) => ann.attention === "new" || ann.attention === "delivered")) reasons.push("\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u7684\u4EBA\u7C7B\u6807\u6CE8");
  if (document.nodes.some((node) => isObject2(node.milestone) && node.milestone.status === "pending")) reasons.push("\u5B58\u5728\u5F85\u5BA1\u6838\u91CC\u7A0B\u7891");
  const projection = buildProjectProjection2(document);
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
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true).length;
  if (activeNodes >= 20) reasons.push(`\u6D3B\u8DC3\u5BF9\u8C61\u6570\u91CF\u8FBE\u5230\u6574\u7406\u9608\u503C\uFF08${activeNodes} \u4E2A\u8282\u70B9\uFF09`);
  if (uniqueCandidateIds.size > 10) reasons.push(`\u5355\u6279\u5019\u9009\u5BF9\u8C61\u8D85\u8FC7 10 \u4E2A\uFF08${uniqueCandidateIds.size}\uFF09`);
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push("\u5019\u9009\u7F6E\u4FE1\u5EA6\u6216\u5019\u9009\u5206\u5DEE\u4E0D\u8DB3");
  return { auto: reasons.length === 0, reasons };
}
function normalizeForComparison2(value) {
  return String(value ?? "").toLowerCase().normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "");
}
function comparisonTokens2(value) {
  const normalized = normalizeForComparison2(value);
  if (!normalized) return /* @__PURE__ */ new Set();
  return new Set(tokenize2(normalized));
}
function similarText2(left, right) {
  const a = normalizeForComparison2(left);
  const b = normalizeForComparison2(right);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  if (a === b) return true;
  const leftTokens = comparisonTokens2(a);
  const rightTokens = comparisonTokens2(b);
  if (!leftTokens.size || !rightTokens.size) return false;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap > 0 && overlap / (leftTokens.size + rightTokens.size - overlap) >= 0.5;
}
function consolidationCounts2(document) {
  const activeRoutes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const activeNodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const activeEdges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && !document.routes.some((route) => route.id === edge.route && (route.archived === true || route.shelved === true)));
  return {
    routes: document.routes.length,
    nodes: document.nodes.length,
    edges: document.edges.length,
    activeNodes: activeNodes.length,
    activeEdges: activeEdges.length
  };
}
function sortedUnique2(values) {
  return [...new Set([...values].map((value) => String(value)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function sourceFor2(document, objectIds, markdownPaths = []) {
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
  return { objectIds: sortedUnique2(objectIds), routeIds: sortedUnique2(routeIds), actors: sortedUnique2(actors), markdownPaths: sortedUnique2(paths.map((path) => path.replace(/\\/g, "/"))) };
}
function decrementAfter2(before, commands) {
  const after = { ...before };
  const archived = /* @__PURE__ */ new Set();
  for (const command2 of commands) {
    if (command2.op !== "update" || command2.patch.archived !== true) continue;
    const key = `${command2.collection}/${command2.id}`;
    if (archived.has(key)) continue;
    archived.add(key);
    if (command2.collection === "nodes") after.activeNodes = Math.max(0, after.activeNodes - 1);
    if (command2.collection === "edges") after.activeEdges = Math.max(0, after.activeEdges - 1);
  }
  return after;
}
function makeSuggestion2(document, before, value) {
  const source = sourceFor2(document, value.objectIds, value.markdownPaths ?? []);
  const afterKnown = value.afterKnown ?? value.mode === "human_only";
  return {
    ...value,
    source,
    before: { ...before },
    after: afterKnown ? decrementAfter2(before, value.commands) : { ...before },
    afterKnown,
    commands: value.commands.map((command2) => structuredClone(command2))
  };
}
function activeForConsolidation2(document) {
  const routes = document.routes.filter((route) => route.archived !== true && route.shelved !== true);
  const routeIds = new Set(routes.map((route) => String(route.id)));
  const nodes = document.nodes.filter((node) => node.archived !== true && node.shelved !== true);
  const edges = document.edges.filter((edge) => edge.archived !== true && edge.shelved !== true && (!edge.route || routeIds.has(String(edge.route))));
  return { routes, nodes, edges };
}
function successfulChains2(edges) {
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
function planConsolidation2(document, options = {}) {
  const now = new Date(options.now ?? Date.now());
  const maxSuggestions = Math.max(1, Math.min(20, Number.isInteger(options.maxSuggestions) ? Number(options.maxSuggestions) : 12));
  const active = activeForConsolidation2(document);
  const before = consolidationCounts2(document);
  const trigger = [];
  if (before.activeNodes >= 20) trigger.push(`\u6D3B\u8DC3\u8282\u70B9\u8FBE\u5230 ${before.activeNodes} \u4E2A`);
  if (before.activeEdges >= 20) trigger.push(`\u6D3B\u8DC3\u65B9\u6848\u8FBE\u5230 ${before.activeEdges} \u6761`);
  const suggestions = [];
  const ageDays = (value) => {
    const time = new Date(String(value ?? "")).getTime();
    return Number.isFinite(time) ? Math.max(0, (now.getTime() - time) / 864e5) : 0;
  };
  const add = (value) => {
    if (suggestions.length < maxSuggestions) suggestions.push(makeSuggestion2(document, before, value));
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
    const key = `${String(edge.from)}:${normalizeForComparison2(edge.name)}`;
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
        if (consumed.has(String(duplicate.id)) || !similarText2(canonical.name, duplicate.name)) continue;
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
  for (const chain of successfulChains2(active.edges)) {
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
      if (!rightTarget || !similarText2(leftTarget.name, rightTarget.name)) continue;
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
    const owner = [...document.nodes, ...document.edges].find((item) => String(item.md ?? "").replace(/\\/g, "/") === path);
    const objectIds = owner ? [String(owner.id)] : [];
    trigger.push("\u5B58\u5728\u8FC7\u957F Markdown \u6458\u8981\u5019\u9009");
    add({
      id: `summarize-markdown-${fnv1a2(path)}`,
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
  for (const suggestion of ordered) if (suggestion.afterKnown) after = decrementAfter2(after, suggestion.commands);
  return {
    revision: document.revision,
    counts: { ...before },
    before: { ...before },
    after,
    trigger: [...new Set(trigger)],
    suggestions: ordered
  };
}

// src/cli/livedot.ts
if (isSea()) process.env.LIVEDOT_SEA = "1";
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
async function markdownDocuments2(root, limit = 200) {
  const output = [];
  const ignored = /* @__PURE__ */ new Set([".git", "node_modules", ".next", "dist", "out", ".bridge", "backups", "snapshots", "quarantine"]);
  const walk = async (directory, depth) => {
    if (depth > 5 || output.length >= limit) return;
    const entries = await readdir5(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit || ignored.has(entry.name)) continue;
      const full = join9(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && extname2(entry.name).toLowerCase() === ".md") {
        const metadata = await stat6(full).catch(() => null);
        if (!metadata || metadata.size > 2e6) continue;
        const text = await readFile7(full, "utf8").catch(() => "");
        if (text && text.length <= 2e6) output.push({ path: full.slice(root.length + 1).replace(/\\/g, "/"), text });
      }
    }
  };
  await walk(root, 0);
  return output;
}
function markdownSection2(text, headings) {
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
function attemptEvidence2(document, markdown) {
  const docs = new Map(markdown.map((item) => [String(item.path).replace(/\\/g, "/"), String(item.text ?? "")]));
  const edges = Array.isArray(document.edges) ? document.edges : [];
  const mapDir = typeof document.mapDir === "string" && document.mapDir ? document.mapDir : ".live-dot-map";
  return edges.filter((edge) => ["failed", "success", "pending"].includes(String(edge.status)) && edge.archived !== true && edge.shelved !== true).map((edge) => {
    const path = String(edge.md ?? `${mapDir}/routes/${edge.id}.md`).replace(/\\/g, "/");
    const text = docs.get(path) ?? "";
    const result2 = markdownSection2(text, ["\u7ED3\u679C", "\u7ED3\u8BBA"]);
    const failureReason = markdownSection2(text, ["\u5931\u8D25\u539F\u56E0", "\u5931\u8D25\u539F\u56E0/\u6392\u9664\u6761\u4EF6"]);
    const nextStep = markdownSection2(text, ["\u4E0B\u4E00\u6B65", "\u540E\u7EED\u5EFA\u8BAE"]);
    const evidence = markdownSection2(text, ["\u5173\u952E\u8BC1\u636E", "\u8BC1\u636E"]);
    return {
      id: String(edge.id),
      status: String(edge.status),
      name: String(edge.name ?? edge.id),
      path,
      evidence: evidence.slice(0, 360),
      result: result2.slice(0, 360),
      failureReason: failureReason.slice(0, 360),
      nextStep: nextStep.slice(0, 360),
      hasMarkdown: Boolean(text)
    };
  }).filter((item) => item.status === "failed" || item.status === "pending" || item.status === "success").sort((a, b) => (a.status === "failed" ? -1 : 0) - (b.status === "failed" ? -1 : 0) || String(a.id).localeCompare(String(b.id))).slice(0, 8);
}
async function recordAgentHealth2(root, actor, event, status, error) {
  const path = join9(root, ".live-dot-map", ".bridge", "agent-health.json");
  const prior = await readFile7(path, "utf8").then((text) => JSON.parse(text)).catch(() => ({}));
  const records = prior.records && typeof prior.records === "object" && !Array.isArray(prior.records) ? prior.records : {};
  const value = error;
  records[actor.replace(/^agent:/, "")] = {
    status,
    actor,
    event,
    boundary: event.startsWith("hook:") ? "hook" : "mcp",
    at: (/* @__PURE__ */ new Date()).toISOString(),
    ...status === "error" ? { code: value?.code ?? "HOOK_FAILED", message: String(value?.message ?? value ?? "\u672A\u77E5\u9519\u8BEF").slice(0, 400) } : {}
  };
  await mkdir6(dirname7(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID5()}.tmp`;
  try {
    await writeFile4(temporary, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString(), records }, null, 2)}
`, "utf8");
    await rename5(temporary, path);
  } catch {
  }
}
async function openStore(projectRoot) {
  const root = resolve6(projectRoot);
  const { activeMap } = await ensureMapsLayout(root);
  let mapName;
  try {
    const parsed = JSON.parse(await readFile7(join9(mapDirectory(root, activeMap), "map.json"), "utf8"));
    if (typeof parsed?.name === "string" && parsed.name) mapName = parsed.name;
  } catch {
  }
  return ProjectStore.open({
    projectRoot: root,
    dataDirectory: mapDirectory(root, activeMap),
    mapName,
    mapDir: mapRelativeDirectory(activeMap),
    shared: await loadSharedAdapter(),
    pollIntervalMs: 0
  });
}
function envelope(projectId, revision, actor, sessionId, commands) {
  return { projectId, baseRevision: revision, commandId: `cmd-${randomUUID5()}`, actor, sessionId, commands };
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
async function callTool(store, root, tool, args, defaultActor = "agent:generic") {
  const snapshot = await store.snapshot();
  const document = snapshot.document;
  const actor = defaultActor.startsWith("agent:") ? defaultActor : "agent:generic";
  const sessionId = `session-${randomUUID5()}`;
  if (tool === "map_get_context") {
    const markdown = await markdownDocuments2(root);
    const projection = { ...buildProjectProjection2(document), attemptEvidence: attemptEvidence2(document, markdown) };
    return { revision: snapshot.revision, projection, attemptEvidence: projection.attemptEvidence, ...retrieveContext2(document, String(args.query ?? ""), { currentNodeId: args.currentNodeId == null ? null : String(args.currentNodeId), markdown }) };
  }
  if (tool === "map_list_human_updates") {
    const anns = Array.isArray(document.anns) ? document.anns : [];
    return { revision: snapshot.revision, updates: anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(String(ann.attention))) };
  }
  if (tool === "map_ack_human_updates") {
    const ids = Array.isArray(args.ids) ? args.ids.map(String) : [];
    return store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: "ack_annotations", ids, summary: String(args.summary ?? "") }]));
  }
  if (tool === "map_next_candidates") {
    const markdown = await markdownDocuments2(root);
    const context = retrieveContext2(document, String(args.query ?? ""), {
      currentNodeId: args.currentNodeId === null || args.currentNodeId === void 0 ? null : String(args.currentNodeId),
      limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
      includeHistory: args.includeHistory === true,
      markdown
    });
    return { revision: snapshot.revision, alternatives: findExplorationAlternatives2(document, args.currentNodeId == null ? null : String(args.currentNodeId), { limit: 3 }), attemptEvidence: attemptEvidence2(document, markdown), ...context, autonomy: autonomyDecision2(document, context.objects) };
  }
  if (tool === "map_apply_commands") {
    const request = {
      ...envelope(String(document.mapId), snapshot.revision, actor, sessionId, Array.isArray(args.commands) ? args.commands : []),
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
      commandId: typeof args.commandId === "string" ? args.commandId : `cmd-${randomUUID5()}`
    };
    return store.execute(request);
  }
  if (tool === "map_validate") {
    const target = args.document ?? document;
    const validation = validateMapDocument2(target);
    return target === document ? { ...validation, attemptIssues: validation.ok ? checkAttemptEvidence2(document, await markdownDocuments2(root)) : [] } : validation;
  }
  if (tool === "map_checkpoint") return store.createSnapshot();
  if (tool === "map_plan_consolidation") {
    const markdown = await markdownDocuments2(root);
    return { ...planConsolidation2(document, {
      now: typeof args.now === "string" ? args.now : void 0,
      maxSuggestions: Number.isInteger(args.maxSuggestions) ? Number(args.maxSuggestions) : 12,
      markdown
    }), revision: snapshot.revision };
  }
  throw Object.assign(new Error(`\u672A\u77E5\u5DE5\u5177 ${tool}`), { code: "UNKNOWN_TOOL" });
}
var toolDefinitions = [
  ["map_get_context", "\u6309\u56FE\u7ED3\u6784\u4E0E\u672C\u5730 Markdown \u68C0\u7D22\u672C\u8F6E\u76F8\u5173\u4E0A\u4E0B\u6587", { query: { type: "string" } }],
  ["map_list_human_updates", "\u5217\u51FA new/delivered \u7684\u4EBA\u7C7B\u6807\u6CE8", {}],
  ["map_ack_human_updates", "\u6458\u8981\u660E\u786E\u5F15\u7528\u6807\u6CE8 ID \u540E\u786E\u8BA4\u8BFB\u53D6", { ids: { type: "array", items: { type: "string" } }, summary: { type: "string" } }],
  ["map_next_candidates", "\u8FD4\u56DE\u5E26\u53EF\u89E3\u91CA\u5206\u6570\u7684\u63A8\u8FDB\u5019\u9009\u4E0E\u81EA\u6CBB\u5224\u65AD", {
    query: { type: "string" },
    currentNodeId: { anyOf: [{ type: "string" }, { type: "null" }] },
    limit: { type: "integer", minimum: 1, maximum: 12 },
    includeHistory: { type: "boolean" }
  }],
  ["map_apply_commands", "\u901A\u8FC7\u7EDF\u4E00 reducer \u539F\u5B50\u63D0\u4EA4\u5730\u56FE\u547D\u4EE4", { commands: { type: "array" } }],
  ["map_validate", "\u6821\u9A8C v2 \u5730\u56FE\u6216\u5F53\u524D\u5730\u56FE", { document: { type: "object" } }],
  ["map_checkpoint", "\u521B\u5EFA\u4EBA\u5DE5\u68C0\u67E5\u70B9", {}],
  ["map_plan_consolidation", "\u53EA\u8BFB\u5206\u6790\u53EF\u5BA1\u6838\u7684\u5730\u56FE\u6574\u7406\u5EFA\u8BAE\uFF0C\u4E0D\u76F4\u63A5\u4FEE\u6539\u5730\u56FE", { maxSuggestions: { type: "integer", minimum: 1, maximum: 20 } }]
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: "object", properties, additionalProperties: true } }));
async function runMcp(projectRoot, actor) {
  const root = resolve6(projectRoot);
  const logger = createLogger({ source: "agent" });
  const store = await openStore(root);
  await logger.info("agent.mcp.start", { project: root, actor, pid: process.pid });
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
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
        const params = request.params;
        const value = await callTool(store, root, String(params.name), params.arguments ?? {}, actor);
        result2 = { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
      } else throw Object.assign(new Error(`\u672A\u77E5\u65B9\u6CD5 ${String(request.method)}`), { code: -32601 });
      await recordAgentHealth2(root, actor, `mcp:${String(request.method === "tools/call" ? request.params?.name ?? "call" : request.method)}`, "ok");
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: result2 })}
`);
    } catch (error) {
      const value = error;
      await recordAgentHealth2(root, actor, `mcp:${String(request.params?.name ?? request.method ?? "unknown")}`, "error", value);
      await logger.error("agent.mcp", { tool: String(request.params?.name ?? request.method ?? "unknown"), error: value });
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: typeof value.code === "number" ? value.code : -32e3, message: value.message, data: { code: value.code, details: value.details } } })}
`);
    }
  }
}
async function runHook(kind, args) {
  const root = resolve6(required(args, "project"));
  const actor = `agent:${String(args.agent || "generic")}`;
  const sessionId = String(args.session || `session-${randomUUID5()}`);
  const logger = createLogger({ source: "agent" });
  await logger.info("agent.hook.start", { event: kind, actor, project: root });
  const store = await openStore(root);
  const snapshot = await store.snapshot();
  const document = snapshot.document;
  if (kind === "session-start") {
    const watermarkPath = join9(root, ".live-dot-map", "agent-read.json");
    let watermark = 0;
    try {
      const parsed = JSON.parse(await readFile7(watermarkPath, "utf8"));
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
      await mkdir6(dirname7(watermarkPath), { recursive: true });
      await writeFile4(watermarkPath, `${JSON.stringify({ version: 1, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)}
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
    const context = await callTool(store, root, "map_get_context", { query: prompt }, actor);
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: JSON.stringify(compactHookContext(context)) } })}
`);
    await recordAgentHealth2(root, actor, "hook:user-prompt", "ok");
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
    const updates = await callTool(store, root, "map_list_human_updates", {}, actor);
    const validation = await callTool(store, root, "map_validate", {}, actor);
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
  }
}
async function main() {
  const { command: command2, args } = parseArgs(process.argv.slice(2));
  if (command2 === "serve") {
    const logger = createLogger({ source: "bridge" });
    const projectRoot = resolve6(required(args, "project"));
    const appPath = resolve6(typeof args.app === "string" ? args.app : join9(process.cwd(), "app.html"));
    const appHtml = await readFile7(appPath, "utf8");
    const assetRoot = dirname7(appPath);
    const staticAssets = {};
    for (const [urlPath, file, type] of [
      ["/sw.js", "sw.js", "text/javascript; charset=utf-8"],
      ["/manifest.webmanifest", "manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/icons/icon-192.png", join9("icons", "icon-192.png"), "image/png"],
      ["/icons/icon-512.png", join9("icons", "icon-512.png"), "image/png"]
    ]) {
      try {
        staticAssets[urlPath] = { body: await readFile7(join9(assetRoot, file)), type };
      } catch {
      }
    }
    const bridge = await createBridgeServer({ allowedProjectRoots: [projectRoot], appHtml, staticAssets, logger });
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bridge.bootstrapToken)}&project=${encodeURIComponent(projectRoot)}`;
    await logger.info("bridge.start", { origin: bridge.origin, project: projectRoot, pid: process.pid });
    process.stdout.write(`${JSON.stringify({ ok: true, origin: bridge.origin, bootstrapToken: bridge.bootstrapToken, url })}
`);
    const shutdown = async () => {
      await logger.info("bridge.stop", { pid: process.pid });
      await logger.flush();
      await bridge.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  if (command2 === "mcp") {
    const project = resolve6(typeof args.project === "string" && args.project.trim() ? args.project : process.cwd());
    return runMcp(project, `agent:${String(args.agent || "generic")}`);
  }
  if (command2 === "hook") {
    const project = resolve6(typeof args.project === "string" && args.project.trim() ? args.project : process.cwd());
    return runHook(String(args.event || "session-start"), { ...args, project });
  }
  if (command2 === "install") {
    const root = resolve6(typeof args.project === "string" ? args.project : process.cwd());
    const runtimeSource = process.env.LIVEDOT_RUNTIME_SOURCE || process.argv[1] || process.cwd();
    const appPath = resolve6(typeof args.app === "string" ? args.app : join9(dirname7(runtimeSource), "app.html"));
    const install = installProject;
    const result2 = await install({ projectRoot: root, runtimeSource, appPath, createDesktopShortcut: args["no-shortcut"] !== true, register: false });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    return;
  }
  if (command2 === "doctor") {
    const root = resolve6(required(args, "project"));
    const result2 = await doctorProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    if (!result2.ok) process.exitCode = 1;
    return;
  }
  if (command2 === "uninstall") {
    const root = resolve6(required(args, "project"));
    const result2 = await uninstallProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result2, null, 2)}
`);
    if (!result2.ok && result2.reason !== "not-installed") process.exitCode = 1;
    return;
  }
  process.stdout.write("\u6D3B\u70B9\u5730\u56FE v2\n  livedot.mjs install --project <path> --app <app.html>\n  livedot.mjs serve --project <path> --app <app.html>\n  livedot.mjs mcp --project <path> --agent codex|claude|kimi\n  livedot.mjs hook --event session-start|user-prompt|stop --project <path>\n  livedot.mjs doctor --project <path>\n  livedot.mjs uninstall --project <path>\n");
}
void main().catch(async (error) => {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === "hook" || parsed.command === "mcp") {
    const project = resolve6(typeof parsed.args.project === "string" && parsed.args.project.trim() ? parsed.args.project : process.cwd());
    await recordAgentHealth2(project, `agent:${String(parsed.args.agent || "generic")}`, `${parsed.command === "hook" ? `hook:${String(parsed.args.event || "unknown")}` : "mcp:process"}`, "error", error).catch(() => void 0);
  }
  await createLogger({ source: parsed.command === "serve" ? "bridge" : "agent" }).error("process.error", { command: parsed.command, error });
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
