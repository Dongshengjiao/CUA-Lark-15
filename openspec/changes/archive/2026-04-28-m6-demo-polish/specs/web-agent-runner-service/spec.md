## ADDED Requirements

### Requirement: runner 启动后 navigate 到 default starting URL 而非停留在 about:blank

runner 在 `LocalBrowser.launch()` 完成后、向 BridgeServer 发送 `registerClient(.webAgentRunner)` 之前 SHALL 主动打开一个 page 并 navigate 到 default starting URL（M6 默认 `https://www.google.com`，国内场景可在源码中改为 `https://www.bing.com`）。

理由：M5 task 7.5 实测时 VLM 看到 about:blank（空白屏幕 + 旁注 "Clickable Elements"），完全没有意识到自己处在 Chromium 内，第一反应去用 `Cmd+Space` 启动 Spotlight。给 default URL 后 VLM 看到搜索框就能正确 ground 到"我在浏览器里、可以输 URL/搜索词"。

如果 navigate 失败（断网 / DNS 解析失败 / 超时），runner SHALL 记 warning 但**不**阻断启动；page 退化到 about:blank，registerClient 仍正常发送。

#### Scenario: runner 启动后默认页是 google.com
- **WHEN** runner 启动且未指定环境变量 override
- **THEN** runner 完成 `LocalBrowser.launch()` 后，先 createPage + goto `https://www.google.com`
- **AND** 等待 networkidle 或超时（≤10s），不论是否 idle 都继续走 registerClient

#### Scenario: navigate 失败时降级到 about:blank
- **WHEN** runner 启动后 navigate 到 default URL 抛超时或网络错
- **THEN** runner 记 warning `default starting URL navigation failed: <err>`
- **AND** runner 仍发送 registerClient
- **AND** runner 仍能接受 runWebAgentTask（任务的 skill / generic 模式自带 startingURL 时正常工作）

## MODIFIED Requirements

### Requirement: GUIAgent 步骤事件按规范回灌

runner 在执行任务期间 MUST 把 `@ui-tars/sdk` 的 `GUIAgent.onData` 回调翻译成 `webAgentStepUpdate` envelope，规则：

- `taskID` 等于当前任务的 ID。
- `stepIndex` 从 0 开始单调递增。
- `thought` = `data.conversations[last].predictionParsed[0].thought`，如果不存在则为空字符串。
- `actionRaw` = `data.conversations[last].rawPrediction`（原始 prediction 字符串），如果不存在则 `null`。
- `actionType` = `data.conversations[last].predictionParsed[0].action_type`，如果不存在则 `null`。
- `screenshotURL` = 截图本地绝对路径（见下一条 Requirement），写盘失败也仍要带 path。
- `costMs` / `costTokens` 来自 `data.conversations[last].costTime` / `costTokens`，缺失时 `null`。
- `timestamp` 取事件触发的 `Date.now()`。

任务正常完成时 runner MUST 发 `webAgentTaskCompleted`，字段：
- `finalAnswer` = `onFinalAnswer` 回调的字符串，否则 fallback 到最后一步 `thought`。
- `totalSteps` = 回灌过的 step 数。
- `totalTokens` / `totalMs` = GUIAgent `data` 末态的累计字段，缺失时为 `0`。

GUIAgent 实例化时 `maxLoopCount` SHALL 至少为 30。M5 时设为 12 已实测不足以支撑飞书 IM 的多步任务（实测在 step 23 才点中正确入口，没机会输入消息+发送）。如果未来发现 30 仍不够，先在日志里观察是 VLM 死循环还是真任务步数偏多，再决定是否扩到 50 / 加 per-skill 配置。

#### Scenario: 一步成功的任务发出完整事件流
- **WHEN** 任务执行恰好 1 步后调用 `onFinalAnswer("Done.")`
- **THEN** runner 按顺序发出：`webAgentTaskStarted`、1 个 `webAgentStepUpdate{stepIndex: 0}`、`webAgentTaskCompleted{finalAnswer: "Done.", totalSteps: 1}`

#### Scenario: 多步任务的 stepIndex 单调递增
- **WHEN** 任务执行 5 步
- **THEN** runner 发出的 5 个 `webAgentStepUpdate` envelope 的 `stepIndex` 依次为 0、1、2、3、4

#### Scenario: maxLoopCount 默认 30
- **WHEN** runner 初始化 GUIAgent
- **THEN** 传给 `@ui-tars/sdk` 的 `maxLoopCount >= 30`
