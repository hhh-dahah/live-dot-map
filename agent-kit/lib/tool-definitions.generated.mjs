// 由 scripts/sync-tool-definitions.mjs 生成，请勿手改。
export const MCP_TOOL_DEFINITIONS = Object.freeze([
  {
    "name": "map_look",
    "description": "看地图目录：返回相关节点/文档的 id、名称、类型、路径和一句理由，不含正文。先 look 找路径，再 map_read。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "关键词，可空"
        },
        "nodeId": {
          "type": "string"
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
    "name": "map_read",
    "description": "读正文。path 用 look 给的路径或节点 id；同会话内未变化的文件只回 unchanged，force:true 强制重读；以 / 结尾列出资料包文件。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "force": {
          "type": "boolean"
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_write",
    "description": "写入。path+content 默认追加（文件不存在则新建）；带 baseEtag 为整文替换。node:{name,kind} 新建节点；ack:[id] 确认人类标注；commands 提交地图命令。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "baseEtag": {
          "type": "string"
        },
        "node": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string"
            },
            "kind": {
              "type": "string",
              "enum": [
                "goal",
                "problem"
              ]
            },
            "near": {
              "type": "string"
            }
          }
        },
        "ack": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "commands": {
          "type": "array",
          "items": {
            "type": "object"
          }
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "analysis_run",
    "description": "对资料包里的 CSV/JSONL/JSON 表做确定性统计，只回摘要。op: describe 字段概况 | group 分组对比 | top 前20%对比其余。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string"
        },
        "op": {
          "type": "string",
          "enum": [
            "describe",
            "group",
            "top"
          ]
        },
        "params": {
          "type": "object",
          "description": "group: {by, metric?, agg?}；top: {metric, ratio?, fields?}"
        }
      },
      "required": [
        "path",
        "op"
      ],
      "additionalProperties": true
    }
  },
  {
    "name": "map_manage",
    "description": "低频管理。action: maps|create_map|switch_map|rename_map|files|rename_file|archive|restore|import|validate|checkpoint|plan|human。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "maps",
            "create_map",
            "switch_map",
            "rename_map",
            "files",
            "rename_file",
            "archive",
            "restore",
            "import",
            "validate",
            "checkpoint",
            "plan",
            "human"
          ]
        },
        "mapKey": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "path": {
          "type": "string"
        },
        "to": {
          "type": "string"
        },
        "sourcePath": {
          "type": "string"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": true
    }
  }
]);
export const MCP_TOOL_NAMES = Object.freeze(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
// 旧细粒度工具名：不在 tools/list 中发布，桥仍接受按名调用（画布、hook、旧客户端）。
export const MCP_LEGACY_TOOL_NAMES = Object.freeze(["map_get_context","map_list_human_updates","map_ack_human_updates","map_list","map_create","map_switch","map_rename","map_next_candidates","map_apply_commands","map_validate","map_checkpoint","map_plan_consolidation","map_read_markdown","map_write_markdown","map_append_markdown","map_list_bundle_files","map_create_markdown","map_rename_bundle_file","map_archive_bundle_file","map_restore_bundle_file","map_list_assets","map_import_asset","map_archive_asset","map_restore_asset","map_read_asset"]);
