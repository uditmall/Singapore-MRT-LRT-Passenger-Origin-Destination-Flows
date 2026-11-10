/* Minimal canvas slippy map (Web Mercator + raster tiles). No dependencies. */
(function (root) {
  function mercator(lat, lng) {
    const s = Math.sin(lat * Math.PI / 180);
    return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
  }

  function TileMap(canvas, opts) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts || {};
    this.minZ = this.opts.minZoom || 10;
    this.maxZ = this.opts.maxZoom || 17.5;
    this.view = { x: 0.5, y: 0.5, z: 11 };
    this.tileUrl = null;
    this.bg = "#e8e6df";
    this.tileAlpha = 1;
    this.cache = new Map();
    this.W = 0; this.H = 0; this.dpr = 1;
    this.raf = 0;
    this.ptrs = new Map();
    this.moved = false;
    this.bounds = null;
    const self = this;
    new ResizeObserver(() => self.resize()).observe(canvas.parentElement);
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", e => self._down(e));
    canvas.addEventListener("pointermove", e => self._move(e));
    canvas.addEventListener("pointerup", e => self._up(e));
    canvas.addEventListener("pointercancel", e => self._up(e, true));
    canvas.addEventListener("pointerleave", () => { if (self.opts.onLeave) self.opts.onLeave(); });
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      self.zoomBy(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    canvas.addEventListener("dblclick", e => {
      const r = canvas.getBoundingClientRect();
      self.zoomBy(1, e.clientX - r.left, e.clientY - r.top);
    });
    this.resize();
  }

  const P = TileMap.prototype;
  P.scale = function () { return 256 * Math.pow(2, this.view.z); };
  P.project = function (lat, lng) {
    const w = mercator(lat, lng), S = this.scale();
    return [(w[0] - this.view.x) * S + this.W / 2, (w[1] - this.view.y) * S + this.H / 2];
  };
  P.resize = function () {
    const p = this.cv.parentElement;
    this.W = p.clientWidth; this.H = p.clientHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + "px";
    this.cv.style.height = this.H + "px";
    this.render();
  };
  P.setTiles = function (fn) { this.tileUrl = fn; this.cache.clear(); this.requestRender(); };
  P.fitBounds = function (b, pad) {
    pad = pad || 24;
    this.bounds = b;
    const a = mercator(b[0], b[1]), c = mercator(b[2], b[3]);
    const w = Math.abs(c[0] - a[0]), h = Math.abs(c[1] - a[1]);
    const zx = Math.log2((this.W - 2 * pad) / (256 * w)), zy = Math.log2((this.H - 2 * pad) / (256 * h));
    this.view.z = Math.max(this.minZ, Math.min(this.maxZ, Math.min(zx, zy)));
    this.view.x = (a[0] + c[0]) / 2; this.view.y = (a[1] + c[1]) / 2;
    this.requestRender();
  };
  /* like fitBounds, but fits into the part of the canvas inside pad = {top,right,bottom,left}, and never zooms in past maxZoom */
  P.fitBoundsIn = function (b, pad, maxZoom) {
    const a = mercator(b[0], b[1]), c = mercator(b[2], b[3]);
    const w = Math.abs(c[0] - a[0]) || 1e-9, h = Math.abs(c[1] - a[1]) || 1e-9;
    const vw = Math.max(80, this.W - pad.left - pad.right), vh = Math.max(80, this.H - pad.top - pad.bottom);
    const z = Math.min(Math.log2(vw / (256 * w)), Math.log2(vh / (256 * h)), maxZoom || this.maxZ);
    this.view.z = Math.max(this.minZ, Math.min(this.maxZ, z));
    const S = this.scale(), cx = (a[0] + c[0]) / 2, cy = (a[1] + c[1]) / 2;
    this.view.x = cx - (pad.left + vw / 2 - this.W / 2) / S; this.view.y = cy - (pad.top + vh / 2 - this.H / 2) / S;
    this.requestRender();
  };
  P.zoomBy = function (dz, sx, sy) {
    sx = sx == null ? this.W / 2 : sx; sy = sy == null ? this.H / 2 : sy;
    const S0 = this.scale();
    const wx = this.view.x + (sx - this.W / 2) / S0, wy = this.view.y + (sy - this.H / 2) / S0;
    this.view.z = Math.max(this.minZ, Math.min(this.maxZ, this.view.z + dz));
    const S1 = this.scale();
    this.view.x = wx - (sx - this.W / 2) / S1; this.view.y = wy - (sy - this.H / 2) / S1;
    this.requestRender();
  };
  P.requestRender = function () {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = 0; this.render(); });
  };
  P._tile = function (z, x, y) {
    const k = z + "/" + x + "/" + y;
    let t = this.cache.get(k);
    if (!t) {
      const img = new Image();
      t = { img, ok: false };
      const self = this;
      img.onload = () => { t.ok = true; self.requestRender(); };
      img.onerror = () => { t.err = true; };
      img.src = this.tileUrl(z, x, y, this.dpr > 1.2);
      this.cache.set(k, t);
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
    }
    return t;
  };
  P.render = function () {
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = this.bg;
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.tileUrl) {
      const S = this.scale();
      const z = Math.max(0, Math.min(18, Math.round(this.view.z)));
      const n = Math.pow(2, z), ts = S / n;
      const u0 = Math.floor((this.view.x - this.W / (2 * S)) * n), u1 = Math.floor((this.view.x + this.W / (2 * S)) * n);
      const v0 = Math.floor((this.view.y - this.H / (2 * S)) * n), v1 = Math.floor((this.view.y + this.H / (2 * S)) * n);
      ctx.globalAlpha = this.tileAlpha;
      for (let u = u0; u <= u1; u++) {
        for (let v = v0; v <= v1; v++) {
          if (u < 0 || v < 0 || u >= n || v >= n) continue;
          const t = this._tile(z, u, v);
          if (t.ok) ctx.drawImage(t.img, (u / n - this.view.x) * S + this.W / 2, (v / n - this.view.y) * S + this.H / 2, ts + 0.5, ts + 0.5);
        }
      }
      ctx.globalAlpha = 1;
    }
    if (this.opts.onRender) this.opts.onRender(ctx, this);
  };
  P._pos = function (e) { const r = this.cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  P._down = function (e) {
    this.cv.setPointerCapture(e.pointerId);
    this.ptrs.set(e.pointerId, this._pos(e));
    this.moved = false;
    this.down0 = this._pos(e);
  };
  P._move = function (e) {
    const p = this._pos(e);
    if (!this.ptrs.has(e.pointerId)) {
      if (this.opts.onHover) this.opts.onHover(p[0], p[1]);
      return;
    }
    const prev = this.ptrs.get(e.pointerId);
    if (this.ptrs.size === 1) {
      const S = this.scale();
      this.view.x -= (p[0] - prev[0]) / S; this.view.y -= (p[1] - prev[1]) / S;
      this.requestRender();
    } else if (this.ptrs.size === 2) {
      const others = [...this.ptrs.entries()].filter(([id]) => id !== e.pointerId)[0][1];
      const d0 = Math.hypot(prev[0] - others[0], prev[1] - others[1]), d1 = Math.hypot(p[0] - others[0], p[1] - others[1]);
      if (d0 > 0 && d1 > 0) this.zoomBy(Math.log2(d1 / d0), (p[0] + others[0]) / 2, (p[1] + others[1]) / 2);
    }
    this.ptrs.set(e.pointerId, p);
    if (Math.hypot(p[0] - this.down0[0], p[1] - this.down0[1]) > 5) this.moved = true;
    if (this.opts.onLeave && this.moved) this.opts.onLeave();
  };
  P._up = function (e, cancel) {
    const p = this._pos(e);
    const had = this.ptrs.has(e.pointerId);
    this.ptrs.delete(e.pointerId);
    if (had && !this.moved && !cancel && this.ptrs.size === 0 && this.opts.onClick) this.opts.onClick(p[0], p[1]);
  };

  root.TileMap = TileMap;
})(window);
