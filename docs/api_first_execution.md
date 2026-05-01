# API-First Execution

## Positioning

This document defines the corrected primary architecture for the Feishu competition build:

1. Feishu CLI and Feishu OpenAPI are the primary business-execution path.
2. Desktop automation is secondary and optional for product demo, replay, or fallback.
3. Business completion must be attributable to platform-side API execution, not only to desktop clicks.

## Current Runtime Reality

The local repository now includes:

1. A dedicated `lark-cli` executor backend.
2. API-first case files for Calendar, Docs, IM, and Contact search.
3. Existing desktop CUA assets that can be retained only as demo or recovery tooling.

## Executor

Use the `lark-cli` executor with:

```bash
PYTHONPATH=src python3 -m cua_lark.cli <case.json> --executor lark-cli --perception mock
```

`mock` perception is sufficient because the primary action path is API-driven.

## Implemented API-First Cases

1. `cases/api_first/contact_search_user_bot.json`
2. `cases/api_first/calendar_create_event_bot.json`
3. `cases/api_first/docs_create_doc_bot.json`
4. `cases/api_first/im_send_message_bot.json`

## Current Blocker

At the moment, the configured Feishu app still fails real API calls with:

- `msg: app secret invalid`
- `code: 10014`

That means the code path is ready, but the current app credential pair is still not accepted by Feishu OpenAPI.

## Next Setup Action

The next required action is to fix the Feishu developer-platform credential pair used by `lark-cli`.

Once that is corrected, the API-first cases can run directly through:

1. `calendar +create`
2. `docs +create`
3. `im +messages-send`
4. `contact +search-user`
