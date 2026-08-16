// src/shared/index.ts
var MAP_VERSION = 2;
var COLLECTIONS = ["routes", "nodes", "edges", "anns"];
var ID = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
var ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
var DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
var MAX_NAME = 80;
var MAX_ANN = 4e3;
var MAX_AGENT_OBJECTS_PER_ENVELOPE = 10;
var MAX_AGENT_NEW_NODES_PER_ENVELOPE = 5;
var MAX_AGENT_MILESTONES_PER_ENVELOPE = 2;
var MAX_ACTIVE_NODES = 30;
var MAX_INITIAL_MAP_NODES = 15;
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
function assertHumanOnlyCommand(command, actor) {
  if (isAgent(actor) && command.op === "update" && command.humanOnly === true) {
    throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "\u8BE5\u6574\u7406\u547D\u4EE4\u53EA\u80FD\u7531\u4EBA\u5728\u753B\u5E03\u5BA1\u6838\u540E\u63D0\u4EA4", {
      suggestion: "\u5148\u8C03\u7528 map_plan_consolidation \u67E5\u770B\u53EA\u8BFB\u5EFA\u8BAE\uFF0C\u518D\u7531\u4EBA\u5728\u753B\u5E03\u786E\u8BA4"
    });
  }
}
function applyOne(document, command, actor, revision, now) {
  assertHumanOnlyCommand(command, actor);
  if (command.op === "create") {
    const value = cleanRecord(command.value, "value");
    if (typeof value.id !== "string" || !ID.test(value.id)) throw mapError("INVALID_ID", 422, "\u65B0\u5BF9\u8C61 ID \u65E0\u6548");
    if (getList(document, command.collection).some((v) => v.id === value.id)) throw mapError("DUPLICATE_ID", 409, `\u5BF9\u8C61 ${value.id} \u5DF2\u5B58\u5728`);
    if (command.collection !== "anns") assertName(value.name);
    if (command.collection === "nodes") {
      if (value.kind !== void 0 && !["goal", "problem", "result"].includes(String(value.kind))) throw mapError("INVALID_NODE_KIND", 422, "\u8282\u70B9 kind \u5FC5\u987B\u662F goal\u3001problem \u6216 result");
      value.kind = normalizeNodeKind(value.kind ?? value.type);
    }
    if (command.collection === "nodes" && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === "work") assertAgentMilestoneAllowed(value);
    }
    assertAgentCurationAllowed(value, actor);
    const item = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command.collection === "nodes" && value.milestone !== void 0) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command.collection === "nodes" && item.md === void 0) item.md = stableMarkdownPath("nodes", String(item.id), documentMapDir(document));
    if (command.collection === "edges" && item.md === void 0) item.md = stableMarkdownPath("edges", String(item.id), documentMapDir(document));
    if (command.collection === "anns") {
      if (typeof item.text !== "string" || item.text.length > MAX_ANN) throw mapError("INVALID_ANNOTATION", 422, "\u6807\u6CE8\u65E0\u6548\u6216\u8FC7\u957F");
      item.source = actor === "human" ? "human" : actor;
      item.priority = item.priority ?? "normal";
      item.attention = actor === "human" ? "new" : item.attention ?? "acknowledged";
      item.acknowledgements = [];
    }
    getList(document, command.collection).push(item);
    return;
  }
  if (command.op === "update") {
    const item = findItem(document, command.collection, command.id);
    const patch = cleanRecord(command.patch, "patch");
    for (const key of ["id", "createdAt", "createdBy", "updatedAt", "updatedBy", "updatedRevision"]) delete patch[key];
    if ("name" in patch) assertName(patch.name);
    if (command.collection === "nodes" && "kind" in patch) {
      if (!["goal", "problem", "result"].includes(String(patch.kind))) throw mapError("INVALID_NODE_KIND", 422, "\u8282\u70B9 kind \u5FC5\u987B\u662F goal\u3001problem \u6216 result");
    }
    assertAgentCurationAllowed(patch, actor);
    if (command.collection === "nodes" && isObject(patch.milestone)) {
      if (isAgent(actor)) {
        assertAgentMilestoneAllowed(patch.milestone);
      }
      patch.milestone = normalizeMilestone(patch.milestone, actor, now, revision, isObject(item.milestone) ? item.milestone : void 0);
    }
    Object.assign(item, patch);
    if (command.collection === "anns" && actor === "human") {
      item.source = "human";
      item.attention = "new";
      if (!Array.isArray(item.acknowledgements)) item.acknowledgements = [];
    }
    touch(item, actor, revision, now);
    return;
  }
  if (command.op === "delete") {
    if (actor.startsWith("agent:")) throw mapError("HUMAN_APPROVAL_REQUIRED", 403, "Agent \u4E0D\u80FD\u76F4\u63A5\u5220\u9664\u5BF9\u8C61");
    const list = getList(document, command.collection);
    const index = list.findIndex((entry) => entry.id === command.id);
    if (index < 0) return;
    if (command.collection === "nodes") {
      for (const route of document.routes) {
        if (route.currentNodeId === command.id) {
          delete route.currentNodeId;
          touch(route, actor, revision, now);
        }
      }
      document.edges = document.edges.filter((edge) => edge.from !== command.id);
      for (const edge of document.edges) {
        if (edge.to === command.id) {
          edge.to = null;
          edge.status = "pending";
          edge.dx = typeof edge.dx === "number" ? edge.dx : 120;
          edge.dy = typeof edge.dy === "number" ? edge.dy : 0;
          touch(edge, actor, revision, now);
        }
      }
      document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === "node" && ann.target.id === command.id));
    }
    if (command.collection === "edges") document.anns = document.anns.filter((ann) => !(isObject(ann.target) && ann.target.kind === "edge" && ann.target.id === command.id));
    list.splice(index, 1);
    return;
  }
  if (command.op === "set_view" || command.op === "set_ui") {
    const key = command.op === "set_view" ? "view" : "ui";
    document[key] = { ...document[key], ...cleanRecord(command.patch, key) };
    return;
  }
  if (command.op === "set_meta") {
    const patch = cleanRecord(command.patch, "meta");
    assertName(patch.name);
    document.name = String(patch.name).trim().slice(0, MAX_NAME);
    document.updatedAt = now;
    return;
  }
  if (command.op === "deliver_annotations") {
    for (const id of command.ids) {
      const ann = findItem(document, "anns", id);
      if (ann.attention === "new") ann.attention = "delivered";
      const deliveries = Array.isArray(ann.deliveries) ? ann.deliveries : [];
      if (!deliveries.some((entry) => isObject(entry) && entry.deliveryId === command.deliveryId)) deliveries.push({ deliveryId: command.deliveryId, sessionId: command.deliveryId, deliveredAt: now });
      ann.deliveries = deliveries;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === "ack_annotations") {
    if (!actor.startsWith("agent:")) throw mapError("AGENT_REQUIRED", 403, "\u53EA\u6709 Agent \u4F1A\u8BDD\u53EF\u4EE5\u786E\u8BA4\u8BFB\u53D6");
    for (const id of command.ids) if (!command.summary.includes(id)) throw mapError("ACK_MISSING_ID", 422, `\u6458\u8981\u6CA1\u6709\u5F15\u7528\u6807\u6CE8 ${id}`);
    for (const id of command.ids) {
      const ann = findItem(document, "anns", id);
      ann.attention = "acknowledged";
      const records = Array.isArray(ann.acknowledgements) ? ann.acknowledgements : [];
      records.push({ actor, sessionId: actor, acknowledgedAt: now, summary: command.summary });
      ann.acknowledgements = records;
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === "resolve_annotations") {
    for (const id of command.ids) {
      const ann = findItem(document, "anns", id);
      if (actor === "human") ann.attention = "resolved";
      else ann.resolutionProposal = { actor, evidence: command.evidence ?? "", proposedAt: now };
      touch(ann, actor, revision, now);
    }
    return;
  }
  if (command.op === "suggest_milestone") {
    const node = findItem(document, "nodes", command.nodeId);
    node.milestoneSuggestion = { status: command.status, reviewNote: command.reviewNote ?? null, suggestedBy: actor, suggestedAt: now };
    touch(node, actor, revision, now);
    return;
  }
  throw mapError("UNKNOWN_COMMAND", 400, `\u4E0D\u652F\u6301\u7684\u5730\u56FE\u547D\u4EE4\uFF1A${String(command?.op ?? "")}`);
}
function applyMapCommand(document, command, options = {}) {
  const validation = validateMapDocument(document);
  if (!validation.ok) throw mapError("INVALID_MAP", 422, "\u5F53\u524D\u5730\u56FE\u65E0\u6548", validation.errors);
  const next = clone(document);
  const revision = options.revision ?? next.revision + 1;
  const now = utcNow(options.now);
  applyOne(next, command, options.actor ?? "human", revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const result = validateMapDocument(next);
  if (!result.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", result.errors);
  return next;
}
function applyCommandEnvelope(document, envelope, options = {}) {
  if (!envelope || !Array.isArray(envelope.commands) || envelope.commands.length === 0 || envelope.commands.length > 100) throw mapError("INVALID_ENVELOPE", 400, "commands \u5FC5\u987B\u5305\u542B 1\u2013100 \u6761\u547D\u4EE4");
  if (!ID.test(envelope.projectId) || !ID.test(envelope.commandId) || !ID.test(envelope.sessionId)) throw mapError("INVALID_ENVELOPE", 400, "projectId/commandId/sessionId \u65E0\u6548");
  if (!Number.isInteger(envelope.baseRevision) || envelope.baseRevision < 0) throw mapError("INVALID_ENVELOPE", 400, "baseRevision \u65E0\u6548");
  const agentInitialMap = isAgent(envelope.actor) && (document.nodes.length === 0 || isObject(document.ui?.initialization) && document.ui.initialization.status === "in_progress");
  if (isAgent(envelope.actor)) {
    const objectCommands = envelope.commands.filter((command) => ["create", "update", "delete"].includes(command.op));
    const nodeCreates = envelope.commands.filter((command) => command.op === "create" && command.collection === "nodes");
    const milestoneCreates = nodeCreates.filter((command) => isObject(command.value) && command.value.milestone !== void 0);
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
  if (agentInitialMap && !isObject(next.ui.initialization)) next.ui.initialization = { status: "in_progress", startedBy: envelope.actor, startedAt: now };
  for (const command of envelope.commands) applyOne(next, command, envelope.actor, revision, now);
  next.revision = revision;
  next.lastEventId += 1;
  next.updatedAt = now;
  const validation = validateMapDocument(next);
  if (!validation.ok) throw mapError("COMMAND_INVALID_RESULT", 422, "\u547D\u4EE4\u4F1A\u4EA7\u751F\u65E0\u6548\u5730\u56FE", validation.errors);
  return next;
}
function commandTouches(command) {
  if (command.op === "create" || command.op === "delete") return [`${command.collection}/${command.op === "create" ? String(command.value.id ?? "*") : command.id}/*`];
  if (command.op === "update") return Object.keys(command.patch).map((key) => `${command.collection}/${command.id}/${key}`);
  if (command.op === "set_view" || command.op === "set_ui") return Object.keys(command.patch).map((key) => `${command.op === "set_view" ? "view" : "ui"}/${key}`);
  if (command.op === "set_meta") return ["meta/name"];
  if ("ids" in command) return command.ids.map((id) => `anns/${id}/attention`);
  if (command.op === "suggest_milestone") return [`nodes/${command.nodeId}/milestoneSuggestion`];
  return ["*"];
}
function envelopeTouches(envelope) {
  return [...new Set(envelope.commands.flatMap(commandTouches))].sort();
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
    const required = status === "pending" ? ["\u5173\u952E\u8BC1\u636E", "\u4E0B\u4E00\u6B65"] : ["\u5173\u952E\u8BC1\u636E", "\u7ED3\u679C", "\u4E0B\u4E00\u6B65"];
    if (status === "failed") required.push("\u5931\u8D25\u539F\u56E0");
    if (status === "success") required.push("\u8BC4\u5206");
    const missing = required.filter((heading) => !headingContent(text, heading));
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
  for (const command of commands) {
    if (command.op !== "update" || command.patch.archived !== true) continue;
    const key = `${command.collection}/${command.id}`;
    if (archived.has(key)) continue;
    archived.add(key);
    if (command.collection === "nodes") after.activeNodes = Math.max(0, after.activeNodes - 1);
    if (command.collection === "edges") after.activeEdges = Math.max(0, after.activeEdges - 1);
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
    commands: value.commands.map((command) => structuredClone(command))
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
export {
  COLLECTIONS,
  MAP_VERSION,
  applyCommandEnvelope,
  applyMapCommand,
  autonomyDecision,
  buildProjectProjection,
  checkAttemptEvidence,
  commandTouches,
  createEmptyMap,
  documentMapDir,
  envelopeTouches,
  findExplorationAlternatives,
  mapError,
  migrateMapV1,
  planConsolidation,
  retrieveContext,
  stableMarkdownPath,
  validateMapDocument
};
