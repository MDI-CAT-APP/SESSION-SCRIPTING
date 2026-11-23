/* Session Script — observer logger
   Works standalone (file:// or any static host) and with the optional local server. */
(function () {
  "use strict";

  var STORAGE_KEY = "session-script-v1";
  var DEFAULT_EMAIL = "maarten.vanneste@meetingsupport.org";
  var OTHER_TYPE = "Other activity";

  var ACTIVITY_TYPES = [
    "Introduction",
    "Presentations",
    "Question from a participant",
    "Conversation",
    "Voting",
    "Play/Sing",
    "Other activity",
    "Q&A",
    "Conclusions",
    "Survey"
  ];

  var state = defaultState();
  var pendingIso = null;
  var pendingType = null;
  var editingId = null;
  var serverAvailable = false;
  var lastFocused = null;

  var $ = function (id) { return document.getElementById(id); };

  function defaultState() {
    return {
      version: 1,
      setup: {
        title: "",
        speakers: "",
        plannedStart: toDatetimeLocal(new Date()),
        observer: ""
      },
      settings: {
        coordinatorEmail: DEFAULT_EMAIL
      },
      activities: []
    };
  }

  function pad(n) { return String(n).padStart(2, "0"); }

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

  function formatDateLong(d) {
    try {
      return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    } catch (e) {
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function yymmdd(d) {
    return String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate());
  }

  function minutesBetween(from, to) {
    return Math.round((to.getTime() - from.getTime()) / 60000);
  }

  function formatElapsed(mins) {
    if (!isFinite(mins)) return "—";
    if (mins === 0) return "+0 min";
    return (mins > 0 ? "+" : "") + mins + " min";
  }

  function formatDuration(ms) {
    if (ms == null || ms < 0) return "—";
    if (ms < 60000) return "less than 1 min";
    var total = Math.round(ms / 60000);
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h <= 0) return m + " min";
    return h + " h " + m + " min";
  }

  function slugPart(s, fallback) {
    var t = String(s || "")
      .trim()
      .replace(/[^\w\s-]+/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 40);
    return t || fallback;
  }

  function reportDate() {
    var planned = parseDatetimeLocal(state.setup.plannedStart);
    if (planned) return planned;
    if (state.activities.length) return new Date(state.activities[0].time);
    return new Date();
  }

  function reportFilename() {
    var d = reportDate();
    var title = slugPart(state.setup.title, "session");
    var observer = slugPart(state.setup.observer, "observer");
    return yymmdd(d) + " " + title + " " + observer + ".txt";
  }

  function sortedActivities() {
    return state.activities.slice().sort(function (a, b) {
      return new Date(a.time).getTime() - new Date(b.time).getTime();
    });
  }

  function actualStartDate() {
    var list = sortedActivities();
    return list.length ? new Date(list[0].time) : null;
  }

  function endDate() {
    var list = sortedActivities();
    return list.length ? new Date(list[list.length - 1].time) : null;
  }

  function speakersLine() {
    return (state.setup.speakers || "")
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean)
      .join(", ");
  }

  function activityLabel(entry) {
    if (entry.type === OTHER_TYPE && entry.other) return OTHER_TYPE + ": " + entry.other;
    return entry.type;
  }

  function activityLine(entry) {
    var t = new Date(entry.time);
    var planned = parseDatetimeLocal(state.setup.plannedStart);
    var elapsed = planned ? formatElapsed(minutesBetween(planned, t)) : "";
    var line = formatHMS(t) + (elapsed ? " (" + elapsed + ") " : " ") + activityLabel(entry);
    if (entry.note) {
      if (entry.type === OTHER_TYPE && entry.other) line += " — " + entry.note;
      else line += ": " + entry.note;
    }
    return line;
  }

  function buildReport() {
    var planned = parseDatetimeLocal(state.setup.plannedStart);
    var actual = actualStartDate();
    var end = endDate();
    var duration = (actual && end) ? formatDuration(end.getTime() - actual.getTime()) : "—";
    var lines = [
      "SESSION SCRIPT",
      "Meeting Design Institute",
      "",
      "Session: " + (state.setup.title || "—"),
      "Speakers: " + (speakersLine() || "—"),
      "Observer: " + (state.setup.observer || "—"),
      "Date: " + formatDateLong(reportDate()),
      "Planned start: " + (planned ? formatHM(planned) : "—"),
      "Actual start: " + (actual ? formatHMS(actual) : "—"),
      "End: " + (end ? formatHMS(end) : "—"),
      "Duration: " + duration,
      "",
      "----------------------------------------------------------------"
    ];
    var list = sortedActivities();
    if (!list.length) {
      lines.push("(no activities logged)");
    } else {
      list.forEach(function (entry) { lines.push(activityLine(entry)); });
    }
    lines.push("----------------------------------------------------------------");
    lines.push("");
    return lines.join("\n");
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      state.setup = Object.assign(state.setup, data.setup || {});
      state.settings = Object.assign(state.settings, data.settings || {});
      state.activities = Array.isArray(data.activities) ? data.activities : [];
      if (!state.settings.coordinatorEmail) state.settings.coordinatorEmail = DEFAULT_EMAIL;
      if (!state.setup.plannedStart) state.setup.plannedStart = toDatetimeLocal(new Date());
    } catch (e) {
      console.warn("Could not load saved session", e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("Could not save on this device");
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function readSetupFromForm() {
    state.setup.title = $("sessionTitle").value;
    state.setup.speakers = $("speakers").value;
    state.setup.plannedStart = $("plannedStart").value;
    state.setup.observer = $("observer").value;
  }

  function fillForm() {
    $("sessionTitle").value = state.setup.title || "";
    $("speakers").value = state.setup.speakers || "";
    $("plannedStart").value = state.setup.plannedStart || toDatetimeLocal(new Date());
    $("observer").value = state.setup.observer || "";
    $("coordinatorEmail").value = state.settings.coordinatorEmail || DEFAULT_EMAIL;
  }

  function renderMeta() {
    var planned = parseDatetimeLocal(state.setup.plannedStart);
    var actual = actualStartDate();
    $("metaPlanned").textContent = planned ? formatHM(planned) : "—";
    $("metaActual").textContent = actual ? formatHMS(actual) : "—";
    var now = new Date();
    $("metaElapsed").textContent = planned ? formatElapsed(minutesBetween(planned, now)) : "—";
  }

  function renderLog() {
    var list = sortedActivities();
    var empty = $("logEmpty");
    var ol = $("logList");
    if (!list.length) {
      empty.classList.remove("hidden");
      ol.innerHTML = "";
      return;
    }
    empty.classList.add("hidden");
    ol.innerHTML = list.map(function (entry) {
      var t = new Date(entry.time);
      var planned = parseDatetimeLocal(state.setup.plannedStart);
      var elapsed = planned ? formatElapsed(minutesBetween(planned, t)) : "";
      var note = entry.note ? escapeHtml(entry.note) : "";
      return '<li class="log-item" data-id="' + escapeHtml(entry.id) + '">' +
        '<div>' +
          '<div class="log-time">' + escapeHtml(formatHMS(t)) + (elapsed ? " (" + elapsed + ")" : "") + "</div>" +
          '<div class="log-type">' + escapeHtml(activityLabel(entry)) + "</div>" +
          (note ? '<div class="log-note">' + note + "</div>" : "") +
        "</div>" +
        '<div class="log-actions">' +
          '<button type="button" class="linkish" data-edit="' + escapeHtml(entry.id) + '">Edit</button>' +
          '<button type="button" class="linkish danger" data-delete="' + escapeHtml(entry.id) + '">Delete</button>' +
        "</div>" +
      "</li>";
    }).join("");
  }

  function renderReport() {
    $("reportPreview").value = buildReport();
  }

  function scrollEntry(id) {
    var el = document.querySelector('.log-item[data-id="' + id + '"]');
    if (el && el.scrollIntoView) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  function renderAll() {
    renderMeta();
    renderLog();
    renderReport();
  }

  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }

  function setExportStatus(msg, isError) {
    var el = $("exportStatus");
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  function openModal(id) {
    lastFocused = document.activeElement;
    $("toast").classList.remove("show");
    $(id).classList.remove("hidden");
    document.body.style.overflow = "hidden";
    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    $(id).classList.add("hidden");
    if (document.querySelectorAll(".modal-backdrop:not(.hidden)").length === 0) {
      document.body.style.overflow = "";
      document.body.classList.remove("modal-open");
    }
    if (lastFocused && lastFocused.focus) {
      try { lastFocused.focus(); } catch (e) { /* ignore */ }
    }
  }

  function buildActivityGrid() {
    var grid = $("activityGrid");
    grid.innerHTML = ACTIVITY_TYPES.map(function (type) {
      return '<button type="button" data-type="' + escapeHtml(type) + '">' + escapeHtml(type) + "</button>";
    }).join("");
    var sel = $("editType");
    sel.innerHTML = ACTIVITY_TYPES.map(function (type) {
      return '<option value="' + escapeHtml(type) + '">' + escapeHtml(type) + "</option>";
    }).join("");
  }

  function resetPicker() {
    pendingIso = null;
    pendingType = null;
    $("otherText").value = "";
    $("activityNote").value = "";
    $("otherBox").classList.add("hidden");
    $("activityAddRow").classList.add("hidden");
    var pressed = $("activityGrid").querySelectorAll('[aria-pressed="true"]');
    for (var i = 0; i < pressed.length; i++) pressed[i].setAttribute("aria-pressed", "false");
  }

  function openPicker() {
    pendingIso = new Date().toISOString();
    pendingType = null;
    $("otherText").value = "";
    $("activityNote").value = "";
    $("otherBox").classList.add("hidden");
    $("activityAddRow").classList.add("hidden");
    $("activityStamp").textContent = formatHMS(new Date(pendingIso));
    var pressed = $("activityGrid").querySelectorAll('[aria-pressed="true"]');
    for (var i = 0; i < pressed.length; i++) pressed[i].setAttribute("aria-pressed", "false");
    openModal("activityModal");
    if (navigator.vibrate) {
      try { navigator.vibrate(12); } catch (e) { /* ignore */ }
    }
  }

  function closePicker() {
    closeModal("activityModal");
    resetPicker();
  }

  function addActivity(type, other, note, iso) {
    var id = uid();
    state.activities.push({
      id: id,
      time: iso || new Date().toISOString(),
      type: type,
      other: other || "",
      note: (note || "").trim()
    });
    save();
    renderAll();
    scrollEntry(id);
  }

  function pickType(type) {
    pendingType = type;
    var buttons = $("activityGrid").querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-type") === type ? "true" : "false");
    }
    if (type === OTHER_TYPE) {
      $("otherBox").classList.remove("hidden");
      $("activityAddRow").classList.remove("hidden");
      $("otherText").focus();
      return;
    }
    addActivity(type, "", $("activityNote").value, pendingIso);
    closePicker();
    toast("Logged");
  }

  function confirmOther() {
    var other = $("otherText").value.trim();
    if (!other) {
      toast("Please describe the activity");
      $("otherText").focus();
      return;
    }
    addActivity(OTHER_TYPE, other, $("activityNote").value, pendingIso);
    closePicker();
    toast("Activity logged");
  }

  function findActivity(id) {
    for (var i = 0; i < state.activities.length; i++) {
      if (state.activities[i].id === id) return state.activities[i];
    }
    return null;
  }

  function openEdit(id) {
    var entry = findActivity(id);
    if (!entry) return;
    editingId = id;
    var d = new Date(entry.time);
    $("editTime").value = formatHMS(d);
    $("editType").value = entry.type;
    $("editOther").value = entry.other || "";
    $("editNote").value = entry.note || "";
    $("editOtherBox").classList.toggle("hidden", entry.type !== OTHER_TYPE);
    openModal("editModal");
  }

  function applyEditedTime(entry, hms) {
    var m = String(hms || "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return false;
    var h = +m[1], min = +m[2], sec = m[3] ? +m[3] : 0;
    if (h > 23 || min > 59 || sec > 59) return false;
    var d = new Date(entry.time);
    d.setHours(h, min, sec, 0);
    entry.time = d.toISOString();
    return true;
  }

  function saveEdit() {
    var entry = findActivity(editingId);
    if (!entry) return closeModal("editModal");
    if (!applyEditedTime(entry, $("editTime").value)) {
      toast("Use time as HH:MM:SS");
      $("editTime").focus();
      return;
    }
    entry.type = $("editType").value;
    entry.other = entry.type === OTHER_TYPE ? $("editOther").value.trim() : "";
    if (entry.type === OTHER_TYPE && !entry.other) {
      toast("Please describe the activity");
      $("editOther").focus();
      return;
    }
    entry.note = $("editNote").value.trim();
    save();
    renderAll();
    closeModal("editModal");
    editingId = null;
    toast("Entry updated");
  }

  function deleteActivity(id, skipConfirm) {
    if (!skipConfirm && !window.confirm("Delete this activity?")) return;
    state.activities = state.activities.filter(function (a) { return a.id !== id; });
    save();
    renderAll();
    toast("Entry deleted");
  }

  function newSession() {
    var observer = state.setup.observer;
    var email = state.settings.coordinatorEmail;
    state = defaultState();
    state.setup.observer = observer;
    state.settings.coordinatorEmail = email || DEFAULT_EMAIL;
    fillForm();
    save();
    renderAll();
    $("setupFields").classList.remove("hidden");
    $("setupToggle").textContent = "Hide";
    closeModal("confirmModal");
    toast("New session started");
  }

  function downloadTxt() {
    var text = buildReport();
    var name = reportFilename();
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setExportStatus("Saved as “" + name + "”. On iPhone this may open in Files or a share sheet, not Downloads.");
      toast("File ready");
    } catch (e) {
      setExportStatus("Could not download the file. Use Copy or Share instead.", true);
    }
  }

  function shareReport() {
    var text = buildReport();
    var name = reportFilename();
    var title = state.setup.title ? "Session Script: " + state.setup.title : "Session Script";
    if (!navigator.share) {
      setExportStatus("Sharing is not available in this browser. The report was copied instead — paste it into WhatsApp or Mail.", true);
      copyText(text, true);
      return;
    }
    var payload = { title: title, text: text };
    var fileShare = null;
    try {
      var file = new File([text], name, { type: "text/plain" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        fileShare = { title: title, text: text, files: [file] };
      }
    } catch (e) {
      fileShare = null;
    }
    var attempt = fileShare || payload;
    navigator.share(attempt).then(function () {
      setExportStatus("Shared.");
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;
      if (fileShare && attempt === fileShare) {
        return navigator.share(payload);
      }
      throw err;
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;
      setExportStatus("Share did not work. The report was copied instead.", true);
      copyText(text, true);
    });
  }

  function copyText(text, silent) {
    var value = text != null ? text : buildReport();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () {
        if (!silent) {
          setExportStatus("Copied to clipboard.");
          toast("Copied");
        }
      }).catch(function () {
        return fallbackCopy(value, silent);
      });
    }
    return fallbackCopy(value, silent);
  }

  function fallbackCopy(value, silent) {
    return new Promise(function (resolve) {
      var ta = $("reportPreview");
      var prev = ta.value;
      ta.value = value;
      ta.removeAttribute("readonly");
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      ta.setAttribute("readonly", "readonly");
      ta.value = prev;
      if (ok) {
        if (!silent) {
          setExportStatus("Copied to clipboard.");
          toast("Copied");
        }
      } else if (!silent) {
        setExportStatus("Could not copy. Select the report text above and copy it yourself.", true);
      }
      resolve(ok);
    });
  }

  function openWhatsApp() {
    var text = buildReport();
    var url = "https://wa.me/?text=" + encodeURIComponent(text);
    if (url.length > 1800) {
      copyText(text, true);
      setExportStatus("The report is long for a WhatsApp link, so it was copied. Open WhatsApp and paste it.", true);
      toast("Copied — paste in WhatsApp");
      return;
    }
    window.location.href = url;
  }

  function openEmail() {
    var text = buildReport();
    var email = (state.settings.coordinatorEmail || DEFAULT_EMAIL).trim();
    var subject = "Session Script: " + (state.setup.title || "session") +
      (state.setup.observer ? " — " + state.setup.observer : "");
    var href = "mailto:" + encodeURIComponent(email) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(text);
    if (href.length > 1800) {
      copyText(text, true);
      setExportStatus("The report is long for email links, so it was copied. Open your mail app and paste it to " + email + ".", true);
      toast("Copied — paste into email");
      return;
    }
    window.location.href = href;
  }

  function probeServer() {
    if (!/^https?:$/i.test(location.protocol)) {
      $("sendServerBtn").classList.add("hidden");
      return;
    }
    fetch("./api/status", { headers: { "Accept": "application/json" } })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(); })
      .then(function (data) {
        serverAvailable = !!(data && data.ok);
        $("sendServerBtn").classList.toggle("hidden", !serverAvailable);
        if (serverAvailable) {
          $("serverHint").textContent = "This copy is running on the Session Script server. Use Send to server to store your report in the reports folder.";
        }
      })
      .catch(function () {
        serverAvailable = false;
        $("sendServerBtn").classList.add("hidden");
      });
  }

  function sendToServer() {
    if (!serverAvailable) {
      setExportStatus("Send to server only works when the app is opened from the Session Script server.", true);
      return;
    }
    var payload = {
      filename: reportFilename(),
      text: buildReport(),
      title: state.setup.title || "",
      observer: state.setup.observer || ""
    };
    fetch("./submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok || !data || !data.ok) {
          throw new Error((data && data.error) || "Server could not save the report");
        }
        return data;
      });
    }).then(function (data) {
      setExportStatus("Saved on the server as “" + data.filename + "”.");
      toast("Sent to server");
    }).catch(function (err) {
      setExportStatus((err && err.message) || "Could not send to the server.", true);
    });
  }

  function onSetupInput() {
    readSetupFromForm();
    save();
    renderAll();
  }

  function bind() {
    ["sessionTitle", "speakers", "plannedStart", "observer"].forEach(function (id) {
      $(id).addEventListener("input", onSetupInput);
      $(id).addEventListener("change", onSetupInput);
    });

    $("setupToggle").addEventListener("click", function () {
      var hidden = $("setupFields").classList.toggle("hidden");
      $("setupToggle").textContent = hidden ? "Show" : "Hide";
    });

    $("activityBtn").addEventListener("click", openPicker);
    $("activityCancel").addEventListener("click", closePicker);
    $("activityAddBtn").addEventListener("click", confirmOther);

    $("activityGrid").addEventListener("click", function (ev) {
      var btn = ev.target.closest("button[data-type]");
      if (!btn) return;
      pickType(btn.getAttribute("data-type"));
    });

    $("activityModal").addEventListener("click", function (ev) {
      if (ev.target === $("activityModal")) closePicker();
    });

    $("logList").addEventListener("click", function (ev) {
      var edit = ev.target.closest("[data-edit]");
      var del = ev.target.closest("[data-delete]");
      if (edit) openEdit(edit.getAttribute("data-edit"));
      if (del) deleteActivity(del.getAttribute("data-delete"));
    });

    $("editType").addEventListener("change", function () {
      $("editOtherBox").classList.toggle("hidden", $("editType").value !== OTHER_TYPE);
    });
    $("editCancel").addEventListener("click", function () {
      editingId = null;
      closeModal("editModal");
    });
    $("editSave").addEventListener("click", saveEdit);
    $("editDelete").addEventListener("click", function () {
      if (!editingId) return;
      if (!window.confirm("Delete this activity?")) return;
      var id = editingId;
      editingId = null;
      closeModal("editModal");
      deleteActivity(id, true);
    });
    $("editModal").addEventListener("click", function (ev) {
      if (ev.target === $("editModal")) {
        editingId = null;
        closeModal("editModal");
      }
    });

    $("settingsBtn").addEventListener("click", function () {
      $("coordinatorEmail").value = state.settings.coordinatorEmail || DEFAULT_EMAIL;
      openModal("settingsModal");
    });
    $("settingsClose").addEventListener("click", function () { closeModal("settingsModal"); });
    $("settingsSave").addEventListener("click", function () {
      state.settings.coordinatorEmail = $("coordinatorEmail").value.trim() || DEFAULT_EMAIL;
      save();
      closeModal("settingsModal");
      toast("Settings saved");
    });
    $("settingsModal").addEventListener("click", function (ev) {
      if (ev.target === $("settingsModal")) closeModal("settingsModal");
    });

    $("newSessionBtn").addEventListener("click", function () { openModal("confirmModal"); });
    $("confirmNo").addEventListener("click", function () { closeModal("confirmModal"); });
    $("confirmYes").addEventListener("click", newSession);
    $("confirmModal").addEventListener("click", function (ev) {
      if (ev.target === $("confirmModal")) closeModal("confirmModal");
    });

    $("saveTxtBtn").addEventListener("click", downloadTxt);
    $("shareBtn").addEventListener("click", shareReport);
    $("whatsappBtn").addEventListener("click", openWhatsApp);
    $("emailBtn").addEventListener("click", openEmail);
    $("copyBtn").addEventListener("click", function () { copyText(); });
    $("sendServerBtn").addEventListener("click", sendToServer);

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (!$("activityModal").classList.contains("hidden")) closePicker();
      else if (!$("editModal").classList.contains("hidden")) {
        editingId = null;
        closeModal("editModal");
      } else if (!$("settingsModal").classList.contains("hidden")) closeModal("settingsModal");
      else if (!$("confirmModal").classList.contains("hidden")) closeModal("confirmModal");
    });

    window.addEventListener("beforeunload", function () {
      readSetupFromForm();
      save();
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/i.test(location.protocol)) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function (err) {
      console.warn("Service worker not registered", err);
    });
  }

  load();
  if (!state.setup.plannedStart) state.setup.plannedStart = toDatetimeLocal(new Date());
  fillForm();
  buildActivityGrid();
  bind();
  renderAll();
  probeServer();
  registerWorker();
  setInterval(renderMeta, 1000);
})();
