#!/usr/bin/env python3
"""Combine Session Script CSV exports into one Excel summary.

Each phone exports one CSV per session, with the same columns:

    session, observer, room_speakers, segment_type, start, end,
    duration_seconds, group_size, note

This tool reads every CSV in a folder and writes one summary workbook
(a CSV that Excel opens). It does not need any packages beyond Python 3.

Usage:
    python3 tools/combine.py /path/to/csv-folder
    python3 tools/combine.py /path/to/csv-folder -o /path/to/session-script-summary.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from pathlib import Path

COLUMNS = [
    "section",
    "session",
    "observer",
    "room_speakers",
    "source_file",
    "segment_type",
    "count",
    "total_duration_seconds",
    "average_duration_seconds",
    "share_of_time_percent",
    "average_group_size",
    "session_total_seconds",
]

REQUIRED = {
    "session",
    "observer",
    "room_speakers",
    "segment_type",
    "start",
    "end",
    "duration_seconds",
    "group_size",
    "note",
}

SEGMENT_TYPES = [
    "Introduction",
    "Presentation",
    "Conversation",
    "Q&A",
    "Participant question",
    "Survey",
    "Drawing",
    "Other activity",
]

BUCKETS = [
    ("Presentation (incl. introduction)", ["Introduction", "Presentation"]),
    ("Conversation", ["Conversation"]),
    ("Q&A (incl. participant questions)", ["Q&A", "Participant question"]),
    ("Survey", ["Survey"]),
    ("Drawing", ["Drawing"]),
    ("Other", ["Other activity"]),
]


def bucket_for(segment_type: str) -> str:
    for label, types in BUCKETS:
        if segment_type in types:
            return label
    return "Other"


def norm_header(name: str | None) -> str:
    return (name or "").strip().lstrip("\ufeff").lower()


def parse_seconds(value: str) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        seconds = int(round(float(text)))
    except ValueError:
        return None
    if seconds < 0:
        return None
    return seconds


def parse_group(value: str) -> int | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        size = int(round(float(text)))
    except ValueError:
        return None
    if size < 1:
        return None
    return size


def average_seconds(total: int, count: int) -> str:
    if count <= 0:
        return ""
    return str(int(round(total / count)))


def average_group(values: list[int]) -> str:
    if not values:
        return ""
    number = sum(values) / len(values)
    text = f"{number:.2f}".rstrip("0").rstrip(".")
    return text or "0"


def share_percents(parts: list[int], whole: int) -> list[str]:
    """One-decimal percentages that sum to 100.0 when the parts sum to whole."""
    if whole <= 0 or not parts:
        return ["" for _ in parts]
    floors: list[int] = []
    order: list[tuple[float, int, int]] = []
    used = 0
    for index, part in enumerate(parts):
        exact = (part * 1000) / whole
        base = int(exact)  # floor for non-negative values
        floors.append(base)
        used += base
        order.append((exact - base, part, index))
    left = 1000 - used
    order.sort(key=lambda item: (item[0], item[1]), reverse=True)
    guard = 0
    while left > 0 and order and guard < 5000:
        floors[order[guard % len(order)][2]] += 1
        left -= 1
        guard += 1
    guard = 0
    while left < 0 and order and guard < 5000:
        index = order[-(guard % len(order) + 1)][2]
        if floors[index] > 0:
            floors[index] -= 1
            left += 1
        guard += 1
    return [f"{tenth / 10:.1f}" for tenth in floors]


def read_export(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return _rows_from_reader(reader)


def _rows_from_reader(reader: csv.DictReader) -> list[dict[str, str]]:
    if not reader.fieldnames:
        raise ValueError("missing header")
    headers = {norm_header(name) for name in reader.fieldnames}
    if not REQUIRED.issubset(headers):
        raise ValueError("not a Session Script export")
    rows: list[dict[str, str]] = []
    for raw in reader:
        item = {norm_header(key): (value or "").strip() for key, value in raw.items() if key}
        if not item.get("segment_type"):
            continue
        rows.append(item)
    return rows


def blank_row() -> dict[str, str]:
    return {column: "" for column in COLUMNS}


class Bucket:
    def __init__(self) -> None:
        self.count = 0
        self.seconds = 0
        self.groups: list[int] = []

    def add(self, seconds: int, group: int | None) -> None:
        self.count += 1
        self.seconds += seconds
        if group is not None:
            self.groups.append(group)


def ordered_types(found: dict[str, Bucket]) -> list[str]:
    known = [name for name in SEGMENT_TYPES if name in found]
    extra = sorted(name for name in found if name not in SEGMENT_TYPES)
    return known + extra


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Combine Session Script CSV exports into one summary spreadsheet."
    )
    parser.add_argument("folder", type=Path, help="Folder of CSV files exported from Session Script")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Summary CSV to write (default: <folder>/session-script-summary.csv)",
    )
    args = parser.parse_args(argv)
    folder = args.folder
    if not folder.is_dir():
        print(f"Folder not found: {folder}", file=sys.stderr)
        return 1
    output = args.output or (folder / "session-script-summary.csv")

    paths = sorted(
        path
        for path in folder.iterdir()
        if path.is_file()
        and path.suffix.lower() == ".csv"
        and not path.name.startswith(".")
        and path.resolve() != output.resolve()
    )
    if not paths:
        print(f"No CSV files in {folder}", file=sys.stderr)
        return 1

    sessions: list[dict[str, object]] = []
    skipped: list[str] = []
    for path in paths:
        try:
            rows = read_export(path)
        except (OSError, UnicodeDecodeError, ValueError, csv.Error) as exc:
            skipped.append(f"{path.name} ({exc})")
            continue
        if not rows:
            skipped.append(f"{path.name} (no segment rows)")
            continue
        grouped: dict[tuple[str, str, str], list[dict[str, str]]] = defaultdict(list)
        for row in rows:
            key = (row.get("session", ""), row.get("observer", ""), row.get("room_speakers", ""))
            grouped[key].append(row)
        for (title, observer, room), group_rows in grouped.items():
            sessions.append(
                {
                    "title": title,
                    "observer": observer,
                    "room": room,
                    "source": path.name,
                    "rows": group_rows,
                }
            )

    if not sessions:
        print("No Session Script CSV exports were found.", file=sys.stderr)
        for line in skipped:
            print(f"Skipped {line}", file=sys.stderr)
        return 2

    overall: dict[str, Bucket] = defaultdict(Bucket)
    overall_buckets: dict[str, Bucket] = defaultdict(Bucket)
    grand_seconds = 0
    grand_groups: list[int] = []
    session_stats = []

    for session in sessions:
        by_type: dict[str, Bucket] = defaultdict(Bucket)
        by_bucket: dict[str, Bucket] = defaultdict(Bucket)
        total = 0
        groups: list[int] = []
        for row in session["rows"]:  # type: ignore[index]
            seconds = parse_seconds(str(row.get("duration_seconds", "")))
            if seconds is None:
                continue
            segment_type = str(row.get("segment_type", ""))
            group = parse_group(str(row.get("group_size", "")))
            by_type[segment_type].add(seconds, group)
            by_bucket[bucket_for(segment_type)].add(seconds, group)
            overall[segment_type].add(seconds, group)
            overall_buckets[bucket_for(segment_type)].add(seconds, group)
            total += seconds
            if group is not None:
                groups.append(group)
                grand_groups.append(group)
        grand_seconds += total
        session_stats.append(
            {
                "title": session["title"],
                "observer": session["observer"],
                "room": session["room"],
                "source": session["source"],
                "total": total,
                "groups": groups,
                "by_type": by_type,
                "count": sum(bucket.count for bucket in by_type.values()),
            }
        )

    rows_out: list[dict[str, str]] = []

    def add(section: str, **values: object) -> None:
        row = blank_row()
        row["section"] = section
        for key, value in values.items():
            row[key] = "" if value is None else str(value)
        rows_out.append(row)

    type_names = ordered_types(overall)
    type_shares = share_percents([overall[name].seconds for name in type_names], grand_seconds)
    for name, share in zip(type_names, type_shares):
        bucket = overall[name]
        add(
            "segment_type",
            segment_type=name,
            count=bucket.count,
            total_duration_seconds=bucket.seconds,
            average_duration_seconds=average_seconds(bucket.seconds, bucket.count),
            share_of_time_percent=share,
            average_group_size=average_group(bucket.groups),
            session_total_seconds=grand_seconds,
        )

    bucket_names = [label for label, _types in BUCKETS]
    bucket_shares = share_percents(
        [overall_buckets[name].seconds for name in bucket_names],
        grand_seconds,
    )
    for name, share in zip(bucket_names, bucket_shares):
        bucket = overall_buckets[name]
        add(
            "bucket",
            segment_type=name,
            count=bucket.count,
            total_duration_seconds=bucket.seconds,
            average_duration_seconds=average_seconds(bucket.seconds, bucket.count),
            share_of_time_percent=share,
            average_group_size=average_group(bucket.groups),
            session_total_seconds=grand_seconds,
        )

    for session in session_stats:
        by_type = session["by_type"]
        names = ordered_types(by_type)
        shares = share_percents([by_type[name].seconds for name in names], int(session["total"]))
        add(
            "session",
            session=session["title"],
            observer=session["observer"],
            room_speakers=session["room"],
            source_file=session["source"],
            count=session["count"],
            total_duration_seconds=session["total"],
            average_duration_seconds=average_seconds(int(session["total"]), int(session["count"])),
            average_group_size=average_group(session["groups"]),
            session_total_seconds=session["total"],
        )
        for name, share in zip(names, shares):
            bucket = by_type[name]
            add(
                "session_segment",
                session=session["title"],
                observer=session["observer"],
                room_speakers=session["room"],
                source_file=session["source"],
                segment_type=name,
                count=bucket.count,
                total_duration_seconds=bucket.seconds,
                average_duration_seconds=average_seconds(bucket.seconds, bucket.count),
                share_of_time_percent=share,
                average_group_size=average_group(bucket.groups),
                session_total_seconds=session["total"],
            )

    add(
        "total",
        count=sum(bucket.count for bucket in overall.values()),
        total_duration_seconds=grand_seconds,
        average_duration_seconds=average_seconds(
            grand_seconds,
            sum(bucket.count for bucket in overall.values()),
        ),
        share_of_time_percent="100.0" if grand_seconds else "",
        average_group_size=average_group(grand_groups),
        session_total_seconds=grand_seconds,
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, lineterminator="\r\n")
        writer.writeheader()
        writer.writerows(rows_out)

    segment_count = sum(int(session["count"]) for session in session_stats)
    print(f"Read {len(sessions)} session(s), {segment_count} segment(s).")
    print(f"Wrote {output}")
    for line in skipped:
        print(f"Skipped {line}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
