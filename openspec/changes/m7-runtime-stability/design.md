# 设计：M7 runtime 稳定性 + 飞书命中率缓解

## 背景（Context）

M6 archive 后用真飞书账号实测 hello m6 demo（详见 `archive/2026-04-28-m6-demo-polish/tasks.md §9`），跑出三个 bug：B（已 hotfix）、C（必修）、A（缓解）。本节说明 m7 怎么修 C + 缓解 A、为什么不走重路径。

涉及方：
- M7 实施者：你 + AI。
- M6 archive §9.5 给的指引：必修 Bug C；推荐 Bug A 走 path B（DOM 模式）或更轻量的 omni-search workaround。

约束：
- **不引入 DOM 模式**（path B / m6 task 8.1）—— 那是 0.5-1 天的架构级改动，要重写 BrowserOperator 的 click 路径接 puppeteer `getByRole/getByText`。m7 走轻量 prompt 缓解，把 path B 留到下一回合（如果 m7 实测仍达不到 ≤ 25 step）。
- **不打包**：m7 仍 dev 模式跑；不引入 DMG / 代码签名。
- **不动 BridgeServer / SessionState / runner 主流程**：所有改动是 polish。
- **不收 demo.mov 录制**：用户做不了 agent 自动化，保持 backlog。

## 目标 / 非目标（Goals / Non-Goals）

**目标：**
- runner 重启后跑飞书 IM 任务时，若 `profiles/feishu/` 已有有效 cookie，**不再触发** visible 扫码流程（Bug C 修复）。
- 飞书 IM "给自己发消息" 任务在新 prompt 引导下能在 **≤ 25 step events**（约 ≤ 13 LLM iterations）内完成（Bug A 缓解）—— 即把 m6 实测的 42 step / 21 iter 砍一半。
- 通用 google 任务能跑通，灵动岛缩略图刷新 ≥ 3 次，finalAnswer 经 markdown 渲染。
- m7 archive 后 task 6.4 / 6.5 可以从 `[-]` 改 `[x]`（在 m7 自己的 tasks.md retrospective 段里声明）。

**非目标：**
- 不做 DOM 模式（path B）。
- 不做 calendar / doc skill 的 prompt 重写（m6 实测没跑过这两个，没数据驱动改 prompt）。
- 不做 demo.mov 录制（task 6.6 仍 `[-]`）。
- 不做"VLM 自己写 plan + 检查"或多步任务规划。
- 不引入 npm / SwiftPackage 新依赖。

## 关键决策（Decisions）

### D1：BrowserRef 扩成 `{ current, currentSegment }`，ensureLoggedIn 入口对齐 segment

当前 `BrowserRef = { current: LocalBrowser }`。m7 加一个 `currentSegment: string` 字段，由所有 mutator 同步更新（runner 启动时设 `'generic'`；ensureLoggedIn Phase 2/3 切换时更新）。

`ensureLoggedIn` 修改：

```ts
// Phase 0（new）：segment 对齐
if (browserRef.currentSegment !== skill.userDataDirSegment) {
  logger.info(`[login] swapping browser ${browserRef.currentSegment} → ${skill.userDataDirSegment}`);
  await safeClose(browserRef.current, logger);
  const newBrowser = new LocalBrowser({ logger });
  await newBrowser.launch({
    headless: true,
    userDataDir: userDataDirFor(skill.userDataDirSegment),
    args: [...],
  });
  browserRef.current = newBrowser;
  browserRef.currentSegment = skill.userDataDirSegment;
}

// Phase 1（existing）：在已对齐的 browser 上探测
if (await isLoggedIn(...)) return { ok: true };

// Phase 2/3（existing）：visible scan + relaunch headless（也需要更新 currentSegment）
```

考虑过：
- **每个 task 都开新 browser 探测，不维护 ref 状态**：reject。每个 task ~1-2s 浏览器 spawn 是不可忽略延迟，task 短的话占比超 30%。
- **Map<segment, LocalBrowser> 缓存**：reject。同时持有多个 chromium 进程占内存大；m7 单 task serial（M3 §D4），不需要并发 cache。
- **runner 启动时不预 launch chromium，全部 lazy**：reject。这会破坏 m6 的"task 6.4 通用 google 任务的 default starting URL"行为（runner 启动时 navigate 到 google.com），首次通用 task 体验会差。保留预 launch + 切换语义最干净。

### D2：feishu_im_send omni-search fallback 写成"合法捷径"而非"修复路径"

m6 实测 step 31 VLM 自己想到 workaround，但 prompt 没教 → VLM 用 9 步推理 / 多次反复试错才找到这条路（step 1-29 都浪费了）。m7 prompt 加新段 `## OMNI-SEARCH FALLBACK`：

```
## OMNI-SEARCH FALLBACK (use when stuck)

If you've tried clicking the conversation search field 2+ times and each
time the centered modal "搜索全部内容..." pops up (you keep hitting the
top global bar despite trying to avoid it), STOP retrying the conversation
search. Switch to omni-search fallback:

  1. The omni-search modal is already open. The text field inside it has
     focus. Just type the recipient name directly.
  2. Click the FIRST result row matching the recipient.
  3. Feishu navigates into that contact's chat window. From here, the
     normal flow resumes: click the bottom composer, type message, send.

This is a LEGAL path; it does NOT bypass any check. Use it as a fallback
when the conversation search seems unreachable, but PREFER the conversation
search when it's clearly clickable (it's faster: 1 click + 1 type vs
2 clicks + 1 type via omni-search).
```

