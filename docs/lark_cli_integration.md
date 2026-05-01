# Lark CLI Integration Plan

## Role in CUA-Lark

`lark-cli` is an auxiliary capability in this project.

It should be used for:

1. Post-run verification after GUI automation finishes.
2. Fixture creation before a demo or benchmark run.
3. Cleanup after a run so cases stay repeatable.
4. Exploratory productization support after the desktop baseline is stable.

It should not be used for:

1. Replacing the visual agent as the primary competition action path.
2. Hiding failures in the GUI workflow.
3. Pretending desktop execution succeeded just because an API call exists.

## Integration Order

### Phase A

Keep the direct `lark-cli` execution assets as optional exploration:

1. Preserve the dedicated `lark-cli` executor backend.
2. Preserve API-side case files for Calendar, Docs, IM, and Contact search.
3. Keep preflight and clear failure signaling.

### Phase B

After local credentials are valid:

1. Add one Calendar verification or fixture case.
2. Add one Docs verification or fixture case.
3. Add one IM verification or fixture case.

### Phase C

Use desktop CUA as the primary competition execution path:

1. Execute the target workflow through screenshot understanding and desktop actions.
2. Use `lark-cli` only when it provides extra confidence or operational convenience.
3. Keep the source of truth for the competition demo on the desktop interaction loop.

## Example Command Patterns

These remain useful optional command patterns:

```bash
lark-cli contact +search-user --query "王泽"
lark-cli calendar +agenda --format json
lark-cli docs +create --title "Weekly Report" --markdown "# Progress" --dry-run
lark-cli im +messages-send --chat-id oc_xxx --text "hello" --dry-run
```

## Current Local Status

On the current machine:

1. `lark-cli` is installed.
2. A config file exists under `~/.lark-cli/config.json`.
3. Bot identity is surfaced by `lark-cli auth status`.
4. Real API calls still fail with `code: 10014` because the current app secret is not accepted by Feishu OpenAPI.

That means the next setup action is:

1. Correct the developer-platform app credential pair used by `lark-cli`.
2. Re-run a read-only API call such as `lark-cli calendar +agenda --as bot`.
3. Use the result as optional support, not as a reason to abandon the desktop CUA baseline.

## Competition Story

The message to judges should be:

1. The multimodal agent sees and operates Feishu like a human on the desktop client.
2. The framework can optionally use `lark-cli` or platform APIs for verification or fixture support.
3. This keeps the solution aligned with the competition's visual-first requirement while leaving room for engineering enhancement.
