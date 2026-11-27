#!/usr/bin/env python3
"""Session Script server.

Serves the observer web app and collects TXT and CSV reports.

Usage (on a Mac, from this folder):

    python3 server.py

Then on phones on the same Wi-Fi, open:

    http://YOUR-MAC-IP:8080

Find the Mac's IP with:  ipconfig getifaddr en0
(or en1 if you are on USB/iPhone tethering). Default port is 8080.
Override with:  PORT=9090 python3 server.py
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
REPORTS = ROOT / "reports"
PORT = int(os.environ.get("PORT", "8080"))
MAX_BODY = 1_000_000  # 1 MB

SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")


def sanitize_filename(name: str, extension: str = ".txt") -> str:
    if not extension.startswith("."):
        extension = "." + extension
    name = os.path.basename(unquote(name or "").replace("\\", "/"))
    name = SAFE_FILENAME.sub("", name).strip().strip(".")
    name = re.sub(r"\s+", " ", name)
    if name.lower().endswith(extension.lower()):
        stem = name[: -len(extension)].strip().strip(".")
    else:
        stem = re.sub(r"\.(txt|csv)$", "", name, count=1, flags=re.IGNORECASE).strip().strip(".")
    if not stem:
        stamp = datetime.now().strftime("%y%m%d %H%M%S")
        stem = f"{stamp} session observer"
    max_stem = max(1, 120 - len(extension))
    return stem[:max_stem].strip() + extension


def unique_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    if not candidate.exists():
        return candidate
    stem, suffix = os.path.splitext(filename)
    for i in range(2, 200):
        alt = directory / f"{stem}-{i}{suffix}"
        if not alt.exists():
            return alt
    stamp = datetime.now().strftime("%H%M%S")
    return directory / f"{stem}-{stamp}{suffix}"


def yymmdd_now() -> str:
    return datetime.now().strftime("%y%m%d")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _html(self, code: int, html: str) -> None:
        body = html.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)

        if path in ("/api/status", "/api/status/"):
            self._json(200, {"ok": True, "app": "session-script"})
            return

        if path in ("/reports", "/reports/"):
            self._reports_page()
            return

        if path.startswith("/reports/"):
            rel = path[len("/reports/") :]
            # Only files directly in reports/, no traversal.
            name = os.path.basename(rel)
            if (
                not name
                or name.startswith(".")
                or "/" in rel
                or "\\" in rel
                or rel != name
                or not name.lower().endswith((".txt", ".csv"))
            ):
                self.send_error(404, "Not found")
                return
            target = (REPORTS / name).resolve()
            if not str(target).startswith(str(REPORTS.resolve())) or not target.is_file():
                self.send_error(404, "Not found")
                return
            try:
                data = target.read_bytes()
            except OSError:
                self.send_error(404, "Not found")
                return
            self.send_response(200)
            media = "text/csv" if name.lower().endswith(".csv") else "text/plain"
            self.send_header("Content-Type", f"{media}; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Disposition", f'inline; filename="{name}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return

        if path in ("/submit", "/submit/"):
            self.send_error(405, "POST only")
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        if path not in ("/submit", "/submit/"):
            self.send_error(404, "Not found")
            return

        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"ok": False, "error": "Report is missing or too large."})
            return
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": "Expected JSON with text and filename."})
            return

        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            self._json(400, {"ok": False, "error": "Missing report text."})
            return

        suggested = data.get("filename") or ""
        if not isinstance(suggested, str) or not suggested.strip():
            title = sanitize_filename(str(data.get("title") or "session"))
            if title.lower().endswith(".txt"):
                title = title[:-4]
            observer = sanitize_filename(str(data.get("observer") or "observer"))
            if observer.lower().endswith(".txt"):
                observer = observer[:-4]
            suggested = f"{yymmdd_now()} {title} {observer}.txt"
        filename = sanitize_filename(suggested)

        REPORTS.mkdir(parents=True, exist_ok=True)
        dest = unique_path(REPORTS, filename)
        try:
            dest.write_text(text, encoding="utf-8")
        except OSError as exc:
            self._json(500, {"ok": False, "error": f"Could not write file: {exc}"})
            return

        csv_saved = None
        csv_text = data.get("csv")
        if isinstance(csv_text, str) and csv_text.strip():
            suggested_csv = data.get("csvFilename") or ""
            if not isinstance(suggested_csv, str) or not suggested_csv.strip():
                suggested_csv = filename[:-4] + ".csv" if filename.lower().endswith(".txt") else filename
            csv_name = sanitize_filename(suggested_csv, ".csv")
            dest_csv = unique_path(REPORTS, csv_name)
            try:
                dest_csv.write_text(csv_text, encoding="utf-8")
            except OSError as exc:
                self._json(500, {"ok": False, "error": f"Could not write spreadsheet: {exc}", "filename": dest.name})
                return
            csv_saved = dest_csv.name

        payload = {"ok": True, "filename": dest.name}
        if csv_saved:
            payload["csvFilename"] = csv_saved
        self._json(200, payload)

    def _reports_page(self) -> None:
        REPORTS.mkdir(parents=True, exist_ok=True)
        files = sorted(
            (
                p
                for p in REPORTS.iterdir()
                if p.is_file() and not p.name.startswith(".") and p.suffix.lower() in {".txt", ".csv"}
            ),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        rows = []
        for p in files:
            stamp = datetime.fromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%d %H:%M")
            href = "/reports/" + posixpath.basename(p.name)
            rows.append(
                "<tr>"
                f"<td><a href='{href}'>{_escape(p.name)}</a></td>"
                f"<td>{stamp}</td>"
                f"<td>{p.stat().st_size} bytes</td>"
                "</tr>"
            )
        table = (
            "<table><thead><tr><th>File</th><th>Saved</th><th>Size</th></tr></thead>"
            f"<tbody>{''.join(rows) or '<tr><td colspan=3>No reports yet.</td></tr>'}</tbody></table>"
        )
        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Session Script reports</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; background: #f6f3ee; color: #1c1917; }}
    h1 {{ color: #0e4a4c; font-size: 1.4rem; }}
    a {{ color: #0e4a4c; }}
    table {{ border-collapse: collapse; width: 100%; background: #fffefb; }}
    th, td {{ text-align: left; padding: 10px 12px; border-bottom: 1px solid #e7e0d6; }}
    th {{ font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: #57534e; }}
  </style>
</head>
<body>
  <h1>Session Script reports</h1>
  <p><a href="/">Open the observer app</a></p>
  {table}
</body>
</html>
"""
        self._html(200, html)

    def end_headers(self) -> None:
        # Helpful when testing from another device on the LAN.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Content-Length", "0")
        self.end_headers()


def _escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def main() -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    host = "0.0.0.0"
    httpd = ThreadingHTTPServer((host, PORT), Handler)
    print(f"Session Script server")
    print(f"  App:     http://127.0.0.1:{PORT}/")
    print(f"  Reports: http://127.0.0.1:{PORT}/reports")
    print(f"  Folder:  {REPORTS}")
    print(f"  Listening on all interfaces, port {PORT}.")
    print("  On a Mac, find your Wi-Fi IP with:  ipconfig getifaddr en0")
    print("  Then phones open:  http://THAT-IP:{0}/".format(PORT))
    print("  Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        httpd.server_close()


if __name__ == "__main__":
    main()
