## Why

M6 archive 后用真飞书账号实测 hello m6 demo（详见 `archive/2026-04-28-m6-demo-polish/tasks.md §9`），消息确实发出去了，但暴露了三件 archive 时没暴露的事：

1. **Bug B（已 hotfix in `08a2435`）** —— `feishu_im_send.ts` prompt 写了字面 `Esc` 但 `@ui-tars/operator-browser` 的 `KEY_MAPPINGS` 只接受 `escape`，VLM 照写就 task failed。已修。
2. **Bug C（未修，体验问题）** —— runner 启动用 `userDataDirFor('generic')` 启 chromium，但 `feishu_im_send.userDataDirSegment = 'feishu'`。`ensureLoggedIn` Phase 1 在当前（generic）browser 上探测 feishu cookie 永远查不到 → 每次 runner 重启都走 Phase 2 强制重扫码，即使 `profiles/feishu/` 已经有有效 cookie。
3. **Bug A（未修，命中率问题）** —— Qwen3-VL-Plus 在飞书 React UI 上把顶部全局搜索栏视觉识别为"消息标题下方的浅色会话搜索框"。第二次实测（修 Bug B 后）VLM 在坐标 `[14, 122]` 附近**连点 8 次都误中顶部全局栏**——但 step 31 它自己想到 workaround：既然每次都触发 omni-search 模态，**就直接在模态里搜联系人**（飞书 omni-search 也能跳到聊天）。最终用 21 次 LLM iteration（42 个 step events）完成任务。

m7 把"消息能发出"从"VLM 自己想出 workaround"提升到"prompt 主动指引 workaround"，并修掉 Bug C 这个体验阻断点。

不收：demo.mov 录制（task 6.6）—— 需要用户屏幕录制，agent 做不了；保持 backlog。

## What Changes

- **修 Bug C：runner 启动改为 lazy launch + per-skill profile 切换**
  - `BrowserRef` 加 `currentSegment: string` 字段记录当前 chromium 用的 user-data-dir segment。
  - runner 启动时仍用 `'generic'` segment 预 launch（保留 default 起始页 google.com 行为，不破坏 task 6.4 路径）。
  - `ensureLoggedIn` Phase 1 之前先比较 `browserRef.currentSegment` 与 `skill.userDataDirSegment`：若不匹配，先 `safeClose` 当前 browser，relaunch headless 用 skill segment；再走 Phase 1 探测。
  - 这样即使是 fresh runner，只要 `profiles/<segment>/` 里有有效 cookie，Phase 1 直接通过，不进 Phase 2 visible 扫码流程。
- **修 Bug A 缓解：把 omni-search 写成合法捷径路径**
  - `feishu_im_send.ts` 的 `systemPromptAddendum` 在"强禁止"段后追加 `## OMNI-SEARCH FALLBACK`：当 VLM 误触全局搜索模态时，**不必非要 escape**，可以直接在模态里 type 联系人名 → 点击搜索结果（飞书 omni-search 命中联系人会跳进对应聊天）。同时 few-shot 加一段 fallback 路径示例。
  - calendar / doc 的 `systemPromptAddendum` 暂不改（M6 实测没跑这两个）。
- **task 6.4 实跑收尾**：用 observer-client 跑通用 google 任务，验证 default starting URL + 缩略图 path 在 generic 模式真的工作。
- **task 6.5 重测**：用 observer-client 跑飞书 IM 任务，验证 Bug C 修复后**不再要求重扫码** + Bug A workaround 在 prompt 引导下能在 ≤ 25 step 完成。

## Capabilities

### New Capabilities

无。m7 全部是对现有 capability 的修补。

### Modified Capabilities

- `web-agent-runner-service`: runner 启动 + ensureLoggedIn 的 user-data-dir 与 skill profile 对齐（Bug C）；`BrowserRef` 接口扩展。
- `web-agent-skills`: `feishu_im_send` 的 `systemPromptAddendum` 增加 omni-search fallback 段（Bug A 缓解）。

## Impact

- **代码**：
  - runner: 改 `agent/login.ts`（约 30 行：探测前的 segment 对齐）；改 `agent/runtime.ts` BrowserRef 类型（约 5 行）；改 `runner.ts`（初始化 currentSegment 字段，约 3 行）
  - skills: 改 `feishu_im_send.ts` 的 `systemPromptAddendum`（追加 ~30 行 prompt 文本 + 1 段 few-shot）
  - 新增 `runners/web-agent/test/login.test.ts`（unit test：BrowserRef segment 切换在 mismatch 时触发 close+relaunch）
- **协议**：bridge schema 不变。
- **依赖**：无新增。
- **风险**：
  - profile 切换的 close/relaunch 增加了一次 chromium spawn 的延迟（~1-2s）；只在 segment mismatch 时发生，generic→generic 或同 skill 复跑时无感。
  - VLM 在新 omni-search fallback prompt 下可能直接走 fallback 跳过"会话搜索"路径——这是预期，但要避免它**永远**走 omni-search（因为这条路径每次都要等模态弹出）；prompt 把"会话搜索"标为 preferred path，omni-search 标为 fallback when stuck。
- **数据**：无。
- **运维**：现有 `~/Library/Application Support/LarkIsland/web-agent/profiles/feishu/` cookie 兼容；用户感知是"M6 跑过一次后，后续 runner 重启不再要求扫码"。
