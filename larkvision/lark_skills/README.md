# 飞书子产品 Skills (SOP)

> 这些是给 LarkVision-Tester 用的"标准操作流程"(Standard Operating Procedure).
> 上游 TuriX-CUA 的 Planner 在任务开始时会从 `skills_dir` 检索匹配 Skill 注入到 prompt.
> 用法见 `larkvision/skills/github-web-actions.md` (上游样例) 和 [TuriX 上游 README](https://github.com/TurixAI/TuriX-CUA).

## 目录结构

```
lark_skills/
├── im/        # IM 即时通讯
├── calendar/  # 日历
├── docs/      # 云文档
└── README.md  # 本文
```

## 使用方式

在 `examples/config.json` 里:

```json
"agent": {
  "use_skills": true,
  "skills_dir": "lark_skills",   // 改这里
  "skills_max_chars": 4000
}
```

## 写新 Skill 的约定

每个 `*.md` 文件首部必须有 frontmatter:

```markdown
---
name: feishu-im-send-text
description: 在飞书 IM 中向指定联系人发送一条文本消息
keywords:
  - 发消息
  - send message
  - IM
applies_to:
  - 飞书 / Lark
  - 桌面客户端 (Electron)
---

# Steps
1. (步骤 1)
2. ...
```

`description` 必填——Planner 用它做向量检索匹配.
