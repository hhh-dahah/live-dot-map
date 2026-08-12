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
function applyOne(document, command, actor, revision, now) {
  if (command.op === "create") {
    const value = cleanRecord(command.value, "value");
    if (typeof value.id !== "string" || !ID.test(value.id)) throw mapError("INVALID_ID", 422, "\u65B0\u5BF9\u8C61 ID \u65E0\u6548");
    if (getList(document, command.collection).some((v) => v.id === value.id)) throw mapError("DUPLICATE_ID", 409, `\u5BF9\u8C61 ${value.id} \u5DF2\u5B58\u5728`);
    if (command.collection !== "anns") assertName(value.name);
    if (command.collection === "nodes" && isAgent(actor)) {
      assertAgentMilestoneAllowed(value.milestone);
      if (value.level === "work") assertAgentMilestoneAllowed(value);
    }
    const item = { ...value, createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor, updatedRevision: revision };
    if (command.collection === "nodes" && value.milestone !== void 0) item.milestone = normalizeMilestone(value.milestone, actor, now, revision);
    if (command.collection === "nodes" && item.md === void 0) item.md = stableMarkdownPath("nodes", String(item.id));
    if (command.collection === "edges" && item.md === void 0) item.md = stableMarkdownPath("edges", String(item.id));
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
  }
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
export {
  COLLECTIONS,
  MAP_VERSION,
  applyCommandEnvelope,
  applyMapCommand,
  autonomyDecision,
  commandTouches,
  createEmptyMap,
  envelopeTouches,
  mapError,
  migrateMapV1,
  retrieveContext,
  stableMarkdownPath,
  validateMapDocument
};
