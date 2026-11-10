"""Generate the OD dashboard data files from the monthly OD csv files.

Run from this folder:   python3 prepare_data.py
Reads   months.json (which months, csv names, date of access), holidays.json, raw/*.csv,
        MRT_Stations_with_Coordinates.xlsx, lines/*.geojson
Writes  ../data/od-network.js, od-lines.js, od-manifest.js and od-YYYY-MM.js

Adding a month: put its csv in raw/, add one entry to months.json, check holidays.json,
run this script and read what it prints (day counts and warnings).
"""
import base64
import calendar
import datetime as dt
import glob
import gzip
import json
import os
import re
import sys

import numpy as np
import pandas as pd

from od_model import CLASSES, HOURS, load_od, parse_code, read_codes, route_table

HERE = os.path.dirname(os.path.abspath(__file__))


def load_json(name):
    with open(os.path.join(HERE, name)) as fh:
        return json.load(fh)


def day_counts(ym, entry, holidays):
    """(weekdays, weekend/holiday days). A manual 'days' entry in months.json overrides the calendar."""
    if entry.get("days"):
        return entry["days"]["wd"], entry["days"]["we"]
    y, m = map(int, ym.split("-"))
    hol = {h["date"] for h in holidays.get(str(y), [])}
    if len(hol) < 11:
        print("WARNING: holidays.json has only", len(hol), "holidays for", y, "- check the list")
    wd = we = 0
    for d in range(1, calendar.monthrange(y, m)[1] + 1):
        date = dt.date(y, m, d)
        if date.weekday() >= 5 or date.isoformat() in hol:
            we += 1
        else:
            wd += 1
    return wd, we


def b64gz(b):
    return base64.b64encode(gzip.compress(b, 9)).decode()


def station_lines(code):
    """Line classes used by the line filter. Sengkang and Punggol (STC/PTC hubs) stay under NE."""
    out = []
    for p, _ in parse_code(code):
        if p in ("STC", "PTC"):
            continue
        cls = {"CG": "EW", "BP": "LRT", "SE": "LRT", "SW": "LRT", "PE": "LRT", "PW": "LRT"}.get(p, p)
        if cls not in out:
            out.append(cls)
    return out


def quantise(cells):
    items = sorted(cells.items())
    ws = [v for _, v in items]
    q = [int(round(w * 65535)) for w in ws]
    q[int(np.argmax(ws))] += 65535 - sum(q)
    return [(k, w) for (k, _), w in zip(items, q)]


def round_coords(c, nd=5):
    if isinstance(c[0], (int, float)):
        return [round(c[0], nd), round(c[1], nd)]
    return [round_coords(x, nd) for x in c]


def lines_geojson(mrt_path, lrt_path):
    feats = []
    for path, kind in ((mrt_path, "mrt"), (lrt_path, "lrt")):
        g = json.load(open(path))
        for ft in g["features"]:
            p = ft["properties"]
            name = p.get("name") or p.get("Name")
            colour = p.get("colour") or p.get("Colour") or "#748477"
            feats.append({"type": "Feature",
                          "properties": {"name": name, "colour": colour, "kind": kind},
                          "geometry": {"type": ft["geometry"]["type"],
                                       "coordinates": round_coords(ft["geometry"]["coordinates"])}})
    return {"type": "FeatureCollection", "features": feats}


def js_assign(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    print("wrote", path, round(os.path.getsize(path) / 1e6, 2), "MB")


def main(penalties=(2, 4, 6)):
    out_dir = os.path.join(HERE, "..")
    meta = pd.read_excel(os.path.join(HERE, "MRT_Stations_with_Coordinates.xlsx")).set_index("PT_CODE")
    months = load_json("months.json")["months"]
    holidays = load_json("holidays.json")
    files = [os.path.join(HERE, "raw", m["csv"]) for m in months]
    codes = sorted(set().union(*[read_codes(f) for f in files]))  # union over all months
    manifest = []
    prev = None
    for m, f in zip(months, files):
        ym = m["month"]
        c, cube = load_od(f, None, codes)
        wd, we = day_counts(ym, m, holidays)
        label = dt.date(int(ym[:4]), int(ym[5:]), 1).strftime("%B %Y")
        body = {"label": label, "days": [wd, we], "cube": b64gz(cube.tobytes())}
        js_assign(os.path.join(out_dir, "data", f"od-{ym}.js"),
                  f'window.OD=window.OD||{{}};OD.months=OD.months||{{}};OD.months["{ym}"]={json.dumps(body, separators=(",", ":"))};\n')
        manifest.append({"id": ym, "label": label, "accessed": m.get("accessed", "")})
        total = int(cube.sum(dtype=np.int64))
        per_day = total / (wd + we)
        print(ym, "weekdays", wd, "weekend/holiday days", we, "trips", total)
        if prev and abs(per_day / prev - 1) > 0.25:
            print("WARNING: trips per day changed by more than 25% against the previous month")
        prev = per_day
    missing = set(codes) - set(meta.index)
    if missing:
        raise SystemExit("Station codes missing from the station workbook: " + ", ".join(sorted(missing)))
    n = len(codes)
    routes = {}
    for p in penalties:
        rt = route_table(codes, p)
        pair, cell, w = [], [], []
        for (o, d), (_, cells) in sorted(rt.items()):
            for (a, b), q in quantise(cells):
                pair.append(o * n + d)
                cell.append(a * 7 + b)
                w.append(q)
        routes[str(p)] = {"pair": b64gz(np.array(pair, dtype=np.uint16).tobytes()),
                          "cell": b64gz(np.array(cell, dtype=np.uint8).tobytes()),
                          "w": b64gz(np.array(w, dtype=np.uint16).tobytes())}
    stations = [{"code": c, "name": str(meta.loc[c, "STATION_NAME"]), "lat": round(float(meta.loc[c, "LATITUDE"]), 6),
                 "lng": round(float(meta.loc[c, "LONGITUDE"]), 6), "lines": station_lines(c)} for c in codes]
    net = {"classes": CLASSES, "hours": HOURS, "stations": stations, "routes": routes,
           "penalties": list(penalties), "defaultPenalty": 4}
    js_assign(os.path.join(out_dir, "data", "od-network.js"),
              "window.OD=window.OD||{};Object.assign(OD," + json.dumps(net, separators=(",", ":")) + ");\n")
    js_assign(os.path.join(out_dir, "data", "od-lines.js"),
              "window.OD=window.OD||{};OD.lines=" + json.dumps(lines_geojson(os.path.join(HERE, "lines", "MRT_lines_existing.geojson"),
                                                                           os.path.join(HERE, "lines", "LRT_lines_geojson.geojson")), separators=(",", ":")) + ";\n")
    js_assign(os.path.join(out_dir, "data", "od-manifest.js"),
              "window.OD=window.OD||{};OD.manifest=" + json.dumps(manifest) + ";\n")


if __name__ == "__main__":
    main()
