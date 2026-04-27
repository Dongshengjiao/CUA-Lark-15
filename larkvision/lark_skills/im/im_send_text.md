---
name: feishu-im-send-text
description: 在飞书桌面客户端 IM 中向指定联系人发送一条文本消息
keywords:
  - 发消息
  - send message
  - IM
  - 飞书消息
applies_to:
  - 飞书 / Lark 桌面客户端
---

# 飞书 IM 发送文本消息

来源: 2026-04-26 实测打通 (3 步, ~65 秒, qwen3-vl-plus + DashScope).
经验: 不要让 actor 戳坐标找联系人, 用 Cmd+K 全局搜索更稳.

## 前置条件

- 飞书客户端已登录并在运行 (即使在后台也行)
- macOS 已授予屏幕录制 + 辅助功能权限给 Python 进程

## 操作步骤 (每步 1 个 action)

### Step 1: 强制激活飞书到前台
**Action**: `run_apple_script`
**Script**: `tell application "Lark" to activate`
**为什么**: `open_app` 经常被其他 App (如网易云音乐) 抢走焦点;  AppleScript activate 最可靠.

### Step 2: 打开全局搜索
**Action**: `multi_Hotkey`
**Args**: `key1='cmd'`, `key2='k'`
**注意**: 必须 Step 1 之后才执行, 否则 Cmd+K 会被前一个前台 App 截获.

### Step 3: 输入联系人名
**Action**: `input_text`
**Args**: `text='<contact_name>'`
**经验**: 用 `input_text` 一次性塞完整字符串, 比多次 `Hotkey` 字符更稳.

### Step 4: 选第一个搜索结果
**Action**: `Hotkey`
**Args**: `key='enter'`
**结果**: 打开与该联系人的聊天窗口, 输入框默认聚焦.

### Step 5: 输入消息内容
**Action**: `input_text`
**Args**: `text='<message>'`
**Brain 会自动跳过 Step 5/6**: 如果截图发现已经在目标聊天页且输入框聚焦.

### Step 6: 发送
**Action**: `Hotkey`
**Args**: `key='enter'`
**完成判定**: 截图中消息内容出现在聊天记录区.

## 失败兜底

| 现象 | 原因 | 兜底 |
|---|---|---|
| Cmd+K 没反应 | 飞书没在前台 | 重做 Step 1 |
| 搜索结果是错的人 | 名字有重名 | 在 Step 3 加更多字 / 拼音 |
| 消息没发出 | 输入框失焦 | 加一个 `LeftClickPixel` 点输入框中央再 input_text |

## 用例参数

```yaml
parameters:
  contact: 钟梓文       # 任意联系人名
  message: hello       # 任意 UTF-8 文本 (含中文 emoji 可)
```

## 历史记录

- 2026-04-26 19:54: 首次跑通, qwen3-vl-plus, 3 步实际执行 (Brain 自动跳过 Step 2-4 因为聊天已聚焦)
- 备注: 当 Brain 发现 Step N 已达成时会自动跳到 N+1, task 写完整链路即可
