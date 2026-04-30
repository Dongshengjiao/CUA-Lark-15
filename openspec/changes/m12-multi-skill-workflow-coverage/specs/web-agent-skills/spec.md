## ADDED Requirements

### Requirement: feishu_doc_create skill 经端到端实测验证

`feishu_doc_create` MUST 经过至少一次端到端实测（创建出真飞书云文档资源），并 MUST 在 IM / Calendar / Docs 三产品矩阵中达到课题 M3 阶段验收线（每产品 ≥ 2 可运行用例）。skill 的 startingURL / loginURL / userDataDirSegment / matchKeywords 配置 MUST 与 m7 archive 保持一致；任何 hotfix MUST 限定在 systemPromptAddendum 内，且 MUST 同步加 1-2 条对应的 prompt 单测断言以防 m13+ 再次回归。

m7 引入时只完成了 prompt 单测层（`runners/web-agent/test/skills.test.ts` 里的"M7 hotfix doc/calendar prompt hardening"段），未经端到端实测。m10 / m11 都没碰 docs。这给课题"M3 阶段 IM/Calendar/Docs 三产品各 2+ 用例"留了硬空缺。m12 任务 A（docs 单 task）+ 任务 B（docs+IM workflow）共同负责把这个 skill 升级到"已实测验证"状态。

#### Scenario: feishu_doc_create 完成一次 single-task 端到端
- **WHEN** bot 收到飞书 IM prompt `"在飞书新建一个文档，标题是 m12 docs 测试"`
- **AND** runner 路由到 `feishu_doc_create` skill
- **THEN** runner 在 ≤ 50 step events（含截图 step）内 emit `webAgentTaskCompleted`
- **AND** 飞书云空间 (`https://<tenant>.feishu.cn/drive/home/` 或 `/drive/me/`) 能看到一个新文档资源，标题包含 prompt 指定的字符串前缀（"m12 docs"）
- **AND** bot 终态 IM `✅ 任务完成（X 步 / Y.Ys）：<finalAnswer>` reply 送达

#### Scenario: feishu_doc_create 在 workflow 第 0 步使用 + 上下文传给 step 1
- **WHEN** bot 收到 `"在飞书新建一个文档，标题是 m12 workflow doc，并给自己发条消息说文档已建"`
- **AND** plan-LLM 拆 2 步：step 0 = 创建文档，step 1 = IM 通知
- **THEN** step 0 路由到 `feishu_doc_create` 并 ≤ 50 step 完成
- **AND** step 1 派发时 prompt 经 `renderTemplate` 注入 step 0 finalAnswer
- **AND** step 1 IM 自聊气泡里输入的文本含 step 0 文档信息（标题或链接）
