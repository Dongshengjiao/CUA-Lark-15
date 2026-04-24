from __future__ import annotations

"""Calendar test paths — satisfies the contest requirement of ≥2 Lark apps."""


def create_quick_meeting() -> str:
    return (
        "In Lark Desktop, open Calendar, create a new event titled 'CUA Test Meeting' "
        "for tomorrow 3pm-4pm, save it, and verify the event appears on the tomorrow "
        "column of the week view."
    )


def cross_product_meeting_reminder(group: str) -> str:
    """Bonus #2: Cross-product flow — Calendar → IM."""
    return (
        "In Lark Desktop: (1) open Calendar, find the next upcoming meeting today, "
        f"note its title and time; (2) switch to IM, open group '{group}', send a "
        "reminder message of the form 'Reminder: <title> at <time>', and verify the "
        "message appears."
    )
