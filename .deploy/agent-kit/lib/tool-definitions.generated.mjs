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
      "properties": {},
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
      "properties": {},
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
        }
      },
      "additionalProperties": true
    }
  },
  {
    "name": "map_write_markdown",
    "description": "用 baseEtag 原子替换资料包 Markdown。",
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
    "description": "按路径锁幂等追加 Markdown。",
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
    "description": "在对象资料包中新建补充 Markdown。",
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
    "description": "从项目内 sourcePath 流式导入附件。",
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
