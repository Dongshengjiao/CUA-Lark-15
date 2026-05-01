from __future__ import annotations

from cua_lark.models import RunResult


class MarkdownReporter:
    def render(self, result: RunResult) -> str:
        final_observation = result.metadata.get("final_observation", {})
        final_metadata = {}
        if isinstance(final_observation, dict):
            candidate = final_observation.get("metadata", {})
            if isinstance(candidate, dict):
                final_metadata = candidate

        external_checks = result.validation.metadata.get("external", [])
        if not isinstance(external_checks, list):
            external_checks = []

        lines = [
            f"# Run Report: {result.case_name}",
            "",
            f"- Case ID: `{result.case_id}`",
            f"- Product: `{result.product.value}`",
            f"- Success: `{result.success}`",
            f"- Validation: {result.validation.message}",
            "",
            "## Validation Details",
        ]

        for detail in result.validation.details:
            lines.append(f"- {detail}")

        if external_checks:
            lines.extend(
                [
                    "",
                    "## Verification Checks",
                ]
            )
            for item in external_checks:
                if not isinstance(item, dict):
                    continue
                check_id = item.get("id", "unknown")
                provider = item.get("provider", "unknown")
                success = item.get("success", "unknown")
                lines.append(f"- `{check_id}` ({provider}): success={success}")

        if final_metadata:
            lines.extend(
                [
                    "",
                    "## Final Observation",
                ]
            )
            front_window_app = final_metadata.get("front_window_app")
            front_window_title = final_metadata.get("front_window_title")
            screenshot_path = final_metadata.get("screenshot_path")
            browser_title = final_metadata.get("browser_title")
            browser_url = final_metadata.get("browser_url")
            front_window_lookup_error = final_metadata.get("front_window_lookup_error")
            if front_window_app:
                lines.append(f"- front_window_app: `{front_window_app}`")
            if front_window_title:
                lines.append(f"- front_window_title: `{front_window_title}`")
            if browser_title:
                lines.append(f"- browser_title: `{browser_title}`")
            if browser_url:
                lines.append(f"- browser_url: `{browser_url}`")
            if screenshot_path:
                lines.append(f"- screenshot_path: `{screenshot_path}`")
            if front_window_lookup_error:
                lines.append(f"- front_window_lookup_error: `{front_window_lookup_error}`")

        execution_metadata = result.metadata.get("execution", {})
        recovery_events = []
        if isinstance(execution_metadata, dict):
            candidate = execution_metadata.get("recovery_events", [])
            if isinstance(candidate, list):
                recovery_events = candidate

        if recovery_events:
            lines.extend(
                [
                    "",
                    "## Recovery",
                ]
            )
            for event in recovery_events:
                if not isinstance(event, dict):
                    continue
                step_id = event.get("step_id", "unknown")
                fallback_success = event.get("fallback_success", False)
                retry_after_fallback = event.get("retry_after_fallback", False)
                retry_success = event.get("retry_success")
                summary = (
                    f"- `{step_id}`: fallback_success={fallback_success}, "
                    f"retry_after_fallback={retry_after_fallback}"
                )
                if retry_success is not None:
                    summary += f", retry_success={retry_success}"
                lines.append(summary)

        lines.extend(
            [
                "",
            "## Steps",
            ]
        )

        for action_result in result.action_results:
            lines.append(
                f"- `{action_result.step_id}`: success={action_result.success} | {action_result.message}"
            )

        return "\n".join(lines) + "\n"
