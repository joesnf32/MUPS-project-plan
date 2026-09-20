/* ============================================================
   Moto United KPI Dashboard — behaviour
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 1. password gate ----------------------------------
     This is a simple front-door, not real security: the page (and
     the "password") ship in the site's own files, so anyone who
     opens the source can read it. It's meant to keep casual link-
     clicking away from the work plan while it's live, not to guard
     sensitive data. Change the word below to whatever you agree on
     as a team, then redeploy.
  ----------------------------------------------------------------*/
  var PASSWORD = "motounited2026";
  var SESSION_KEY = "mu_wp_unlocked";

  var gate = document.getElementById("gate");
  var gateForm = document.getElementById("gate-form");
  var gateInput = document.getElementById("gate-password");
  var gateError = document.getElementById("gate-error");
  var gateCard = gateForm;
  var site = document.getElementById("site");
  var lockBtn = document.getElementById("lock-btn");

  function unlock() {
    gate.hidden = true;
    site.hidden = false;
    renderAll();
  }

  function tryUnlock(pw) {
    if (pw === PASSWORD) {
      try { sessionStorage.setItem(SESSION_KEY, "1"); } catch (e) {}
      unlock();
    } else {
      gateError.hidden = false;
      gateCard.classList.remove("shake");
      void gateCard.offsetWidth;
      gateCard.classList.add("shake");
      gateInput.value = "";
      gateInput.focus();
    }
  }

  gateForm.addEventListener("submit", function (e) {
    e.preventDefault();
    tryUnlock(gateInput.value.trim());
  });

  lockBtn.addEventListener("click", function () {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    site.hidden = true;
    gate.hidden = false;
    gateInput.value = "";
    gateInput.focus();
  });

  var alreadyUnlocked = false;
  try { alreadyUnlocked = sessionStorage.getItem(SESSION_KEY) === "1"; } catch (e) {}

  /* ---------- 1b. shared state: checkmarks + added tasks -----------
     Both sync across everyone through a free Firebase Realtime
     Database, using plain HTTP — no SDK, no build step, so this stays
     a set of static files GitHub Pages can serve as-is.

     If firebase-config.js hasn't been filled in yet (FIREBASE_DB_URL
     is empty), this quietly falls back to saving in this browser only,
     so the site still works before that 5-minute setup is done. See
     README.md for the setup steps.
  ----------------------------------------------------------------*/
  var LOCAL_CACHE_KEY = "mu_wp_cache";
  var NAME_KEY = "mu_wp_name";

  var DB_URL = (window.FIREBASE_DB_URL || "").replace(/\/+$/, "");
  var progress = {};      // { storageKey: { done: true, by: "Jack" } }
  var customTasks = {};   // { id: { phase, name, owner, hours, by, at } }
  var syncMode = "local";
  var stream = null;
  var askedForName = false;

  function encodeKey(num) { return num.replace(/\./g, "_"); }

  function loadLocalCache() {
    try { return JSON.parse(localStorage.getItem(LOCAL_CACHE_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveLocalCache() {
    try {
      localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify({ progress: progress, customTasks: customTasks }));
    } catch (e) {}
  }
  (function () {
    var cached = loadLocalCache();
    progress = cached.progress || {};
    customTasks = cached.customTasks || {};
  })();

  function getYourName() {
    try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; }
  }
  function saveYourName(name) {
    try { localStorage.setItem(NAME_KEY, name); } catch (e) {}
  }
  function askForNameOnce() {
    if (askedForName) return getYourName();
    askedForName = true;
    var name = (window.prompt("Your name, so teammates can see who did this:") || "").trim();
    if (name) saveYourName(name);
    return name || getYourName();
  }

  function isDone(key) { var v = progress[key]; return !!(v && v.done); }
  function doneBy(key) { var v = progress[key]; return v && v.done ? v.by || "" : ""; }
  function keyOf(t) { return t.custom ? t.id : encodeKey(t.num); }

  function setSyncMode(mode) {
    syncMode = mode;
    var el = document.getElementById("sync-status");
    if (!el) return;
    el.className = "sync-status sync-" + mode;
    el.textContent =
      mode === "live" ? "Synced live with the team" :
      mode === "connecting" ? "Connecting…" :
      mode === "error" ? "Sync error — saving on this device only" :
      "Saving on this device only";
  }

  function remoteSetPath(path, value) {
    if (!DB_URL) return;
    fetch(DB_URL + "/" + path + ".json", {
      method: "PUT",
      body: JSON.stringify(value)
    }).catch(function (err) {
      console.warn("Could not save to shared database:", err);
    });
  }

  function applyRemoteSnapshot(path, data) {
    var parts = (path || "/").replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length === 0) {
      data = data || {};
      progress = data.progress || {};
      customTasks = data.customTasks || {};
    } else if (parts[0] === "progress") {
      if (parts.length === 1) {
        progress = data || {};
      } else if (data === null) {
        delete progress[parts[1]];
      } else {
        progress[parts[1]] = data;
      }
    } else if (parts[0] === "customTasks") {
      if (parts.length === 1) {
        customTasks = data || {};
      } else if (data === null) {
        delete customTasks[parts[1]];
      } else {
        customTasks[parts[1]] = data;
      }
    }
    saveLocalCache();
    if (site && !site.hidden) rerender();
  }

  function connectSync() {
    if (!DB_URL) { setSyncMode("local"); return; }
    if (typeof window.EventSource === "undefined" || typeof window.fetch === "undefined") {
      setSyncMode("error");
      return;
    }
    setSyncMode("connecting");

    fetch(DB_URL + "/.json")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        data = data || {};
        progress = data.progress || {};
        customTasks = data.customTasks || {};
        saveLocalCache();
        if (site && !site.hidden) rerender();
        openStream();
      })
      .catch(function (err) {
        console.warn("Could not load shared data:", err);
        setSyncMode("error");
      });
  }

  function openStream() {
    try {
      stream = new EventSource(DB_URL + "/.json");
    } catch (e) {
      setSyncMode("error");
      return;
    }
    stream.addEventListener("put", function (e) {
      setSyncMode("live");
      try {
        var msg = JSON.parse(e.data);
        applyRemoteSnapshot(msg.path, msg.data);
      } catch (err) { /* ignore malformed event */ }
    });
    stream.addEventListener("patch", function (e) {
      setSyncMode("live");
      try {
        var msg = JSON.parse(e.data);
        Object.keys(msg.data || {}).forEach(function (k) {
          applyRemoteSnapshot((msg.path === "/" ? "" : msg.path) + "/" + k, msg.data[k]);
        });
      } catch (err) { /* ignore malformed event */ }
    });
    stream.onopen = function () { setSyncMode("live"); };
    stream.onerror = function () {
      if (syncMode === "live") setSyncMode("connecting");
    };
  }

  // called for every checkbox toggle
  function setDone(key, done) {
    var value = null;
    if (done) {
      var name = getYourName();
      if (!name && DB_URL) name = askForNameOnce();
      value = { done: true, by: name || "" };
      progress[key] = value;
    } else {
      delete progress[key];
    }
    saveLocalCache();
    remoteSetPath("progress/" + key, value);
  }

  function addCustomTask(phaseNum, name, owner, hoursStr) {
    var id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var hours = parseFloat(hoursStr);
    if (isNaN(hours) || hours < 0) hours = 0;
    var who = getYourName();
    if (!who && DB_URL) who = askForNameOnce();
    var entry = { phase: phaseNum, name: name, owner: owner || "", hours: hours, by: who || "", at: new Date().toISOString() };
    customTasks[id] = entry;
    saveLocalCache();
    remoteSetPath("customTasks/" + id, entry);
    rerender();
  }

  function removeCustomTask(id) {
    if (!window.confirm(DB_URL ? "Remove this task for everyone?" : "Remove this task?")) return;
    delete customTasks[id];
    delete progress[id];
    saveLocalCache();
    remoteSetPath("customTasks/" + id, null);
    remoteSetPath("progress/" + id, null);
    rerender();
  }

  function customTasksFor(phaseNum) {
    return Object.keys(customTasks)
      .filter(function (id) { return customTasks[id].phase === phaseNum; })
      .map(function (id) {
        var c = customTasks[id];
        return {
          id: id, num: "", depth: 2, leaf: true, custom: true,
          name: c.name, owner: c.owner, hours: c.hours, by: c.by,
          start: null, end: null
        };
      })
      .sort(function (a, b) { return (customTasks[a.id].at || "").localeCompare(customTasks[b.id].at || ""); });
  }

  /* ---------- 2. data helpers ------------------------------------*/

  var DATA = window.SITE_DATA;
  var META = DATA.meta;
  var TASKS_BASE = DATA.tasks;
  var PHASES = DATA.phases;
  var OWNER_HOURS = DATA.ownerHours;

  function parseDate(s) { return s ? new Date(s + "T00:00:00") : null; }

  function numParts(num) { return num.split(".").map(Number); }
  function compareNums(a, b) {
    var pa = numParts(a), pb = numParts(b);
    for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
      var x = pa[i] === undefined ? -1 : pa[i];
      var y = pb[i] === undefined ? -1 : pb[i];
      if (x !== y) return x - y;
    }
    return 0;
  }

  function fmtDate(s) {
    if (!s) return "—";
    var d = parseDate(s);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  /* ---------- 3. hero facts + timeline ----------------------------*/

  function renderHero() {
    document.getElementById("meta-sponsor").textContent = META.sponsor;
    document.getElementById("meta-lead").textContent = META.lead;
    document.getElementById("meta-window").textContent =
      fmtDate(META.start) + " – " + fmtDate(META.end);
    document.getElementById("meta-hours").textContent = META.plannedHours + " hrs";
    document.getElementById("meta-min").textContent = META.minHours + " hrs min";
  }

  var DAY_MS = 86400000;
  var timelineMode = "overview"; // "overview" | "week"
  var currentWeekIndex = 0;

  function totalWeeks() {
    var start = parseDate(META.start), end = parseDate(META.end);
    var days = Math.round((end - start) / DAY_MS) + 1;
    return Math.max(1, Math.ceil(days / 7));
  }

  function weekBounds(idx) {
    var start = parseDate(META.start), end = parseDate(META.end);
    var wStart = new Date(start.getTime() + idx * 7 * DAY_MS);
    var wEnd = new Date(Math.min(wStart.getTime() + 6 * DAY_MS, end.getTime()));
    return { start: wStart, end: wEnd };
  }

  // Picks whichever week contains today, so switching to Week view lands
  // somewhere useful instead of always starting back at week 1.
  function defaultWeekIndex() {
    var start = parseDate(META.start), end = parseDate(META.end);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < start) return 0;
    if (today > end) return totalWeeks() - 1;
    return Math.floor((today - start) / (7 * DAY_MS));
  }

  function renderTimeline() {
    if (timelineMode === "week") renderWeekTimeline();
    else renderOverviewTimeline();
  }

  function renderOverviewTimeline() {
    var start = parseDate(META.start);
    var end = parseDate(META.end);
    var totalMs = end - start;

    var monthsEl = document.getElementById("ruler-months");
    monthsEl.innerHTML = "";
    var cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    var months = [];
    while (cursor <= end) {
      months.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    // Skip a label if it sits too close to the next one to avoid overlapping
    // text (e.g. the project starting on Aug 31 leaves "Aug" almost no room
    // before "Sep" begins) — when two crowd each other, keep whichever one
    // has more of the timeline ahead of it, since that's the one someone
    // scanning the ruler actually cares about.
    var MIN_GAP_PCT = 6;
    var positions = months.map(function (m) {
      return Math.max(0, (m - start) / totalMs) * 100;
    });
    positions.forEach(function (left, i) {
      var next = i + 1 < positions.length ? positions[i + 1] : 100;
      if (i < positions.length - 1 && next - left < MIN_GAP_PCT) return;
      var span = document.createElement("span");
      span.style.position = "absolute";
      span.style.left = left + "%";
      span.textContent = months[i].toLocaleDateString("en-US", { month: "short" });
      monthsEl.appendChild(span);
    });
    monthsEl.style.position = "relative";
    monthsEl.style.height = "14px";

    var tl = document.getElementById("timeline");
    tl.innerHTML = "";
    var sorted = PHASES.slice().sort(function (a, b) {
      return parseDate(a.start) - parseDate(b.start);
    });
    sorted.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "tl-row";

      var s = parseDate(p.start), e = parseDate(p.end);
      var left = ((s - start) / totalMs) * 100;
      var width = Math.max(((e - s) / totalMs) * 100, 0.4);

      var bar = document.createElement("div");
      bar.className = "tl-bar";
      bar.style.left = left + "%";
      bar.style.width = width + "%";
      bar.setAttribute("data-owner", p.owner || "");
      bar.title = p.num + " · " + p.name + " (" + p.owner + ", " + p.hours + "h, "
        + fmtDate(p.start) + "–" + fmtDate(p.end) + ")";

      row.appendChild(bar);
      tl.appendChild(row);
    });

    renderTimelineLegend();
  }

  function renderWeekTimeline() {
    var totalWk = totalWeeks();
    currentWeekIndex = Math.max(0, Math.min(currentWeekIndex, totalWk - 1));
    var bounds = weekBounds(currentWeekIndex);
    var wStart = bounds.start, wEnd = bounds.end;
    var weekMs = (wEnd - wStart) + DAY_MS; // inclusive of the last day

    // day-of-week ruler
    var monthsEl = document.getElementById("ruler-months");
    monthsEl.innerHTML = "";
    monthsEl.style.position = "relative";
    monthsEl.style.height = "14px";
    var numDays = Math.round((wEnd - wStart) / DAY_MS) + 1;
    for (var d = 0; d < numDays; d++) {
      var day = new Date(wStart.getTime() + d * DAY_MS);
      var left = (d * DAY_MS / weekMs) * 100;
      var span = document.createElement("span");
      span.style.position = "absolute";
      span.style.left = left + "%";
      span.textContent = day.toLocaleDateString("en-US", { weekday: "short", day: "numeric" });
      monthsEl.appendChild(span);
    }

    // nav label + button state
    document.getElementById("week-label").textContent =
      "Week " + (currentWeekIndex + 1) + " of " + totalWk + " · " +
      wStart.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " – " +
      wEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    document.getElementById("week-prev-btn").disabled = currentWeekIndex === 0;
    document.getElementById("week-next-btn").disabled = currentWeekIndex === totalWk - 1;

    // phase bars, clipped to this week's 7-day span
    var tl = document.getElementById("timeline");
    tl.innerHTML = "";
    var active = PHASES.filter(function (p) {
      var ps = parseDate(p.start), pe = parseDate(p.end);
      return pe >= wStart && ps <= wEnd;
    }).sort(function (a, b) { return parseDate(a.start) - parseDate(b.start); });

    if (!active.length) {
      var none = document.createElement("p");
      none.className = "no-match";
      none.style.margin = "14px 6px";
      none.textContent = "No phases scheduled this week.";
      tl.appendChild(none);
    } else {
      active.forEach(function (p) {
        var row = document.createElement("div");
        row.className = "tl-row";

        var ps = parseDate(p.start), pe = parseDate(p.end);
        var barStart = ps < wStart ? wStart : ps;
        var barEnd = pe > wEnd ? wEnd : pe;
        var left = ((barStart - wStart) / weekMs) * 100;
        var width = Math.max((((barEnd - barStart) + DAY_MS) / weekMs) * 100, 4);

        var bar = document.createElement("div");
        bar.className = "tl-bar";
        bar.style.left = left + "%";
        bar.style.width = width + "%";
        bar.setAttribute("data-owner", p.owner || "");
        bar.title = p.num + " · " + p.name + " (" + p.owner + ", " + p.hours + "h, "
          + fmtDate(p.start) + "–" + fmtDate(p.end) + ")";

        row.appendChild(bar);
        tl.appendChild(row);
      });
    }

    renderTimelineLegend();
  }

  document.getElementById("view-overview-btn").addEventListener("click", function () {
    if (timelineMode === "overview") return;
    timelineMode = "overview";
    document.getElementById("view-overview-btn").classList.add("active");
    document.getElementById("view-week-btn").classList.remove("active");
    document.getElementById("week-nav").hidden = true;
    renderTimeline();
  });

  document.getElementById("view-week-btn").addEventListener("click", function () {
    if (timelineMode === "week") return;
    timelineMode = "week";
    document.getElementById("view-week-btn").classList.add("active");
    document.getElementById("view-overview-btn").classList.remove("active");
    document.getElementById("week-nav").hidden = false;
    currentWeekIndex = defaultWeekIndex();
    renderTimeline();
  });

  document.getElementById("week-prev-btn").addEventListener("click", function () {
    if (currentWeekIndex === 0) return;
    currentWeekIndex -= 1;
    renderTimeline();
  });

  document.getElementById("week-next-btn").addEventListener("click", function () {
    if (currentWeekIndex === totalWeeks() - 1) return;
    currentWeekIndex += 1;
    renderTimeline();
  });

  // Matches the colors set in style.css for .tl-bar[data-owner="..."] —
  // kept here so the legend can show a swatch next to each name.
  var OWNER_COLORS = {
    "Jack Gerstner": "#7fb0d9",
    "Tanner Lewis": "#8fc79a",
    "Sherwinn Leong": "#d494c9",
    "Aaron Wilson II": "#e8a33d"
  };

  function renderTimelineLegend() {
    var el = document.getElementById("timeline-legend");
    if (!el) return;
    el.innerHTML = "";
    META.team.forEach(function (name) {
      var item = document.createElement("span");
      item.className = "legend-item";
      var swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = OWNER_COLORS[name] || "#e8a33d";
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(name));
      el.appendChild(item);
    });
  }

  /* ---------- 4. team hours panel ---------------------------------*/

  function renderTeamBars() {
    var wrap = document.getElementById("team-bars");
    wrap.innerHTML = "";
    var entries = Object.keys(OWNER_HOURS).map(function (k) {
      return { name: k, hours: OWNER_HOURS[k] };
    });
    entries.sort(function (a, b) { return b.hours - a.hours; });
    var max = Math.max.apply(null, entries.map(function (e) { return e.hours; }));

    entries.forEach(function (e) {
      var row = document.createElement("div");
      row.className = "team-bar-row";

      var name = document.createElement("div");
      name.className = "team-bar-name";
      name.textContent = e.name;

      var track = document.createElement("div");
      track.className = "team-bar-track";
      var fill = document.createElement("div");
      fill.className = "team-bar-fill";
      fill.style.width = ((e.hours / max) * 100) + "%";
      track.appendChild(fill);

      var hours = document.createElement("div");
      hours.className = "team-bar-hours";
      hours.textContent = e.hours + "h";

      row.appendChild(name);
      row.appendChild(track);
      row.appendChild(hours);
      wrap.appendChild(row);
    });
  }

  /* ---------- 5. phase / task list --------------------------------*/

  var leafCacheOrig = {};
  function leavesUnder(num) {
    var orig = leafCacheOrig[num];
    if (!orig) {
      orig = TASKS_BASE.filter(function (t) {
        return t.leaf && (t.num === num || t.num.indexOf(num + ".") === 0);
      });
      leafCacheOrig[num] = orig;
    }
    var customs = customTasksFor(num);
    return customs.length ? orig.concat(customs) : orig;
  }

  function countProgress(num) {
    var leaves = leavesUnder(num);
    var done = leaves.filter(function (t) { return isDone(keyOf(t)); }).length;
    return { done: done, total: leaves.length };
  }

  function allLeaves() {
    var base = TASKS_BASE.filter(function (t) { return t.leaf; });
    var allCustom = Object.keys(customTasks).map(function (id) {
      return { id: id, custom: true, leaf: true };
    });
    return base.concat(allCustom);
  }

  function fmtProgress(p) {
    return p.done + "/" + p.total;
  }

  function taskRow(t) {
    var key = keyOf(t);
    var row = document.createElement("div");
    row.className = "task-row depth-" + t.depth + (t.custom ? " custom" : "") + (t.leaf && isDone(key) ? " done" : "");
    row.style.paddingLeft = (t.depth - 1) * 16 + "px";
    row.setAttribute("data-key", key);

    var check = document.createElement("div");
    check.className = "task-check";
    if (t.leaf) {
      var box = document.createElement("input");
      box.type = "checkbox";
      box.className = "task-check-input";
      box.checked = isDone(key);
      box.setAttribute("aria-label", "Mark \"" + t.name.trim() + "\" done");
      check.appendChild(box);
    } else {
      var badge = document.createElement("span");
      badge.className = "task-progress";
      badge.setAttribute("data-num", t.num);
      badge.textContent = fmtProgress(countProgress(t.num));
      check.appendChild(badge);
    }

    var num = document.createElement("div");
    num.className = "task-num" + (t.custom ? " task-num-new" : "");
    num.textContent = t.custom ? "+" : t.num;

    var name = document.createElement("div");
    name.className = "task-name" + (t.depth === 1 ? " mid" : "");
    name.textContent = t.name.trim();

    var metaBits = [];
    if (t.custom && t.by) metaBits.push("added by " + t.by);
    if (t.leaf && isDone(key) && doneBy(key)) metaBits.push("done by " + doneBy(key));
    if (metaBits.length) {
      var meta = document.createElement("span");
      meta.className = "task-by";
      meta.textContent = " · " + metaBits.join(" · ");
      name.appendChild(meta);
    }

    var owner = document.createElement("div");
    owner.className = "task-owner";
    owner.textContent = t.owner || "";

    var dates = document.createElement("div");
    dates.className = "task-dates";
    dates.textContent = fmtDate(t.start) + " – " + fmtDate(t.end);

    var hours = document.createElement("div");
    hours.className = "task-hours";
    var hoursText = document.createElement("span");
    hoursText.textContent = t.hours ? t.hours + "h" : "";
    hours.appendChild(hoursText);
    if (t.custom) {
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "remove-task-btn";
      rm.title = "Remove this task";
      rm.textContent = "×";
      rm.addEventListener("click", function (e) {
        e.stopPropagation();
        removeCustomTask(t.id);
      });
      hours.appendChild(rm);
    }

    row.appendChild(check);
    row.appendChild(num);
    row.appendChild(name);
    row.appendChild(owner);
    row.appendChild(dates);
    row.appendChild(hours);
    return row;
  }

  function buildAddTaskRow(phaseNum) {
    var wrap = document.createElement("div");
    wrap.className = "add-task-row";

    var input = document.createElement("input");
    input.type = "text";
    input.className = "add-task-input";
    input.placeholder = "Add a task…";

    var ownerSel = document.createElement("select");
    ownerSel.className = "add-task-owner";
    var blank = document.createElement("option");
    blank.value = ""; blank.textContent = "Owner (optional)";
    ownerSel.appendChild(blank);
    META.team.concat(["Team"]).forEach(function (name) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      ownerSel.appendChild(o);
    });

    var hoursInput = document.createElement("input");
    hoursInput.type = "number";
    hoursInput.step = "0.5";
    hoursInput.min = "0";
    hoursInput.className = "add-task-hours";
    hoursInput.placeholder = "hrs";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "add-task-btn";
    btn.textContent = "Add";

    function submit() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      addCustomTask(phaseNum, name, ownerSel.value, hoursInput.value);
      input.value = "";
      hoursInput.value = "";
      ownerSel.value = "";
      input.focus();
    }
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });

    wrap.appendChild(input);
    wrap.appendChild(ownerSel);
    wrap.appendChild(hoursInput);
    wrap.appendChild(btn);
    return wrap;
  }

  var descendantsCache = {};
  function descendantsOfBase(phaseNum) {
    if (descendantsCache[phaseNum]) return descendantsCache[phaseNum];
    var out = TASKS_BASE.filter(function (t) {
      return t.num.indexOf(phaseNum + ".") === 0;
    }).sort(function (a, b) { return compareNums(a.num, b.num); });
    descendantsCache[phaseNum] = out;
    return out;
  }

  function combinedDescendants(phaseNum) {
    return descendantsOfBase(phaseNum).concat(customTasksFor(phaseNum));
  }

  function buildPhaseBody(phaseNum, matcher) {
    var body = document.createElement("div");
    var kids = combinedDescendants(phaseNum);
    var any = false;
    kids.forEach(function (k) {
      if (matcher && !matcher(k)) return;
      any = true;
      body.appendChild(taskRow(k));
    });
    if (!any) {
      var none = document.createElement("div");
      none.className = "no-match";
      none.textContent = "No tasks match your filters in this phase.";
      body.appendChild(none);
    }
    if (!matcher) body.appendChild(buildAddTaskRow(phaseNum));
    return body;
  }

  function renderPhaseList(matcher, forceOpenAll) {
    var list = document.getElementById("phase-list");
    list.innerHTML = "";

    PHASES.slice().sort(function (a, b) { return compareNums(a.num, b.num); })
      .forEach(function (p) {
        var phaseMatches = !matcher || matcher(p);
        var kids = combinedDescendants(p.num);
        var kidMatches = matcher ? kids.some(function (k) { return matcher(k); }) : true;

        if (matcher && !phaseMatches && !kidMatches) return;

        var el = document.createElement("div");
        el.className = "phase";
        el.setAttribute("data-phase", p.num);
        if (forceOpenAll) el.classList.add("open");

        var head = document.createElement("button");
        head.className = "phase-head";
        head.type = "button";
        head.innerHTML =
          '<span class="phase-num">' + p.num + '</span>' +
          '<span class="phase-name">' + p.name + '</span>' +
          '<span class="phase-owner">' + (p.owner || "") + '</span>' +
          '<span class="phase-dates">' + fmtDate(p.start) + '–' + fmtDate(p.end) + '</span>' +
          '<span class="phase-progress" data-num="' + p.num + '">' + fmtProgress(countProgress(p.num)) + '</span>' +
          '<span class="phase-hours">' + p.hours + 'h</span>' +
          '<span class="phase-chevron">›</span>';
        head.addEventListener("click", function () {
          el.classList.toggle("open");
        });

        var body = document.createElement("div");
        body.className = "phase-body";
        body.appendChild(buildPhaseBody(p.num, matcher));

        el.appendChild(head);
        el.appendChild(body);
        list.appendChild(el);
      });

    if (!list.children.length) {
      var none = document.createElement("p");
      none.className = "no-match";
      none.textContent = "No tasks match your search.";
      list.appendChild(none);
    }
  }

  /* ---------- 6. search + owner filter -----------------------------*/

  function populateOwnerFilter() {
    var sel = document.getElementById("owner-filter");
    META.team.concat(["Team"]).forEach(function (name) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  }

  function currentMatcher() {
    var q = document.getElementById("search").value.trim().toLowerCase();
    var owner = document.getElementById("owner-filter").value;
    if (!q && !owner) return null;
    return function (t) {
      var okOwner = !owner || t.owner === owner;
      var okQuery = !q ||
        (t.name && t.name.toLowerCase().indexOf(q) !== -1) ||
        (t.num && t.num.indexOf(q) !== -1);
      return okOwner && okQuery;
    };
  }

  document.getElementById("search").addEventListener("input", rerender);
  document.getElementById("owner-filter").addEventListener("change", rerender);

  /* ---------- 7. progress bar + re-render ---------------------------*/

  function renderOverallProgress() {
    var leaves = allLeaves();
    var done = leaves.filter(function (t) { return isDone(keyOf(t)); }).length;
    var total = leaves.length;
    var pct = total ? Math.round((done / total) * 100) : 0;
    document.getElementById("progress-count").textContent = done + " / " + total + " tasks";
    document.getElementById("progress-pct").textContent = pct + "%";
    document.getElementById("progress-fill").style.width = pct + "%";
    var note = document.getElementById("task-count-note");
    if (note) note.textContent = total + " planned items across " + PHASES.length + " phases. Click a phase to open it.";
  }

  // Rebuilds the list from current data, keeping whichever phases were
  // open (as long as no search/filter is forcing everything open).
  function rerender() {
    var matcher = currentMatcher();
    var wasOpen = null;
    if (!matcher) {
      wasOpen = Array.prototype.map.call(
        document.querySelectorAll(".phase.open"),
        function (el) { return el.getAttribute("data-phase"); }
      );
    }
    renderPhaseList(matcher, !!matcher);
    if (wasOpen) {
      wasOpen.forEach(function (n) {
        var el = document.querySelector('.phase[data-phase="' + n + '"]');
        if (el) el.classList.add("open");
      });
    }
    renderOverallProgress();
  }

  // one listener handles every checkbox, including ones added later
  document.getElementById("phase-list").addEventListener("change", function (e) {
    if (!e.target.classList.contains("task-check-input")) return;
    var row = e.target.closest(".task-row");
    var key = row.getAttribute("data-key");
    setDone(key, e.target.checked);
    rerender();
  });

  document.getElementById("reset-progress").addEventListener("click", function () {
    var msg = DB_URL
      ? "Clear all checkmarks for the whole team? Added tasks are kept."
      : "Clear all checkmarks saved in this browser?";
    if (!window.confirm(msg)) return;
    Object.keys(progress).forEach(function (key) {
      remoteSetPath("progress/" + key, null);
    });
    progress = {};
    saveLocalCache();
    rerender();
  });

  /* ---------- 8. boot -----------------------------------------------*/

  function renderAll() {
    renderHero();
    renderTimeline();
    renderTeamBars();
    populateOwnerFilter();
    renderPhaseList(null, false);
    renderOverallProgress();
    connectSync();
  }

  // Only now — after every function and variable above is fully defined —
  // is it safe to auto-unlock someone who was already unlocked earlier in
  // this browser tab. Doing this any earlier in the file risks calling
  // renderAll() before the spreadsheet data has been read in.
  if (alreadyUnlocked) unlock();
})();
