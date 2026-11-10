(function () {
  "use strict";
  const OD = window.OD, Core = window.ODCore, CFG = window.OD_CONFIG;
  const ST = OD.stations, N = ST.length, CLS = OD.classes, NH = OD.hours.length;
  const FONT = '"Atkinson Hyperlegible",system-ui,sans-serif';
  const LINE_COLOUR = { NS: "#D42E12", EW: "#009645", NE: "#9900AA", CC: "#FA9E0D", DT: "#005EC4", TE: "#9D5B25", LRT: "#748477" };
  const LINE_NAME = { NS: "North South", EW: "East West", NE: "North East", CC: "Circle", DT: "Downtown", TE: "Thomson-East Coast", LRT: "LRT (all)" };

  const $ = (s, r) => (r || document).querySelector(s);
  function h(tag, props) {
    const e = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k];
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, "");
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    }
    return e;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = v => v >= 100 ? Math.round(v).toLocaleString("en") : v >= 10 ? String(Math.round(v)) : v.toFixed(1);
  const hh = i => String(OD.hours[i]).padStart(2, "0");
  const hEnd = i => String(OD.hours[i] + 1).padStart(2, "0");          // the hour ends on the next full hour: 05:00 to 06:00, the last one 23:00 to 24:00
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const S = { view: "flow", month: null, day: 0, h0: 0, h1: NH - 1, line: "all", station: null, dir: "out", topN: 10,
              corMode: "combined", corK: 10, corLine: "all", penalty: OD.defaultPenalty || 4, mxMode: "pct",
              wkDir: "in", wkLine: "all", wkMin: 500, basemap: "auto", ldLine: "all", ldTop: 10, ldFwd: 1, ldNote: false, ldSel: null, ldRankOpen: true,
              labelMode: "both", colOut: null, colIn: null, lineScale: 1, circleScale: 1, mapOpacity: 1, railScale: 1, dotScale: 1, loadOpa: 0, railOpa: 0 };
  const DEFAULTS = { labelMode: "both", colOut: null, colIn: null, lineScale: 1, circleScale: 1, mapOpacity: 1, railScale: 1, dotScale: 1, loadOpa: 0, railOpa: 0 };
  const PREF_KEYS = Object.keys(DEFAULTS).concat(["basemap", "panelW", "listH"]);
  function savePrefs() {
    try { const o = {}; PREF_KEYS.forEach(k => { if (S[k] != null && S[k] !== DEFAULTS[k]) o[k] = S[k]; }); localStorage.setItem("od.prefs", JSON.stringify(o)); } catch (e) { /* storage blocked */ }
  }
  function loadPrefs() {
    try { const o = JSON.parse(localStorage.getItem("od.prefs") || "{}"); PREF_KEYS.forEach(k => { if (o[k] != null) S[k] = o[k]; }); } catch (e) { /* ignore */ }
  }
  const stName = i => S.labelMode === "code" ? ST[i].code : S.labelMode === "name" ? ST[i].name : ST[i].name + " (" + ST[i].code + ")";
  const cubes = {}, routes = {}, matCache = new Map();
  let F = null, hits = [], hover = -1, map = null;

  /* ---------- data ---------- */
  async function gz(b64) {
    if (typeof DecompressionStream === "undefined") throw new Error("This browser cannot unpack the data. Please use a current Chrome, Edge, Firefox or Safari.");
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  }
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src)); document.head.append(s); });
  }
  async function ensureMonth(id) {
    if (!OD.months || !OD.months[id]) await loadScript("data/od-" + id + ".js");
    if (!cubes[id]) cubes[id] = new Uint16Array(await gz(OD.months[id].cube));
  }
  async function loadRoutes() {
    for (const p of OD.penalties) {
      const r = OD.routes[p];
      routes[p] = { pair: new Uint16Array(await gz(r.pair)), cell: new Uint8Array(await gz(r.cell)), w: new Uint16Array(await gz(r.w)) };
    }
  }
  let LD = null;   // passenger load between stations: route segments + timetable trains (data/od-load.js)
  async function loadLoad() {
    const L = OD.load; if (!L) return;
    LD = { lines: L.lines, segs: L.segs, mix: L.weekendMix || {},
           pair: new Uint16Array(await gz(L.pair)), seg: new Uint16Array(await gz(L.seg)), w: new Uint16Array(await gz(L.w)),
           trains: new Uint16Array(await gz(L.trains)), cache: new Map() };
  }
  function getMat(day) {
    const k = [S.month, day, S.h0, S.h1].join("|");
    let m = matCache.get(k);
    if (!m) {
      m = Core.sumHours(cubes[S.month], N, day, S.h0, S.h1);
      matCache.set(k, m);
      if (matCache.size > 14) matCache.delete(matCache.keys().next().value);
    }
    return m;
  }
  const nDays = day => OD.months[S.month].days[day];
  const monthLabel = () => OD.months[S.month].label;
  const dayName = d => d ? "weekend / holiday day" : "weekday";
  const hoursText = () => hh(S.h0) + ":00 to " + hEnd(S.h1) + ":00";

  /* ---------- flow state ---------- */
  function computeFlow() {
    const mat = getMat(S.day), nd = nDays(S.day);
    if (S.station == null) {
      const t = Core.stationTotals(mat, N, S.dir);
      const vals = t.map(v => v / nd);
      F = { mode: "totals", vals, max: Math.max(1, ...vals), top: [], total: 0, count: 0 };
    } else {
      const fl = Core.flowFrom(mat, N, S.station, S.dir);
      const vals = fl.map(v => v / nd);
      const top = Core.topK(vals, S.topN, S.station);
      let total = 0, count = 0;
      vals.forEach(v => { total += v; if (v > 0) count++; });
      F = { mode: "flow", vals, top, total, count, max: top.length ? vals[top[0]] : 1,
            shown: top.reduce((a, j) => a + vals[j], 0) };
    }
  }

  /* ---------- map drawing ---------- */
  let lineParts = [];
  function prepLines() {
    lineParts = OD.lines.features.map(f => ({ colour: f.properties.colour, kind: f.properties.kind,
      parts: f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates }));
  }
  const colOutNow = () => S.colOut || css("--out"), colInNow = () => S.colIn || css("--in");
  function dirColour() { return S.dir === "out" ? colOutNow() : colInNow(); }
  function updateScale(m) {   // map scale in the credits ribbon: a round distance, 60 to 110 px long
    const box = $("#scale"); if (!box) return;
    const S0 = m.scale(), lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * m.view.y))), mpp = 40075016.686 * Math.cos(lat) / S0;
    const base = Math.pow(10, Math.floor(Math.log10(110 * mpp)));
    const len = [5, 2, 1].map(k => k * base).find(v => v / mpp <= 110);
    const px = Math.round(len / mpp), txt = len >= 1000 ? (len / 1000) + " km" : len + " m";
    if (box.dataset.k !== px + txt) { box.dataset.k = px + txt; box.replaceChildren(h("i", { style: "width:" + px + "px" }), txt); }
  }
  function drawMap(ctx, m) {
    updateScale(m);
    hits = [];
    if (S.view === "load") return drawLoad(ctx, m);
    {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      lineParts.forEach(lp => {
        ctx.strokeStyle = lp.colour; ctx.globalAlpha = lp.kind === "mrt" ? 0.6 : 0.5;
        ctx.lineWidth = (lp.kind === "mrt" ? 3 : 1.8) * S.railScale;
        lp.parts.forEach(part => {
          ctx.beginPath();
          part.forEach((c, i) => { const p = m.project(c[1], c[0]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
          ctx.stroke();
        });
      });
      ctx.globalAlpha = 1;
    }
    if (!F) return;
    const col = dirColour(), P = ST.map(s => m.project(s.lat, s.lng));
    const rad = v => Math.max(3, 22 * S.circleScale * Math.sqrt(v / F.max));
    const labels = [];
    if (F.mode === "flow") {
      const sp = P[S.station];
      for (let k = F.top.length - 1; k >= 0; k--) {
        const j = F.top[k], v = F.vals[j], t = Math.sqrt(v / F.max), q = P[j];
        const dx = q[0] - sp[0], dy = q[1] - sp[1], len = Math.hypot(dx, dy) || 1;
        const cx = (sp[0] + q[0]) / 2 - dy * 0.16, cy = (sp[1] + q[1]) / 2 + dx * 0.16;
        ctx.beginPath(); ctx.moveTo(sp[0], sp[1]); ctx.quadraticCurveTo(cx, cy, q[0], q[1]);
        ctx.strokeStyle = col; ctx.globalAlpha = 0.25 + 0.5 * t; ctx.lineWidth = (1.2 + 9 * t) * S.lineScale; ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const inTop = new Set(F.top);
      for (let i = 0; i < N; i++) {
        if (inTop.has(i) || i === S.station) continue;
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], 3.2 * S.dotScale, 0, 6.2832);
        ctx.fillStyle = css("--muted"); ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
        hits.push({ i, x: P[i][0], y: P[i][1], r: 3.2 * S.dotScale });
      }
      for (let k = F.top.length - 1; k >= 0; k--) {
        const j = F.top[k], r = rad(F.vals[j]);
        ctx.beginPath(); ctx.arc(P[j][0], P[j][1], r, 0, 6.2832);
        ctx.fillStyle = col; ctx.globalAlpha = 0.72; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = css("--card"); ctx.lineWidth = 1.2; ctx.stroke();
        hits.push({ i: j, x: P[j][0], y: P[j][1], r });
        if (k < 8) labels.push({ i: j, x: P[j][0] + r + 4, y: P[j][1] + 4 });
      }
      const sp2 = P[S.station];
      ctx.beginPath(); ctx.arc(sp2[0], sp2[1], 8, 0, 6.2832);
      ctx.fillStyle = css("--card"); ctx.fill(); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 3; ctx.stroke();
      hits.push({ i: S.station, x: sp2[0], y: sp2[1], r: 8 });
      labels.unshift({ i: S.station, x: sp2[0] + 12, y: sp2[1] + 4, bold: true });
    } else {
      const order = [...Array(N).keys()].sort((a, b) => F.vals[b] - F.vals[a]);
      for (let k = N - 1; k >= 0; k--) {
        const i = order[k], r = rad(F.vals[i]);
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r, 0, 6.2832);
        ctx.fillStyle = col; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = css("--card"); ctx.lineWidth = 1; ctx.stroke();
        hits.push({ i, x: P[i][0], y: P[i][1], r });
      }
      const nl = m.view.z >= 14.2 ? 40 : 8;
      for (let k = 0; k < nl; k++) { const i = order[k]; labels.push({ i, x: P[i][0] + rad(F.vals[i]) + 4, y: P[i][1] + 4 }); }
    }
    if (hover >= 0) {
      const p = P[hover];
      ctx.beginPath(); ctx.arc(p[0], p[1], 10, 0, 6.2832); ctx.strokeStyle = css("--ink"); ctx.lineWidth = 2; ctx.stroke();
      if (!labels.some(l => l.i === hover)) labels.push({ i: hover, x: p[0] + 14, y: p[1] + 4, bold: true });
    }
    ctx.textBaseline = "alphabetic";
    const placed = [];
    labels.forEach(l => {
      const t = stName(l.i);
      ctx.font = (l.bold ? "700 " : "400 ") + "12px " + FONT;
      const w = ctx.measureText(t).width, box = [l.x, l.y - 11, l.x + w, l.y + 3];
      if (!l.bold && placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box);
      ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = css("--card"); ctx.strokeText(t, l.x, l.y);
      ctx.fillStyle = css("--ink"); ctx.fillText(t, l.x, l.y);
    });
  }
  function hitAt(x, y) {
    let best = -1, bd = 1e9;
    hits.forEach(hit => { const d = Math.hypot(hit.x - x, hit.y - y) - hit.r; if (d <= 5 && d < bd) { bd = d; best = hit.i; } });
    return best;
  }
  function tipHtml(i) {
    const s = ST[i], v = F.vals[i], where = '<b>' + esc(s.name) + '</b> <span style="opacity:.7">' + esc(s.code) + "</span>";
    const verb = S.dir === "out" ? "leaving" : "arriving";
    if (F.mode === "totals") return where + "<br>" + fmt(v) + " trips/day " + verb;
    if (i === S.station) return where + "<br>" + fmt(F.total) + " trips/day " + verb + " &middot; " + F.count + " stations";
    const sel = esc(ST[S.station].name), share = F.total ? 100 * v / F.total : 0;
    return where + "<br>" + fmt(v) + " trips/day " + (S.dir === "out" ? "from " + sel + " to here" : "from here to " + sel) + " (" + share.toFixed(1) + "%)";
  }
  function showTip(x, y, html) {
    const t = $("#tip"); t.innerHTML = html; t.hidden = false;
    const w = t.offsetWidth, hgt = t.offsetHeight, W = $("#app").clientWidth;
    t.style.left = Math.max(6, Math.min(W - w - 6, x + 14)) + "px";
    t.style.top = Math.max(6, y - hgt - 10) + "px";
  }
  const hideTip = () => { $("#tip").hidden = true; if (typeof ldHover !== "undefined" && ldHover !== -1) { ldHover = -1; map && map.requestRender(); } if (hover !== -1) { hover = -1; map && map.requestRender(); } $("#cv").classList.remove("hit"); };
  function onHover(x, y) {
    if (S.view === "load") return loadHover(x, y);
    if (S.view !== "flow" || !F) return;
    const i = hitAt(x, y);
    if (i !== hover) { hover = i; map.requestRender(); }
    $("#cv").classList.toggle("hit", i >= 0);
    if (i >= 0) showTip(x, y, tipHtml(i)); else $("#tip").hidden = true;
  }
  function onMapClick(x, y) { if (S.view === "load") return loadClick(x, y); const i = hitAt(x, y); if (i >= 0) selectStation(i); }

  function selectStation(i) {
    S.station = i;
    if (i != null && S.line !== "all" && ST[i].lines.indexOf(S.line) < 0) S.line = "all";
    refreshFlow(true);
  }
  function refreshFlow(rebuildControls) {
    computeFlow();
    if (rebuildControls) buildFlowControls();
    updateSummary(); renderRank(); map.requestRender();
  }

  /* ---------- controls ---------- */
  const group = (label, node) => h("div", { class: "grp" }, h("span", { class: "lab" }, label), node);
  function gSeg(label, opts, get, set, small) {
    const wrap = h("div", { class: "seg" + (small ? " sm" : ""), role: "group", "aria-label": label });
    opts.forEach(o => wrap.append(h("button", { type: "button", "aria-pressed": String(get() === o[0]), onclick: () => {
      set(o[0]); [].forEach.call(wrap.children, (b, k) => b.setAttribute("aria-pressed", String(opts[k][0] === get())));
    } }, o[1])));
    return group(label, wrap);
  }
  function gSel(label, opts, get, set) {
    const s = h("select", { "aria-label": label });
    opts.forEach(o => s.append(h("option", { value: o[0], selected: String(o[0]) === String(get()) }, o[1])));
    s.addEventListener("change", () => set(s.value));
    return group(label, s);
  }
  function gMonth(after) {
    return gSel("Month", OD.manifest.map(m => [m.id, m.label]), () => S.month, async v => {
      try { await ensureMonth(v); S.month = v; matCache.clear(); after(); } catch (e) { showError(e); }
    });
  }
  function gDay(after) { return gSeg("Day type", [[0, "Weekday"], [1, "Weekend / holiday"]], () => S.day, v => { S.day = v; after(); }); }
  function gHours(after) {
    const from = h("select", { "aria-label": "From hour" }), to = h("select", { "aria-label": "To hour" });
    OD.hours.forEach((x, i) => { from.append(h("option", { value: i, selected: i === S.h0 }, hh(i) + ":00")); to.append(h("option", { value: i, selected: i === S.h1 }, hEnd(i) + ":00")); });
    from.onchange = () => { S.h0 = +from.value; if (S.h1 < S.h0) { S.h1 = S.h0; to.value = S.h1; } after(); };
    to.onchange = () => { S.h1 = +to.value; if (S.h0 > S.h1) { S.h0 = S.h1; from.value = S.h0; } after(); };
    const all = h("button", { class: "btn", type: "button", onclick: () => { S.h0 = 0; S.h1 = NH - 1; from.value = 0; to.value = S.h1; after(); } }, "All hours");
    return group("Hours", h("div", { class: "row2" }, from, h("span", { class: "note" }, "to"), to, all));
  }
  const lineOpts = () => [["all", "All lines"]].concat(CLS.map(c => [c, LINE_NAME[c]]));

  function buildFlowControls() {
    const box = $("#ctlBody"); box.replaceChildren();
    const after = () => refreshFlow(false);
    const stations = ST.map((s, i) => i).filter(i => S.line === "all" || ST[i].lines.indexOf(S.line) >= 0 || i === S.station)
      .sort((a, b) => ST[a].name.localeCompare(ST[b].name));
    const stSel = h("select", { "aria-label": "Station" }, h("option", { value: "" }, "Choose a station\u2026"));
    stations.forEach(i => stSel.append(h("option", { value: i, selected: i === S.station }, ST[i].name + " (" + ST[i].code + ")")));
    stSel.onchange = () => { S.station = stSel.value === "" ? null : +stSel.value; refreshFlow(false); };
    box.append(
      h("div", { class: "two" }, gMonth(after), gSel("Line (filters the station list)", lineOpts(), () => S.line, v => { S.line = v; buildFlowControls(); })),
      gDay(after), gHours(after),
      gSeg("Direction", [["out", "Leaving the station"], ["in", "Arriving at the station"]], () => S.dir, v => { S.dir = v; after(); }, true),
      group("Station (or click one on the map)", h("div", { class: "row2" }, stSel)),
      gSeg("Show top stations", [[10, "10"], [20, "20"], [25, "25"], ["all", "All"]], () => S.topN, v => { S.topN = v; after(); }, true)
    );
  }
  function buildSettings() {
    const box = $("#setBody"); box.replaceChildren();
    const redraw = () => { savePrefs(); map && map.requestRender(); };
    const sg = t => h("div", { class: "sg" }, t);
    const fld = (label, ...ctl) => h("label", { class: "fld" }, h("span", null, label), ...ctl);
    const slider = (label, key, min, max, step, show) => {
      const out = h("output", { "data-key": key }, show(S[key]));   // a setting shown under two names in two views keeps both copies in step
      return fld(label, h("input", { type: "range", min, max, step, value: S[key], "aria-label": label, "data-key": key,
        oninput: e => { S[key] = +e.target.value; document.querySelectorAll('#setBody input[data-key="' + key + '"]').forEach(i => { i.value = S[key]; }); document.querySelectorAll('#setBody output[data-key="' + key + '"]').forEach(o => { o.textContent = show(S[key]); }); if (key === "mapOpacity") applyOpacity(); redraw(); } }), out);
    };
    const times = v => "×" + (+v).toFixed(1);
    const fo = el => { el.classList.add("flowOnly"); return el; };   // hidden in the load view
    const lo = el => { el.classList.add("loadOnly"); return el; };   // shown only in the load view
    const opa = v => v <= 0 ? "Default" : Math.round(v * 100) + "%";
    const picker = (label, key, getDefault) => {
      const inp = h("input", { type: "color", value: S[key] || getDefault(), "aria-label": label,
        oninput: e => { S[key] = e.target.value; legend(); renderRank(); redraw(); } });
      const reset = h("button", { class: "btn sm", type: "button", onclick: () => { S[key] = null; inp.value = getDefault(); legend(); renderRank(); redraw(); } }, "Default");
      return fld(label, inp, reset);
    };
    const select = (label, opts, get, set) => {
      const sel = h("select", { "aria-label": label });
      opts.forEach(o => sel.append(h("option", { value: o[0], selected: String(o[0]) === String(get()) }, o[1])));
      sel.addEventListener("change", () => set(sel.value));
      return fld(label, sel);
    };
    const provs = CFG.basemap.providers;
    const file = h("input", { type: "file", accept: "application/json,.json", hidden: true, "aria-label": "Import settings file",
      onchange: e => { const f = e.target.files[0]; if (!f) return; f.text().then(t => { try { importSettings(JSON.parse(t)); } catch (err) { alert("That file is not a valid settings file."); } }); } });
    box.append(
      sg("Labels"),
      select("Map labels", [["both", "Name and code"], ["name", "Name only"], ["code", "Code only"]], () => S.labelMode, v => { S.labelMode = v; renderRank(); redraw(); }),
      fo(sg("Colours")),
      fo(picker("Leaving flows (lines and circles)", "colOut", () => css("--out"))),
      fo(picker("Arriving flows (lines and circles)", "colIn", () => css("--in"))),
      sg("Sizes"),
      fo(slider("Flow line width", "lineScale", 0.5, 2, 0.1, times)),
      lo(slider("Passenger load width", "lineScale", 0.5, 2, 0.1, times)),
      fo(slider("Circle size", "circleScale", 0.5, 2, 0.1, times)),
      slider("Rail line width", "railScale", 0.5, 3, 0.1, times),
      fo(slider("Inactive station dots", "dotScale", 1, 3, 0.1, times)),
      lo(slider("Station dots", "dotScale", 1, 3, 0.1, times)),
      lo(slider("Passenger load opacity", "loadOpa", 0, 1, 0.05, opa)),
      lo(slider("Rail line opacity", "railOpa", 0, 1, 0.05, opa)),
      sg("Basemap"),
      select("Basemap", Object.keys(provs).map(k => [k, provs[k].label]), () => baseKey(), v => { S.basemap = v; S.baseUser = true; applyBasemap(); }),
      slider("Basemap opacity", "mapOpacity", 0.2, 1, 0.05, v => Math.round(v * 100) + "%"),
      sg("Layout and settings"),
      h("div", { class: "btnrow" },
        h("button", { class: "btn", type: "button", onclick: () => { resetLayout(); } }, "Reset panel layout"),
        h("button", { class: "btn", type: "button", onclick: () => resetSettings() }, "Reset settings"),
        h("button", { class: "btn", type: "button", onclick: () => exportSettings() }, "Download settings"),
        h("button", { class: "btn", type: "button", onclick: () => file.click() }, "Import settings")),
      file);
  }
  function resetSettings() {
    Object.assign(S, DEFAULTS); S.basemap = CFG.basemap.default; S.mapOpacity = 1;
    applyOpacity(); applyBasemap(); buildSettings(); legend(); renderRank(); savePrefs(); map && map.requestRender();
  }
  function exportSettings() {
    const o = {}; PREF_KEYS.forEach(k => { if (S[k] != null) o[k] = S[k]; });
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: "application/json" }));
    a.download = "od-dashboard-settings.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function importSettings(o) {
    if (!o || typeof o !== "object") throw new Error("bad");
    PREF_KEYS.forEach(k => { if (o[k] !== undefined) S[k] = o[k]; });
    if (!CFG.basemap.providers[S.basemap]) S.basemap = CFG.basemap.default;
    setPanelW(S.panelW); setListH(S.listH);
    applyOpacity(); applyBasemap(); buildSettings(); legend(); renderRank(); savePrefs(); map && map.requestRender();
  }
  function legend() {
    const dot = c => '<span class="sw" style="background:' + c + '"></span>';
    $("#lgBody").innerHTML = "<span>" + dot(colOutNow()) + "Trips leaving the selected station</span><span>" + dot(colInNow()) + "Trips arriving at the selected station</span><span>Circle area and line width: average trips per day.</span><span>Coloured lines: MRT. Grey lines: LRT.</span>";
  }
  /* ---------- resizable panels ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function setPanelW(w) {
    const max = Math.max(280, Math.min(760, window.innerWidth - 24));
    S.panelW = w == null ? null : clamp(Math.round(w), 260, max);
    S.panelW == null ? $("#rt").style.removeProperty("--rtw") : $("#rt").style.setProperty("--rtw", S.panelW + "px");
    if (S.view === "flow" && map) map.requestRender();
  }
  function setListH(hpx) {
    const sc = $("#sc"), rt = $("#rt");
    if (hpx == null) { S.listH = null; sc.style.removeProperty("flex"); return; }
    S.listH = clamp(Math.round(hpx), 110, Math.max(140, rt.parentElement.clientHeight - 160));
    sc.style.flex = "0 0 " + S.listH + "px";
  }
  function resetLayout() { setPanelW(null); setListH(null); savePrefs(); }
  function grip(el, onDrag, onKey, onReset, saveIt) {
    let start = null;
    el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); start = [e.clientX, e.clientY]; el.classList.add("on"); e.preventDefault(); onDrag(0, 0, true); });
    el.addEventListener("pointermove", e => { if (start) onDrag(e.clientX - start[0], e.clientY - start[1]); });
    const end = () => { if (start) { start = null; el.classList.remove("on"); savePrefs(); } };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", e => { if (onKey(e.key)) { e.preventDefault(); savePrefs(); } });
    el.addEventListener("dblclick", () => { onReset(); savePrefs(); });
  }
  function initGrips() {
    const rt = $("#rt"), g1 = $("#rtGrip"), g2 = $("#rkGrip");
    let w0 = 0, h0 = 0;
    grip(g1, (dx, dy, first) => { if (first) { w0 = rt.getBoundingClientRect().width; } else setPanelW(w0 - dx); },
      k => { const w = rt.getBoundingClientRect().width; if (k === "ArrowLeft") setPanelW(w + 24); else if (k === "ArrowRight") setPanelW(w - 24); else return false; return true; },
      () => setPanelW(null));
    grip(g2, (dx, dy, first) => { if (first) { h0 = $("#sc").getBoundingClientRect().height; } else setListH(h0 - dy); },
      k => { const hh0 = $("#sc").getBoundingClientRect().height; if (k === "ArrowUp") setListH(hh0 + 30); else if (k === "ArrowDown") setListH(hh0 - 30); else return false; return true; },
      () => setListH(null));
    if (S.panelW) setPanelW(S.panelW);
    if (S.listH) setListH(S.listH);
    window.addEventListener("resize", () => { if (S.panelW) setPanelW(S.panelW); });
  }
  const baseKey = () => CFG.basemap.providers[S.basemap] ? S.basemap : CFG.basemap.default;
  const lnk = (u, t) => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>";
  const dmy = iso => { const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function creditsHTML() {
    const cr = CFG.credits, bm = CFG.basemap.providers[baseKey()].attribution;
    return lnk(cr.dataMallUrl, "LTA DataMall") + " \u00b7 " + lnk(cr.ltaLicenceUrl, "Singapore Open Data Licence v1.0") + (bm ? " \u00b7 " + bm : "") + " \u00b7 Independent student project. Not affiliated with or endorsed by LTA";
  }
  function applyOpacity() { if (map) { map.tileAlpha = S.mapOpacity; map.requestRender(); } }
  let lastBase = null;
  function applyBasemap() {
    const key = baseKey(); lastBase = key;
    const ct = $("#credTxt"); if (ct) ct.innerHTML = creditsHTML();
    if (!$("#info").hidden) buildInfo();
    if (!map) return;
    map.bg = "#eef1f3"; map.tileAlpha = S.mapOpacity;
    map.setTiles(key === "none" ? null : (z, x, y, r) => CFG.tileUrl(key, z, x, y, r));
  }
  function updateSummary() {
    if (S.view === "load") {
      $("#ctlSum").textContent = (S.day ? "Weekend / holiday" : "Weekday") + " \u00b7 " + hh(S.h0) + ":00\u2013" + hEnd(S.h1) + ":00";
      $("#monthLbl").textContent = monthLabel() + " \u00b7 passengers per train, " + (S.day ? "weekend / holiday" : "weekday"); return;
    }
    $("#ctlSum").textContent = (S.day ? "Weekend / holiday" : "Weekday") + " · " + hh(S.h0) + ":00–" + hEnd(S.h1) + ":00 · " + (S.dir === "out" ? "leaving" : "arriving");
    $("#monthLbl").textContent = monthLabel() + " · average trips per " + dayName(S.day);
  }

  /* ---------- ranking panel ---------- */
  function renderRank() {
    const sc = $("#sc");
    if (S.view === "load") return renderLoadRank();
    if (S.view !== "flow" || S.station == null || !F || F.mode !== "flow") { sc.hidden = true; $("#rkGrip").hidden = true; return; }
    sc.hidden = false; $("#rkGrip").hidden = false; sc.replaceChildren(); sc.classList.remove("min"); sc.style.flex = S.listH ? "0 0 " + S.listH + "px" : "";
    const s = ST[S.station], col = dirColour();
    sc.append(h("div", { class: "rkh" }, h("h2", null, (S.dir === "out" ? "Trips leaving " : "Trips arriving at ") + s.name),
      h("button", { class: "btn", type: "button", "aria-label": "Clear selection", onclick: () => selectStation(null) }, "Clear")),
      h("p", { class: "sub" }, fmt(F.total) + " trips per " + dayName(S.day) + " · top " + F.top.length + " of " + F.count + " stations cover " + (F.total ? Math.round(100 * F.shown / F.total) : 0) + "%"));
    F.top.forEach((j, k) => {
      const v = F.vals[j];
      sc.append(h("button", { class: "rk", type: "button", title: "Show trips for " + ST[j].name, onclick: () => selectStation(j) },
        h("span", { class: "n" }, String(k + 1)),
        h("span", { class: "nm" }, stName(j), h("i", { class: "bar1", style: "width:" + Math.max(2, 100 * v / F.max) + "%;background:" + col })),
        h("span", { class: "v" }, fmt(v)), h("span", { class: "p" }, (F.total ? 100 * v / F.total : 0).toFixed(1) + "%")));
    });
  }

  /* ---------- chart views ---------- */
  function buildBar(view) {
    const bar = $("#pvBar"); bar.replaceChildren();
    const body = () => renderBody();
    const month = gMonth(body), day = gDay(body), hours = gHours(body);
    if (view === "cor") bar.append(month, day, hours,
      gSel("Line (both stations on it)", lineOpts(), () => S.corLine, v => { S.corLine = v; body(); }),
      gSeg("Show top", [[10, "10"], [20, "20"]], () => S.corK, v => { S.corK = v; body(); }, true),
      gSeg("Rank by", [["combined", "Both directions combined"], ["larger", "Larger direction"]], () => S.corMode, v => { S.corMode = v; body(); }, true));
    if (view === "mx") bar.append(month, day, hours,
      gSeg("Show", [["pct", "% of row"], ["trips", "Trips per day"]], () => S.mxMode, v => { S.mxMode = v; body(); }, true),
      gSeg("Transfer penalty (stops)", OD.penalties.map(p => [p, p === OD.defaultPenalty ? p + " (default)" : String(p)]), () => S.penalty, v => { S.penalty = +v; body(); }, true));
    if (view === "wk") bar.append(month, hours,
      gSeg("Measure", [["in", "Arrivals"], ["out", "Departures"]], () => S.wkDir, v => { S.wkDir = v; body(); }, true),
      gSel("Line", lineOpts(), () => S.wkLine, v => { S.wkLine = v; body(); }),
      gSel("Minimum trips per day (each day type)", [[100, "100"], [500, "500"], [1000, "1,000"], [2000, "2,000"], [5000, "5,000"]], () => S.wkMin, v => { S.wkMin = +v; body(); }));
  }
  function renderBody() {
    updateSummary();
    if (S.view === "cor") renderCor(); else if (S.view === "mx") renderMx(); else if (S.view === "wk") renderWk();
  }
  const key = (colour, text) => h("span", null, h("i", { style: "background:" + colour }), text);

  function renderCor() {
    const body = $("#pvBody"); body.replaceChildren();
    const mat = getMat(S.day), nd = nDays(S.day);
    const rows = Core.corridors(mat, N, ST, { mode: S.corMode, k: S.corK, line: S.corLine });
    body.append(h("h2", null, "Top corridors"),
      h("p", { class: "sub" }, "Busiest station pairs, ranked by " + (S.corMode === "combined" ? "trips in both directions combined" : "the larger of the two directions") + ". Average trips per " + dayName(S.day) + ", " + hoursText() + ", " + monthLabel() + "."),
      h("div", { class: "key" }, key("var(--out)", "Larger direction (upper bar)"), key("var(--in)", "Opposite direction (lower bar)")));
    if (!rows.length) { body.append(h("p", { class: "note" }, "No station pairs match these filters.")); return; }
    const max = Math.max(1, ...rows.map(r => r.major / nd)), grid = h("div", { class: "cor" });
    rows.forEach(r => {
      const a = ST[r.from].name, b = ST[r.to].name, major = r.major / nd, minor = r.minor / nd;
      const im = r.minor === 0 ? "one-way in this selection" : r.ratio < 1.15 ? "balanced" : r.ratio.toFixed(1) + "× toward " + b;
      grid.append(h("div", { class: "nm" }, a + " ⇄ " + b, h("small", null, fmt(r.combined / nd) + " trips/day combined")),
        h("div", { class: "bars" },
          h("div", null, h("i", { style: "width:" + Math.max(1, 100 * major / max) * 0.8 + "%;background:var(--out)" }), h("span", null, fmt(major) + " " + a + " → " + b)),
          h("div", null, h("i", { style: "width:" + Math.max(0.5, 100 * minor / max) * 0.8 + "%;background:var(--in)" }), h("span", null, fmt(minor) + " " + b + " → " + a))),
        h("div", { class: "im" }, im));
    });
    body.append(grid);
  }

  function renderMx() {
    const body = $("#pvBody"); body.replaceChildren();
    const mat = getMat(S.day), nd = nDays(S.day), rt = routes[S.penalty];
    const M = Core.classMatrix(mat, rt), Pc = Core.rowPercent(M);
    const rowSum = [...Array(7).keys()].map(r => { let s = 0; for (let c = 0; c < 7; c++) s += M[r * 7 + c]; return s; });
    const maxT = Math.max(...M), maxP = Math.max(...Pc);
    body.append(h("h2", null, "Where trips start and end, by line"),
      h("p", { class: "sub" }, "Rows: line of the first leg of the trip. Columns: line of the last leg. Average trips per " + dayName(S.day) + ", " + hoursText() + ", " + monthLabel() + ". Outlined cells are trips that stay on one line."),
      h("p", { class: "note pen" }, h("b", null, "What is the transfer penalty? "), "The data shows where a trip starts and ends, not the route, so each trip is given the cheapest route. Every stop ridden costs 1. Every change of line adds the penalty, " + S.penalty + " stops here (about " + 2 * S.penalty + " minutes at 2 minutes per stop), for walking to another platform and waiting for the train. A lower penalty (2) makes transfers more likely, a higher one (6) makes passengers stay on one line where they can. Routes with the same cost share the trip equally."));
    const grid = h("div", { class: "mx", style: "grid-template-columns:110px repeat(7,minmax(0,1fr)) 90px" });
    const head = c => h("div", { class: "h" }, h("span", { class: "sw", style: "border-radius:3px;background:" + LINE_COLOUR[c] }), c);
    grid.append(h("div", { class: "h rh" }, "First leg ↓ / last leg →"));
    CLS.forEach(c => grid.append(head(c)));
    grid.append(h("div", { class: "h" }, "Trips/day"));
    CLS.forEach((c, r) => {
      grid.append(h("div", { class: "h rh" }, h("span", { class: "sw", style: "border-radius:3px;background:" + LINE_COLOUR[c] }), c));
      for (let k = 0; k < 7; k++) {
        const i = r * 7 + k, pct = S.mxMode === "pct" ? Pc[i] / (maxP || 1) : M[i] / (maxT || 1);
        grid.append(h("div", { class: "c" + (r === k ? " dg" : ""), style: "background:color-mix(in srgb,var(--out) " + Math.round(8 + 62 * pct) + "%,transparent)",
          title: c + " first, " + CLS[k] + " last: " + fmt(M[i] / nd) + " trips/day, " + Pc[i].toFixed(1) + "% of the row" },
          S.mxMode === "pct" ? Pc[i].toFixed(1) + "%" : fmt(M[i] / nd)));
      }
      grid.append(h("div", { class: "h", style: "justify-content:flex-end;font-variant-numeric:tabular-nums" }, fmt(rowSum[r] / nd)));
    });
    body.append(grid);
    const lo = OD.penalties[0], hi = OD.penalties[OD.penalties.length - 1];
    const sens = Core.sensitivity(mat, routes[lo], routes[hi]), ch = 100 * Core.shareChanged(mat, routes[lo], routes[hi], N);
    const a = CLS[Math.floor(sens.maxCell / 7)], b = CLS[sens.maxCell % 7];
    body.append(h("div", { class: "fn" },
      h("p", null, h("b", null, "How sensitive is this? "), "Between a " + lo + "-stop and a " + hi + "-stop transfer penalty, " + ch.toFixed(1) + "% of trips change their first or last line, and no cell's share of its row moves by more than " + sens.maxPP.toFixed(1) + " percentage points (largest: " + a + " first, " + b + " last). Currently showing a penalty of " + S.penalty + " stops."),
      h("p", null, h("b", null, "Assumptions. "), "The data records stations, not lines, so each trip is routed along the path with the fewest stops: 1 per stop ridden plus " + S.penalty + " stops for each transfer. Tied routes share the trip equally. Each trip is counted once, under the line of its first and its last leg. Passengers are assumed to take that route and trains are assumed to run both ways round the LRT loops. The Changi Airport branch counts as East West; Bukit Panjang, Sengkang and Punggol LRTs are grouped as LRT."),
      h("p", null, "The 23:00 hour includes trips after midnight.")));
  }

  function renderWk() {
    const body = $("#pvBody"); body.replaceChildren();
    const res = Core.weekendShift(getMat(0), getMat(1), N, ST, { dir: S.wkDir, line: S.wkLine, minPerDay: S.wkMin, daysWd: nDays(0), daysWe: nDays(1), k: 10 });
    const rows = res.gainers.concat(res.losers);
    body.append(h("h2", null, "Weekday vs weekend / holiday"),
      h("div", { class: "sub wkx" },
        h("p", null, h("b", null, "Station share of the network. "), "A station's share is its " + (S.wkDir === "in" ? "arrivals (trips that end there)" : "departures (trips that start there)") + " divided by all " + (S.wkDir === "in" ? "arrivals" : "departures") + " on the network, for one day type. For example, if Bishan has 40,000 weekday " + (S.wkDir === "in" ? "arrivals" : "departures") + " out of 3,000,000, its weekday share is 1.33%. With 26,000 out of 2,400,000 on weekends, its weekend share is 1.08%."),
        h("p", null, h("b", null, "What is shown. "), "The difference: weekend share minus weekday share, in percentage points. Bishan: 1.08 \u2212 1.33 = \u22120.25 points."),
        h("p", null, h("b", null, "How to read it. "), "Positive: the station matters more on weekends and holidays, for example leisure stations. Negative: it matters more on weekdays, as commuter and office stations do. Near zero: its role is about the same on both day types."),
        h("p", null, hoursText() + ", " + monthLabel() + ". Stations with at least " + S.wkMin.toLocaleString("en") + " trips per day on both day types.")),
      h("div", { class: "key" }, key("var(--gain)", "Relatively busier on weekends / holidays"), key("var(--loss)", "Relatively busier on weekdays")));
    if (!rows.length) { body.append(h("p", { class: "note" }, "No stations match these filters. Try a lower minimum.")); return; }
    const W = Math.max(520, Math.min(980, body.clientWidth - 8)), rh = 26, lw = Math.min(190, W * 0.3), top = 6, ph = rows.length * rh + 44;
    const half = (W - lw - 130) / 2, cx = lw + 65 + half, maxA = Math.max(0.2, ...rows.map(r => Math.abs(r.shiftPP)));
    let svg = '<svg width="100%" viewBox="0 0 ' + W + " " + (ph + top) + '" role="img" aria-label="Diverging bars of station share change between weekdays and weekends">';
    svg += '<line x1="' + cx + '" x2="' + cx + '" y1="' + top + '" y2="' + (rows.length * rh + top) + '" style="stroke:var(--line)" stroke-width="1"/>';
    rows.forEach((r, i) => {
      const y = top + i * rh, len = Math.abs(r.shiftPP) / maxA * half, pos = r.shiftPP >= 0, x = pos ? cx : cx - len;
      const tip = ST[r.station].name + ": " + r.shareWd.toFixed(2) + "% of weekday vs " + r.shareWe.toFixed(2) + "% of weekend/holiday; " + fmt(r.perDayWd) + " vs " + fmt(r.perDayWe) + " trips/day";
      svg += '<g><title>' + esc(tip) + '</title><text x="' + (lw + 25) + '" y="' + (y + 17) + '" text-anchor="end" font-size="13" style="fill:var(--ink)">' + esc(ST[r.station].name) + "</text>" +
        '<rect x="' + x + '" y="' + (y + 4) + '" width="' + Math.max(1, len) + '" height="17" rx="3" style="fill:' + (pos ? "var(--gain)" : "var(--loss)") + '"/>' +
        '<text x="' + (pos ? cx + len + 5 : cx - len - 5) + '" y="' + (y + 17) + '" text-anchor="' + (pos ? "start" : "end") + '" font-size="12" style="fill:var(--ink2)">' + (pos ? "+" : "−") + Math.abs(r.shiftPP).toFixed(2) + "</text></g>";
    });
    const ay = rows.length * rh + top + 22;
    svg += '<text x="' + (cx - 8) + '" y="' + ay + '" text-anchor="end" font-size="12" style="fill:var(--ink2)">← busier on weekdays</text><text x="' + (cx + 8) + '" y="' + ay + '" font-size="12" style="fill:var(--ink2)">busier on weekends / holidays →</text></svg>';
    const holder = h("div"); holder.innerHTML = svg; body.append(holder);
    body.append(h("div", { class: "fn" }, h("p", null, "Shares are within each day type, so the different number of weekdays and weekend days (" + nDays(0) + " and " + nDays(1) + " in " + monthLabel() + ") does not affect the result. The list shows up to 10 stations on each side."),
      h("p", null, "The 23:00 hour includes trips after midnight.")));
  }

  /* ---------- passenger load between stations ---------- */
  /* Passengers on each directed segment (a -> next station b on a line) come from the OD trips routed along their
     fewest-stops path (data/od-load.js, penalty 4, ties split equally); trains per segment come from the planned
     GTFS timetable. Load per train = passengers per hour / trains per hour, summed over the chosen hours. */
  const SEG_CLASS = { NS: "NS", EW: "EW", CG: "EW", NE: "NE", CC: "CC", DT: "DT", TE: "TE", BP: "LRT", SE: "LRT", SW: "LRT", PE: "LRT", PW: "LRT" };
  const SEG_LINE_NAME = { NS: "North South", EW: "East West", CG: "Changi Airport branch (East West)", NE: "North East", CC: "Circle", DT: "Downtown",
    TE: "Thomson-East Coast", BP: "Bukit Panjang LRT", SE: "Sengkang LRT, east loop", SW: "Sengkang LRT, west loop", PE: "Punggol LRT, east loop", PW: "Punggol LRT, west loop" };
  const LOOPY = new Set(["CC", "BP", "SE", "SW", "PE", "PW"]);
  const trainAt = (sv, hr, sid) => LD.trains[(sv * NH + hr) * LD.segs.length + sid];
  function trainsHour(day, hr, sid) {
    if (day === 0) return trainAt(0, hr, sid);
    const mix = LD.mix[S.month] || [1, 1], tot = mix[0] + mix[1];
    return (mix[0] * trainAt(1, hr, sid) + mix[1] * trainAt(2, hr, sid)) / tot;
  }
  function addPaxHour(out, cube, day, hr) {
    const base = (day * NH + hr) * N * N, pr = LD.pair, sg = LD.seg, w = LD.w;
    for (let e = 0; e < pr.length; e++) { const t = cube[base + pr[e]]; if (t) out[sg[e]] += t * w[e] / 65535; }
  }
  function loadScale() {            // width scale shared by all hours: 98th percentile of the single-hour loads
    const k = "scale|" + S.month + "|" + S.day;
    if (LD.cache.has(k)) return LD.cache.get(k);
    const cube = cubes[S.month], nd = nDays(S.day), ns = LD.segs.length, vals = [], tmp = new Float64Array(ns);
    for (let hr = 0; hr < NH; hr++) {
      tmp.fill(0); addPaxHour(tmp, cube, S.day, hr);
      for (let s = 0; s < ns; s++) { const t = trainsHour(S.day, hr, s); if (t > 0 && tmp[s] > 0) vals.push(tmp[s] / nd / t); }
    }
    vals.sort((a, b) => a - b);
    const v = vals.length ? Math.max(1, vals[Math.floor(0.98 * (vals.length - 1))]) : 1;
    LD.cache.set(k, v); return v;
  }
  function loadCalc() {
    const k = [S.month, S.day, S.h0, S.h1].join("|");
    if (LD.cache.has(k)) return LD.cache.get(k);
    const ns = LD.segs.length, pax = new Float64Array(ns), trn = new Float64Array(ns), nd = nDays(S.day);
    for (let hr = S.h0; hr <= S.h1; hr++) { addPaxHour(pax, cubes[S.month], S.day, hr); for (let s = 0; s < ns; s++) trn[s] += trainsHour(S.day, hr, s); }
    const load = new Float64Array(ns), nh = S.h1 - S.h0 + 1;
    for (let s = 0; s < ns; s++) { pax[s] /= nd; load[s] = trn[s] > 0 ? pax[s] / trn[s] : NaN; }
    const r = { pax, trn, load, nh, scale: loadScale() };
    LD.cache.set(k, r); if (LD.cache.size > 40) LD.cache.delete(LD.cache.keys().next().value);
    return r;
  }
  function ldTerm() {               // first and last station of each line, in the listed order
    if (LD.term) return LD.term;
    const t = {};
    LD.lines.forEach((ln, li) => {
      const fw = LD.segs.map((s, i) => i).filter(i => LD.segs[i][2] === li && LD.segs[i][4] === 1).sort((a, b) => LD.segs[a][3] - LD.segs[b][3]);
      t[li] = fw.length ? { first: LD.segs[fw[0]][0], last: LD.segs[fw[fw.length - 1]][1] } : null;
    });
    return (LD.term = t);
  }
  const segTowards = sid => {
    const [a, b, li, , fwd] = LD.segs[sid], ln = LD.lines[li], t = ldTerm()[li];
    if (!t || LOOPY.has(ln)) return "";
    return "towards " + ST[fwd ? t.last : t.first].name;
  };
  const segTitle = sid => ST[LD.segs[sid][0]].name + " → " + ST[LD.segs[sid][1]].name;
  const LINE_GROUPS = { SK: { name: "Sengkang LRT", parts: ["SE", "SW"] }, PG: { name: "Punggol LRT", parts: ["PE", "PW"] } };   // the two loops of each LRT line are chosen together
  const PART_NAME = { SE: "East loop", SW: "West loop", PE: "East loop", PW: "West loop" };
  const ldMembers = v => LINE_GROUPS[v] ? LINE_GROUPS[v].parts : [v];
  const ldName = v => LINE_GROUPS[v] ? LINE_GROUPS[v].name : SEG_LINE_NAME[v];
  const segActive = sid => S.ldLine === "all" || ldMembers(S.ldLine).indexOf(LD.lines[LD.segs[sid][2]]) >= 0;
  const LINE_ORDER = ["NS", "EW", "CG", "NE", "CC", "DT", "TE", "BP", "SK", "PG"];
  const ldLineOpts = () => [["all", "All lines"]].concat(LINE_ORDER.filter(l => ldMembers(l).every(m => LD.lines.indexOf(m) >= 0)).map(l => [l, ldName(l)]));
  function lineGroup() {            // the one Line selector, used in the Controls panel and in the chart panel
    const sel = h("select", { class: "ldLineSel", "aria-label": "Line" });
    ldLineOpts().forEach(o => sel.append(h("option", { value: o[0], selected: o[0] === S.ldLine }, o[1])));
    sel.addEventListener("change", () => setLine(sel.value));
    const clr = h("button", { class: "lnk ldClear", type: "button", style: S.ldLine === "all" ? "display:none" : "", "aria-label": "Clear the line selection", onclick: () => setLine("all") }, "Clear");
    return h("div", { class: "grp" }, h("div", { class: "lab lab2" }, h("span", null, "Line"), clr), sel);
  }
  function syncLineUI() {
    document.querySelectorAll(".ldLineSel").forEach(x => { x.value = S.ldLine; });
    document.querySelectorAll(".ldClear").forEach(x => { x.style.display = S.ldLine === "all" ? "none" : ""; });
  }
  function zoomToLine(ln) {
    const lats = [], lngs = [];
    LD.segs.forEach((sg, s) => { if (ldMembers(ln).indexOf(LD.lines[sg[2]]) >= 0) LD.geom[s].forEach(c => { lats.push(c[1]); lngs.push(c[0]); }); });
    if (!lats.length) return;
    const p = 0.004;
    map.fitBoundsIn([Math.min(...lats) - p, Math.min(...lngs) - p, Math.max(...lats) + p, Math.max(...lngs) + p], visiblePad(), 15);
  }
  function setLine(v) {
    S.ldLine = v; S.ldSel = null; S.ldFwd = 1; syncLineUI();
    renderLoadRank(); renderLoadChart();
    if (v === "all") map.fitBoundsIn(CFG.bounds, visiblePad(), 30); else zoomToLine(v);
    map.requestRender();
  }
  const fmt1 = v => v >= 100 ? Math.round(v).toLocaleString("en") : v.toFixed(1).replace(/\.0$/, "");
  function segTip(sid) {
    const C = loadCalc(), ln = LD.lines[LD.segs[sid][2]], tw = segTowards(sid);
    const load = C.load[sid];
    return "<b>" + esc(segTitle(sid)) + "</b>" + (tw ? ' <span style="opacity:.7">' + esc(tw) + "</span>" : "") + "<br>" + esc(SEG_LINE_NAME[ln]) + "<br>" +
      (isNaN(load) ? "No scheduled trains in these hours" :
        "<b>" + fmt(load) + " passengers per train</b><br>" + fmt1(C.trn[sid] / C.nh) + " trains per hour &middot; " + fmt(C.pax[sid] / C.nh) + " passengers per hour");
  }
  /* real track geometry for every segment: the traced line is cut between the two stations */
  const LRT_LINES = new Set(["BP", "SE", "SW", "PE", "PW"]), LRT_COLOUR = "#4b5650";
  const FEAT_KEY = { NS: /North South/, EW: /East West/, CG: /East West/, NE: /North East/, CC: /Circle/, DT: /Downtown/, TE: /Thomson/, BP: /Bukit Panjang/, PE: /PGLRT|Punggol/, PW: /PGLRT|Punggol/, SE: /Sengkang/, SW: /Sengkang/ };
  function buildGeom() {
    const lat0 = 1.35, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const feats = OD.lines.features.map((f, fi) => ({ name: f.properties.name, colour: f.properties.colour,
      parts: lineParts[fi].parts.map(p => { const pts = p.map(c => [c[0] * kx, c[1] * ky]), cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); return { pts, cum }; }) }));
    const featOf = ln => feats.find(f => FEAT_KEY[ln] && FEAT_KEY[ln].test(f.name));
    // every place where the traced line passes within 450 m of a station (a line can pass a station twice, e.g. on a loop)
    const passes = (f, x, y) => {
      const out = [];
      f.parts.forEach((pt, pi) => {
        let cur = null;
        for (let i = 0; i < pt.pts.length - 1; i++) {
          const ax = pt.pts[i][0], ay = pt.pts[i][1], vx = pt.pts[i + 1][0] - ax, vy = pt.pts[i + 1][1] - ay, L2 = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2)), px = ax + t * vx, py = ay + t * vy, d = Math.hypot(x - px, y - py);
          if (d < 450) {
            const c = { d, pi, i, pos: pt.cum[i] + t * Math.sqrt(L2), px, py };
            if (cur && i - cur.last <= 2) { cur.last = i; if (d < cur.best.d) cur.best = c; } else { if (cur) out.push(cur.best); cur = { last: i, best: c }; }
          }
        }
        if (cur) out.push(cur.best);
      });
      return out;
    };
    const plen = p => { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return l; };
    const walk = (pt, nr, toEnd) => { const p = [[nr.px, nr.py]]; if (toEnd) { for (let i = nr.i + 1; i < pt.pts.length; i++) p.push(pt.pts[i]); } else { for (let i = nr.i; i >= 0; i--) p.push(pt.pts[i]); } return p; };
    const joinPath = (f, na, nb) => {
      if (na.pi === nb.pi) {                                   // both on the same part: take the piece between them
        const pt = f.parts[na.pi], fwd = na.pos <= nb.pos, lo = fwd ? na : nb, hi = fwd ? nb : na, pts = [[lo.px, lo.py]];
        for (let i = lo.i + 1; i <= hi.i; i++) pts.push(pt.pts[i]);
        pts.push([hi.px, hi.py]);
        const clean = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.5);
        if (clean.length < 2) return null;
        if (!fwd) clean.reverse();
        return clean;
      }
      // different parts (a branch or a loop meeting a hub): join the two parts at their nearest ends
      const A = f.parts[na.pi], B = f.parts[nb.pi];
      const oa = [[[na.px, na.py]], walk(A, na, false), walk(A, na, true)], ob = [[[nb.px, nb.py]], walk(B, nb, false), walk(B, nb, true)];
      let best = null;
      oa.forEach(pa => ob.forEach(pb => {
        const ta = pa[pa.length - 1], tb = pb[pb.length - 1], jump = Math.hypot(ta[0] - tb[0], ta[1] - tb[1]), len = plen(pa) + jump + plen(pb);
        if (jump <= 400 && (!best || len < best.len)) best = { len, pts: pa.concat(pb.slice().reverse()) };
      }));
      return best ? best.pts : null;
    };
    const geom = [], colour = [], bad = [];
    LD.segs.forEach((sg, s) => {
      const ln = LD.lines[sg[2]], f = featOf(ln); colour[s] = LRT_LINES.has(ln) ? LRT_COLOUR : (f ? f.colour : "#748477");
      const a = ST[sg[0]], b = ST[sg[1]]; let g = null;
      if (f) {
        const pa = passes(f, a.lng * kx, a.lat * ky), pb = passes(f, b.lng * kx, b.lat * ky);
        const straight = Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * ky);
        let best = null;
        pa.forEach(na => pb.forEach(nb => { const p = joinPath(f, na, nb); if (p) { const l = plen(p) + na.d + nb.d; if (!best || l < best.l) best = { l, p }; } }));
        if (best && plen(best.p) <= straight * 2.2 + 250) g = best.p.map(p => [p[0] / kx, p[1] / ky]);
      }
      if (!g) { bad.push(s); g = [[a.lng, a.lat], [b.lng, b.lat]]; }
      geom[s] = g;
    });
    /* loops (Bukit Panjang, Sengkang, Punggol): the track passes the hub twice, so the loop is cut in the order trains visit the stations */
    const stOf = (pre, k) => { const re = new RegExp("(^|/)" + pre + k + "(/|$)"); return ST.findIndex(s => re.test(s.code)); };
    const SPt = i => [ST[i].lng * kx, ST[i].lat * ky];
    const cumOf = p => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; };
    const candsOf = (p, c, pt, R) => {
      const out = [];
      for (let i = 1; i < p.length; i++) {
        const ax = p[i - 1][0], ay = p[i - 1][1], dx = p[i][0] - ax, dy = p[i][1] - ay;
        const t = Math.max(0, Math.min(1, ((pt[0] - ax) * dx + (pt[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
        const d = Math.hypot(pt[0] - ax - t * dx, pt[1] - ay - t * dy);
        if (d <= R) out.push({ s: c[i - 1] + t * (c[i] - c[i - 1]), d });
      }
      return out;
    };
    const snapSeq = (p, seq) => {                      // one position along the path per station, always moving forward
      const c = cumOf(p), C = seq.map(i => candsOf(p, c, SPt(i), 150));
      if (C.some(x => !x.length)) return null;
      let prev = C[0].map(x => ({ s: x.s, cost: x.d, bk: -1 })); const lay = [prev];
      for (let k = 1; k < C.length; k++) {
        const cur = C[k].map(x => { let best = null; prev.forEach((y, j) => { if (x.s > y.s + 30) { const cost = y.cost + x.d; if (!best || cost < best.cost) best = { s: x.s, cost, bk: j }; } }); return best; }).filter(Boolean);
        if (!cur.length) return null; lay.push(cur); prev = cur;
      }
      let j = 0, bc = 1e18; prev.forEach((y, i) => { if (y.cost < bc) { bc = y.cost; j = i; } });
      const pos = []; for (let k = lay.length - 1; k >= 0; k--) { pos[k] = lay[k][j].s; j = lay[k][j].bk; }
      return { pos, c, cost: bc };
    };
    const cutPath = (p, c, s0, s1) => {
      const at = s => { for (let i = 1; i < p.length; i++) if (s <= c[i]) { const t = (s - c[i - 1]) / ((c[i] - c[i - 1]) || 1); return [p[i - 1][0] + t * (p[i][0] - p[i - 1][0]), p[i - 1][1] + t * (p[i][1] - p[i - 1][1])]; } return p[p.length - 1]; };
      const out = [at(s0)]; for (let i = 0; i < p.length; i++) if (c[i] > s0 && c[i] < s1) out.push(p[i]); out.push(at(s1));
      return out.filter((q, i) => i === 0 || Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]) > 0.5);
    };
    const pieces = new Map(), loopFail = [];
    const stationsOf = pre => { const a = []; for (let k = 1; k < 40; k++) { const i = stOf(pre, k); if (i >= 0) a.push(i); else if (k > 1 && stOf(pre, k + 1) < 0) break; } return a; };
    const addPieces = (ln, seq, path) => {
      const r = snapSeq(path, seq); if (!r) { loopFail.push(ln); return; }
      for (let k = 1; k < seq.length; k++) pieces.set(ln + "|" + seq[k - 1] + "|" + seq[k], cutPath(path, r.c, r.pos[k - 1], r.pos[k]));
    };
    {   // Bukit Panjang: one trace runs Choa Chu Kang - BP6 - loop and ends where the loop rejoins the main line, about 300 m past BP6
      const f = featOf("BP"), li = LD.lines.indexOf("BP");
      if (f && li >= 0) {
        const p = f.parts[0].pts, c = cumOf(p), e = p[p.length - 1]; let bs = null;
        for (let i = 1; i < p.length && c[i] < 3500; i++) {
          const ax = p[i - 1][0], ay = p[i - 1][1], dx = p[i][0] - ax, dy = p[i][1] - ay;
          const t = Math.max(0, Math.min(1, ((e[0] - ax) * dx + (e[1] - ay) * dy) / (dx * dx + dy * dy || 1))), q = [ax + t * dx, ay + t * dy], d = Math.hypot(e[0] - q[0], e[1] - q[1]);
          if (!bs || d < bs.d) bs = { d, i, q };
        }
        const seq = stationsOf("BP"), b6 = stOf("BP", 6);
        if (bs && bs.d < 60 && b6 >= 0) {
          seq.push(b6); const back = [bs.q];
          for (let i = bs.i - 1; i >= 0 && Math.hypot(p[i][0] - bs.q[0], p[i][1] - bs.q[1]) < 700; i--) back.push(p[i]);
          addPieces(li, seq, p.concat(back));
        } else loopFail.push(li);
      }
    }
    [["SE", /(^|\/)STC$/], ["SW", /(^|\/)STC$/], ["PE", /(^|\/)PTC$/], ["PW", /(^|\/)PTC$/]].forEach(([ln, hubRe]) => {
      const f = featOf(ln), li = LD.lines.indexOf(ln), hub = ST.findIndex(s => hubRe.test(s.code)); if (!f || li < 0 || hub < 0) return;
      const seq = [hub].concat(stationsOf(ln), [hub]), ps = f.parts.map(x => x.pts), trunk = ps[0], hp = SPt(hub);
      let iH = 0, bd = 1e18; trunk.forEach((q, i) => { const d = Math.hypot(q[0] - hp[0], q[1] - hp[1]); if (d < bd) { bd = d; iH = i; } });
      let best = null;
      ps.slice(1).forEach(lp => [false, true].forEach(rev => [false, true].forEach(flipT => {
        const loop = rev ? lp.slice().reverse() : lp, t = flipT ? trunk.slice().reverse() : trunk, h = flipT ? t.length - 1 - iH : iH;
        const gA = Math.hypot(t[t.length - 1][0] - loop[0][0], t[t.length - 1][1] - loop[0][1]), gB = Math.hypot(loop[loop.length - 1][0] - t[0][0], loop[loop.length - 1][1] - t[0][1]);
        if (gA > 60 || gB > 60) return;
        const path = t.slice(h).concat(loop, t.slice(0, h + 1)), r = snapSeq(path, seq);
        if (r && (!best || r.cost < best.cost)) best = { cost: r.cost, path };
      })));
      if (best) addPieces(li, seq, best.path); else loopFail.push(li);
    });
    LD.segs.forEach((sg, s) => {
      let g = pieces.get(sg[2] + "|" + sg[0] + "|" + sg[1]);
      if (!g) { g = pieces.get(sg[2] + "|" + sg[1] + "|" + sg[0]); if (g) g = g.slice().reverse(); }
      if (g) geom[s] = g.map(q => [q[0] / kx, q[1] / ky]);
    });
    /* line ends: the traced track stops a little short of these terminal stations, so extend it up to the station */
    [["EW33", "EW"], ["EW1", "EW"], ["NS28", "NS"], ["CC30", "CC"], ["NS4/BP1", "BP"]].forEach(([code, ln]) => {
      const i = ST.findIndex(s => s.code === code), li = LD.lines.indexOf(ln); if (i < 0 || li < 0) return;
      LD.segs.forEach((sg, s) => {
        if (sg[2] !== li) return;
        const g = geom[s], dm = q => Math.hypot((q[0] - ST[i].lng) * kx, (q[1] - ST[i].lat) * ky);
        if (sg[0] === i && dm(g[0]) > 3 && dm(g[0]) <= 260) g.unshift([ST[i].lng, ST[i].lat]);
        if (sg[1] === i && dm(g[g.length - 1]) > 3 && dm(g[g.length - 1]) <= 260) g.push([ST[i].lng, ST[i].lat]);
      });
    });
    /* check every segment: it must cover most of the way between its two stations and start and end at them (interchanges have platforms apart) */
    const geomBad = [];
    LD.segs.forEach((sg, s) => {
      const g = geom[s], a = ST[sg[0]], b = ST[sg[1]], straight = Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * ky);
      let len = 0; for (let i = 1; i < g.length; i++) len += Math.hypot((g[i][0] - g[i - 1][0]) * kx, (g[i][1] - g[i - 1][1]) * ky);
      const e0 = Math.hypot((g[0][0] - a.lng) * kx, (g[0][1] - a.lat) * ky), e1 = Math.hypot((g[g.length - 1][0] - b.lng) * kx, (g[g.length - 1][1] - b.lat) * ky);
      const tol = c => (c.indexOf("/") >= 0 || c === "EW4") ? 350 : 60;
      if (len < 0.6 * straight || e0 > tol(a.code) || e1 > tol(b.code)) geomBad.push({ s, a: a.code, b: b.code, len: Math.round(len), straight: Math.round(straight), e0: Math.round(e0), e1: Math.round(e1) });
    });
    LD.geom = geom; LD.colour = colour; LD.fallback = bad; LD.geomBad = geomBad; LD.loopFail = loopFail;
    if (geomBad.length || loopFail.length || bad.length) console.warn("track geometry check", { geomBad, loopFail, fallback: bad.length });
  }
  function offsetLine(p, d) {
    const n = p.length; if (n < 2 || !d) return p;
    const nm = []; for (let i = 0; i < n - 1; i++) { const dx = p[i + 1][0] - p[i][0], dy = p[i + 1][1] - p[i][1], l = Math.hypot(dx, dy) || 1; nm.push([-dy / l, dx / l]); }
    return p.map((pt, i) => {
      const n0 = nm[Math.max(0, i - 1)], n1 = nm[Math.min(n - 2, i)];
      let nx = n0[0] + n1[0], ny = n0[1] + n1[1]; const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const k = Math.max(0.55, nx * n1[0] + ny * n1[1]);
      return [pt[0] + nx * d / k, pt[1] + ny * d / k];
    });
  }
  const lineColour = li => { const i = LD.segs.findIndex(s => s[2] === li); return i >= 0 ? LD.colour[i] : "#748477"; };
  let ldHover = -1, ldHits = [];
  function drawLoad(ctx, m) {
    // rail geometry underneath, faint
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    lineParts.forEach(lp => {
      ctx.strokeStyle = lp.colour; ctx.globalAlpha = Math.max(S.railOpa, lp.kind === "mrt" ? 0.22 : 0.18); ctx.lineWidth = (lp.kind === "mrt" ? 3 : 1.8) * S.railScale;
      lp.parts.forEach(part => { ctx.beginPath(); part.forEach((c, i) => { const p = m.project(c[1], c[0]); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }); ctx.stroke(); });
    });
    ctx.globalAlpha = 1;
    ldHits = [];
    if (!LD) return;
    const C = loadCalc(), P = ST.map(s => m.project(s.lat, s.lng)), ns = LD.segs.length, sc = S.lineScale;
    const OFF = 5.5 * sc, STEP = 22 * sc;
    // lines that share the same two stations (for example NS and EW in the centre) get their own pair of lanes
    if (!LD.groups) {
      const g = new Map();
      LD.segs.forEach((s, i) => { const k = Math.min(s[0], s[1]) + "|" + Math.max(s[0], s[1]); if (!g.has(k)) g.set(k, new Set()); g.get(k).add(s[2]); });
      LD.groups = LD.segs.map(s => { const k = Math.min(s[0], s[1]) + "|" + Math.max(s[0], s[1]); const arr = [...g.get(k)].sort((a, b) => a - b); return [arr.indexOf(s[2]), arr.length]; });
    }
    const order = [];
    for (let s = 0; s < ns; s++) order.push(s);
    order.sort((a, b) => (segActive(a) - segActive(b)) || ((C.load[a] || 0) - (C.load[b] || 0)));   // greyed lines first, the chosen line on top
    const drawSeg = (s, extra) => {
      if (!segActive(s)) return;                      // lines that are not selected stay as the faint track underneath, with no load
      const [a, b, li] = LD.segs[s], [k, K] = LD.groups[s];
      let pts = (LD.geom[s] || [[ST[a].lng, ST[a].lat], [ST[b].lng, ST[b].lat]]).map(c => m.project(c[1], c[0]));
      pts = offsetLine(pts, -(OFF + (a < b ? 1 : -1) * (k - (K - 1) / 2) * STEP));   // trains keep to the left, so each lane sits on the left of its direction of travel
      const ld = C.load[s], wdt = isNaN(ld) ? 1 : Math.max(1.1, (1 + 9.5 * Math.min(1.25, ld / C.scale)) * sc);
      const path = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); };
      ctx.lineCap = "butt"; ctx.lineJoin = "round";
      if (extra) { ctx.strokeStyle = css("--ink"); ctx.globalAlpha = 1; ctx.lineWidth = wdt + 4; path(); }
      const act = segActive(s), lrt = LRT_LINES.has(LD.lines[li]);
      ctx.strokeStyle = LD.colour[s];
      ctx.globalAlpha = Math.max(S.loadOpa, isNaN(ld) || ld === 0 ? 0.35 : (lrt ? 0.68 : 0.5) + 0.3 * Math.min(1, ld / C.scale));   // the opacity setting only raises it
      ctx.lineWidth = wdt; path(); ctx.globalAlpha = 1;
      ldHits.push({ s, pts, r: Math.max(wdt / 2, 3) });
    };
    order.forEach(s => drawSeg(s, false));
    [S.ldSel, ldHover].forEach(s => { if (s != null && s >= 0) drawSeg(s, true); });
    // stations
    const onLine = new Set(); LD.segs.forEach((sg, s) => { if (segActive(s)) { onLine.add(sg[0]); onLine.add(sg[1]); } });
    ctx.fillStyle = css("--ink2");
    ST.forEach((s, i) => { ctx.globalAlpha = onLine.has(i) ? 0.9 : 0.12; ctx.beginPath(); ctx.arc(P[i][0], P[i][1], 2.6 * S.dotScale, 0, 6.2832); ctx.fill(); });
    ctx.globalAlpha = 1;
    // labels: ends of the busiest segments, the hovered or selected one, and every station when zoomed in
    const labels = [], seen = new Set(), add = (i, bold) => { if (seen.has(i) || !onLine.has(i)) return; seen.add(i); labels.push({ i, x: P[i][0] + 7, y: P[i][1] - 6, bold }); };
    [ldHover, S.ldSel].forEach(s => { if (s != null && s >= 0) { add(LD.segs[s][0], true); add(LD.segs[s][1], true); } });
    order.filter(segActive).slice(-8).reverse().forEach(s => { add(LD.segs[s][0]); add(LD.segs[s][1]); });
    if (m.view.z >= (S.ldLine === "all" ? 14.2 : 12.5)) for (let i = 0; i < N; i++) add(i);   // a selected line gets all its station names from zoom 12.5
    const placed = [];
    labels.forEach(l => {
      const t = stName(l.i); ctx.font = (l.bold ? "700 " : "400 ") + "12px " + FONT;
      const w = ctx.measureText(t).width, box = [l.x, l.y - 11, l.x + w, l.y + 3];
      if (!l.bold && placed.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) return;
      placed.push(box); ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 3; ctx.lineJoin = "round"; ctx.strokeStyle = css("--card"); ctx.strokeText(t, l.x, l.y);
      ctx.fillStyle = css("--ink"); ctx.fillText(t, l.x, l.y);
    });
  }
  function segAt(x, y) {
    let best = -1, bd = 1e9;
    ldHits.forEach(h2 => {
      for (let i = 0; i < h2.pts.length - 1; i++) {
        const x1 = h2.pts[i][0], y1 = h2.pts[i][1], vx = h2.pts[i + 1][0] - x1, vy = h2.pts[i + 1][1] - y1, L2 = vx * vx + vy * vy || 1;
        const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / L2));
        const d = Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy)) - h2.r;
        if (d <= 3 && d < bd) { bd = d; best = h2.s; }
      }
    });
    return best;
  }
  function loadHover(x, y) {
    if (!LD) return;
    const s = segAt(x, y);
    if (s !== ldHover) { ldHover = s; map.requestRender(); }
    $("#cv").classList.toggle("hit", s >= 0);
    if (s >= 0) showTip(x, y, segTip(s)); else $("#tip").hidden = true;
  }
  function loadClick(x, y) {
    const s = segAt(x, y); S.ldSel = s >= 0 && s !== S.ldSel ? s : null;
    renderLoadRank(); renderLoadChart(); map.requestRender();
  }
  function visiblePad() {   // part of the map not covered by the right column or the open chart panel
    const cr = $("#cv").getBoundingClientRect(), rt = $("#rt").getBoundingClientRect(), lp = $("#lp");
    const right = rt.width ? Math.max(30, cr.right - rt.left + 12) : 30;
    let bottom = 46;
    if (lp && !lp.hidden && !$("#lpBody").hidden) bottom = Math.max(bottom, cr.bottom - lp.getBoundingClientRect().top + 12);
    return { top: 70, left: 30, right: Math.min(right, cr.width * 0.6), bottom: Math.min(bottom, cr.height * 0.6) };
  }
  function zoomToSeg(s) {
    const g = LD.geom[s], lats = g.map(c => c[1]), lngs = g.map(c => c[0]), padDeg = 0.0015;
    map.fitBoundsIn([Math.min(...lats) - padDeg, Math.min(...lngs) - padDeg, Math.max(...lats) + padDeg, Math.max(...lngs) + padDeg], visiblePad(), 15.6);
  }
  function selectSeg(s) {          // click on a bar or a row: select and zoom, click again to clear and zoom out
    if (S.ldSel === s) return clearLoadSel();
    S.ldSel = s; zoomToSeg(s); renderLoadRank(); renderLoadChart(); map.requestRender();
  }
  function clearLoadSel() {
    S.ldSel = null; map.fitBoundsIn(CFG.bounds, visiblePad(), 30);
    renderLoadRank(); renderLoadChart(); map.requestRender();
  }
  function buildLoadControls() {
    const box = $("#ctlBody"); box.replaceChildren();
    if (!LD) { box.append(h("p", { class: "note" }, "The load data file could not be found.")); return; }
    const after = () => renderLoadAll();
    box.append(
      h("div", { class: "two" }, gMonth(after), lineGroup()),
      gDay(after), gHours(after),
      gSeg("Show top segments", [[10, "10"], [20, "20"], [25, "25"], ["all", "All"]], () => S.ldTop, v => { S.ldTop = v; renderLoadRank(); }, true));
  }
  function renderLoadAll() {
    if (!LD) return;
    updateSummary(); renderLoadRank(); renderLoadChart(); map.requestRender();
  }
  function renderLoadRank() {
    const sc = $("#sc");
    if (S.view !== "load" || !LD) { sc.hidden = true; $("#rkGrip").hidden = true; return; }
    sc.hidden = false; $("#rkGrip").hidden = false; sc.replaceChildren();
    const C = loadCalc(), col = colOutNow();
    let ids = []; for (let s = 0; s < LD.segs.length; s++) if (segActive(s) && C.load[s] > 0) ids.push(s);
    ids.sort((a, b) => C.load[b] - C.load[a] || a - b);
    const total = ids.length; if (S.ldTop !== "all") ids = ids.slice(0, S.ldTop);
    const open = S.ldRankOpen;
    sc.classList.toggle("min", !open); sc.style.flex = open ? (S.listH ? "0 0 " + S.listH + "px" : "") : "0 0 auto"; $("#rkGrip").hidden = !open;
    sc.append(h("div", { class: "rkh ldh" }, h("h2", null, "Busiest segments"),
      h("span", { class: "rkb" },
        S.ldSel != null ? h("button", { class: "btn", type: "button", "aria-label": "Clear the selected segment and zoom out", onclick: clearLoadSel }, "Clear") : null,
        h("button", { class: "hbtn", type: "button", "aria-expanded": String(open), "aria-label": "Show or hide the list", onclick: () => { S.ldRankOpen = !S.ldRankOpen; renderLoadRank(); } }, h("span", { class: "car" }, "\u25be")))));
    if (!open) return;
    sc.append(h("p", { class: "sub" }, "Average passengers per train, " + hoursText() + ". Right column: trains per hour, averaged over the selected hours. " + ids.length + " of " + total + " segments."));
    const max = ids.length ? C.load[ids[0]] : 1;
    ids.forEach((s, k) => {
      const tw = segTowards(s);
      sc.append(h("button", { class: "rk" + (S.ldSel === s ? " sel" : ""), type: "button", title: segTitle(s) + (tw ? ", " + tw : "") + " (" + SEG_LINE_NAME[LD.lines[LD.segs[s][2]]] + ")",
        onclick: () => selectSeg(s) },
        h("span", { class: "n" }, String(k + 1)),
        h("span", { class: "nm" }, segTitle(s), h("i", { class: "bar1", style: "width:" + Math.max(2, 100 * C.load[s] / max) + "%;background:" + LD.colour[s] })),
        h("span", { class: "v" }, fmt(C.load[s])), h("span", { class: "p" }, fmt1(C.trn[s] / C.nh))));
    });
  }
  const segCode = (st, ln) => {      // the station code that belongs to this line, e.g. EW24 for EW24/NS1
    const parts = ST[st].code.split("/"), pre = ln === "CG" ? "CG" : ln;
    return parts.find(p => new RegExp("^" + pre + "\\d").test(p)) || parts.find(p => /^(STC|PTC)$/.test(p)) || parts[0];
  };
  function renderLoadChart() {
    const body = $("#lpBody"); if (!body || !LD || S.view !== "load") return;
    if (body.hidden) { $("#lp").style.width = ""; return; }
    body.replaceChildren();
    const C = loadCalc(), lp = $("#lp"), ln = S.ldLine, avail = Math.max(340, $("#cv").parentElement.clientWidth - $("#rt").getBoundingClientRect().width - 48);
    // legend: line widths for sample loads
    const sc = C.scale, sample = [0.25, 0.5, 1].map(f => Math.round(sc * f / 50) * 50 || Math.round(sc * f));
    const lg = h("div", { class: "lpl" }, h("span", null, "Line width on the map = passengers per train:"),
      sample.map(v => h("span", { class: "lpw" }, h("i", { style: "height:" + (1 + 9.5 * Math.min(1.25, v / sc)) * S.lineScale + "px;background:#52606d" }), fmt(v))));
    const noteBtn = h("button", { class: "btn sm lpi", type: "button", "aria-expanded": String(S.ldNote), "aria-label": "About this chart", title: "About this chart", onclick: () => { S.ldNote = !S.ldNote; renderLoadChart(); } }, "i");
    const members = ldMembers(ln), lis = members.map(m => LD.lines.indexOf(m)), li = lis[0], grp = members.length > 1;
    if (ln === "all" || lis.some(x => x < 0)) {
      lp.style.width = Math.min(avail, 460) + "px";
      body.append(h("div", { class: "lpc" }, lineGroup(), noteBtn), h("p", { class: "note" }, "Choose a line to see its passengers per train station by station. The map then shows that line and greys the others."), lg);
      if (S.ldNote) body.append(h("p", { class: "note lpn" }, NOTE_TXT));
      return;
    }
    const t = ldTerm()[li], loopy = grp || LOOPY.has(ln) || !t;
    const dirs = h("div", { class: "seg sm", role: "group", "aria-label": "Direction" });
    [[1, loopy ? "In order of station codes" : "Towards " + (t ? ST[t.last].name : "")], [0, loopy ? "The other way round" : "Towards " + (t ? ST[t.first].name : "")]].forEach(o =>
      dirs.append(h("button", { type: "button", "aria-pressed": String(S.ldFwd === o[0]), onclick: () => { S.ldFwd = o[0]; renderLoadChart(); } }, o[1])));
    body.append(h("div", { class: "lpc" }, lineGroup(), group("Direction", dirs), noteBtn), lg);
    const partIds = lis.map(pl => { const a = []; for (let s = 0; s < LD.segs.length; s++) if (LD.segs[s][2] === pl && LD.segs[s][4] === S.ldFwd) a.push(s); a.sort((x, y) => S.ldFwd ? LD.segs[x][3] - LD.segs[y][3] : LD.segs[y][3] - LD.segs[x][3]); return a; });
    const ids = [].concat(...partIds), partOf = []; partIds.forEach((a, k) => a.forEach(() => partOf.push(k)));
    const GAP = grp ? 14 : 0, TOPL = grp ? 14 : 0;
    const vals = ids.map(s => isNaN(C.load[s]) ? 0 : C.load[s]), top = Math.max(1, ...vals);
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(top))); return [1, 1.5, 2, 3, 5, 10].map(f => f * p).find(v => v >= top) || top; })();
    const n = Math.max(1, ids.length), padL = 44, padT = 8 + TOPL, plotH = 70, labH = 40;
    const panelW = Math.min(avail, Math.max(420, n * 26 + (lis.length - 1) * GAP + padL + 36)), W = panelW - 32, bw = Math.max(18, (W - padL - 8 - (lis.length - 1) * GAP) / n), H = padT + plotH + labH;
    const xAt = i => padL + i * bw + partOf[i] * GAP, totalW = n * bw + (lis.length - 1) * GAP;
    lp.style.width = panelW + "px";
    const barCol = LD.colour[LD.segs.findIndex(s2 => s2[2] === li)] || "#748477";
    const NS_ = "http://www.w3.org/2000/svg", el = (tag, at, txt) => { const e = document.createElementNS(NS_, tag); for (const k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; return e; };
    const svg = el("svg", { width: Math.ceil(padL + totalW + 8), height: H, role: "img", "aria-label": "Passengers per train between consecutive stations on the " + ldName(ln) + " line" });
    [0, 0.5, 1].forEach(f => {
      const y = padT + plotH * (1 - f);
      svg.append(el("line", { x1: padL - 4, x2: padL + totalW + 4, y1: y, y2: y, stroke: "#d9e0e6", "stroke-width": 1 }),
        el("text", { x: padL - 8, y: y + 4, "text-anchor": "end", "font-size": 11, fill: "#52606d" }, fmt(nice * f)));
    });
    if (grp) { let st = 0; partIds.forEach((a, k) => { if (a.length) { svg.append(el("text", { x: xAt(st), y: 11, "font-size": 11, "font-weight": 600, fill: "#52606d" }, PART_NAME[members[k]])); if (k > 0) svg.append(el("line", { x1: xAt(st) - GAP / 2, x2: xAt(st) - GAP / 2, y1: 2, y2: padT + plotH + labH - 4, stroke: "#c3ccd4", "stroke-width": 1, "stroke-dasharray": "3 3" })); } st += a.length; }); }
    ids.forEach((s, i) => {
      const v = vals[i], bh = plotH * v / nice, x0 = xAt(i), x = x0 + bw * 0.14, g = el("g", { style: "cursor:pointer" });
      const tw = segTowards(s);
      g.append(el("title", {}, segTitle(s) + (tw ? " (" + tw + ")" : "") + ": " + (isNaN(C.load[s]) ? "no scheduled trains" : fmt(v) + " passengers per train, " + fmt1(C.trn[s] / C.nh) + " trains per hour")),
        el("rect", { x: x0, y: padT, width: bw, height: plotH + labH, fill: "transparent" }),
        el("rect", { x, y: padT + plotH - bh, width: bw * 0.72, height: Math.max(bh, 0.5), rx: 2, fill: barCol, opacity: S.ldSel === s ? 1 : 0.82, stroke: S.ldSel === s ? "#13202b" : "none", "stroke-width": 2 }));
      const tx = x + bw * 0.36, ty = padT + plotH + 6;
      g.append(el("text", { x: tx + 4, y: ty, "text-anchor": "end", "font-size": 10.5, fill: "#13202b", transform: "rotate(-90 " + (tx + 4) + " " + ty + ")" }, segCode(LD.segs[s][0], members[partOf[i]])));
      g.addEventListener("click", () => selectSeg(s));
      g.addEventListener("mouseenter", () => { ldHover = s; map.requestRender(); });
      g.addEventListener("mouseleave", () => { ldHover = -1; map.requestRender(); });
      svg.append(g);
    });
    body.append(h("div", { class: "lps" }, svg));
    if (S.ldNote) body.append(h("p", { class: "note lpn" }, NOTE_TXT + " The last bar ends at " + (ids.length ? ST[LD.segs[ids[ids.length - 1]][1]].name : "") + "."));
  }
  const NOTE_TXT = "Each bar is the stretch of track after the station whose code is under it, up to the next station. Hover a bar for the station names and numbers. Hover highlights it on the map; click zooms to it, and clicking again zooms back out. For how the numbers are made, see Methodology at the top left.";
  /* ---------- views, info, errors ---------- */
  function setView(v) {
    S.view = v; $("#app").dataset.view = v;
    [].forEach.call($("#views").children, b => b.setAttribute("aria-pressed", String(b.dataset.v === v)));
    const flow = v === "flow", ld = v === "load", onMap = flow || ld;
    ["#rt", "#zoom"].forEach(s => { $(s).hidden = !onMap; });
    $("#lg").hidden = !flow; $("#lp").hidden = !ld; $("#meth").hidden = !ld; if (ld) { buildMeth(); toggleMeth(false); }
    $("#scale").hidden = !onMap; $("#pv").hidden = onMap; $("#cv").style.visibility = onMap ? "visible" : "hidden"; $("#app").classList.toggle("chart", !onMap);
    hideTip();
    if (flow) { buildFlowControls(); map.resize(); renderRank(); }
    else if (ld) { buildLoadControls(); map.resize(); renderLoadAll(); }
    else { $("#sc").hidden = true; $("#rkGrip").hidden = true; buildBar(v); renderBody(); }
    updateSummary();
    if (map && lastBase !== baseKey()) applyBasemap();
  }
  function infoHTML() {
    const cr = CFG.credits, e = OD.months[S.month];
    const mans = OD.manifest.filter(m => m.accessed).slice().sort((a, b) => b.id.localeCompare(a.id)).map(m => esc2(dmy(m.accessed)) + " (" + esc2(m.label) + " data)");
    const acc = mans.length > 1 ? mans.slice(0, -1).join(", ") + " and " + mans[mans.length - 1] : (mans[0] || "date not recorded");
    const provs = CFG.basemap.providers;
    const bmTxt = Object.keys(provs).filter(k => provs[k].attribution).map(k => "<b>" + esc2(provs[k].label) + ":</b> " + provs[k].attribution).join("<br>");
    return "<h2>Data, method and credits</h2>" +
      "<p>Trips between pairs of MRT and LRT stations by hour of day and day type, from " + lnk(cr.dataMallUrl, "LTA DataMall") + " (" + esc2(cr.dataset) + "). Monthly totals are divided by the number of days of each type to give average trips per day. The 23:00 hour includes trips after midnight, so the data has no hour before 05:00 and the last hour is shown as 23:00 to 24:00.</p>" +
      (e ? "<p>Days counted in " + esc2(e.label) + ": " + e.days[0] + " weekdays and " + e.days[1] + " weekend / holiday days.</p>" : "") +
      "<p>Contains information from " + esc2(cr.dataset) + ", accessed on " + acc + ", and from " + esc2(cr.gtfsName) + (cr.gtfsAccessed ? ", accessed on " + esc2(dmy(cr.gtfsAccessed)) : "") + ", from " + lnk(cr.dataMallUrl, "LTA DataMall") + ", which is made available under the terms of the " + lnk(cr.ltaLicenceUrl, esc2(cr.ltaLicenceName)) + ".</p>" +
      "<p><b>Passenger load between stations.</b> The method is described under Methodology of Passenger load between stations, at the top left of that view.</p>" +
      "<p>Rail lines were traced using the original " + lnk(cr.uraUrl, "Master Plan 2019 Rail Line layer") + ", Urban Redevelopment Authority (URA), accessed from data.gov.sg and made available under the " + lnk(cr.dataGovLicenceUrl, esc2(cr.ltaLicenceName)) + ". Station locations were compiled by the author with the help of Claude AI. The MRT and LRT lines and stations shown on the map are indicative only.</p>" +
      "<p><b>Basemaps</b> (the map tiles you can choose in Settings)<br>" + bmTxt + "</p>" +
      "<p><b>Disclaimer:</b> Independent student project. Not affiliated with or endorsed by LTA.</p>" +
      "<h2>About</h2>" +
      "<p>Built by " + lnk(cr.linkedin, esc2(cr.author)) + ", a Master's student in Rail and Urban Transport at TUM Asia, to explore Singapore's urban rail ridership data. Spotted a mistake? Message me on " + lnk(cr.linkedin, "LinkedIn") + ".</p>" +
      "<p>The dashboard code is open source under the MIT licence. The LTA, URA and OpenStreetMap data stay under their own licences.</p>";
  }
  function buildMeth() {
    const b = $("#methBody"); if (b.childElementCount) return;
    const part = (t, x) => h("p", null, h("b", null, t + ". "), x);
    b.append(
      part("Routing", "Each trip is routed along its fewest-stops path, with a transfer penalty of " + OD.defaultPenalty + " stops. Where two routes tie exactly, the trip is shared equally between them."),
      part("Passengers on a segment", "A segment is the stretch between two neighbouring stations in one direction. Its passengers are everyone whose trip passes through that stretch, counted in the hour they start their trip. For example, a trip from NS17 to NS21 counts once on each segment between them: NS17 \u2192 NS18, NS18 \u2192 NS19, NS19 \u2192 NS20 and NS20 \u2192 NS21."),
      part("Trains per hour", "Counted from the planned timetable in " + CFG.credits.gtfsName + ". For weekend and holiday days, the Saturday and the Sunday/public holiday timetables are blended by the number of such days in the month."),
      part("Load per train", "Passengers divided by trains for the chosen hours. It is a modelled average and not a count of people on one particular train."),
      part("Tied routes", "Where two lines give exactly the same route, for example between City Hall and Raffles Place or between Bayfront and Promenade, the trips are split equally between them, and each line is drawn in its own lane, because the data does not show which train people took."));
  }
  function toggleMeth(open) {
    const m = $("#meth"), btn = $("#methBtn"), body = $("#methBody");
    if (open === undefined) open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open)); body.hidden = !open;
    m.style.width = open ? $("#title").offsetWidth + "px" : "";
  }
  function buildInfo() { $("#info").innerHTML = infoHTML(); }
  function showError(e) { const b = $("#err"); b.className = "ov"; b.hidden = false; b.textContent = e && e.message ? e.message : String(e); }

  /* ---------- start ---------- */
  async function start() {
    $("#h1").textContent = CFG.title; $("#methBtn").addEventListener("click", () => toggleMeth());
    const msg = $("#err"); msg.className = "ov"; msg.hidden = false; msg.textContent = "Loading data…";
    try {
      S.month = OD.manifest[OD.manifest.length - 1].id;
      await Promise.all([ensureMonth(S.month), loadRoutes(), loadLoad()]);
    } catch (e) { showError(e); return; }
    msg.hidden = true;
    prepLines(); if (LD) buildGeom();
    map = new TileMap($("#cv"), { minZoom: 10, maxZoom: 17.5, onRender: drawMap, onHover, onLeave: hideTip, onClick: onMapClick });
    map.fitBounds(CFG.bounds, 30);
    loadPrefs(); if (!CFG.basemap.providers[S.basemap]) S.basemap = CFG.basemap.default;
    applyBasemap(); buildSettings(); buildInfo(); initGrips();
    $("#zin").onclick = () => map.zoomBy(0.8); $("#zout").onclick = () => map.zoomBy(-0.8); $("#zreset").onclick = () => map.fitBounds(CFG.bounds, 30);
    [["ctlBtn", "ctlBody"], ["setBtn", "setBody"], ["lgBtn", "lgBody"], ["lpBtn", "lpBody"]].forEach(p => {
      const b = $("#" + p[0]), c = $("#" + p[1]);
      b.onclick = () => { const open = b.getAttribute("aria-expanded") === "true"; b.setAttribute("aria-expanded", String(!open)); c.hidden = open; };
    });
    legend();
    $("#lpBtn").addEventListener("click", () => setTimeout(renderLoadChart, 0));
    $("#infoBtn").onclick = () => { const o = $("#info").hidden; $("#info").hidden = !o; $("#infoBtn").setAttribute("aria-expanded", String(o)); buildInfo(); };
    [].forEach.call($("#views").children, b => { b.onclick = () => setView(b.dataset.v); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!$("#info").hidden) $("#infoBtn").click(); else if (!$("#meth").hidden && $("#methBtn").getAttribute("aria-expanded") === "true") toggleMeth(false); else if (S.view === "flow" && S.station != null) selectStation(null); } });
    window.addEventListener("resize", () => { if (S.view === "wk") renderWk(); if (S.view === "load") renderLoadChart(); });
    buildFlowControls(); computeFlow(); updateSummary(); renderRank();
    if (window.innerWidth < 760) $("#ctlBtn").click();
    window.__od = { S, stName, setPanelW, setListH, Core, getMat, routes, cubes, setView, selectStation, computeFlow, get F() { return F; }, ST, nDays, map, get LD() { return LD; }, loadCalc: () => loadCalc(), selectSeg, clearLoadSel, visiblePad };
  }
  start();
})();
