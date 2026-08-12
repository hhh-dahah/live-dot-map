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
  commandTouches: () => commandTouches,
  createEmptyMap: () => createEmptyMap,
  envelopeTouches: () => envelopeTouches,
  mapError: () => mapError,
  migrateMapV1: () => migrateMapV1,
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
function stableMarkdownPath(collection, id) {
  if (!ID.test(id)) throw mapError("INVALID_ID", 400, "\u5BF9\u8C61 ID \u65E0\u6548");
  return collection === "nodes" ? `.live-dot-map/nodes/${id}.md` : `.live-dot-map/routes/${id}.md`;
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
  const result = {
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
  const validation = validateMapDocument(result);
  if (!validation.ok) throw mapError("MIGRATION_INVALID", 422, "v1 \u6570\u636E\u65E0\u6CD5\u5B89\u5168\u8FC1\u79FB", validation.errors);
  return result;
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
  for (const [i, edge] of byCollection.edges.entries()) {
    if (!nodeIds.has(String(edge.from))) errors.push(`edges[${i}].from \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.to !== null && !nodeIds.has(String(edge.to))) errors.push(`edges[${i}].to \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (!["success", "failed", "pending"].includes(String(edge.status))) errors.push(`edges[${i}].status \u65E0\u6548`);
    if (edge.route !== null && edge.route !== void 0 && !routeIds.has(String(edge.route))) errors.push(`edges[${i}].route \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.score !== void 0 && (!Number.isInteger(edge.score) || Number(edge.score) < 0 || Number(edge.score) > 100)) errors.push(`edges[${i}].score \u65E0\u6548`);
  }
  for (const [i, node] of byCollection.nodes.entries()) {
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
function applyOne(document, command2, actor, revision, now) {
  if (command2.op === "create") {
    const value = cleanRecord(command2.value, "value");
    if (typeof value.id !== "string" || !ID.test(value.id)) throw mapError("INVALID_ID", 422, "\u65B0\u5BF9\u8C61 ID \u65E0\u6548");
    if (getList(document, command2.collection).some((v) => v.id === value.id)) throw mapError("DUPLICATE_ID", 409, `\u5BF9\u8C61 ${value.id} \u5DF2\u5B58\u5728`);
    if (command2.collection !== "anns") assertName(value.name);
    if (command2.collection === "nodes" && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === "work") assertAgentMilestoneAllowed(value);
    }
    const item = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command2.collection === "nodes" && value.milestone !== void 0) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command2.collection === "nodes" && item.md === void 0) item.md = stableMarkdownPath("nodes", String(item.id));
    if (command2.collection === "edges" && item.md === void 0) item.md = stableMarkdownPath("edges", String(item.id));
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
  }
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
  const result = validateMapDocument(next);
  if (!result.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", result.errors);
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
  return [item.id, item.name, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === "string").join(" ");
}
function ageScore(updatedAt, now) {
  if (typeof updatedAt !== "string") return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 864e5);
  return Math.max(0, 60 - Math.floor(days) * 5);
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
  for (const edge of document.edges) if (typeof edge.from === "string" && typeof edge.to === "string") {
    connect(edge.from, edge.to);
    connect(edge.to, edge.from);
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
function autonomyDecision(document, candidates) {
  const reasons = [];
  if (document.anns.some((ann) => ann.attention === "new" || ann.attention === "delivered")) reasons.push("\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u7684\u4EBA\u7C7B\u6807\u6CE8");
  if (document.nodes.some((node) => isObject(node.milestone) && node.milestone.status === "pending")) reasons.push("\u5B58\u5728\u5F85\u5BA1\u6838\u91CC\u7A0B\u7891");
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push("\u5019\u9009\u7F6E\u4FE1\u5EA6\u6216\u9886\u5148\u5E45\u5EA6\u4E0D\u8DB3");
  return { auto: reasons.length === 0, reasons };
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
import { randomUUID as randomUUID4 } from "node:crypto";
import { readFile as readFile5, readdir as readdir2, stat as stat4 } from "node:fs/promises";
import { dirname as dirname4, extname, join as join6, resolve as resolve4 } from "node:path";
import { createInterface } from "node:readline";
import { isSea } from "node:sea";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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
import { lstat, readdir, readFile as readFile2, realpath as realpath2, stat as stat2, unlink as unlink2 } from "node:fs/promises";
import { basename, join as join2 } from "node:path";
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
      await new Promise((resolve5) => setTimeout(resolve5, 20));
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

// src/bridge/project-store.mjs
var MAP_DIRECTORY = ".live-dot-map";
var BRIDGE_DIRECTORY = ".bridge";
function validationResult(result) {
  if (result === true || result === void 0) return { ok: true, errors: [] };
  if (result === false) return { ok: false, errors: ["Document validation failed"] };
  return { ok: Boolean(result?.ok), readOnly: Boolean(result?.readOnly), errors: Array.isArray(result?.errors) ? result.errors : [] };
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
  constructor({
    projectRoot,
    shared,
    clock = () => /* @__PURE__ */ new Date(),
    snapshotEvery = 20,
    faultInjector = () => {
    },
    onEvent = () => {
    },
    pollIntervalMs = 250
  }) {
    this.projectRoot = projectRoot;
    this.shared = shared;
    this.clock = clock;
    this.snapshotEvery = Math.max(1, Number(snapshotEvery) || 20);
    this.readOnly = false;
    this.#faultInjector = faultInjector;
    this.#onEvent = onEvent;
    const requestedPollInterval = Number(pollIntervalMs);
    this.#pollIntervalMs = requestedPollInterval <= 0 ? 0 : Math.max(50, requestedPollInterval || 250);
    this.dataDirectory = join2(projectRoot, MAP_DIRECTORY);
    this.mapPath = join2(this.dataDirectory, "map.json");
    this.bridgeDirectory = join2(this.dataDirectory, BRIDGE_DIRECTORY);
    this.walPath = join2(this.bridgeDirectory, "wal.ndjson");
    this.lockPath = join2(this.bridgeDirectory, "write.lock");
    this.snapshotDirectory = join2(this.bridgeDirectory, "snapshots");
    this.backupDirectory = join2(this.bridgeDirectory, "backups");
    this.quarantineDirectory = join2(this.bridgeDirectory, "quarantine");
  }
  static async open(options) {
    const store = new _ProjectStore(options);
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
    const rejectSymlink = async (path) => {
      try {
        if ((await lstat(path)).isSymbolicLink()) {
          throw new BridgeError("SYMLINK_ESCAPE", "\u672C\u5730\u6865\u62D2\u7EDD\u901A\u8FC7\u7B26\u53F7\u94FE\u63A5\u8BFB\u5199\u9879\u76EE\u6570\u636E", { status: 403, details: { path } });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    };
    for (const path of [...directories, ...files]) await rejectSymlink(path);
    for (const path of directories) {
      await ensureDirectory(path);
      await rejectSymlink(path);
      const canonical = await realpath2(path);
      const escaped = relative(canonicalRoot, canonical);
      if (escaped.startsWith("..") || isAbsolute(escaped) || resolve(canonical) === resolve(canonicalRoot)) {
        throw new BridgeError("PATH_ESCAPE", "\u672C\u5730\u6865\u6570\u636E\u76EE\u5F55\u5FC5\u987B\u4F4D\u4E8E\u6CE8\u518C\u9879\u76EE\u5185", { status: 403, details: { path } });
      }
    }
  }
  async #initializeLocked() {
    this.#records = await this.#readWal();
    if (!await exists(this.mapPath)) {
      const created = await this.shared.createEmptyMap({
        name: basename(this.projectRoot),
        now: this.clock().toISOString()
      });
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
      await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.json.corrupt").catch(() => {
      });
      const candidate = await this.#latestRecoverableDocument();
      if (!candidate) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError("CORRUPT_MAP", "map.json cannot be parsed or recovered", {
          status: 409,
          cause: error
        });
      }
      document = candidate.document;
      await writeJsonAtomic(this.mapPath, document);
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
    let result;
    try {
      result = validationResult(await this.shared.validateDocument(document));
    } catch (error) {
      throw new BridgeError(code, "Map document validation threw an error", {
        status: 422,
        details: { validationError: error.message },
        cause: error
      });
    }
    if (!result.ok) {
      throw new BridgeError(code, "Map document failed validation", {
        status: 422,
        details: { errors: result.errors, readOnly: result.readOnly === true }
      });
    }
  }
  async #readWal() {
    if (!await exists(this.walPath)) return [];
    const metadata = await stat2(this.walPath);
    if (metadata.size > 128 * 1024 * 1024) {
      throw new BridgeError("WAL_TOO_LARGE", "WAL \u8D85\u8FC7 128 MiB \u5B89\u5168\u4E0A\u9650\uFF0C\u9700\u8981\u4EBA\u5DE5\u6062\u590D", { status: 413, details: { size: metadata.size } });
    }
    const content = await readFile2(this.walPath, "utf8");
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
      const result = validationResult(await this.shared.validateDocument(disk2));
      if (result.ok || result.readOnly !== true) {
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
      const quarantinePath = await quarantineCopy(this.mapPath, this.quarantineDirectory, "map.operation-corrupt.json").catch(() => void 0);
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
    const path = join2(this.snapshotDirectory, `rev-${String(this.revision).padStart(12, "0")}-${timestampName(this.clock())}.json`);
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
    const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
    await Promise.all(entries.slice(0, Math.max(0, entries.length - keep)).map((name) => unlink2(join2(directory, name))));
  }
  async #ensureDailyBackup() {
    const day = this.clock().toISOString().slice(0, 10);
    const path = join2(this.backupDirectory, `${day}.json`);
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
      const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name).sort();
      const selected = name === void 0 ? entries.at(-1) : basename(name);
      if (!selected || !entries.includes(selected) || selected !== (name === void 0 ? selected : name)) {
        throw new BridgeError("RECOVERY_IMAGE_NOT_FOUND", "Requested recovery image was not found", {
          status: 404,
          details: { source, name }
        });
      }
      const envelope2 = await readJson(join2(directory, selected));
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
import { randomBytes as randomBytes2, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile as readFile4 } from "node:fs/promises";
import { join as join5 } from "node:path";

// src/bridge/shared-adapter.mjs
var REQUIRED_EXPORTS = ["validateMapDocument", "applyMapCommand", "applyCommandEnvelope", "envelopeTouches", "createEmptyMap", "migrateMapV1", "retrieveContext", "autonomyDecision"];
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
    autonomyDecision: shared.autonomyDecision,
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
import { createHash as createHash3, randomUUID as randomUUID3 } from "node:crypto";
import { execFile } from "node:child_process";
import { access, copyFile as copyFile2, mkdir as mkdir3, readFile as readFile3, rename as rename2, rm, stat as stat3, writeFile as writeFile3 } from "node:fs/promises";
import { constants } from "node:fs";
import { basename as basename2, dirname as dirname3, join as join4, resolve as resolve3 } from "node:path";
import { fileURLToPath } from "node:url";

// agent-kit/lib/bridge-client.mjs
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
var MCP_TOOL_NAMES = Object.freeze([
  "map_get_context",
  "map_list_human_updates",
  "map_ack_human_updates",
  "map_next_candidates",
  "map_apply_commands",
  "map_validate",
  "map_checkpoint"
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
  const digest = createHash2("sha256").update(String(projectRoot)).digest("hex").slice(0, 32);
  return `project:${digest}`;
}

// agent-kit/lib/shortcut.mjs
import { execFileSync } from "node:child_process";
import { mkdir as mkdir2, writeFile as writeFile2 } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname as dirname2, join as join3, resolve as resolve2 } from "node:path";
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
function windowsDesktopDirectory({ platform = process.platform, env = process.env, exec = execFileSync } = {}) {
  if (platform !== "win32") return join3(homedir(), "Desktop");
  try {
    const output = exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('Desktop')"], { encoding: "utf8", timeout: 5e3 });
    const path = String(output || "").trim();
    if (path) return path;
  } catch {
  }
  return join3(env.USERPROFILE || homedir(), "Desktop");
}
async function createShortcut({
  target,
  arguments: args = "",
  name = "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865",
  desktopDirectory,
  platform = process.platform,
  env = process.env,
  exec = execFileSync
} = {}) {
  if (!target) return { ok: false, skipped: true, reason: "missing-target" };
  const desktop = desktopDirectory || windowsDesktopDirectory({ platform, env, exec });
  await mkdir2(desktop, { recursive: true });
  if (platform !== "win32") {
    const launcher = join3(desktop, `${name}.command`);
    const script2 = `#!/bin/sh
exec ${JSON.stringify(resolve2(target))}${args ? ` ${args}` : ""}
`;
    await writeFile2(launcher, script2, { encoding: "utf8" });
    return { ok: true, type: "command", path: launcher };
  }
  const shortcut = join3(desktop, `${name}.lnk`);
  const script = [
    "$ws=New-Object -ComObject WScript.Shell",
    `$sc=$ws.CreateShortcut(${psQuote(shortcut)})`,
    `$sc.TargetPath=${psQuote(resolve2(target))}`,
    args ? `$sc.Arguments=${psQuote(args)}` : "",
    `$sc.WorkingDirectory=${psQuote(dirname2(resolve2(target)))}`,
    "$sc.Save()"
  ].filter(Boolean).join(";");
  try {
    exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { stdio: "ignore", timeout: 1e4 });
    return { ok: true, type: "windows-lnk", path: shortcut };
  } catch (error) {
    const fallback = join3(desktop, `${name}.cmd`);
    await writeFile2(fallback, `@echo off
"${resolve2(target)}" ${args}
`, { encoding: "utf8" });
    return { ok: false, type: "windows-lnk", path: shortcut, fallback, reason: "powershell-shortcut-failed", error };
  }
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
var ADAPTER_PROBES = Object.freeze({
  codex: ["codex"],
  "claude-code": ["claude", "claude-code"],
  "kimi-code": ["kimi", "kimi-code"]
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
  await mkdir3(dirname3(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${randomUUID3()}`;
  await writeFile3(temp, text, { encoding: "utf8", flag: "wx" });
  await rename2(temp, path);
}
async function atomicJson(path, value) {
  await atomicText(path, `${JSON.stringify(value, null, 2)}
`);
}
async function readJson2(path, fallback = {}) {
  try {
    const value = JSON.parse(await readFile3(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function sha256(bytes) {
  return createHash3("sha256").update(bytes).digest("hex");
}
async function captureFile(path) {
  try {
    const metadata = await stat3(path);
    if (metadata.isDirectory()) return { path, exists: true, kind: "directory", sha256: null, content: null };
    const bytes = await readFile3(path);
    return { path, exists: true, kind: "file", sha256: sha256(bytes), content: bytes.toString("base64") };
  } catch {
    return { path, exists: false, kind: "missing", sha256: null, content: null };
  }
}
async function restoreCapturedFile(entry) {
  if (entry?.kind === "directory") return;
  if (entry?.exists) {
    await mkdir3(dirname3(entry.path), { recursive: true });
    await writeFile3(entry.path, Buffer.from(String(entry.content || ""), "base64"));
  } else {
    await rm(entry.path, { force: true }).catch(() => void 0);
  }
}
var adapterConfigPaths = (root, id) => id === "codex" ? [join4(root, ".codex", "config.toml"), join4(root, ".codex", "hooks.json")] : id === "claude-code" ? [join4(root, ".mcp.json"), join4(root, ".claude", "settings.json")] : [join4(root, ".kimi-code", "mcp.json"), join4(root, ".live-dot-map", "kimi-plugin", "kimi.plugin.json"), join4(root, ".live-dot-map", "kimi-plugin", "runtime", "livedot.mjs")];
function seaRuntime() {
  return process.env.LIVEDOT_SEA === "1";
}
function runtimeArgs(runtime) {
  return seaRuntime() ? [] : [runtime];
}
function command(nodeCommand, runtime, root, agent, event) {
  return [`"${nodeCommand}"`, ...runtimeArgs(runtime).map((arg) => `"${arg}"`), "hook", "--event", event, "--project", `"${root}"`, "--agent", agent].join(" ");
}
function execProbe(file, args = []) {
  return new Promise((resolve5) => {
    execFile(file, args, { windowsHide: true, timeout: 4e3 }, (error, stdout = "") => {
      resolve5(!error && String(stdout).trim().length > 0);
    });
  });
}
async function commandExists(file) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  return execProbe(locator, [file]);
}
async function detectInstalledAdapters({ projectRoot = process.cwd(), platform = process.platform } = {}) {
  const root = resolve3(projectRoot);
  const checks = await Promise.all(ADAPTERS.map(async (id) => {
    const configPaths = id === "codex" ? [join4(root, ".codex", "config.toml"), join4(root, ".codex", "hooks.json")] : id === "claude-code" ? [join4(root, ".mcp.json"), join4(root, ".claude", "settings.json")] : [join4(root, ".kimi-code", "mcp.json"), join4(root, ".live-dot-map", "kimi-plugin", "kimi.plugin.json")];
    const configured = (await Promise.all(configPaths.map(async (path) => {
      const text = await readFile3(path, "utf8").catch(() => "");
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
    return [id, { id, configured, executable, discovered: configured || executable }];
  }));
  return Object.fromEntries(checks);
}
function hooksFor(nodeCommand, runtime, root, agent) {
  return Object.fromEntries([
    ["SessionStart", "session-start"],
    ["UserPromptSubmit", "user-prompt"],
    ["Stop", "stop"]
  ].map(([name, event]) => [name, [{ hooks: [{ type: "command", command: command(nodeCommand, runtime, root, agent, event), timeout: 10 }] }]]));
}
function mergeHooks(existing, additions) {
  const hooks = { ...existing?.hooks || {} };
  for (const [event, groups] of Object.entries(additions)) {
    const prior = Array.isArray(hooks[event]) ? hooks[event] : [];
    const kept = prior.filter((group) => !JSON.stringify(group).includes("livedot.mjs"));
    hooks[event] = [...kept, ...groups];
  }
  return { ...existing, hooks };
}
function tomlString(value) {
  return JSON.stringify(String(value));
}
async function writeCodexConfig(root, nodeCommand, runtime) {
  const path = join4(root, ".codex", "config.toml");
  const begin = "# BEGIN LIVE-DOT-MAP";
  const end = "# END LIVE-DOT-MAP";
  const old = await readFile3(path, "utf8").catch(() => "");
  const stripped = old.replace(new RegExp(`${begin}[\\s\\S]*?${end}\\s*`, "g"), "").trimEnd();
  const block = [begin, '[mcp_servers."livedot-map"]', `command = ${tomlString(nodeCommand)}`, `args = [${[...runtimeArgs(runtime), "mcp", "--project", root, "--agent", "codex"].map(tomlString).join(", ")}]`, "required = true", end].join("\n");
  await atomicText(path, `${stripped ? `${stripped}

` : ""}${block}
`);
  await atomicJson(join4(root, ".codex", "hooks.json"), mergeHooks(await readJson2(join4(root, ".codex", "hooks.json")), hooksFor(nodeCommand, runtime, root, "codex")));
  return [path, join4(root, ".codex", "hooks.json")];
}
async function writeClaudeConfig(root, nodeCommand, runtime) {
  const settingsPath = join4(root, ".claude", "settings.json");
  await atomicJson(settingsPath, mergeHooks(await readJson2(settingsPath), hooksFor(nodeCommand, runtime, root, "claude")));
  const mcpPath = join4(root, ".mcp.json");
  const mcp = await readJson2(mcpPath);
  mcp.mcpServers = { ...mcp.mcpServers || {}, "livedot-map": { type: "stdio", command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--project", root, "--agent", "claude"] } };
  await atomicJson(mcpPath, mcp);
  return [settingsPath, mcpPath];
}
async function writeKimiConfig(root, nodeCommand, runtime) {
  const mcpPath = join4(root, ".kimi-code", "mcp.json");
  const mcp = await readJson2(mcpPath);
  mcp.mcpServers = { ...mcp.mcpServers || {}, "livedot-map": { command: nodeCommand, args: [...runtimeArgs(runtime), "mcp", "--project", root, "--agent", "kimi"] } };
  await atomicJson(mcpPath, mcp);
  const plugin = join4(root, ".live-dot-map", "kimi-plugin");
  const pluginRuntime = join4(plugin, "runtime", "livedot.mjs");
  await mkdir3(dirname3(pluginRuntime), { recursive: true });
  if (!seaRuntime()) await copyFile2(runtime, pluginRuntime);
  const pluginInvocation = [`"${nodeCommand}"`, ...seaRuntime() ? [] : ["./runtime/livedot.mjs"].map((arg) => `"${arg}"`)].join(" ");
  const manifest = {
    name: "livedot-map",
    version: "2.0.0",
    description: "\u6D3B\u70B9\u5730\u56FE\u4EBA\u673A\u534F\u4F5C\u95ED\u73AF",
    mcpServers: { "livedot-map": { command: nodeCommand, args: [...seaRuntime() ? [] : ["./runtime/livedot.mjs"], "mcp", "--project", ".", "--agent", "kimi"] } },
    hooks: [
      { event: "SessionStart", command: `${pluginInvocation} hook --event session-start --project . --agent kimi`, timeout: 10 },
      { event: "UserPromptSubmit", command: `${pluginInvocation} hook --event user-prompt --project . --agent kimi`, timeout: 10 },
      { event: "Stop", command: `${pluginInvocation} hook --event stop --project . --agent kimi`, timeout: 10 }
    ]
  };
  await atomicJson(join4(plugin, "kimi.plugin.json"), manifest);
  return [mcpPath, join4(plugin, "kimi.plugin.json")];
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
  discoverAgents = true
} = {}) {
  const root = resolve3(projectRoot);
  if (!await exists2(root)) throw new Error(`\u9879\u76EE\u76EE\u5F55\u4E0D\u5B58\u5728: ${root}`);
  const source = resolve3(sourceRoot instanceof URL ? fileURLToPath(sourceRoot) : sourceRoot || process.cwd());
  const sourceRuntime = resolve3(runtimeSource || resolve3(source, "livedot.mjs"));
  if (!seaRuntime() && !await exists2(sourceRuntime)) throw new Error(`\u7F3A\u5C11\u5DF2\u6784\u5EFA\u8FD0\u884C\u65F6: ${sourceRuntime}`);
  const dataDir = join4(root, ".live-dot-map");
  const runtime = seaRuntime() ? null : join4(dataDir, "livedot.mjs");
  await mkdir3(dataDir, { recursive: true });
  const projectId = projectIdForRoot(root);
  const mapPath = join4(dataDir, "map.json");
  const configPath = join4(dataDir, "agent-kit.json");
  const old = await readJson2(configPath);
  const url = bridgeUrl || old?.bridge?.url || "http://127.0.0.1:0";
  assertLoopbackUrl(url);
  const nodeCommand = process.execPath;
  const detected = discoverAgents ? await detectInstalledAdapters({ projectRoot: root, platform }) : Object.fromEntries(ADAPTERS.map((id) => [id, { id, configured: false, executable: false, discovered: true }]));
  const installed = {};
  for (const id of ADAPTERS) if (detected[id]?.discovered) installed[id] = true;
  const backupPath = join4(dataDir, "backups", "agent-kit-install.json");
  const beforeBackup = await captureFile(backupPath);
  const oldRuntime = runtime ? await captureFile(runtime) : { exists: false, kind: "missing", path: null };
  const oldMap = await captureFile(mapPath);
  const touched = /* @__PURE__ */ new Set([configPath, ...runtime ? [runtime] : []]);
  for (const id of /* @__PURE__ */ new Set([...Object.keys(old.installed || {}), ...Object.keys(installed)])) for (const path of adapterConfigPaths(root, id)) touched.add(path);
  const existingBackup = await readJson2(backupPath, null);
  const backupFiles = new Map(Array.isArray(existingBackup?.files) ? existingBackup.files.map((entry) => [entry.path, entry]) : []);
  for (const path of touched) if (!backupFiles.has(path)) backupFiles.set(path, await captureFile(path));
  const backup = existingBackup?.version === 1 && Array.isArray(existingBackup.files) ? { ...existingBackup, files: [...backupFiles.values()] } : { version: 1, createdAt: (/* @__PURE__ */ new Date()).toISOString(), projectRoot: root, files: [...backupFiles.values()] };
  const rollback = async () => {
    for (const entry of backup.files) await restoreCapturedFile(entry);
    await restoreCapturedFile(beforeBackup);
    if (!oldMap.exists) await rm(mapPath, { force: true }).catch(() => void 0);
    if (runtime && !oldRuntime.exists) await rm(runtime, { force: true }).catch(() => void 0);
  };
  try {
    await atomicJson(backupPath, backup);
    if (runtime && resolve3(sourceRuntime) !== resolve3(runtime)) await copyFile2(sourceRuntime, runtime);
    if (!oldMap.exists) {
      const map = structuredClone(map_template_default);
      if (map.version !== 2) throw new Error("\u5185\u7F6E map.json \u6A21\u677F\u4E0D\u662F v2");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      map.mapId = projectId;
      map.name = basename2(root);
      map.createdAt = now;
      map.updatedAt = now;
      for (const collection of ["routes", "nodes", "edges", "anns"]) for (const item of Array.isArray(map[collection]) ? map[collection] : []) {
        item.createdAt = now;
        item.updatedAt = now;
        item.updatedBy = "installer";
      }
      await atomicJson(mapPath, map);
    }
    if (installed.codex) await writeCodexConfig(root, nodeCommand, runtime);
    if (installed["claude-code"]) await writeClaudeConfig(root, nodeCommand, runtime);
    if (installed["kimi-code"]) await writeKimiConfig(root, nodeCommand, runtime);
    const config = {
      ...old,
      version: 2,
      projectId: old.projectId || projectId,
      projectRoot: root,
      runtime,
      runtimeMode: seaRuntime() ? "sea" : "node",
      nodeCommand,
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
    const result = {
      ok: true,
      projectRoot: root,
      projectId: config.projectId,
      configPath,
      runtime,
      installed,
      detectedAgents: detected,
      bridge: { registered: true, mode: "project-config" },
      shortcut: null,
      trustRequired: Object.fromEntries(Object.keys(installed).map((id) => [id, id === "codex" ? "\u5728 Codex /hooks \u4E2D\u4FE1\u4EFB\u9879\u76EE hooks" : id === "claude-code" ? "\u9996\u6B21\u6253\u5F00\u9879\u76EE\u65F6\u786E\u8BA4 hooks \u4E0E MCP" : `\u5728 Kimi \u6267\u884C /plugins install ${join4(dataDir, "kimi-plugin")}`])),
      runtimePlan: runtimePlan({ offline })
    };
    if (register && bridgeClient) {
      result.bridge.registration = await bridgeClient.openProject(root);
      result.bridge.mode = "live-bridge";
    }
    if (createDesktopShortcut && platform === "win32") {
      const launcher = join4(dataDir, "\u542F\u52A8\u6D3B\u70B9\u5730\u56FE.cmd");
      const app = resolve3(appPath || join4(root, "app.html"));
      await atomicText(launcher, `@echo off\r
"${nodeCommand}"${runtimeArgs(runtime).map((arg) => ` "${arg}"`).join("")} serve --project "${root}" --app "${app}"\r
`);
      try {
        result.shortcut = await createShortcut({ target: launcher, name: "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865", platform, env, exec });
      } catch (error) {
        const fallback = join4(dataDir, "\u6253\u5F00\u6D3B\u70B9\u5730\u56FE.cmd");
        await atomicText(fallback, `@echo off\r
"${launcher}"\r
`);
        result.shortcut = { ok: false, type: "project-fallback", fallback, reason: "shortcut-location-unavailable", error: error?.message };
      }
    }
    return result;
  } catch (error) {
    await rollback();
    throw error;
  }
}
async function uninstallProject({ projectRoot = process.cwd(), platform = process.platform, env = process.env, exec } = {}) {
  const root = resolve3(projectRoot);
  const dataDir = join4(root, ".live-dot-map");
  const configPath = join4(dataDir, "agent-kit.json");
  const config = await readJson2(configPath, null);
  if (!config || typeof config !== "object") return { ok: false, reason: "not-installed", projectRoot: root, mapPreserved: await exists2(join4(dataDir, "map.json")) };
  const backupPath = typeof config.installBackup === "string" ? config.installBackup : join4(dataDir, "backups", "agent-kit-install.json");
  const backup = await readJson2(backupPath, null);
  const installedFiles = config.installedFiles && typeof config.installedFiles === "object" ? config.installedFiles : {};
  const restored = [];
  const skipped = [];
  for (const entry of Array.isArray(backup?.files) ? backup.files : []) {
    if (!entry?.path || entry.path === join4(dataDir, "map.json") || entry.path === backupPath) continue;
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
  const launcherPaths = [join4(dataDir, "\u542F\u52A8\u6D3B\u70B9\u5730\u56FE.cmd"), join4(dataDir, "\u6253\u5F00\u6D3B\u70B9\u5730\u56FE.cmd")];
  if (platform === "win32") {
    const desktop = windowsDesktopDirectory({ platform, env, exec });
    launcherPaths.push(join4(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.lnk"), join4(desktop, "\u6D3B\u70B9\u5730\u56FE\u672C\u5730\u6865.cmd"));
  }
  for (const path of launcherPaths) {
    const current = await captureFile(path);
    if (!current.exists) continue;
    const looksOwned = path.includes(dataDir) || current.content?.includes(Buffer.from("livedot.mjs").toString("base64"));
    if (looksOwned) {
      await rm(path, { force: true });
      restored.push(path);
    }
  }
  const mapPreserved = await exists2(join4(dataDir, "map.json"));
  return { ok: skipped.length === 0, projectRoot: root, restored, skipped, mapPreserved, backupPath };
}
async function doctorProject({ projectRoot = process.cwd(), checkBridge = false, bridgeClient, offline = true } = {}) {
  const root = resolve3(projectRoot);
  const configPath = join4(root, ".live-dot-map", "agent-kit.json");
  const config = await readJson2(configPath, null);
  const installed = config?.installed && typeof config.installed === "object" ? config.installed : {};
  const expected = [
    ["agent-kit-config", configPath],
    ["map", join4(root, ".live-dot-map", "map.json")]
  ];
  if (config?.runtimeMode !== "sea" && config?.runtime !== null) expected.push(["runtime", join4(root, ".live-dot-map", "livedot.mjs")]);
  if (installed.codex) expected.push(["codex-hooks", join4(root, ".codex", "hooks.json")], ["codex-mcp", join4(root, ".codex", "config.toml")]);
  if (installed["claude-code"]) expected.push(["claude-hooks", join4(root, ".claude", "settings.json")], ["claude-mcp", join4(root, ".mcp.json")]);
  if (installed["kimi-code"]) expected.push(["kimi-mcp", join4(root, ".kimi-code", "mcp.json")], ["kimi-plugin", join4(root, ".live-dot-map", "kimi-plugin", "kimi.plugin.json")]);
  const checks = [{ name: "project-root", ok: await exists2(root), detail: root }];
  for (const [name, path] of expected) checks.push({ name, ok: await exists2(path), detail: path });
  const detectedAgents = await detectInstalledAdapters({ projectRoot: root });
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
function randomToken(bytes = 32) {
  return randomBytes2(bytes).toString("base64url");
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
  staticAssets = {}
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
  async function activeStore(session) {
    if (!session.projectRoot) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
    return stores.get(session.projectRoot);
  }
  async function openProject(requestedRoot) {
    let root;
    try {
      root = await canonicalDirectory(requestedRoot);
    } catch {
      throw new BridgeError("PROJECT_NOT_ALLOWED", "Project root is not allowlisted", { status: 403 });
    }
    if (!roots.has(root)) throw new BridgeError("PROJECT_NOT_ALLOWED", "Project root is not allowlisted", { status: 403 });
    let store = stores.get(root);
    if (!store) {
      store = await ProjectStore.open({
        projectRoot: root,
        shared: adapter,
        snapshotEvery,
        pollIntervalMs,
        clock,
        faultInjector,
        onEvent: (event) => events.publish(
          root,
          event.type === "external" ? { ...event, type: "revision", source: "external" } : event
        )
      });
      stores.set(root, store);
    }
    return { root, store };
  }
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      validateHost(request);
      const url = new URL(request.url, `http://${request.headers.host}`);
      const aliases = /* @__PURE__ */ new Map([
        ["/api/v1/health", "/health"],
        ["/api/v1/session", "/session"],
        ["/api/v1/projects/open", "/open"],
        ["/api/v1/snapshot", "/snapshot"],
        ["/api/v1/commands", "/commands"],
        ["/api/v1/events", "/events"],
        ["/api/v1/recover", "/recover"],
        ["/api/v1/agents", "/agents"]
      ]);
      const pathname = aliases.get(url.pathname) || url.pathname;
      if (request.method === "OPTIONS") {
        validateOrigin(request, response);
        response.statusCode = 204;
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      if (pathname === "/session") {
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
        sendJson(response, 201, { csrfToken, expiresAt: new Date(expiresAt).toISOString() });
        return;
      }
      const session = authenticate(request);
      if (pathname === "/open") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const body = await readJsonBody(request, bodyLimit);
        if (typeof body.projectRoot !== "string") throw new BridgeError("PROJECT_ROOT_REQUIRED", "projectRoot is required", { status: 400 });
        const { root, store } = await openProject(body.projectRoot);
        session.projectRoot = root;
        const snapshot = await store.snapshot();
        sendJson(response, 200, { projectRoot: root, projectId: snapshot.document.mapId, ...snapshot });
        return;
      }
      if (pathname === "/agents") {
        requireMethod(request, "GET");
        const root = session.projectRoot;
        if (!root) throw new BridgeError("PROJECT_NOT_OPEN", "Open an allowlisted project first", { status: 409 });
        const detected = await detectInstalledAdapters({ projectRoot: root });
        let config = {};
        try {
          const parsed = JSON.parse(await readFile4(join5(root, ".live-dot-map", "agent-kit.json"), "utf8"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
        } catch {
        }
        const trust = config.trust && typeof config.trust === "object" ? config.trust : {};
        const agents = Object.values(detected).map((item) => {
          const id = String(item.id);
          let state = "not_installed";
          if (item.configured && !item.executable) state = "error";
          else if (item.configured && item.executable) state = trust[id]?.acknowledged === true ? "connected" : "awaiting_trust";
          else if (item.executable) state = "discovered";
          return { ...item, state, trustAcknowledged: trust[id]?.acknowledged === true };
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
      if (pathname === "/commands") {
        requireMethod(request, "POST");
        validateCsrf(request, session);
        const store = await activeStore(session);
        const body = await readJsonBody(request, bodyLimit);
        sendJson(response, 200, await store.execute(body));
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
        events.subscribe(session.projectRoot, response);
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
        const tool = body.tool || body.name;
        const args = body.arguments && typeof body.arguments === "object" ? body.arguments : {};
        const snapshot = await store.snapshot();
        let result;
        if (tool === "map_get_context") {
          result = { revision: snapshot.revision, ...adapter.retrieveContext(snapshot.document, String(args.query || ""), { markdown: Array.isArray(args.markdown) ? args.markdown : [] }) };
        } else if (tool === "map_list_human_updates") {
          result = { revision: snapshot.revision, updates: snapshot.document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(ann.attention)) };
        } else if (tool === "map_ack_human_updates") {
          result = await store.execute(args);
        } else if (tool === "map_next_candidates") {
          const context = adapter.retrieveContext(snapshot.document, String(args.query || ""), {
            currentNodeId: args.currentNodeId === null || args.currentNodeId === void 0 ? null : String(args.currentNodeId),
            limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
            includeHistory: args.includeHistory === true,
            markdown: Array.isArray(args.markdown) ? args.markdown : []
          });
          result = { revision: snapshot.revision, ...context, autonomy: adapter.autonomyDecision(snapshot.document, context.objects) };
        } else if (tool === "map_apply_commands") {
          result = await store.execute(args);
        } else if (tool === "map_validate") {
          result = await adapter.validateDocument(args.document || snapshot.document);
        } else if (tool === "map_checkpoint") {
          result = await store.createSnapshot();
        } else {
          throw new BridgeError("UNKNOWN_MCP_TOOL", "Unknown MCP tool", { status: 404 });
        }
        sendJson(response, 200, { tool, result });
        return;
      }
      throw new BridgeError("NOT_FOUND", "Endpoint not found", { status: 404 });
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.end();
    }
  });
  server.maxHeadersCount = 64;
  server.headersTimeout = 1e4;
  server.requestTimeout = 15e3;
  server.keepAliveTimeout = 5e3;
  await new Promise((resolve5, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve5);
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
      await new Promise((resolve5, reject) => {
        server.close((error) => error ? reject(error) : resolve5());
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
  for (const [i, edge] of byCollection.edges.entries()) {
    if (!nodeIds.has(String(edge.from))) errors.push(`edges[${i}].from \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.to !== null && !nodeIds.has(String(edge.to))) errors.push(`edges[${i}].to \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (!["success", "failed", "pending"].includes(String(edge.status))) errors.push(`edges[${i}].status \u65E0\u6548`);
    if (edge.route !== null && edge.route !== void 0 && !routeIds.has(String(edge.route))) errors.push(`edges[${i}].route \u5F15\u7528\u4E0D\u5B58\u5728`);
    if (edge.score !== void 0 && (!Number.isInteger(edge.score) || Number(edge.score) < 0 || Number(edge.score) > 100)) errors.push(`edges[${i}].score \u65E0\u6548`);
  }
  for (const [i, node] of byCollection.nodes.entries()) {
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
  return [item.id, item.name, item.type, item.text, item.status, item.reviewNote].filter((v) => typeof v === "string").join(" ");
}
function ageScore2(updatedAt, now) {
  if (typeof updatedAt !== "string") return 0;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const days = Math.max(0, (now.getTime() - timestamp) / 864e5);
  return Math.max(0, 60 - Math.floor(days) * 5);
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
  for (const edge of document.edges) if (typeof edge.from === "string" && typeof edge.to === "string") {
    connect(edge.from, edge.to);
    connect(edge.to, edge.from);
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
function autonomyDecision2(document, candidates) {
  const reasons = [];
  if (document.anns.some((ann) => ann.attention === "new" || ann.attention === "delivered")) reasons.push("\u5B58\u5728\u5C1A\u672A\u786E\u8BA4\u7684\u4EBA\u7C7B\u6807\u6CE8");
  if (document.nodes.some((node) => isObject2(node.milestone) && node.milestone.status === "pending")) reasons.push("\u5B58\u5728\u5F85\u5BA1\u6838\u91CC\u7A0B\u7891");
  const first = candidates[0]?.score ?? 0;
  const second = candidates[1]?.score ?? 0;
  if (first < 500 || first - second < 150) reasons.push("\u5019\u9009\u7F6E\u4FE1\u5EA6\u6216\u9886\u5148\u5E45\u5EA6\u4E0D\u8DB3");
  return { auto: reasons.length === 0, reasons };
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
async function markdownDocuments(root, limit = 200) {
  const output = [];
  const ignored = /* @__PURE__ */ new Set([".git", "node_modules", ".next", "dist", "out", ".bridge", "backups", "snapshots", "quarantine"]);
  const walk = async (directory, depth) => {
    if (depth > 5 || output.length >= limit) return;
    const entries = await readdir2(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (output.length >= limit || ignored.has(entry.name)) continue;
      const full = join6(directory, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
        const metadata = await stat4(full).catch(() => null);
        if (!metadata || metadata.size > 2e6) continue;
        const text = await readFile5(full, "utf8").catch(() => "");
        if (text && text.length <= 2e6) output.push({ path: full.slice(root.length + 1).replace(/\\/g, "/"), text });
      }
    }
  };
  await walk(root, 0);
  return output;
}
async function openStore(projectRoot) {
  return ProjectStore.open({ projectRoot: resolve4(projectRoot), shared: await loadSharedAdapter(), pollIntervalMs: 0 });
}
function envelope(projectId, revision, actor, sessionId, commands) {
  return { projectId, baseRevision: revision, commandId: `cmd-${randomUUID4()}`, actor, sessionId, commands };
}
async function callTool(store, root, tool, args, defaultActor = "agent:generic") {
  const snapshot = await store.snapshot();
  const document = snapshot.document;
  const actor = typeof args.actor === "string" ? args.actor : defaultActor;
  const sessionId = typeof args.sessionId === "string" ? args.sessionId : `session-${randomUUID4()}`;
  if (tool === "map_get_context") {
    return { revision: snapshot.revision, ...retrieveContext2(document, String(args.query ?? ""), { markdown: await markdownDocuments(root) }) };
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
    const context = retrieveContext2(document, String(args.query ?? ""), {
      currentNodeId: args.currentNodeId === null || args.currentNodeId === void 0 ? null : String(args.currentNodeId),
      limit: Number.isInteger(args.limit) ? Number(args.limit) : 12,
      includeHistory: args.includeHistory === true,
      markdown: await markdownDocuments(root)
    });
    return { revision: snapshot.revision, ...context, autonomy: autonomyDecision2(document, context.objects) };
  }
  if (tool === "map_apply_commands") {
    const request = args.envelope && typeof args.envelope === "object" ? args.envelope : {
      ...envelope(String(document.mapId), snapshot.revision, actor, sessionId, Array.isArray(args.commands) ? args.commands : []),
      baseRevision: Number.isInteger(args.baseRevision) ? args.baseRevision : snapshot.revision,
      commandId: typeof args.commandId === "string" ? args.commandId : `cmd-${randomUUID4()}`
    };
    return store.execute(request);
  }
  if (tool === "map_validate") return validateMapDocument2(args.document ?? document);
  if (tool === "map_checkpoint") return store.createSnapshot();
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
  ["map_checkpoint", "\u521B\u5EFA\u4EBA\u5DE5\u68C0\u67E5\u70B9", {}]
].map(([name, description, properties]) => ({ name, description, inputSchema: { type: "object", properties, additionalProperties: true } }));
async function runMcp(projectRoot, actor) {
  const root = resolve4(projectRoot);
  const store = await openStore(root);
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
      let result;
      if (request.method === "initialize") result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "live-dot-map", version: "2.0.0" } };
      else if (request.method === "tools/list") result = { tools: toolDefinitions };
      else if (request.method === "tools/call") {
        const params = request.params;
        const value = await callTool(store, root, String(params.name), params.arguments ?? {}, actor);
        result = { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
      } else throw Object.assign(new Error(`\u672A\u77E5\u65B9\u6CD5 ${String(request.method)}`), { code: -32601 });
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}
`);
    } catch (error) {
      const value = error;
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code: typeof value.code === "number" ? value.code : -32e3, message: value.message, data: { code: value.code, details: value.details } } })}
`);
    }
  }
}
async function runHook(kind, args) {
  const root = resolve4(required(args, "project"));
  const actor = `agent:${String(args.agent || "generic")}`;
  const sessionId = String(args.session || `session-${randomUUID4()}`);
  const store = await openStore(root);
  const snapshot = await store.snapshot();
  const document = snapshot.document;
  if (kind === "session-start") {
    const anns = document.anns.filter((ann) => ann.source === "human" && ["new", "delivered"].includes(String(ann.attention)));
    if (anns.some((ann) => ann.attention === "new")) {
      await store.execute(envelope(String(document.mapId), snapshot.revision, actor, sessionId, [{ op: "deliver_annotations", ids: anns.filter((ann) => ann.attention === "new").map((ann) => ann.id), deliveryId: sessionId }]));
    }
    const context = retrieveContext2(document, "", { markdown: await markdownDocuments(root) });
    const output = {
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: [
        `\u6D3B\u70B9\u5730\u56FE revision ${snapshot.revision}\u3002\u9996\u6B21\u6458\u8981\u5FC5\u987B\u9010\u5B57\u5F15\u7528\u4EE5\u4E0B\u4EBA\u7C7B\u6807\u6CE8 ID\uFF0C\u4E4B\u540E\u8C03\u7528 map_ack_human_updates\uFF1A`,
        ...anns.map((ann) => `${ann.id}: ${ann.text}`),
        `\u5019\u9009\uFF1A${context.objects.slice(0, 3).map((item) => `${item.id}(${item.reasons.join("\u3001")})`).join("\uFF1B") || "\u65E0"}`
      ].join("\n") },
      deliveredIds: anns.map((ann) => ann.id)
    };
    process.stdout.write(`${JSON.stringify(output)}
`);
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
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: JSON.stringify(context) } })}
`);
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
    const incomplete = Array.isArray(updates.updates) && updates.updates.length > 0;
    const attempt = Number(args.attempt || process.env.LIVEDOT_STOP_ATTEMPT || (hookInput.stop_hook_active ? 2 : 1)) || 1;
    if (incomplete && attempt >= 2) {
      const current = await store.snapshot();
      await store.execute(envelope(String(current.document.mapId), current.revision, actor, sessionId, [{
        op: "set_ui",
        patch: { collaboration: { status: "incomplete", agent: actor, sessionId, at: (/* @__PURE__ */ new Date()).toISOString(), reason: "\u4EBA\u7C7B\u6807\u6CE8\u672A\u5B8C\u6210\u6458\u8981\u5F15\u7528\u4E0E\u786E\u8BA4" } }
      }]));
    }
    process.stdout.write(`${JSON.stringify({
      decision: incomplete && attempt < 2 ? "block" : "allow",
      collaborationClosed: !incomplete,
      uiStatus: incomplete ? "error" : "saved",
      reason: incomplete ? attempt < 2 ? "\u4ECD\u6709\u4EBA\u7C7B\u6807\u6CE8\u672A\u5B8C\u6210\u6458\u8981\u5F15\u7528\u4E0E ack\uFF1B\u8BF7\u5148\u95ED\u73AF\u5730\u56FE\u3002" : "\u7B2C\u4E8C\u6B21\u68C0\u67E5\u4ECD\u672A\u95ED\u73AF\uFF0C\u5141\u8BB8\u7ED3\u675F\u4F46\u753B\u5E03\u4FDD\u6301\u7EA2\u8272\u3002" : "\u5730\u56FE\u95ED\u73AF\u5B8C\u6210\u3002"
    })}
`);
  }
}
async function main() {
  const { command: command2, args } = parseArgs(process.argv.slice(2));
  if (command2 === "serve") {
    const projectRoot = resolve4(required(args, "project"));
    const appPath = resolve4(typeof args.app === "string" ? args.app : join6(process.cwd(), "app.html"));
    const appHtml = await readFile5(appPath, "utf8");
    const assetRoot = dirname4(appPath);
    const staticAssets = {};
    for (const [urlPath, file, type] of [
      ["/sw.js", "sw.js", "text/javascript; charset=utf-8"],
      ["/manifest.webmanifest", "manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/icons/icon-192.png", join6("icons", "icon-192.png"), "image/png"],
      ["/icons/icon-512.png", join6("icons", "icon-512.png"), "image/png"]
    ]) {
      try {
        staticAssets[urlPath] = { body: await readFile5(join6(assetRoot, file)), type };
      } catch {
      }
    }
    const bridge = await createBridgeServer({ allowedProjectRoots: [projectRoot], appHtml, staticAssets });
    const url = `${bridge.origin}/app.html?token=${encodeURIComponent(bridge.bootstrapToken)}&project=${encodeURIComponent(projectRoot)}`;
    process.stdout.write(`${JSON.stringify({ ok: true, origin: bridge.origin, bootstrapToken: bridge.bootstrapToken, url })}
`);
    const shutdown = async () => {
      await bridge.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  if (command2 === "mcp") return runMcp(required(args, "project"), `agent:${String(args.agent || "generic")}`);
  if (command2 === "hook") return runHook(String(args.event || "session-start"), args);
  if (command2 === "install") {
    const root = resolve4(typeof args.project === "string" ? args.project : process.cwd());
    const runtimeSource = process.env.LIVEDOT_RUNTIME_SOURCE || process.argv[1] || fileURLToPath2(import.meta.url);
    const appPath = resolve4(typeof args.app === "string" ? args.app : join6(dirname4(runtimeSource), "app.html"));
    const install = installProject;
    const result = await install({ projectRoot: root, runtimeSource, appPath, createDesktopShortcut: args["no-shortcut"] !== true, register: false });
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
    return;
  }
  if (command2 === "doctor") {
    const root = resolve4(required(args, "project"));
    const result = await doctorProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command2 === "uninstall") {
    const root = resolve4(required(args, "project"));
    const result = await uninstallProject({ projectRoot: root });
    process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
    if (!result.ok && result.reason !== "not-installed") process.exitCode = 1;
    return;
  }
  process.stdout.write("\u6D3B\u70B9\u5730\u56FE v2\n  livedot.mjs install --project <path> --app <app.html>\n  livedot.mjs serve --project <path> --app <app.html>\n  livedot.mjs mcp --project <path> --agent codex|claude|kimi\n  livedot.mjs hook --event session-start|user-prompt|stop --project <path>\n  livedot.mjs doctor --project <path>\n  livedot.mjs uninstall --project <path>\n");
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
