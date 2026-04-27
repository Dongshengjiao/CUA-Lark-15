---
name: feishu-im-search-messages
description: 在飞书桌面客户端通过全局搜索查找历史消息记录, 验证至少返回一条匹配结果
keywords:
  - 搜索消息
  - search messages
  - 全局搜索
  - 消息历史
applies_to:
  - 飞书 / Lark 桌面客户端
---

# 飞书 IM 搜索消息

复用 4-26 验证过的 "AppleScript 激活 + Cmd+K 全局搜索" 套路.
飞书 Cmd+K 默认综合搜索, 结果列表里"消息"会自动归类显示.
**核心**: 不是切 tab, 直接看结果列表是否出现包含关键词的条目.

## 前置条件

- 飞书客户端已登录, 且历史消息中应存在至少一条匹配关键词的消息
- macOS 已授予屏幕录制 + 辅助功能权限给 Python 进程

## 操作步骤 (每步 1 个 action)

### Step 1: 强制激活飞书到前台
**Action**: `run_apple_script`
**Script**: `tell application "Lark" to activate`

### Step 2: 打开全局搜索
**Action**: `multi_Hotkey`
**Args**: `key1='cmd'`, `key2='k'`

### Step 3: 输入搜索关键词
**Action**: `input_text`
**Args**: `text='<keyword>'`
**经验**: 搜索框默认聚焦, 直接输入即可; 飞书会实时返回搜索结果.

### Step 4: 等待结果加载并判定
**Action**: 不需要新动作, Brain 看截图即可
**判定条件**: 截图中出现"消息"分组 + 关键词高亮的消息条目.

## 失败兜底

| 现象 | 原因 | 兜底 |
|---|---|---|
| Cmd+K 没反应 | 飞书没在前台 | 重做 Step 1 |
| 搜索结果为空 | 关键词太特殊或未在历史里 | 改更通用关键词 / 先用 im_send_text 造一条 |
| 结果显示但没"消息"分组 | 飞书把结果归到联系人/群组分类 | 让 Brain 看截图判定: 任何包含 <keyword> 的条目都算 PASS |

## 用例参数

```yaml
parameters:
  keyword: hello       # 必须是历史消息里出现过的字
```

## 三层 Verifier 期望

- **L1 像素 Diff**: PASS (Cmd+K 弹出搜索浮窗, 屏幕必变)
- **L2 OCR**: 期望关键词 `[<keyword>]`; 禁止 `[搜索失败, 无结果, 加载失败]`
- **L3 VLM**: "Did the search results contain at least one message matching '<keyword>'?"

## 历史记录

- 2026-04-27: 创建; 复用 im_send_text 套路, 仅 task prompt 微调
