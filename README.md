# Lark Island

灵动岛 (Dynamic Island) + 浏览器沙箱 web agent。从屏幕顶端唤出灵动岛输入"给张三发条飞书消息"，本地后台启动 headless Chromium 自动完成；产品定位对标 Manus 的 Mac 桌面入口，但**全本地、无服务器**。

```
                           ┌────────────────────────┐
   menubar 🌐  ────────►   │   AppModel              │
   (or hover-expand)        │   .startWebAgentTask    │
                           │                          │
   feishu bot (M5.5+) ──►  │     │                    │
                           │     ▼                    │
                           │   BridgeServer (Unix     │
                           │   socket NDJSON v2)      │
                           └─────┬────────────────────┘
                                 │ runWebAgentTask
                                 ▼
                           ┌────────────────────────┐
                           │ runner (Node + tsx)     │ ─► headless Chromium
                           │ • UI-TARS GUIAgent      │     (puppeteer-core)
                           │ • Qwen3-VL-Plus VLM     │
                           │ • feishu skill registry │
                           └─────┬────────────────────┘
                                 │ webAgentStepUpdate
                                 ▼
                           灵动岛 overlay 实时刷新
                           (step 文字 + 缩略图 +
                            完成态 markdown 答复)
```

## 三步本地启动

### 0. 一次性准备

- macOS 14+ (有 hardware notch 体验更佳；非 notch Mac 会用 top-bar fallback)
- Swift 6.2+ (`brew install swift`，新增 keg-only 路径 `/opt/homebrew/opt/swift/bin`)
- Node 20+ (`brew install node`)
- 一个 [DashScope](https://bailian.console.aliyun.com/) API key 用于默认的 Qwen3-VL-Plus profile

### 1. 配 .env

```bash
cd runners/web-agent
cp .env.example .env
# 编辑 .env 把 DASHSCOPE_API_KEY=sk-... 填进去
```

### 2. 一键起服务

```bash
zsh scripts/dev.sh
```

脚本会：自动 `npm install` runner 依赖（如需要） → `swift build` → 后台启动 `swift run LarkIslandApp` → 等到 runner 子进程注册成功 → 提示"点菜单栏 🌐 开干"。

### 3. 跑一条任务

- 点屏幕顶端右侧的 🌐 globe 图标 → 弹出输入框
- 输入 e.g. `在 google 搜索 "UI-TARS"，告诉我前 3 条结果` → Run
- 灵动岛展开显示步骤文字 + 实时缩略图 → 完成态显示 markdown 答复

## 演示路径

`scripts/dev.sh` 启动后两段典型 demo：

| Demo | Prompt | 路径 |
|---|---|---|
| **通用** | `在 google 搜索 UI-TARS 报告前 3 条` | runner spawn 时已 navigate 到 google.com → router 不命中 → generic 模式 |
| **飞书 IM** | `在飞书给自己发条消息：hello demo` | router 命中 `feishu_im_send` → 首次需扫码登录（visible Chromium 弹出二维码）→ 切回 headless → GUIAgent 跑完 |

详细 demo 录像见 [`lark-island/docs/m6-demo.mov`](lark-island/docs/m6-demo.mov)（如未入仓则改为外链）。

## 已知问题

| 问题 | 状态 |
|---|---|
| 首次飞书任务需要扫码登录（弹可见 Chromium）；之后 7 天内复用 cookie | by design |
| Qwen3-VL-Plus 在飞书 React 应用偶尔点错搜索框（plan 风险 1） | M6 已通过 systemPromptAddendum 强禁止段缓解；如再撞墙启动 path B (DOM 模式) |
| 国内访问 `google.com` 慢/失败 | 设环境变量 `LARK_ISLAND_RUNNER_DEFAULT_URL=https://www.bing.com` 或编辑 `runners/web-agent/src/runner.ts` 的 `DEFAULT_STARTING_URL` |
| 灵动岛 idle 状态融入 notch 看不见 | 已在 closed 态加左侧 brand mark + 右侧状态点（橙色=有任务/审批，绿=runner online） |
| 任务取消按钮 / 全局快捷键 | M7 backlog |

## 架构 / 子目录

| 子目录 | License | 角色 |
|---|---|---|
| [`lark-island/`](lark-island/) | GPL v3 (fork from open-vibe-island) | macOS 灵动岛 SwiftUI app + BridgeServer + runner supervisor |
| [`runners/web-agent/`](runners/web-agent/) | Apache-2.0 | Node 子进程：UI-TARS GUIAgent + 飞书 skill registry + 扫码切换协议 |
| [`larkvision/`](larkvision/) | MIT (frozen) | 早期 Python 桌面控制原型；M0 起停止维护 |
| [`openspec/`](openspec/) | docs | 项目历史 milestone（M0-M6）的 propose/design/spec/tasks 归档 |

完整 license map 见 [`LICENSE.md`](LICENSE.md)；子目录间靠 IPC（Unix socket NDJSON）解耦，不形成静态链接，license 不互相污染。

## 想了解更多

- 产品规划与里程碑：[`/.cursor/plans/island-web-agent-pivot_3704f689.plan.md`](.cursor/plans/island-web-agent-pivot_3704f689.plan.md)
- 当前已归档的能力规约：[`openspec/specs/`](openspec/specs/)
- 历史 milestone：[`openspec/changes/archive/`](openspec/changes/archive/)
