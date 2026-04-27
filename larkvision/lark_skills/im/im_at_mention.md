---
name: feishu-im-at-mention
description: 在飞书 IM 群组中通过 @ 提及指定成员并发送一条消息, 验证消息含 @mention 标记
keywords:
  - "@提及"
  - at mention
  - "@"
  - 群消息
applies_to:
  - 飞书 / Lark 桌面客户端 (群组聊天)
---

# 飞书 IM @ 提及成员发消息

复用 4-26 "AppleScript 激活 + Cmd+K + input_text" 套路, 关键点是 **@ 触发候选浮窗后用 input_text + Enter 选第一个**.

## 前置条件

- 飞书已登录且目标群组存在 (例如"测试群")
- 目标群至少有 2 名成员 (你 + 被 @ 的人)
- macOS 已授予屏幕录制 + 辅助功能权限给 Python 进程

## 操作步骤 (每步 1 个 action)

### Step 1: 强制激活飞书到前台
**Action**: `run_apple_script`
**Script**: `tell application "Lark" to activate`

### Step 2: 打开全局搜索
**Action**: `multi_Hotkey`
**Args**: `key1='cmd'`, `key2='k'`

### Step 3: 搜索目标群
**Action**: `input_text`
**Args**: `text='<group_name>'`

### Step 4: 进入群聊
**Action**: `Hotkey`
**Args**: `key='enter'`
**结果**: 打开群聊窗口, 输入框默认聚焦.

### Step 5: 触发 @ 候选浮窗
**Action**: `input_text`
**Args**: `text='@'`
**结果**: 飞书自动弹出群成员候选列表, 默认聚焦第一个成员.

### Step 6: 输入被 @ 成员名以过滤候选
**Action**: `input_text`
**Args**: `text='<contact_name>'`
**结果**: 候选列表过滤到目标成员.

### Step 7: 确认选中第一个候选
**Action**: `Hotkey`
**Args**: `key='enter'`
**结果**: 输入框出现 `@<contact_name>` 蓝色 mention 标签.

### Step 8: 输入消息内容 (在 @ 后面)
**Action**: `input_text`
**Args**: `text=' <message>'`
**注意**: 消息开头加一个空格, 避免和 @ 标签粘连.

### Step 9: 发送
**Action**: `Hotkey`
**Args**: `key='enter'`
**完成判定**: 群聊历史出现新消息, 含 @<contact_name> 蓝色标签 + 后面的文本.

## 失败兜底

| 现象 | 原因 | 兜底 |
|---|---|---|
| Step 4 enter 没进群 | 群名重名命中错的群 | Step 3 加更精确关键词 |
| Step 5 没出 @ 候选浮窗 | 输入框未聚焦 | 加 `LeftClickPixel` 点输入框中央 |
| @ 标签没渲染只有纯文本 | 候选浮窗未出现就 enter | Step 6 输入完后等 0.5s 再 enter |
| 消息发了但没 @ 蓝色标签 | 选错候选 | 让 Brain 看截图判断是否需要重做 Step 5-7 |

## 用例参数

```yaml
parameters:
  group: 测试群           # 已存在的群组
  contact: 钟梓文         # 群成员
  message: 帮我看一下这个 # 跟在 @ 后面的内容
```

## 三层 Verifier 期望

- **L1 像素 Diff**: PASS (聊天界面新消息 + @ 蓝色标签明显变化)
- **L2 OCR**: 期望 `[<contact>, <message>]`; 禁止 `[发送失败, 网络异常, @ 失败]`
- **L3 VLM**: "Did the new message in the chat contain a blue @<contact> mention tag followed by '<message>'?"

## 历史记录

- 2026-04-27: 创建; 套路同 im_send_text, 增加 @ 候选 + 选第一个的 3 步
