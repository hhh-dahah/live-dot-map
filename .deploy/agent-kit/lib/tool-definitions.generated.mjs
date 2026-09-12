// 由 scripts/sync-tool-definitions.mjs 生成，请勿手改。
export const MCP_TOOL_DEFINITIONS = Object.freeze([
  {
    "name": "map_get_context",
    "description": "读取当前地图的结构、推进摘要与明确关联 Markdown。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_list_human_updates",
    "description": "列出人类尚未确认的标注。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_ack_human_updates",
    "description": "摘要明确引用标注 ID 后确认读取。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "列出项目内地图与当前 active-map。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_create",
    "description": "新建完整地图但不自动切换。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_switch",
    "description": "校验目标地图后切换 active-map。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mapKey": {
          "type": "string"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "修改地图显示名，不改变 mapKey。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "mapKey": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "返回带解释的推进候选。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_apply_commands",
    "description": "通过统一 reducer 原子提交地图命令。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "校验当前地图与关联 Markdown 证据。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "document": {
          "type": "object"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_checkpoint",
    "description": "创建可恢复检查点。",
    "inputSchema": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_plan_consolidation",
    "description": "只读生成可审核的整理建议。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_read_markdown",
    "description": "读取当前地图资料包 Markdown。",
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
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_write_markdown",
    "description": "用 baseEtag 原子替换资料包 Markdown。全域人类原声保护：严禁删除或覆盖人类原始文字（违规将被拒绝 HUMAN_CONTENT_PROTECTED）；默认追加式：若替换会删除已有内容的行将被拒绝（REWRITE_REMOVES_CONTENT），请优先用 map_append_markdown；确属用户明确要求改写时才传 allowContentRemoval: true。",
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
        },
        "allowContentRemoval": {
          "type": "boolean"
        },
        "allowHumanContentOverride": {
          "type": "boolean"
        },
        "allowIndexModification": {
          "type": "boolean"
        },
        "wrapAuthor": {
          "type": "boolean"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "按路径锁幂等追加 Markdown。可在任意文件（含 index.md）末尾安全追加 Agent 结论、回复或补充要点，自动包裹成对 @author 闭合标签，绝不破坏上方已有的人类原话。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "列出对象资料包文件。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "在对象资料包中新建补充 Markdown（如 01-方案.md）。创建后系统将在 index.md 自动同步登记资料包索引。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "改名补充 Markdown 或附件。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "归档补充 Markdown。",
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
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "恢复补充 Markdown。",
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
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "列出对象资料包附件元数据。",
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
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "从 sourcePath（支持项目内相对路径或本机任意绝对路径）流式导入附件（支持 zip、数据包、代码、图片、文档等各类文件）。导入后系统将在 index.md 自动同步登记资料包索引。",
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
        },
        "allowExternalPath": {
          "type": "boolean"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "归档对象附件。",
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
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "description": "恢复对象附件。",
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
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
    "name": "map_read_asset",
    "description": "返回对象附件路径与元数据（不搬运二进制）。文本类附 content，二进制可传 includeContent 取 base64。",
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
        "includeContent": {
          "type": "boolean"
        },
        "projectRoot": {
          "type": "string",
          "description": "（可选）目标活点地图项目的物理绝对路径。默认自动跟随当前画布或当前工作区；如需跨项目查阅或修改其他独立项目的记忆，可显式传入该项目的绝对路径。"
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
export const MCP_TOOL_NAMES = Object.freeze(MCP_TOOL_DEFINITIONS.map((tool) => tool.name));
