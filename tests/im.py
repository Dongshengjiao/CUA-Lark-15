from __future__ import annotations

"""IM test paths — contest example:
    'Search Test Group in IM, send Hello World, and verify success.'

Each function returns a natural-language goal string that is fed to the
framework. The framework then plans, executes, verifies, and reports.
"""


def search_and_send() -> str:
    return (
        "In Lark Desktop, open IM, search for 'Test Group', open it, "
        "send the message 'Hello World', and verify the message appears in the chat."
    )


def send_dm_to_contact(contact: str, text: str) -> str:
    return (
        f"In Lark Desktop, open IM, search for contact '{contact}', open the DM, "
        f"send the message '{text}', and verify the message appears in the chat."
    )