few-shot 也补一段 fallback 路径示例。

考虑过：
- **prompt 直接说"无脑用 omni-search"**：reject。omni-search 比会话搜索多 1 步（先弹模态再 type），快路径仍是会话搜索；只在 VLM "卡住"时才走 fallback。
- **runtime 端做"3 次 click 失败自动 fallback"**：reject。这要分析 BrowserOperator action 之后的截图变化判断"是不是又触发了 omni-search"，逻辑复杂、容易误判。让 VLM 自己根据视觉判断更鲁棒。
- **改 base coordinate hint，告诉 VLM 真实坐标**：reject。飞书界面有 dpi 和窗口尺寸自适应，硬编码坐标在不同分辨率下都失效。

### D3：保持现有架构，不重写 BrowserOperator

m6 archive §8.1 的 path B（DOM 模式）是真正解决 Bug A 的方向，但工作量大且要重写 click 执行链。m7 通过 D2 的 prompt 缓解先把"任务能完成"的体验拿到手；如果 m7 实测仍超 25 step，再启动 path B。

考虑过：在 m7 同时做 path B —— reject，单 milestone 不堆两件大改动。

### D4：测试覆盖 —— BrowserRef segment 切换的 unit test

新增 `runners/web-agent/test/login.test.ts`，用 mock LocalBrowser（不真起 chromium），验证：
- BrowserRef.currentSegment 初值 `'generic'`，调 ensureLoggedIn 一个 segment='feishu' 的 skill 后，`safeClose` 被调用一次、新 LocalBrowser 被 launch、`browserRef.current` 被替换、`browserRef.currentSegment === 'feishu'`。
- BrowserRef.currentSegment 已经是 `'feishu'`，调同 segment 的 skill：不触发 close+relaunch（节流 OK）。
- detectLoggedIn 返回 true 时，Phase 0 后直接 `{ ok: true }`，不进 Phase 2。

`skills.test.ts` 加一个断言：`feishu_im_send.systemPromptAddendum` 包含 'OMNI-SEARCH FALLBACK' 关键字（防 prompt 文本退化）。

考虑过：
- **写 e2e 测试** —— reject，e2e 要起真 chromium + 真飞书账号，不能在 CI 跑。
- **写 integration test 模拟 chromium** —— reject，测试基础设施成本太高。

## 风险 / 取舍（Risks / Trade-offs）

- **Bug C 修了之后偶尔仍要扫码** —— 飞书 cookie TTL 7 天；超过会触发 Phase 2。这是预期，不是 m7 范围。
- **D1 的 close+relaunch 在 chromium 异常状态时挂死** —— `safeClose` 已经 try/catch，不会抛；最坏场景是 launch 新 browser 失败 → 整个 task fail（fail-loud），用户从 dev.sh log 能看到。
- **D2 prompt 缓解后 VLM 直接走 omni-search 跳过会话搜索** —— 不算回归（任务仍能完成），但步数会比"理想路径"多 1-2 步。可以接受。
- **D2 prompt 长度变长** —— 影响 LLM 单次推理 token 成本约 +500 tokens。在 GUIAgent 每步推理 ~1500 token 输入的盘子里占 ~30%，但能换"减少错点循环"的步数节省，净开销低。

## 迁移计划（Migration Plan）

m7 是 polish 增量，无数据迁移。落地步骤：

1. 改 `agent/login.ts` + `agent/runtime.ts` BrowserRef 类型（D1）。
2. 改 `runner.ts` 初始化 BrowserRef.currentSegment 字段。
3. 写 `test/login.test.ts`（D4）；`npm test` 通过。
4. 改 `feishu_im_send.ts` 的 `systemPromptAddendum`（D2）。
5. `skills.test.ts` 加 OMNI-SEARCH FALLBACK 断言；`npm test` 通过。
6. 跑 `swift build` + `swift test`（确保 island 端没被慎脱付）。
7. 实跑 `observer-client.ts` 通用 google 任务（task 6.4 收尾）。
8. 实跑 `observer-client.ts` 飞书 IM 任务（task 6.5 重测）—— 验证 cookie 不重扫 + ≤ 25 step 完成。
9. 实测结果补进 `m7-runtime-stability/tasks.md` retrospective 段。
10. archive m7。

回滚：m7 是独立 commit 链；如有阻塞，git revert 到 m6 archive commit (`3b399bf`) 即可。

## 待解决问题（Open Questions）

1. **m7 实测 task 6.5 仍超 25 step 怎么办？** 答：m7 archive 后启动 path B（DOM 模式）作为下一回合（m8）。
2. **BrowserRef.currentSegment 是否要持久化到磁盘？** 答：不需要，runner 重启后默认 'generic'，ensureLoggedIn 第一次自然会切换。
3. **是否要为 calendar / doc skill 也加 omni-search fallback？** 答：m7 只改 IM（有实测数据驱动）；calendar / doc 等真的有 demo 实测数据再说。
