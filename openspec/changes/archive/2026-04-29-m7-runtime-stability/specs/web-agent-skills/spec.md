## MODIFIED Requirements

### Requirement: 飞书 skill 的 systemPromptAddendum 必须包含强禁止段与完成判定段

为缓解 plan 风险 1（Qwen3-VL-Plus 在飞书 React 应用上 click 命中率不稳）+ M5 task 7.3 实测暴露的"两个搜索框打转"问题 + M6 archive §9 实测暴露的"VLM 视觉 grounding 把顶部全局搜索栏当浅色会话搜索框"问题，三个内置飞书 skill 的 `systemPromptAddendum` SHALL 至少包含以下四段：

1. **强禁止段（IMPORTANT 级）**：明确告诉 VLM 不要点屏幕顶部"全局搜索栏"（占位符通常含 `搜索全部内容` / `问你想问的问题` / `⌘+K` 等关键字）；并指出正确入口（左侧消息列表上方的会话搜索框 / 该 skill 的对应专用入口）。误触模态时的恢复指令必须使用 `KEY_MAPPINGS` 接受的合法 key 名（即 `hotkey(key='escape')`，**不是** `'esc'` 缩写——M6 archive §9 实测显示后者会被 BrowserOperator 抛 `Unsupported key: esc`）。
2. **完成判定段**：明确告诉 VLM 出现何种**视觉信号**就应当立即调用 `finished()`（例：IM 看到自己消息以蓝色气泡发送方一侧出现；calendar 看到模态框关闭并日历视图新增条目；doc 看到新文档已经出现在 drive 列表或编辑器已加载）。这一段必须显式注明"不要为了再确认一遍而做额外操作；多余操作会触发 max_loop 而失败"。
3. **few-shot 范例**：演示该 skill 最常见的成功路径，步骤数 ≤ 8。M5 时的 few-shot 步骤过多 / 没强调完成判定，M6 全部重写。
4. **OMNI-SEARCH FALLBACK 段（M7 新增，仅 `feishu_im_send` 必需）**：当 VLM 反复误触顶部全局搜索栏（≥ 2 次）时，prompt 应当**主动**指引 VLM 把全局 omni-search 模态当成合法捷径——直接在弹出的模态里 type 联系人名字、点击搜索结果，飞书 omni-search 命中联系人会跳到对应聊天。M6 archive §9 实测显示 VLM 自己在 step 31 想到了这条路径，但走了 30 步弯路才找到；m7 prompt 显式教这条 fallback，预期把"消息能发出"的步数从 21 LLM iteration 降到 ≤ 13。fallback 必须标记为 fallback（`use when stuck`），而不是替代会话搜索的首选路径——后者仍是更快路径（1 click + 1 type vs 2 click + 1 type）。

#### Scenario: feishu_im_send 包含强禁止全局搜索栏
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 "全局搜索" / "顶部" 等关键字至少一个
- **AND** 字符串包含 "不要" 或 "禁止" 等否定词与上述关键字共现
- **AND** 字符串包含 "⌘+K" 描述消息会话搜索入口

#### Scenario: feishu_im_send 包含合法 escape key 名（M7 新增）
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 任何提到键盘 escape 的位置都使用 `escape` 全名（不是 `esc` 缩写）
- **AND** 字符串包含 `hotkey(key='escape')` 至少一次

#### Scenario: feishu_im_send 包含 omni-search fallback 段（M7 新增）
- **WHEN** 读取 `feishu_im_send.systemPromptAddendum`
- **THEN** 字符串包含 `OMNI-SEARCH FALLBACK` 关键字（标题段）
- **AND** 字符串包含 `use when stuck` 或语义等价的 fallback 触发条件
- **AND** 字符串明确说明 fallback 是合法路径（"LEGAL" 或"飞书设计支持"等）
- **AND** 字符串明确把会话搜索标为 preferred 首选路径，omni-search 标为 fallback

#### Scenario: 三个飞书 skill 都包含完成判定段
- **WHEN** 读取任意飞书 skill 的 `systemPromptAddendum`
- **THEN** 字符串包含 "finished" 关键字
- **AND** 字符串包含至少一种**视觉**完成信号描述（关键字示例: "气泡" / "模态" / "编辑器" / "出现"）
