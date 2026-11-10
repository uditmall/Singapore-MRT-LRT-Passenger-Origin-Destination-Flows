/* OD dashboard calculation core: pure functions, no DOM. Works in browser and Node. */
(function (root) {
  const NH = 19; // hours 5..23 (hour 0 folded into 23)

  // cube layout: [day 2][hour 19][origin N][destination N], uint16 monthly totals
  function sumHours(cube, N, day, h0, h1) {
    const out = new Float64Array(N * N);
    const NN = N * N;
    for (let h = h0; h <= h1; h++) {
      const base = (day * NH + h) * NN;
      for (let i = 0; i < NN; i++) out[i] += cube[base + i];
    }
    return out;
  }

  function flowFrom(mat, N, station, dir) {
    const out = new Float64Array(N);
    for (let j = 0; j < N; j++) out[j] = dir === "out" ? mat[station * N + j] : mat[j * N + station];
    out[station] = 0;
    return out;
  }

  function topK(values, k, skip) {
    const idx = [];
    for (let i = 0; i < values.length; i++) if (values[i] > 0 && i !== skip) idx.push(i);
    idx.sort((a, b) => values[b] - values[a] || a - b);
    return idx.slice(0, k === "all" ? idx.length : k);
  }

  function stationTotals(mat, N, dir) {
    const t = new Float64Array(N);
    for (let o = 0; o < N; o++)
      for (let d = 0; d < N; d++) {
        const v = mat[o * N + d];
        if (dir === "out") t[o] += v; else t[d] += v;
      }
    return t;
  }

  function onLine(station, line) {
    return line === "all" || station.lines.indexOf(line) >= 0;
  }

  // mode: "combined" (a->b plus b->a) or "larger" (bigger single direction)
  function corridors(mat, N, stations, opts) {
    const rows = [];
    for (let a = 0; a < N; a++) {
      if (!onLine(stations[a], opts.line)) continue;
      for (let b = a + 1; b < N; b++) {
        if (!onLine(stations[b], opts.line)) continue;
        const ab = mat[a * N + b], ba = mat[b * N + a];
        if (ab + ba === 0) continue;
        rows.push({ a, b, ab, ba, combined: ab + ba, larger: Math.max(ab, ba) });
      }
    }
    const key = opts.mode === "larger" ? "larger" : "combined";
    rows.sort((x, y) => y[key] - x[key] || x.a - y.a || x.b - y.b);
    return rows.slice(0, opts.k).map(r => {
      const big = r.ab >= r.ba ? [r.a, r.b, r.ab, r.ba] : [r.b, r.a, r.ba, r.ab];
      return { from: big[0], to: big[1], major: big[2], minor: big[3], combined: r.combined,
               ratio: big[3] > 0 ? big[2] / big[3] : Infinity };
    });
  }

  // routes: {pair: Uint16Array, cell: Uint8Array, w: Uint16Array} ; cell = first*7+last
  function classMatrix(mat, routes) {
    const M = new Float64Array(49);
    for (let i = 0; i < routes.pair.length; i++) {
      const t = mat[routes.pair[i]];
      if (t) M[routes.cell[i]] += t * routes.w[i] / 65535;
    }
    return M;
  }

  function rowPercent(M) {
    const P = new Float64Array(49);
    for (let r = 0; r < 7; r++) {
      let s = 0;
      for (let c = 0; c < 7; c++) s += M[r * 7 + c];
      for (let c = 0; c < 7; c++) P[r * 7 + c] = s ? 100 * M[r * 7 + c] / s : 0;
    }
    return P;
  }

  // Largest change in any cell's row-share (percentage points) and the share of trips
  // whose (first,last) cell changes, between two penalty settings.
  function sensitivity(mat, routesA, routesB) {
    const PA = rowPercent(classMatrix(mat, routesA)), PB = rowPercent(classMatrix(mat, routesB));
    let maxPP = 0, maxCell = -1;
    for (let i = 0; i < 49; i++) {
      const d = Math.abs(PA[i] - PB[i]);
      if (d > maxPP) { maxPP = d; maxCell = i; }
    }
    return { maxPP, maxCell };
  }

  function shareChanged(mat, routesA, routesB, N) {
    // fraction of trips whose assigned (first,last) cell differs, using each pair's weight vectors
    const mapA = new Map(), mapB = new Map();
    const add = (m, r) => {
      for (let i = 0; i < r.pair.length; i++) {
        let e = m.get(r.pair[i]);
        if (!e) { e = new Float64Array(49); m.set(r.pair[i], e); }
        e[r.cell[i]] += r.w[i] / 65535;
      }
    };
    add(mapA, routesA); add(mapB, routesB);
    let tot = 0, ch = 0;
    for (const [p, a] of mapA) {
      const t = mat[p];
      if (!t) continue;
      const b = mapB.get(p);
      let d = 0;
      for (let i = 0; i < 49; i++) d += Math.abs(a[i] - (b ? b[i] : 0));
      tot += t; ch += t * d / 2;
    }
    return tot ? ch / tot : 0;
  }

  // Weekday vs weekend/holiday share of arrivals (or departures) per station, in percentage points.
  // matWd / matWe are monthly totals over the same hour range; shares are within each day type
  // across the whole network, so day counts cancel out.
  function weekendShift(matWd, matWe, N, stations, opts) {
    const tWd = stationTotals(matWd, N, opts.dir), tWe = stationTotals(matWe, N, opts.dir);
    let sWd = 0, sWe = 0;
    for (let i = 0; i < N; i++) { sWd += tWd[i]; sWe += tWe[i]; }
    const rows = [];
    for (let i = 0; i < N; i++) {
      if (!onLine(stations[i], opts.line)) continue;
      const perDayWd = tWd[i] / opts.daysWd, perDayWe = tWe[i] / opts.daysWe;
      if (perDayWd < opts.minPerDay || perDayWe < opts.minPerDay) continue;
      rows.push({ station: i, shiftPP: 100 * (tWe[i] / sWe - tWd[i] / sWd),
                  shareWd: 100 * tWd[i] / sWd, shareWe: 100 * tWe[i] / sWe, perDayWd, perDayWe });
    }
    rows.sort((a, b) => b.shiftPP - a.shiftPP);
    const k = opts.k;
    return { gainers: rows.slice(0, k), losers: rows.slice(Math.max(k, rows.length - k)).sort((a, b) => a.shiftPP - b.shiftPP) };
  }

  root.ODCore = { NH, sumHours, flowFrom, topK, stationTotals, corridors, classMatrix, rowPercent,
                  sensitivity, shareChanged, weekendShift, onLine };
  if (typeof module !== "undefined") module.exports = root.ODCore;
})(typeof window !== "undefined" ? window : globalThis);
