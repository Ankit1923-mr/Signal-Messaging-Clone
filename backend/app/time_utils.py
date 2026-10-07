"""
Timestamp serialization helper.

All DateTime columns are populated with datetime.utcnow() (naive, no
tzinfo) -- that storage format is unchanged by this module. The bug this
fixes is purely at the API boundary: naive_datetime.isoformat() produces a
string with no timezone marker at all (e.g. "2026-10-08T18:43:12.123456"),
and the browser's `new Date(...)` parses an unmarked ISO string as LOCAL
time, not UTC. A UTC timestamp therefore got silently reinterpreted as if
it were already in the viewer's local timezone -- the root cause of
messages displaying wrong/stale-looking times.

utc_isoformat() just appends the "Z" suffix so the wire format
unambiguously says UTC, matching what was always true of the underlying
value. No change to how timestamps are stored or computed.
"""

from datetime import datetime


def utc_isoformat(dt: datetime) -> str:
    """Serialize a naive UTC datetime as an unambiguous UTC ISO 8601 string."""
    return dt.isoformat() + "Z"
