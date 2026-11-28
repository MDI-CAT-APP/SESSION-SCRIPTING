/* Session Script — segment timer for observers.
   Stays on the phone (localStorage). Optional server.py can still collect files.
   The activity time is taken when the activity is chosen, not when a dialog opens. */
(function () {
  "use strict";

  var STORAGE_KEY = "session-script-v2";
  var LEGACY_KEY = "session-script-v1";
  var COORDINATOR = "maarten.vanneste@meetingsupport.org";
  var DOUBLE_TAP_MS = 2000;

  var ACTIVITY_TYPES = [
    "Introduction",
    "Presentation",
    "Conversation",
    "Participant question",
    "Q&A",
    "Feedback",
    "Survey",
    "Closing remarks",
    "Other activity"
  ];

  var BUCKETS = [
    { id: "presentation", label: "Presentation (incl. introduction)", types: ["Introduction", "Presentation"] },
    { id: "conversation", label: "Conversations (CAT)", types: ["Conversation"] },
    { id: "feedback", label: "Participants feedback", types: ["Feedback"] },
    { id: "qa", label: "Q&A (incl. participant questions)", types: ["Q&A", "Participant question"] },
    { id: "survey", label: "Survey", types: ["Survey"] },
    { id: "closing", label: "Closing remarks", types: ["Closing remarks"] },
    { id: "other", label: "Other", types: ["Other activity"] }
  ];

  var CLOSING_OPTIONS = [
    "People left right away",
    "People stayed talking",
    "Mixed",
    "Other"
  ];

  var CSV_HEADERS = [
    "session",
    "observer",
    "estimated_participants",
    "left_right_away_pct",
    "room_name",
    "room_speakers",
    "segment_type",
    "start",
    "end",
    "duration_seconds",
    "group_size",
    "group_size_avg",
    "note"
  ];

  var LEGACY_TYPES = {
    "Introduction": "Introduction",
    "Presentations": "Presentation",
    "Presentation": "Presentation",
    "Question from a participant": "Participant question",
    "Participant question": "Participant question",
    "Conversation": "Conversation",
    "Conversations About the Topic (CAT)": "Conversation",
    "Conversations (CAT)": "Conversation",
    "Feedback": "Feedback",
    "Participant feedback": "Feedback",
    "Participants feedback": "Feedback",
    "Q&A": "Q&A",
    "Survey": "Survey",
    "Other activity": "Other activity"
  };

  var state = { version: 2, currentId: null, screen: null, sessions: [] };
  var exportNote = { text: "", error: false };
  var serverAvailable = false;
  var lastFocused = null;
  var lastTap = { type: "", at: 0 };
  var pendingOtherAt = null;
  var noteSegmentId = null;
  var editingId = null;
  var setupEditCloseTouched = false;
  var deletingId = null;

  var $ = function (id) { return document.getElementById(id); };

  function pad(n) { return String(n).padStart(2, "0"); }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function toDatetimeLocal(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function parseDatetimeLocal(value) {
    if (!value) return null;
    var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) {
      var d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  }

  function formatHMS(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatHM(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function formatStamp(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatDateLong(d) {
    try {
      return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function formatDateShort(d) {
    try {
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function yymmdd(d) {
    return String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function formatSeconds(total) {
    total = Math.round(Number(total) || 0);
    if (total < 0) total = 0;
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0 && m > 0) return h + " h " + m + " min";
    if (h > 0) return h + " h";
    if (m > 0 && s > 0) return m + " min " + s + " s";
    if (m > 0) return m + " min";
    return s + " s";
  }

  function formatElapsed(startIso) {
    var ms = Date.now() - new Date(startIso).getTime();
    if (!isFinite(ms) || ms < 0) ms = 0;
    var total = Math.floor(ms / 1000);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    if (h > 0) return h + ":" + pad(m) + ":" + pad(s);
    return pad(m) + ":" + pad(s);
  }

  function slugPart(value, fallback) {
    var t = String(value || "")
      .trim()
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40);
    return t || fallback;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function wantsGroup(type) {
    return type === "Other activity";
  }

  function parseParticipants(value) {
    if (value == null || value === "") return null;
    var text = String(value).trim();
    if (!text) return null;
    var n = Number(text);
    if (!isFinite(n) || n < 0) return null;
    n = Math.round(n);
    if (n > 99999) n = 99999;
    return n;
  }

  function parseGroupSize(value) {
    if (value == null) return null;
    var text = String(value).trim();
    if (!text) return null;
    var n = Number(text);
    if (!isFinite(n) || n < 1) return null;
    n = Math.round(n);
    if (n > 999) n = 999;
    return n;
  }

  function normalizeGroupAvg(rawAvg, groupSize) {
    var text = String(rawAvg || "").trim().toLowerCase();
    if (text === "plenary" || text === "whole room" || text === "plenary/whole room") return "plenary";
    var fromAvg = parseGroupSize(text);
    if (fromAvg != null) return String(fromAvg);
    if (groupSize != null) return String(groupSize);
    return "";
  }

  function applyGroupAvg(seg, value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text) {
      seg.groupSizeAvg = "";
      seg.groupSize = null;
      return;
    }
    if (text === "plenary" || text === "whole room") {
      seg.groupSizeAvg = "plenary";
      seg.groupSize = null;
      return;
    }
    var size = parseGroupSize(text);
    if (size == null) {
      seg.groupSizeAvg = "";
      seg.groupSize = null;
      return;
    }
    seg.groupSizeAvg = String(size);
    seg.groupSize = size;
  }

  function groupPlain(seg) {
    if (!seg) return "";
    if (seg.groupSizeAvg === "plenary") return "Group size avg: Plenary";
    if (seg.type === "Conversation" && (seg.groupSize != null || seg.groupSizeAvg)) {
      return "Group size avg: " + (seg.groupSize != null ? seg.groupSize : seg.groupSizeAvg);
    }
    if (seg.groupSize != null) return "Group size: " + seg.groupSize;
    return "";
  }

  function groupPhrase(seg) {
    var plain = groupPlain(seg);
    if (!plain) return "";
    if (seg.groupSizeAvg === "plenary") return " · group size avg plenary";
    if (seg.type === "Conversation") return " · group size avg " + (seg.groupSize != null ? seg.groupSize : seg.groupSizeAvg);
    return " · group size " + seg.groupSize;
  }

  function csvGroupAvg(seg) {
    if (seg.groupSizeAvg === "plenary") return "plenary";
    if (seg.groupSizeAvg) return String(seg.groupSizeAvg);
    if (seg.groupSize != null) return String(seg.groupSize);
    return "";
  }

  function blankSession(observer) {
    var now = new Date();
    return {
      id: uid(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      title: "",
      speakers: "",
      plannedStart: toDatetimeLocal(now),
      observer: observer || "",
      estimatedParticipants: null,
      roomName: "",
      status: "setup",
      segments: [],
      closing: null,
      endedAt: null,
      lastFiles: null,
      dirtyExport: false
    };
  }

  function findSession(id) {
    if (!id) return null;
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === id) return state.sessions[i];
    }
    return null;
  }

  function currentSession() {
    return findSession(state.currentId);
  }

  function findSegment(session, id) {
    if (!session) return null;
    for (var i = 0; i < session.segments.length; i++) {
      if (session.segments[i].id === id) return session.segments[i];
    }
    return null;
  }

  function runningSegment(session) {
    if (!session || session.status === "ended") return null;
    for (var i = session.segments.length - 1; i >= 0; i--) {
      if (!session.segments[i].end) return session.segments[i];
    }
    return null;
  }

  function orderedSegments(session) {
    return session.segments.slice().sort(function (a, b) {
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });
  }

  function isBlank(session) {
    if (!session || session.status === "ended") return false;
    if (session.segments.length) return false;
    if ((session.title || "").trim()) return false;
    if ((session.speakers || "").trim()) return false;
    if (session.estimatedParticipants != null) return false;
    if ((session.roomName || "").trim()) return false;
    if (session.closing) return false;
    return true;
  }

  function isListed(session) {
    if (!session || isBlank(session)) return false;
    if (session.status === "ended") return true;
    if (session.segments.length) return true;
    return !!(session.title || "").trim();
  }

  function lastObserver() {
    for (var i = state.sessions.length - 1; i >= 0; i--) {
      var name = (state.sessions[i].observer || "").trim();
      if (name) return name;
    }
    return "";
  }

  function speakersList(session) {
    return String(session.speakers || "")
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
  }

  function segmentSeconds(seg) {
    if (!seg || !seg.start || !seg.end) return null;
    var ms = new Date(seg.end).getTime() - new Date(seg.start).getTime();
    if (!isFinite(ms)) return null;
    return ms < 0 ? 0 : Math.round(ms / 1000);
  }

  function sessionSeconds(session) {
    var total = 0;
    session.segments.forEach(function (seg) {
      if (seg.end) {
        var secs = segmentSeconds(seg);
        if (secs != null) total += secs;
      } else if (session.status !== "ended") {
        var ms = Date.now() - new Date(seg.start).getTime();
        if (ms > 0) total += Math.round(ms / 1000);
      }
    });
    return total;
  }

  function sessionDate(session) {
    var planned = parseDatetimeLocal(session.plannedStart);
    if (planned) return planned;
    if (session.segments.length) return new Date(session.segments[0].start);
    return new Date(session.createdAt || Date.now());
  }

  function bucketIdFor(type) {
    for (var i = 0; i < BUCKETS.length; i++) {
      if (BUCKETS[i].types.indexOf(type) !== -1) return BUCKETS[i].id;
    }
    return "other";
  }

  function shareTenths(parts, total) {
    var zeros = parts.map(function () { return 0; });
    if (!total) return zeros;
    var floors = [];
    var fracs = [];
    var used = 0;
    for (var i = 0; i < parts.length; i++) {
      var exact = (parts[i] * 1000) / total;
      var base = Math.floor(exact);
      floors.push(base);
      fracs.push(exact - base);
      used += base;
    }
    var left = 1000 - used;
    var order = fracs.map(function (frac, index) {
      return { i: index, f: frac, p: parts[index] };
    });
    order.sort(function (a, b) {
      if (b.f !== a.f) return b.f - a.f;
      return b.p - a.p;
    });
    var guard = 0;
    while (left > 0 && order.length && guard < 5000) {
      floors[order[guard % order.length].i] += 1;
      left -= 1;
      guard += 1;
    }
    guard = 0;
    while (left < 0 && order.length && guard < 5000) {
      var idx = order[order.length - 1 - (guard % order.length)].i;
      if (floors[idx] > 0) {
        floors[idx] -= 1;
        left += 1;
      }
      guard += 1;
    }
    return floors;
  }

  function computeTotals(session) {
    var byId = {};
    BUCKETS.forEach(function (bucket) { byId[bucket.id] = 0; });
    var total = 0;
    var groups = [];
    var plenaryCount = 0;
    session.segments.forEach(function (seg) {
      var secs = segmentSeconds(seg);
      if (secs == null) return;
      byId[bucketIdFor(seg.type)] += secs;
      total += secs;
      if (seg.groupSizeAvg === "plenary") plenaryCount += 1;
      else if (seg.groupSize != null) groups.push(seg.groupSize);
    });
    var parts = BUCKETS.map(function (bucket) { return byId[bucket.id]; });
    var tenths = shareTenths(parts, total);
    var average = null;
    if (groups.length) {
      var sum = groups.reduce(function (acc, n) { return acc + n; }, 0);
      average = sum / groups.length;
    }
    return {
      totalSeconds: total,
      averageGroup: average,
      plenaryCount: plenaryCount,
      buckets: BUCKETS.map(function (bucket, index) {
        return {
          id: bucket.id,
          label: bucket.label,
          seconds: byId[bucket.id],
          tenths: tenths[index]
        };
      })
    };
  }

  function shownBuckets(totals) {
    var rows = totals.buckets.filter(function (bucket) { return bucket.seconds > 0; });
    var tenths = shareTenths(rows.map(function (bucket) { return bucket.seconds; }), totals.totalSeconds);
    return rows.map(function (bucket, index) {
      return {
        id: bucket.id,
        label: bucket.label,
        seconds: bucket.seconds,
        tenths: tenths[index]
      };
    });
  }

  function formatAvg(value) {
    if (value == null || !isFinite(value)) return null;
    var rounded = Math.round(value * 100) / 100;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) return String(Math.round(rounded));
    return String(rounded);
  }

  function activityLabel(type) {
    if (type === "Conversation") return "Conversations (CAT)";
    if (type === "Feedback") return "Participants feedback";
    return type || "";
  }

  function segmentLabel(seg) {
    if (seg.type === "Other activity" && (seg.otherLabel || "").trim()) {
      return "Other activity: " + seg.otherLabel.trim();
    }
    return activityLabel(seg.type);
  }

  function exportNoteText(seg) {
    var label = (seg.otherLabel || "").trim();
    var note = (seg.note || "").trim();
    if (seg.type === "Other activity" && label && note) return label + " - " + note;
    if (seg.type === "Other activity" && label) return label;
    return note;
  }

  function fileBase(session) {
    var when = parseDatetimeLocal(session.plannedStart);
    if (!when && session.segments.length) when = new Date(session.segments[0].start);
    if (!when) when = new Date();
    return yymmdd(when) + " " + slugPart(session.title, "session") + " " + slugPart(session.observer, "observer");
  }

  function csvCell(value) {
    var text = value == null ? "" : String(value);
    if (/^[=+\-@\t]/.test(text)) text = "'" + text;
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function buildCsv(session) {
    var room = speakersList(session).join("; ");
    var lines = [CSV_HEADERS.join(",")];
    orderedSegments(session).forEach(function (seg) {
      var secs = segmentSeconds(seg);
      lines.push([
        csvCell(session.title || ""),
        csvCell(session.observer || ""),
        session.estimatedParticipants == null ? "" : String(session.estimatedParticipants),
        closingCsv(session),
        csvCell(session.roomName || ""),
        csvCell(room),
        csvCell(activityLabel(seg.type)),
        csvCell(seg.start ? formatStamp(new Date(seg.start)) : ""),
        csvCell(seg.end ? formatStamp(new Date(seg.end)) : ""),
        secs == null ? "" : String(secs),
        seg.groupSize == null ? "" : String(seg.groupSize),
        csvCell(csvGroupAvg(seg)),
        csvCell(exportNoteText(seg))
      ].join(","));
    });
    return lines.join("\r\n") + "\r\n";
  }

  function segmentScriptLine(seg) {
    var start = formatHMS(new Date(seg.start));
    var extra = groupPhrase(seg);
    var label = segmentLabel(seg);
    if (!seg.end) return start + " (running) " + label + extra;
    var secs = segmentSeconds(seg);
    return start + "–" + formatHMS(new Date(seg.end)) + " (" + formatSeconds(secs) + ") " + label + extra;
  }

  function snapLeftPct(value) {
    var n = Math.round(Number(value) / 10) * 10;
    if (!isFinite(n)) return 50;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function closingCsv(session) {
    var closing = session && session.closing;
    if (!closing || typeof closing.leftRightAwayPct !== "number") return "";
    return String(closing.leftRightAwayPct);
  }

  function closingAnswerText(session) {
    if (!session.closing) return "—";
    if (typeof session.closing.leftRightAwayPct === "number") {
      var left = session.closing.leftRightAwayPct;
      var stayed = 100 - left;
      return stayed + "% stayed talking, " + left + "% left right away";
    }
    if (session.closing.answer === "Other") return "Other — " + (session.closing.otherText || "");
    return session.closing.answer || "—";
  }

  function buildReport(session) {
    var planned = parseDatetimeLocal(session.plannedStart);
    var segs = orderedSegments(session);
    var first = segs.length ? new Date(segs[0].start) : null;
    var lastEnd = null;
    for (var i = segs.length - 1; i >= 0; i--) {
      if (segs[i].end) {
        lastEnd = new Date(segs[i].end);
        break;
      }
    }
    var totals = computeTotals(session);
    var lines = [
      "SESSION SCRIPT",
      "Meeting Design Institute",
      "",
      "Session: " + (session.title || "—"),
      "Room: " + ((session.roomName || "").trim() || "—"),
      "Speakers: " + (speakersList(session).join(", ") || "—"),
      "Observer: " + (session.observer || "—"),
      "Estimated participants: " + (session.estimatedParticipants == null ? "—" : String(session.estimatedParticipants)),
      "Date: " + formatDateLong(planned || first || new Date(session.createdAt || Date.now())),
      "Planned start: " + (planned ? formatHM(planned) : "—"),
      "Actual start: " + (first ? formatHMS(first) : "—"),
      "End: " + (lastEnd ? formatHMS(lastEnd) : "—"),
      "Duration: " + (totals.totalSeconds ? formatSeconds(totals.totalSeconds) : "—"),
      "",
      "After the session closed: " + closingAnswerText(session)
    ];
    if (session.closing && session.closing.comment) lines.push("Comment: " + session.closing.comment);
    lines.push("", "TOTALS");
    shownBuckets(totals).forEach(function (bucket) {
      lines.push(bucket.label + ": " + formatSeconds(bucket.seconds) + " (" + (bucket.tenths / 10).toFixed(1) + "%)");
    });
    lines.push("Average group size: " + (formatAvg(totals.averageGroup) || "—"));
    lines.push("", "ACTIVITIES");
    if (!segs.length) {
      lines.push("(no activities)");
    } else {
      segs.forEach(function (seg) {
        lines.push(segmentScriptLine(seg));
        if ((seg.note || "").trim()) lines.push("  " + seg.note.trim());
      });
    }
    lines.push("");
    return lines.join("\n");
  }

  function makeFile(name, contents, mime) {
    try {
      return new File([contents], name, { type: mime });
    } catch (e) {
      return null;
    }
  }

  function buildFiles(session) {
    var base = fileBase(session);
    var txtName = base + ".txt";
    var csvName = base + ".csv";
    var txt = buildReport(session);
    var csv = buildCsv(session);
    return {
      txtName: txtName,
      csvName: csvName,
      txt: txt,
      csv: csv,
      txtFile: makeFile(txtName, txt, "text/plain"),
      csvFile: makeFile(csvName, "\ufeff" + csv, "text/csv")
    };
  }

  function normalizeSegment(raw) {
    if (!raw || typeof raw !== "object" || !raw.start) return null;
    var storedType = raw.type === "Conversations About the Topic (CAT)" || raw.type === "Conversations (CAT)" ? "Conversation" : raw.type === "Participant feedback" || raw.type === "Participants feedback" ? "Feedback" : raw.type;
    var legacyDrawing = storedType === "Drawing";
    var type = legacyDrawing || ACTIVITY_TYPES.indexOf(storedType) === -1 ? "Other activity" : storedType;
    var otherLabel = (raw.otherLabel || "").trim();
    if (legacyDrawing && !otherLabel) otherLabel = "Drawing";
    if (type === "Other activity" && storedType !== "Other activity" && !otherLabel) otherLabel = String(storedType || "");
    var storedSize = parseGroupSize(raw.groupSize);
    var avg = normalizeGroupAvg(raw.groupSizeAvg, storedSize);
    var segment = {
      id: raw.id || uid(),
      type: type,
      otherLabel: otherLabel,
      start: raw.start,
      end: raw.end || null,
      note: raw.note || "",
      groupSize: null,
      groupSizeAvg: ""
    };
    if (avg === "plenary") {
      segment.groupSizeAvg = "plenary";
    } else if (avg) {
      segment.groupSizeAvg = avg;
      segment.groupSize = parseGroupSize(avg);
    } else if (storedSize != null) {
      segment.groupSize = storedSize;
      segment.groupSizeAvg = String(storedSize);
    }
    return segment;
  }

  function normalizeClosing(raw) {
    if (!raw || typeof raw !== "object") return null;
    var comment = String(raw.comment || "").trim();
    var pctText = raw.leftRightAwayPct == null ? "" : String(raw.leftRightAwayPct).trim();
    if (pctText !== "") {
      var pct = Number(pctText);
      if (isFinite(pct)) {
        pct = Math.round(pct);
        if (pct >= 0 && pct <= 100) {
          return {
            leftRightAwayPct: pct,
            answer: "",
            otherText: "",
            comment: comment
          };
        }
      }
    }
    if (CLOSING_OPTIONS.indexOf(raw.answer) === -1) return null;
    var otherText = String(raw.otherText || "").trim();
    if (raw.answer === "Other" && !otherText) return null;
    return {
      leftRightAwayPct: null,
      answer: raw.answer,
      otherText: raw.answer === "Other" ? otherText : "",
      comment: comment
    };
  }

  function normalizeSession(raw) {
    if (!raw || typeof raw !== "object") return null;
    var session = blankSession("");
    session.id = raw.id || session.id;
    session.createdAt = raw.createdAt || session.createdAt;
    session.updatedAt = raw.updatedAt || session.updatedAt;
    session.title = raw.title || "";
    session.speakers = raw.speakers || "";
    session.plannedStart = raw.plannedStart || session.plannedStart;
    session.observer = raw.observer || "";
    session.estimatedParticipants = parseParticipants(raw.estimatedParticipants);
    session.roomName = raw.roomName || "";
    session.status = raw.status === "ended" || raw.status === "live" ? raw.status : "setup";
    session.segments = Array.isArray(raw.segments) ? raw.segments.map(normalizeSegment).filter(Boolean) : [];
    session.closing = normalizeClosing(raw.closing);
    session.endedAt = raw.endedAt || null;
    session.lastFiles = raw.lastFiles && raw.lastFiles.txtName ? raw.lastFiles : null;
    session.dirtyExport = !!raw.dirtyExport;
    return session;
  }

  function repairRunning(session) {
    if (session.status === "ended") {
      var end = session.endedAt || new Date().toISOString();
      session.segments.forEach(function (seg) {
        if (!seg.end) seg.end = end;
      });
      return;
    }
    var open = session.segments.filter(function (seg) { return !seg.end; });
    if (open.length <= 1) return;
    open.sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    for (var i = 0; i < open.length - 1; i++) open[i].end = open[i + 1].start;
  }

  function sessionFromLegacy(data) {
    var setup = data.setup || {};
    var activities = Array.isArray(data.activities) ? data.activities.slice() : [];
    activities.sort(function (a, b) { return new Date(a.time) - new Date(b.time); });
    if (!activities.length && !(setup.title || "").trim()) return null;
    var session = blankSession(setup.observer || "");
    session.title = setup.title || "";
    session.speakers = setup.speakers || "";
    session.plannedStart = setup.plannedStart || session.plannedStart;
    session.status = activities.length ? "live" : "setup";
    activities.forEach(function (activity, index) {
      var mapped = LEGACY_TYPES[activity.type];
      var type = mapped || "Other activity";
      var otherLabel = "";
      if (type === "Other activity") {
        otherLabel = String(activity.other || "").trim();
        if (!otherLabel && !mapped) otherLabel = String(activity.type || "Other");
      }
      var next = activities[index + 1];
      session.segments.push({
        id: activity.id || uid(),
        type: type,
        otherLabel: otherLabel,
        start: activity.time,
        end: next ? next.time : null,
        note: activity.note || "",
        groupSize: null,
        groupSizeAvg: ""
      });
    });
    session.updatedAt = new Date().toISOString();
    return session;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && Array.isArray(data.sessions)) {
          state.sessions = data.sessions.map(normalizeSession).filter(Boolean);
          state.currentId = data.currentId || null;
          if (!findSession(state.currentId)) state.currentId = null;
          state.sessions.forEach(repairRunning);
          return;
        }
      }
    } catch (e) {
      console.warn("Could not load Session Script", e);
    }
    migrateLegacy();
  }

  function migrateLegacy() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      var session = sessionFromLegacy(data || {});
      if (!session) return;
      state.sessions = [session];
      state.currentId = session.id;
      save();
    } catch (e) {
      console.warn("Could not migrate the previous session", e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        currentId: state.currentId,
        sessions: state.sessions
      }));
    } catch (e) {
      toast("Could not save on this phone");
    }
  }

  function toast(message) {
    var el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  function setStatus(message, isError) {
    exportNote = { text: message || "", error: !!isError };
    var el = $("exportStatus");
    if (el) {
      el.textContent = exportNote.text;
      el.classList.toggle("error", exportNote.error);
    }
    if (message && document.body.dataset.view !== "report") toast(message);
  }

  function buzz() {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(12); } catch (e) { /* ignore */ }
  }

  function noteSheetEl() {
    return $("noteModal").querySelector(".modal");
  }

  function fitNoteSheet() {
    var sheet = noteSheetEl();
    if (!sheet || $("noteModal").classList.contains("hidden")) return;
    var vv = window.visualViewport;
    if (!vv) return;
    var height = Math.max(160, Math.floor(vv.height - 8));
    sheet.style.maxHeight = height + "px";
    var obscured = window.innerHeight - vv.offsetTop - vv.height;
    sheet.style.marginBottom = obscured > 1 ? Math.round(obscured) + "px" : "0px";
    revealNoteComposer();
  }

  function revealNoteComposer() {
    var sheet = noteSheetEl();
    var actions = $("noteModal").querySelector(".note-actions");
    if (!sheet || !actions || $("noteModal").classList.contains("hidden")) return;
    var sheetRect = sheet.getBoundingClientRect();
    var overflow = actions.getBoundingClientRect().bottom - (sheetRect.bottom - 6);
    if (overflow > 1) sheet.scrollTop += overflow;
  }

  function watchNoteViewport(on) {
    var vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener("resize", fitNoteSheet);
      vv.removeEventListener("scroll", fitNoteSheet);
    }
    if (!on) {
      var sheet = noteSheetEl();
      if (sheet) {
        sheet.style.maxHeight = "";
        sheet.style.marginBottom = "";
      }
      return;
    }
    if (vv) {
      vv.addEventListener("resize", fitNoteSheet);
      vv.addEventListener("scroll", fitNoteSheet);
    }
    fitNoteSheet();
  }

  function openModal(id) {
    lastFocused = document.activeElement;
    $(id).classList.remove("hidden");
    document.body.classList.add("modal-open");
    var dialog = $(id).querySelector(".modal");
    if (dialog && dialog.focus) dialog.focus();
    if (id === "noteModal") watchNoteViewport(true);
    var auto = $(id).querySelector("[data-autofocus]");
    if (auto) setTimeout(function () { try { auto.focus(); } catch (e) { /* ignore */ } }, 40);
  }

  function closeModal(id) {
    if (id === "noteModal") watchNoteViewport(false);
    $(id).classList.add("hidden");
    if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
      document.body.classList.remove("modal-open");
    }
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) { /* ignore */ }
    }
  }

  function setIdle(id, value) {
    var el = $(id);
    if (!el || document.activeElement === el) return;
    var next = value || "";
    if (el.value !== next) el.value = next;
  }

  function draftSession() {
    var current = currentSession();
    if (current && current.status === "setup") return current;
    var fresh = blankSession(lastObserver());
    state.sessions.push(fresh);
    state.currentId = fresh.id;
    return fresh;
  }

  function persistSetupFromForm() {
    var session = draftSession();
    session.title = $("sessionTitle").value;
    session.speakers = $("speakers").value;
    session.plannedStart = $("plannedStart").value;
    session.observer = $("observer").value;
    session.estimatedParticipants = parseParticipants($("participants").value);
    session.roomName = $("roomName").value;
    session.updatedAt = new Date().toISOString();
    save();
    return session;
  }

  function captureRunningFields() {
    var session = currentSession();
    var seg = runningSegment(session);
    if (!seg) return;
    var note = $("runNote");
    var group = $("runGroup");
    if (note) seg.note = note.value.trim();
    if (group) applyGroupAvg(seg, group.value);
  }

  function startSegment(session, type, when, extra) {
    extra = extra || {};
    var iso = when.toISOString();
    var running = runningSegment(session);
    if (running) running.end = iso;
    var groupSize = extra.groupSize != null ? extra.groupSize : null;
    var groupSizeAvg = extra.groupSizeAvg || (groupSize != null ? String(groupSize) : "");
    session.segments.push({
      id: uid(),
      type: type,
      otherLabel: extra.otherLabel || "",
      start: iso,
      end: null,
      note: extra.note || "",
      groupSize: groupSizeAvg === "plenary" ? null : groupSize,
      groupSizeAvg: groupSizeAvg
    });
    session.status = "live";
    session.updatedAt = iso;
    save();
    render();
  }

  function chooseActivity(type) {
    var session = currentSession();
    if (!session || session.status !== "live") return;
    var nowMs = Date.now();
    if (lastTap.type === type && nowMs - lastTap.at < DOUBLE_TAP_MS) {
      toast("Double tap ignored");
      return;
    }
    lastTap = { type: type, at: nowMs };
    var when = new Date();
    if (type === "Other activity") {
      openOther(when);
      return;
    }
    captureRunningFields();
    startSegment(session, type, when, {});
    var started = runningSegment(currentSession());
    if (started) openNoteSheet(started);
    buzz();
  }

  function markOtherQuick(containerId, value) {
    var box = $(containerId);
    if (!box) return;
    var chips = box.querySelectorAll("[data-other-quick]");
    for (var i = 0; i < chips.length; i++) {
      if (chips[i].getAttribute("data-other-quick") === value) chips[i].setAttribute("aria-pressed", "true");
      else chips[i].removeAttribute("aria-pressed");
    }
  }

  function bindOtherQuick(containerId, fieldId, saveId) {
    var box = $(containerId);
    if (!box) return;
    box.addEventListener("click", function (ev) {
      var chip = ev.target.closest("[data-other-quick]");
      if (!chip || !box.contains(chip)) return;
      var label = chip.getAttribute("data-other-quick");
      var field = $(fieldId);
      if (chip.getAttribute("aria-pressed") === "true") {
        if (field.value.trim() === label) field.value = "";
        chip.removeAttribute("aria-pressed");
      } else {
        field.value = label;
        markOtherQuick(containerId, label);
      }
      if (saveId && $(saveId)) $(saveId).disabled = !field.value.trim();
    });
  }

  function openOther(when) {
    pendingOtherAt = when;
    $("otherStart").textContent = formatHMS(when);
    $("otherText").value = "";
    $("otherGroup").value = "";
    $("otherNote").value = "";
    $("otherSave").disabled = true;
    markOtherQuick("otherQuick", "");
    openModal("otherModal");
    buzz();
  }

  function confirmOther() {
    var label = $("otherText").value.trim();
    if (!pendingOtherAt || !label) {
      toast("Describe the activity");
      $("otherText").focus();
      return;
    }
    var session = currentSession();
    if (!session || session.status !== "live") return;
    captureRunningFields();
    var when = pendingOtherAt;
    pendingOtherAt = null;
    closeModal("otherModal");
    var size = parseGroupSize($("otherGroup").value);
    startSegment(session, "Other activity", when, {
      otherLabel: label,
      groupSize: size,
      groupSizeAvg: size != null ? String(size) : "",
      note: $("otherNote").value.trim()
    });
  }

  function bindChipRow(containerId) {
    $(containerId).addEventListener("click", function (ev) {
      var chip = ev.target.closest("[data-chip]");
      if (!chip || !$(containerId).contains(chip)) return;
      var next = chip.getAttribute("aria-pressed") === "true" ? "" : chip.getAttribute("data-chip");
      setChips(containerId, next);
    });
  }

  function setChips(containerId, value) {
    var chips = $(containerId).querySelectorAll("[data-chip]");
    for (var i = 0; i < chips.length; i++) {
      if (value && chips[i].getAttribute("data-chip") === value) chips[i].setAttribute("aria-pressed", "true");
      else chips[i].removeAttribute("aria-pressed");
    }
  }

  function readGroupAvg(containerId) {
    var pressed = $(containerId).querySelector("[aria-pressed='true']");
    return pressed ? pressed.getAttribute("data-chip") : "";
  }

  function showGroupAvg(containerId, value) {
    var presets = { "2": true, "3": true, "4": true, "5": true, "6": true };
    setChips(containerId, value && presets[value] ? value : "");
  }

  function commitGroupAvg(seg, containerId) {
    var picked = readGroupAvg(containerId);
    var previous = seg.groupSizeAvg || "";
    var chips = { "2": true, "3": true, "4": true, "5": true, "6": true };
    if (picked) applyGroupAvg(seg, picked);
    else if (chips[previous]) applyGroupAvg(seg, "");
  }

  function openNoteSheet(seg) {
    noteSegmentId = seg.id;
    $("noteTitle").textContent = activityLabel(seg.type);
    $("noteActivity").textContent = "Activity: " + activityLabel(seg.type);
    $("noteText").value = seg.note || "";
    var conversation = seg.type === "Conversation";
    $("noteGroupWrap").classList.toggle("hidden", !conversation);
    if (conversation) showGroupAvg("noteChips", seg.groupSizeAvg || "");
    openModal("noteModal");
  }

  function saveNoteSheet() {
    var session = currentSession();
    var seg = findSegment(session, noteSegmentId);
    if (seg) {
      seg.note = $("noteText").value.trim();
      if (seg.type === "Conversation") commitGroupAvg(seg, "noteChips");
      session.updatedAt = new Date().toISOString();
      if (session.status === "ended") session.dirtyExport = true;
      save();
    }
    noteSegmentId = null;
    closeModal("noteModal");
    render();
  }

  function skipNoteSheet() {
    noteSegmentId = null;
    closeModal("noteModal");
  }

  function cancelOther() {
    pendingOtherAt = null;
    lastTap = { type: "", at: 0 };
    closeModal("otherModal");
  }

  function undoLast() {
    var session = currentSession();
    if (!session || session.status !== "live" || !session.segments.length) return;
    session.segments.pop();
    if (session.segments.length) session.segments[session.segments.length - 1].end = null;
    lastTap = { type: "", at: 0 };
    session.updatedAt = new Date().toISOString();
    save();
    render();
    toast("Last tap undone");
  }

  function paintCloseSlider(sliderId, stayedId, leftId, stayedValue) {
    var stayed = snapLeftPct(stayedValue);
    var left = 100 - stayed;
    var slider = $(sliderId);
    slider.value = String(stayed);
    slider.style.setProperty("--split", stayed + "%");
    if (slider.parentElement) slider.parentElement.style.setProperty("--split", stayed + "%");
    $(stayedId).textContent = stayed + "% stayed talking";
    $(leftId).textContent = left + "% left right away";
    return left;
  }

  function openEnd() {
    var session = currentSession();
    if (!session || session.status !== "live" || !session.segments.length) return;
    captureRunningFields();
    save();
    paintCloseSlider("closeSlider", "closeStayed", "closeLeft", 50);
    $("closingComment").value = "";
    $("closeParticipants").value = session.estimatedParticipants == null ? "" : String(session.estimatedParticipants);
    openModal("endModal");
  }

  function isIOS() {
    var ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function canShareFiles(files) {
    if (!files || !files[0] || !files[1] || !navigator.share || !navigator.canShare) return false;
    try { return navigator.canShare({ files: files }); } catch (e) { return false; }
  }

  function downloadText(name, text, mime, bom) {
    downloadBoth([{ name: name, text: text, mime: mime, bom: bom }]);
  }

  function downloadBoth(jobs) {
    var created = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      var blob = new Blob([(job.bom ? "\ufeff" : "") + job.text], { type: job.mime + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = job.name;
      link.rel = "noopener";
      document.body.appendChild(link);
      created.push({ link: link, url: url });
    }
    for (var j = 0; j < created.length; j++) created[j].link.click();
    setTimeout(function () {
      for (var k = 0; k < created.length; k++) {
        created[k].link.remove();
        URL.revokeObjectURL(created[k].url);
      }
    }, 2500);
  }

  function autoSaveFiles(session) {
    var files = buildFiles(session);
    var ios = isIOS();
    session.lastFiles = {
      txtName: files.txtName,
      csvName: files.csvName,
      method: ios ? "share" : "download",
      savedAt: new Date().toISOString()
    };
    session.dirtyExport = false;
    exportNote = { text: "", error: false };
    if (ios) {
      var packed = [files.txtFile, files.csvFile];
      if (canShareFiles(packed)) {
        navigator.share({
          files: packed,
          title: "Session Script — " + COORDINATOR,
          text: "Save both files to Files, then email them to " + COORDINATOR + ".\n\n" + files.txtName + "\n" + files.csvName
        }).catch(function (err) {
          if (err && err.name === "AbortError") return;
          setStatus("The share sheet did not open. Use Email to Maarten or Share, then send both files to " + COORDINATOR + ".", true);
        });
      } else {
        setStatus("This browser cannot open the share sheet. Use Email to Maarten or Share, then send both files to " + COORDINATOR + ".", true);
      }
    } else {
      downloadBoth([
        { name: files.txtName, text: files.txt, mime: "text/plain", bom: false },
        { name: files.csvName, text: files.csv, mime: "text/csv", bom: true }
      ]);
    }
    save();
    render();
  }

  function finalizeSession(storeClose) {
    var session = currentSession();
    if (!session || session.status !== "live" || !session.segments.length) return;
    captureRunningFields();
    var when = new Date();
    var running = runningSegment(session);
    if (running) running.end = when.toISOString();
    if (storeClose) {
      session.estimatedParticipants = parseParticipants($("closeParticipants").value);
      session.closing = {
        leftRightAwayPct: paintCloseSlider("closeSlider", "closeStayed", "closeLeft", $("closeSlider").value),
        answer: "",
        otherText: "",
        comment: $("closingComment").value.trim()
      };
    } else {
      session.closing = null;
    }
    session.status = "ended";
    session.endedAt = when.toISOString();
    session.updatedAt = session.endedAt;
    state.screen = null;
    closeModal("endModal");
    autoSaveFiles(session);
    toast("Session saved");
  }

  function clearDirty(session) {
    if (!session || !session.dirtyExport) return;
    session.dirtyExport = false;
    save();
    var note = $("dirtyNote");
    if (note) note.remove();
  }

  function openMailto(session, files) {
    var subject = "Session Script: " + (session.title || "session") +
      (session.observer ? " — " + session.observer : "");
    var body = files.txt + "\n\n---\nPlease attach the CSV file " + files.csvName + " as well.";
    var href = "mailto:" + COORDINATOR +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
    var message = "Your mail app should open a message to " + COORDINATOR +
      " with the text report. Attach the CSV file " + files.csvName + ".";
    if (href.length > 1900) {
      copyText(files.txt, true);
      message = "The report is long for an email link, so the text was copied. Email " +
        COORDINATOR + " and attach " + files.csvName + ".";
      setStatus(message, true);
      return;
    }
    setStatus(message);
    window.location.href = href;
  }

  function emailToMaarten(session) {
    if (!session) return;
    var files = buildFiles(session);
    var packed = [files.txtFile, files.csvFile];
    var payload = {
      files: packed,
      title: "Session Script — " + COORDINATOR,
      text: "To: " + COORDINATOR + "\n\n" + files.txt
    };
    if (canShareFiles(packed)) {
      navigator.share(payload).then(function () {
        clearDirty(session);
        setStatus("Shared. Send both files to " + COORDINATOR + ".");
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        openMailto(session, files);
      });
      return;
    }
    openMailto(session, files);
  }

  function shareReport(session) {
    var files = buildFiles(session);
    var packed = [files.txtFile, files.csvFile];
    var title = "Session Script: " + (session.title || "session");
    if (canShareFiles(packed)) {
      navigator.share({ files: packed, title: title, text: files.txt }).then(function () {
        clearDirty(session);
        setStatus("Shared.");
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        shareText(files, title);
      });
      return;
    }
    shareText(files, title);
  }

  function shareText(files, title) {
    if (navigator.share) {
      navigator.share({ title: title, text: files.txt }).then(function () {
        setStatus("Shared the text report. Use Save CSV if you still need the spreadsheet.");
      }).catch(function (err) {
        if (err && err.name === "AbortError") return;
        copyText(files.txt, true);
        setStatus("Sharing did not work. The text report was copied.", true);
      });
      return;
    }
    copyText(files.txt, true);
    setStatus("Sharing is not available in this browser. The text report was copied.");
  }

  function copyText(value, silent) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () {
        if (!silent) {
          setStatus("Copied the text report.");
          toast("Copied");
        }
      }).catch(function () { return fallbackCopy(value, silent); });
    }
    return fallbackCopy(value, silent);
  }

  function fallbackCopy(value, silent) {
    return new Promise(function (resolve) {
      var area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "readonly");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      area.remove();
      if (!silent) {
        if (ok) {
          setStatus("Copied the text report.");
          toast("Copied");
        } else {
          setStatus("Could not copy. Select the text report and copy it yourself.", true);
        }
      }
      resolve(ok);
    });
  }

  function openWhatsApp(session) {
    var text = buildReport(session);
    var url = "https://wa.me/?text=" + encodeURIComponent(text);
    if (url.length > 1800) {
      copyText(text, true);
      setStatus("The report is long for a WhatsApp link, so it was copied. Open WhatsApp and paste it.", true);
      toast("Copied — paste in WhatsApp");
      return;
    }
    window.location.href = url;
  }

  function saveSingle(kind) {
    var session = currentSession();
    if (!session) return;
    var files = buildFiles(session);
    if (kind === "csv") downloadText(files.csvName, files.csv, "text/csv", true);
    else downloadText(files.txtName, files.txt, "text/plain", false);
    clearDirty(session);
    setStatus("Saved “" + (kind === "csv" ? files.csvName : files.txtName) + "”.");
  }

  function sendToServer() {
    var session = currentSession();
    if (!session || !serverAvailable) {
      setStatus("Send to server only works when this app is opened from the optional local server.", true);
      return;
    }
    var files = buildFiles(session);
    fetch("./submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        filename: files.txtName,
        text: files.txt,
        csvFilename: files.csvName,
        csv: "\ufeff" + files.csv,
        title: session.title || "",
        observer: session.observer || ""
      })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || "Server could not save the report");
        return data;
      });
    }).then(function (data) {
      clearDirty(session);
      var extra = data.csvFilename ? " and “" + data.csvFilename + "”" : "";
      setStatus("Saved on the server as “" + data.filename + "”" + extra + ".");
      toast("Sent to server");
    }).catch(function (err) {
      setStatus((err && err.message) || "Could not send to the server.", true);
    });
  }

  function createNewSession() {
    var current = currentSession();
    if (isBlank(current)) {
      current.observer = lastObserver() === current.observer ? current.observer : (lastObserver() || current.observer);
      current.plannedStart = toDatetimeLocal(new Date());
      current.title = "";
      current.speakers = "";
      current.estimatedParticipants = null;
      current.roomName = "";
      current.updatedAt = new Date().toISOString();
      state.screen = null;
      exportNote = { text: "", error: false };
      save();
      render();
      return;
    }
    var fresh = blankSession(lastObserver());
    state.sessions.push(fresh);
    state.currentId = fresh.id;
    state.screen = null;
    exportNote = { text: "", error: false };
    save();
    render();
  }

  function requestNewSession() {
    var session = currentSession();
    if (session && session.status === "live" && (session.segments.length || (session.title || "").trim())) {
      openModal("newModal");
      return;
    }
    createNewSession();
  }

  function openSession(id) {
    if (!findSession(id)) return;
    state.currentId = id;
    state.screen = null;
    exportNote = { text: "", error: false };
    save();
    render();
  }

  function openSessionSetup() {
    var session = currentSession();
    if (!session || session.status !== "ended") return;
    $("setupEditTitle").value = session.title || "";
    $("setupEditSpeakers").value = session.speakers || "";
    $("setupEditRoom").value = session.roomName || "";
    $("setupEditPlanned").value = session.plannedStart || "";
    $("setupEditObserver").value = session.observer || "";
    $("setupEditParticipants").value = session.estimatedParticipants == null ? "" : String(session.estimatedParticipants);
    var closing = session.closing;
    var hasPct = !!(closing && typeof closing.leftRightAwayPct === "number");
    paintCloseSlider("setupEditCloseSlider", "setupEditCloseStayed", "setupEditCloseLeft", hasPct ? 100 - closing.leftRightAwayPct : 50);
    var legacy = closing && !hasPct && closing.answer ? "Saved answer: " + closingAnswerText(session) + ". Move the slider to replace it." : "";
    $("setupEditLegacy").textContent = legacy;
    $("setupEditLegacy").classList.toggle("hidden", !legacy);
    setupEditCloseTouched = false;
    $("setupEditError").textContent = "";
    openModal("setupEditModal");
  }

  function saveSessionSetup() {
    var session = currentSession();
    if (!session || session.status !== "ended") return;
    var title = $("setupEditTitle").value.trim();
    var observer = $("setupEditObserver").value.trim();
    var planned = $("setupEditPlanned").value;
    if (!title) {
      $("setupEditError").textContent = "Add a session title.";
      $("setupEditTitle").focus();
      return;
    }
    if (!observer) {
      $("setupEditError").textContent = "Add your name so the file can be identified.";
      $("setupEditObserver").focus();
      return;
    }
    if (!planned) {
      $("setupEditError").textContent = "Add the planned session start.";
      $("setupEditPlanned").focus();
      return;
    }
    session.title = title;
    session.speakers = $("setupEditSpeakers").value;
    session.roomName = $("setupEditRoom").value.trim();
    session.plannedStart = planned;
    session.observer = observer;
    session.estimatedParticipants = parseParticipants($("setupEditParticipants").value);
    var hasPct = !!(session.closing && typeof session.closing.leftRightAwayPct === "number");
    if (hasPct || setupEditCloseTouched) {
      var keptComment = session.closing && session.closing.comment ? session.closing.comment : "";
      session.closing = {
        leftRightAwayPct: paintCloseSlider("setupEditCloseSlider", "setupEditCloseStayed", "setupEditCloseLeft", $("setupEditCloseSlider").value),
        answer: "",
        otherText: "",
        comment: keptComment
      };
    }
    session.updatedAt = new Date().toISOString();
    session.dirtyExport = true;
    save();
    closeModal("setupEditModal");
    render();
    toast("Session updated");
  }

  function askDelete(id) {
    var session = findSession(id);
    if (!session) return;
    deletingId = id;
    var title = session.title || "Untitled session";
    $("deleteBody").textContent = title + " will be removed from this phone. Files already saved in Downloads or Files stay there. This cannot be undone.";
    openModal("deleteModal");
  }

  function confirmDelete() {
    if (!deletingId) return;
    var id = deletingId;
    deletingId = null;
    state.sessions = state.sessions.filter(function (session) { return session.id !== id; });
    if (state.currentId === id) {
      state.currentId = null;
      state.screen = "past";
    }
    save();
    closeModal("deleteModal");
    render();
    toast("Session deleted");
  }

  function showPast() {
    if (document.body.dataset.view === "setup" && ($("sessionTitle").value || $("observer").value || $("speakers").value || $("participants").value || $("roomName").value)) {
      persistSetupFromForm();
    }
    if (document.body.dataset.view === "live") {
      captureRunningFields();
      save();
    }
    state.screen = "past";
    render();
  }

  function togglePast() {
    if (state.screen === "past") {
      state.screen = null;
      render();
      return;
    }
    showPast();
  }

  function logSuffix(seg) {
    var bits = [];
    if (seg.groupSizeAvg === "plenary") bits.push("plenary");
    else if (seg.type === "Conversation" && seg.groupSize != null) bits.push("avg " + seg.groupSize);
    else if (seg.groupSize != null) bits.push("group " + seg.groupSize);
    var note = (seg.note || "").trim().replace(/\s+/g, " ");
    if (note.length > 24) note = note.slice(0, 23).trim() + "…";
    if (note) bits.push(note);
    return bits.length ? " · " + bits.join(" · ") : "";
  }

  function liveLength(startIso) {
    var ms = Date.now() - new Date(startIso).getTime();
    var total = !isFinite(ms) || ms < 0 ? 0 : Math.floor(ms / 1000);
    return formatSeconds(total);
  }

  function segmentItemHtml(seg) {
    var ended = !!seg.end;
    var badge = ended
      ? '<span class="dur">' + escapeHtml(formatSeconds(segmentSeconds(seg))) + "</span>"
      : '<span class="dur" data-live-start="' + escapeHtml(seg.start) + '">' + escapeHtml(liveLength(seg.start)) + "</span>";
    var suffix = logSuffix(seg);
    return '<li class="log-item" data-id="' + escapeHtml(seg.id) + '" data-type="' + escapeHtml(seg.type) + '" data-running="' + (ended ? "false" : "true") + '" data-seconds="' + (ended ? String(segmentSeconds(seg)) : "") + '">' +
      '<button type="button" class="log-line" data-edit="' + escapeHtml(seg.id) + '">' +
        '<span class="log-name">' + escapeHtml(segmentLabel(seg)) +
          (suffix ? '<span class="log-suffix">' + escapeHtml(suffix) + "</span>" : "") +
        "</span>" +
        badge +
      "</button></li>";
  }

  function renderLog(list, emptyEl, session) {
    var segs = orderedSegments(session);
    if (emptyEl) emptyEl.classList.toggle("hidden", !!segs.length);
    list.innerHTML = segs.map(segmentItemHtml).join("");
  }

  function renderStrip(session) {
    var speakers = speakersList(session).join(", ") || "No speakers yet";
    var planned = parseDatetimeLocal(session.plannedStart);
    $("sessionStrip").innerHTML =
      '<p class="strip-title">' + escapeHtml(session.title || "Untitled session") + "</p>" +
      '<p class="strip-sub">' + escapeHtml(speakers) + " · Planned " + escapeHtml(planned ? formatHM(planned) : "—") + "</p>";
  }

  function bindRunning(seg) {
    var note = $("runNote");
    var group = $("runGroup");
    var undo = $("undoBtn");
    if (undo) {
      undo.disabled = !currentSession().segments.length;
      undo.addEventListener("click", undoLast);
    }
    var notes = $("runNotesBtn");
    if (notes) {
      notes.addEventListener("click", function () {
        var live = runningSegment(currentSession());
        if (live) openNoteSheet(live);
      });
    }
    if (note) {
      note.value = seg && seg.note ? seg.note : "";
      note.addEventListener("input", function () {
        var live = runningSegment(currentSession());
        if (!live) return;
        live.note = note.value;
        liveSessionTouch();
      });
      note.addEventListener("blur", function () {
        captureRunningFields();
        save();
      });
    }
    if (group) {
      group.value = seg && seg.groupSize != null ? String(seg.groupSize) : "";
      group.addEventListener("input", function () {
        var live = runningSegment(currentSession());
        if (!live) return;
        live.groupSize = parseGroupSize(group.value);
        liveSessionTouch();
      });
    }
  }

  function liveSessionTouch() {
    var session = currentSession();
    if (!session) return;
    session.updatedAt = new Date().toISOString();
    save();
  }

  function renderRunning(session) {
    var card = $("runningCard");
    var seg = runningSegment(session);
    var key = seg ? [seg.id, seg.type, seg.otherLabel || "", seg.groupSizeAvg || ""].join("|") : "none";
    markPressed(seg ? seg.type : "");
    if (card.getAttribute("data-key") === key && card.contains(document.activeElement)) {
      var ticking = $("runTimer");
      if (ticking && seg) ticking.textContent = formatElapsed(seg.start);
      var undoLive = $("undoBtn");
      if (undoLive) undoLive.disabled = !session.segments.length;
      return;
    }
    card.setAttribute("data-key", key);
    if (!seg) {
      card.innerHTML =
        '<p class="run-empty-title">Tap an activity to start timing</p>' +
        '<button type="button" class="undo-btn" id="undoBtn">Undo last tap</button>';
      bindRunning(null);
      return;
    }
    var groupLine = groupPlain(seg);
    var groupField = groupLine ? '<p class="run-group">' + escapeHtml(groupLine) + "</p>" : "";
    card.innerHTML =
      '<p class="run-kicker"><span class="run-dot" aria-hidden="true"></span><span>Running</span><span class="run-kicker-sep" aria-hidden="true">·</span><span class="run-kicker-name">' + escapeHtml(segmentLabel(seg)) + "</span></p>" +
      '<p class="run-timer" id="runTimer">' + escapeHtml(formatElapsed(seg.start)) + "</p>" +
      '<div class="run-actions">' +
        '<button type="button" class="undo-btn" id="runNotesBtn">Notes</button>' +
        '<button type="button" class="undo-btn" id="undoBtn">Undo last tap</button>' +
      "</div>" +
      groupField;
    bindRunning(seg);
  }

  function markPressed(type) {
    var buttons = $("activityGrid").querySelectorAll("button[data-type]");
    for (var i = 0; i < buttons.length; i++) {
      if (type && buttons[i].getAttribute("data-type") === type) buttons[i].setAttribute("aria-pressed", "true");
      else buttons[i].removeAttribute("aria-pressed");
    }
  }

  function saveCardHtml(session) {
    var files = session.lastFiles;
    var names = files
      ? '<div class="file-row"><p class="file-name">' + escapeHtml(files.txtName) + '</p><p class="file-name">' + escapeHtml(files.csvName) + "</p></div>"
      : "";
    var dirty = session.dirtyExport
      ? '<p id="dirtyNote">Details changed after these files were saved. Save them again before you email.</p>'
      : "";
    return '<p class="save-kicker">Session ended</p><h3>Files saved to Downloads</h3>' + names + dirty;
  }

  function totalsHtml(session) {
    var totals = computeTotals(session);
    var rows = shownBuckets(totals).map(function (bucket) {
      var shown = formatSeconds(bucket.seconds);
      var pct = (bucket.tenths / 10).toFixed(1);
      return '<div class="total-row" data-bucket="' + bucket.id + '" data-seconds="' + bucket.seconds + '" data-percent="' + pct + '">' +
        '<div class="top"><strong>' + escapeHtml(bucket.label) + '</strong><span class="nums">' +
        escapeHtml(shown) + " · " + pct + "%</span></div>" +
        '<div class="bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>';
    }).join("");
    var avg = formatAvg(totals.averageGroup);
    var comment = session.closing && session.closing.comment ? "<br>" + escapeHtml(session.closing.comment) : "";
    return '<p class="avg-line">Estimated participants: ' + escapeHtml(session.estimatedParticipants == null ? "—" : String(session.estimatedParticipants)) + "</p>" +
      '<div class="total-head"><h2>Totals</h2><div class="session-len" data-total-seconds="' + totals.totalSeconds + '">' +
      escapeHtml(totals.totalSeconds ? formatSeconds(totals.totalSeconds) : "0 min") + "</div></div>" +
      rows +
      '<p class="avg-line" data-group-avg="' + escapeHtml(avg == null ? "" : avg) + '">Average group size: ' +
      escapeHtml(avg == null ? "—" : avg) + "</p>" +
      (totals.plenaryCount ? '<p class="avg-line">Plenary (whole room): ' + totals.plenaryCount + "</p>" : "") +
      '<p class="closing-line"><strong>After the session closed</strong>' +
      escapeHtml(closingAnswerText(session)) + comment + "</p>";
  }

  function pastCardHtml(session) {
    var badgeClass = session.status === "ended" ? "ended" : (session.status === "live" ? "live" : "setup");
    var badgeText = session.status === "ended" ? "Ended" : (session.status === "live" ? "In progress" : "Not started");
    var speakers = speakersList(session).join(", ");
    var showEmail = session.status === "ended" || session.segments.length > 0;
    var email = showEmail ? '<button type="button" class="btn btn-primary" data-email>Email to Maarten</button>' : "";
    return '<article class="card session-card" data-id="' + escapeHtml(session.id) + '">' +
      '<div class="session-top"><h3>' + escapeHtml(session.title || "Untitled session") + '</h3>' +
      '<span class="badge ' + badgeClass + '">' + badgeText + "</span></div>" +
      '<p class="session-meta">' + escapeHtml(formatDateShort(sessionDate(session)) + " · " + (session.observer || "No observer name")) + "</p>" +
      '<p class="session-meta">' + escapeHtml([formatSeconds(sessionSeconds(session)), (session.roomName || "").trim(), speakers, session.estimatedParticipants == null ? "" : session.estimatedParticipants + " participants"].filter(Boolean).join(" · ")) + "</p>" +
      '<div class="session-actions' + (showEmail ? "" : " two") + '">' +
      '<button type="button" class="btn" data-open>Open</button>' + email +
      '<button type="button" class="btn btn-danger" data-delete>Delete</button></div></article>';
  }

  function renderSetup(session) {
    var model = session || {
      title: "",
      speakers: "",
      plannedStart: toDatetimeLocal(new Date()),
      observer: lastObserver(),
      estimatedParticipants: null,
      roomName: ""
    };
    setIdle("sessionTitle", model.title);
    setIdle("speakers", model.speakers);
    setIdle("plannedStart", model.plannedStart || toDatetimeLocal(new Date()));
    setIdle("observer", model.observer);
    setIdle("participants", model.estimatedParticipants == null ? "" : String(model.estimatedParticipants));
    setIdle("roomName", model.roomName || "");
  }

  function renderLive(session) {
    renderStrip(session);
    setIdle("liveTitle", session.title);
    setIdle("liveSpeakers", session.speakers);
    setIdle("liveRoomName", session.roomName || "");
    setIdle("livePlanned", session.plannedStart);
    setIdle("liveObserver", session.observer);
    setIdle("liveParticipants", session.estimatedParticipants == null ? "" : String(session.estimatedParticipants));
    renderRunning(session);
    renderLog($("logList"), null, session);
    $("logSection").classList.toggle("hidden", session.segments.length === 0);
    var endBtn = $("endSessionBtn");
    var started = session.segments.length > 0;
    endBtn.disabled = !started;
    endBtn.setAttribute("aria-disabled", started ? "false" : "true");
  }

  function renderReport(session) {
    if (!session) return;
    $("saveFilesBlock").innerHTML = saveCardHtml(session);
    $("totalsCard").innerHTML = totalsHtml(session);
    renderLog($("reportLog"), null, session);
    $("reportPreview").value = buildReport(session);
    $("csvPreview").value = buildCsv(session);
    var status = $("exportStatus");
    status.textContent = exportNote.text;
    status.classList.toggle("error", exportNote.error);
  }

  function listedSessions() {
    return state.sessions.filter(isListed);
  }

  function isRunningSession(session) {
    return !!(session && session.status === "live");
  }

  function deletableSessions() {
    return listedSessions().filter(function (session) { return !isRunningSession(session); });
  }

  function archiveChartHtml() {
    var sessions = listedSessions();
    var byType = {};
    ACTIVITY_TYPES.forEach(function (type) { byType[type] = 0; });
    var total = 0;
    sessions.forEach(function (session) {
      session.segments.forEach(function (seg) {
        var secs = segmentSeconds(seg);
        if (secs == null) return;
        var type = ACTIVITY_TYPES.indexOf(seg.type) === -1 ? "Other activity" : seg.type;
        byType[type] += secs;
        total += secs;
      });
    });
    var types = ACTIVITY_TYPES.filter(function (type) { return byType[type] > 0; });
    var tenths = shareTenths(types.map(function (type) { return byType[type]; }), total);
    var countLabel = sessions.length === 1 ? "1 session" : sessions.length + " sessions";
    var summary = countLabel + " · " + (total ? formatSeconds(total) : "0 min");
    var rows = types.map(function (type, index) {
      var pct = (tenths[index] / 10).toFixed(1);
      return '<div class="archive-row" data-activity="' + escapeHtml(activityLabel(type)) + '" data-seconds="' + byType[type] + '" data-percent="' + pct + '">' +
        '<div class="top"><span class="name">' + escapeHtml(activityLabel(type)) + '</span><span class="nums">' +
        escapeHtml(formatSeconds(byType[type])) + " · " + pct + "%</span></div>" +
        '<div class="bar" aria-hidden="true"><span style="width:' + pct + '%"></span></div></div>';
    }).join("");
    if (!rows) rows = '<p class="archive-empty">No timed activity yet.</p>';
    return '<p class="archive-summary" data-sessions="' + sessions.length + '" data-total-seconds="' + total + '">' + escapeHtml(summary) + "</p>" + rows;
  }

  function renderPast() {
    var list = listedSessions().sort(function (a, b) {
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });
    $("archiveChart").innerHTML = archiveChartHtml();
    $("pastEmpty").classList.toggle("hidden", list.length > 0);
    $("pastList").innerHTML = list.map(pastCardHtml).join("");
    $("deleteAllBtn").classList.toggle("hidden", deletableSessions().length === 0);
  }

  function askDeleteAll() {
    var count = deletableSessions().length;
    if (!count) return;
    var noun = count === 1 ? "session" : "sessions";
    var running = state.sessions.some(isRunningSession);
    var extra = running ? " The session that is still running stays." : "";
    $("deleteAllBody").textContent = count + " " + noun + " will be deleted from this phone." + extra + " This cannot be undone.";
    openModal("deleteAllModal");
  }

  function confirmDeleteAll() {
    var removed = deletableSessions().length;
    if (!removed) {
      closeModal("deleteAllModal");
      return;
    }
    state.sessions = state.sessions.filter(function (session) {
      return isRunningSession(session) || !isListed(session);
    });
    if (!findSession(state.currentId)) {
      var live = state.sessions.filter(isRunningSession)[0];
      state.currentId = live ? live.id : null;
    }
    save();
    closeModal("deleteAllModal");
    render();
    toast(removed === 1 ? "1 session deleted" : removed + " sessions deleted");
  }

  function render() {
    var session = currentSession();
    var view = "setup";
    if (state.screen === "past") view = "past";
    else if (session && session.status === "ended") view = "report";
    else if (session && session.status === "live") view = "live";
    document.body.dataset.view = view;
    $("pastBtn").textContent = view === "past" ? "Back" : "Past";
    $("pastBtn").setAttribute("aria-label", view === "past" ? "Back to the session" : "Past sessions");
    if (view === "setup") renderSetup(session && session.status === "setup" ? session : null);
    if (view === "live") renderLive(session);
    if (view === "report") renderReport(session);
    if (view === "past") renderPast();
  }

  function openEdit(id) {
    var session = currentSession();
    var seg = findSegment(session, id);
    if (!seg) return;
    editingId = id;
    $("editType").value = seg.type;
    $("editOther").value = seg.otherLabel || "";
    markOtherQuick("editQuick", seg.otherLabel || "");
    $("editGroup").value = seg.groupSize == null ? "" : String(seg.groupSize);
    showGroupAvg("editChips", seg.type === "Conversation" ? (seg.groupSizeAvg || "") : "");
    $("editNote").value = seg.note || "";
    $("editStart").textContent = formatHMS(new Date(seg.start));
    $("editDuration").textContent = seg.end ? formatSeconds(segmentSeconds(seg)) : "Still running";
    toggleEditFields();
    openModal("editModal");
  }

  function toggleEditFields() {
    var type = $("editType").value;
    $("editOtherWrap").classList.toggle("hidden", type !== "Other activity");
    $("editGroupWrap").classList.toggle("hidden", type !== "Other activity");
    $("editAvgWrap").classList.toggle("hidden", type !== "Conversation");
  }

  function saveEdit() {
    var session = currentSession();
    var seg = findSegment(session, editingId);
    if (!session || !seg) {
      editingId = null;
      closeModal("editModal");
      return;
    }
    var type = $("editType").value;
    var otherLabel = type === "Other activity" ? $("editOther").value.trim() : "";
    if (type === "Other activity" && !otherLabel) {
      toast("Describe the activity");
      $("editOther").focus();
      return;
    }
    seg.type = type;
    seg.otherLabel = otherLabel;
    if (type === "Conversation") commitGroupAvg(seg, "editChips");
    else if (type === "Other activity") applyGroupAvg(seg, $("editGroup").value);
    else applyGroupAvg(seg, "");
    seg.note = $("editNote").value.trim();
    if (session.status === "ended") session.dirtyExport = true;
    session.updatedAt = new Date().toISOString();
    editingId = null;
    save();
    closeModal("editModal");
    render();
    toast("Activity updated");
  }

  function askDeleteLine() {
    var session = currentSession();
    var seg = findSegment(session, editingId);
    if (!session || !seg) return;
    var ordered = orderedSegments(session);
    var index = -1;
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i].id === seg.id) index = i;
    }
    var prev = index > 0 ? ordered[index - 1] : null;
    var next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
    var body;
    if (!seg.end && prev) {
      body = segmentLabel(seg) + " will be removed. " + segmentLabel(prev) + " will be running again.";
    } else if (prev && next) {
      body = segmentLabel(seg) + " will be removed. " + segmentLabel(prev) + " will run until " + segmentLabel(next) + " starts.";
    } else if (prev && seg.end) {
      body = segmentLabel(seg) + " will be removed. " + segmentLabel(prev) + " will cover the time through the end of this line.";
    } else {
      body = segmentLabel(seg) + " will be removed from this session.";
    }
    $("lineDeleteBody").textContent = body;
    openModal("lineDeleteModal");
  }

  function confirmDeleteLine() {
    var session = currentSession();
    var seg = findSegment(session, editingId);
    if (!session || !seg) {
      closeModal("lineDeleteModal");
      closeModal("editModal");
      editingId = null;
      return;
    }
    var ordered = orderedSegments(session);
    var index = -1;
    for (var i = 0; i < ordered.length; i++) {
      if (ordered[i].id === seg.id) index = i;
    }
    var prev = index > 0 ? ordered[index - 1] : null;
    var next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
    if (!seg.end) {
      if (prev) prev.end = null;
    } else if (prev && next) {
      prev.end = next.start;
    } else if (prev && seg.end) {
      prev.end = seg.end;
    }
    session.segments = session.segments.filter(function (item) { return item.id !== seg.id; });
    if (session.status === "ended") session.dirtyExport = true;
    session.updatedAt = new Date().toISOString();
    editingId = null;
    lastTap = { type: "", at: 0 };
    save();
    closeModal("lineDeleteModal");
    closeModal("editModal");
    render();
    toast("Line deleted");
  }

  function onLogClick(ev) {
    var button = ev.target.closest("[data-edit]");
    if (!button) return;
    openEdit(button.getAttribute("data-edit"));
  }

  function onLiveDetails() {
    var session = currentSession();
    if (!session) return;
    session.title = $("liveTitle").value;
    session.speakers = $("liveSpeakers").value;
    session.roomName = $("liveRoomName").value;
    session.plannedStart = $("livePlanned").value;
    session.observer = $("liveObserver").value;
    session.estimatedParticipants = parseParticipants($("liveParticipants").value);
    session.updatedAt = new Date().toISOString();
    if (session.status === "ended") session.dirtyExport = true;
    save();
    if (document.body.dataset.view === "live") renderStrip(session);
  }

  function startTiming(ev) {
    ev.preventDefault();
    var session = draftSession();
    session.title = $("sessionTitle").value.trim();
    session.speakers = $("speakers").value;
    session.plannedStart = $("plannedStart").value || toDatetimeLocal(new Date());
    session.observer = $("observer").value.trim();
    session.estimatedParticipants = parseParticipants($("participants").value);
    session.roomName = $("roomName").value.trim();
    if (!session.title) {
      $("setupError").textContent = "Add a session title.";
      $("sessionTitle").focus();
      return;
    }
    if (!session.observer) {
      $("setupError").textContent = "Add your name so the file can be identified.";
      $("observer").focus();
      return;
    }
    $("setupError").textContent = "";
    $("sessionTitle").value = session.title;
    $("observer").value = session.observer;
    // Next only opens the activity screen. Timing starts on the first activity tap.
    session.status = "live";
    session.updatedAt = new Date().toISOString();
    state.screen = null;
    save();
    render();
  }

  function fillEditTypes() {
    $("editType").innerHTML = ACTIVITY_TYPES.map(function (type) {
      return '<option value="' + escapeHtml(type) + '">' + escapeHtml(activityLabel(type)) + "</option>";
    }).join("");
  }

  function bind() {
    $("setupForm").addEventListener("submit", startTiming);
    ["sessionTitle", "speakers", "roomName", "plannedStart", "observer", "participants"].forEach(function (id) {
      $(id).addEventListener("input", function () {
        $("setupError").textContent = "";
        persistSetupFromForm();
      });
      $(id).addEventListener("change", persistSetupFromForm);
    });
    $("setupPastBtn").addEventListener("click", showPast);
    $("pastBtn").addEventListener("click", togglePast);

    ["liveTitle", "liveSpeakers", "liveRoomName", "livePlanned", "liveObserver", "liveParticipants"].forEach(function (id) {
      $(id).addEventListener("input", onLiveDetails);
      $(id).addEventListener("change", onLiveDetails);
    });

    $("activityGrid").addEventListener("click", function (ev) {
      var button = ev.target.closest("button[data-type]");
      if (!button) return;
      chooseActivity(button.getAttribute("data-type"));
    });
    $("endSessionBtn").addEventListener("click", openEnd);
    $("logList").addEventListener("click", onLogClick);
    $("reportLog").addEventListener("click", onLogClick);

    $("otherText").addEventListener("input", function () {
      $("otherSave").disabled = !$("otherText").value.trim();
      markOtherQuick("otherQuick", $("otherText").value.trim());
    });
    bindOtherQuick("otherQuick", "otherText", "otherSave");
    $("editOther").addEventListener("input", function () {
      markOtherQuick("editQuick", $("editOther").value.trim());
    });
    bindOtherQuick("editQuick", "editOther");
    $("otherSave").addEventListener("click", confirmOther);
    $("otherCancel").addEventListener("click", cancelOther);
    $("noteSkip").addEventListener("click", skipNoteSheet);
    $("noteSave").addEventListener("click", saveNoteSheet);
    $("noteText").addEventListener("focus", function () {
      setTimeout(revealNoteComposer, 60);
    });
    bindChipRow("noteChips");
    bindChipRow("editChips");
    $("otherModal").addEventListener("click", function (ev) {
      if (ev.target === $("otherModal")) cancelOther();
    });
    $("noteModal").addEventListener("click", function (ev) {
      if (ev.target === $("noteModal")) skipNoteSheet();
    });

    $("closeSlider").addEventListener("input", function () {
      paintCloseSlider("closeSlider", "closeStayed", "closeLeft", $("closeSlider").value);
    });
    $("setupEditCloseSlider").addEventListener("input", function () {
      setupEditCloseTouched = true;
      paintCloseSlider("setupEditCloseSlider", "setupEditCloseStayed", "setupEditCloseLeft", $("setupEditCloseSlider").value);
    });
    $("endCancel").addEventListener("click", function () { closeModal("endModal"); });
    $("endSkip").addEventListener("click", function () { finalizeSession(false); });
    $("endSave").addEventListener("click", function () { finalizeSession(true); });
    $("endModal").addEventListener("click", function (ev) {
      if (ev.target === $("endModal")) closeModal("endModal");
    });

    $("editType").addEventListener("change", toggleEditFields);
    $("editCancel").addEventListener("click", function () {
      editingId = null;
      closeModal("editModal");
    });
    $("editSave").addEventListener("click", saveEdit);
    $("editDelete").addEventListener("click", askDeleteLine);
    $("lineDeleteKeep").addEventListener("click", function () { closeModal("lineDeleteModal"); });
    $("lineDeleteConfirm").addEventListener("click", confirmDeleteLine);
    $("lineDeleteModal").addEventListener("click", function (ev) {
      if (ev.target === $("lineDeleteModal")) closeModal("lineDeleteModal");
    });
    $("editModal").addEventListener("click", function (ev) {
      if (ev.target === $("editModal")) {
        editingId = null;
        closeModal("editModal");
      }
    });

    $("deleteKeep").addEventListener("click", function () {
      deletingId = null;
      closeModal("deleteModal");
    });
    $("deleteConfirm").addEventListener("click", confirmDelete);
    $("deleteModal").addEventListener("click", function (ev) {
      if (ev.target === $("deleteModal")) {
        deletingId = null;
        closeModal("deleteModal");
      }
    });

    $("newCancel").addEventListener("click", function () { closeModal("newModal"); });
    $("newConfirm").addEventListener("click", function () {
      closeModal("newModal");
      createNewSession();
    });
    $("newModal").addEventListener("click", function (ev) {
      if (ev.target === $("newModal")) closeModal("newModal");
    });

    $("pastNewBtn").addEventListener("click", requestNewSession);
    $("deleteAllBtn").addEventListener("click", askDeleteAll);
    $("deleteAllKeep").addEventListener("click", function () { closeModal("deleteAllModal"); });
    $("deleteAllConfirm").addEventListener("click", confirmDeleteAll);
    $("deleteAllModal").addEventListener("click", function (ev) {
      if (ev.target === $("deleteAllModal")) closeModal("deleteAllModal");
    });
    $("reportNewBtn").addEventListener("click", requestNewSession);
    $("pastList").addEventListener("click", function (ev) {
      var button = ev.target.closest("button");
      if (!button) return;
      var card = button.closest("[data-id]");
      if (!card) return;
      var id = card.getAttribute("data-id");
      if (button.hasAttribute("data-open")) openSession(id);
      if (button.hasAttribute("data-email")) emailToMaarten(findSession(id));
      if (button.hasAttribute("data-delete")) askDelete(id);
    });

    $("emailMaartenBtn").addEventListener("click", function () { emailToMaarten(currentSession()); });
    $("shareBtn").addEventListener("click", function () { shareReport(currentSession()); });
    $("editSessionBtn").addEventListener("click", openSessionSetup);
    $("setupEditCancel").addEventListener("click", function () { closeModal("setupEditModal"); });
    $("setupEditSave").addEventListener("click", saveSessionSetup);
    $("setupEditModal").addEventListener("click", function (ev) {
      if (ev.target === $("setupEditModal")) closeModal("setupEditModal");
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!$("lineDeleteModal").classList.contains("hidden")) closeModal("lineDeleteModal");
      else if (!$("noteModal").classList.contains("hidden")) skipNoteSheet();
      else if (!$("otherModal").classList.contains("hidden")) cancelOther();
      else if (!$("endModal").classList.contains("hidden")) closeModal("endModal");
      else if (!$("editModal").classList.contains("hidden")) {
        editingId = null;
        closeModal("editModal");
      } else if (!$("deleteModal").classList.contains("hidden")) {
        deletingId = null;
        closeModal("deleteModal");
      } else if (!$("deleteAllModal").classList.contains("hidden")) closeModal("deleteAllModal");
      else if (!$("setupEditModal").classList.contains("hidden")) closeModal("setupEditModal");
      else if (!$("newModal").classList.contains("hidden")) closeModal("newModal");
    });

    window.addEventListener("beforeunload", function () {
      if (document.body.dataset.view === "setup") persistSetupFromForm();
      if (document.body.dataset.view === "live") captureRunningFields();
      save();
    });
  }

  function probeServer() {
    if (!/^https?:$/i.test(location.protocol)) return;
    fetch("./api/status", { headers: { "Accept": "application/json" } })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) {
        serverAvailable = !!(data && data.ok);
      })
      .catch(function () {
        serverAvailable = false;
      });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/i.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function (err) {
      console.warn("Service worker not registered", err);
    });
  }

  function tick() {
    if (document.body.dataset.view !== "live") return;
    var seg = runningSegment(currentSession());
    if (!seg) return;
    var label = formatElapsed(seg.start);
    var timer = $("runTimer");
    if (timer) timer.textContent = label;
    var badges = document.querySelectorAll("[data-live-start]");
    for (var i = 0; i < badges.length; i++) badges[i].textContent = liveLength(badges[i].getAttribute("data-live-start"));
  }

  fillEditTypes();
  load();
  bind();
  render();
  probeServer();
  registerWorker();
  setInterval(tick, 1000);
})();
