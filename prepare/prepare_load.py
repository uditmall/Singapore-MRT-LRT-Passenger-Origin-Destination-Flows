"""Segment loads for the "Passenger load between stations" view.

Reads   ../data/od-network.js (station list), gtfs/ (LTA GTFS Schedule (Train) unzipped)
Writes  ../data/od-load.js
For every ordered station pair the script lists the directed segments (station a -> next station b on a
line) of its fewest-stops route (transfer penalty 4, ties split equally) with the share of the trip on each
segment, and counts the scheduled trains on every segment per hour from the GTFS timetable.
Run from this folder:  python3 prepare_load.py [gtfs_folder]
"""
import base64, gzip, heapq, json, os, re, sys
from collections import defaultdict
import numpy as np
import pandas as pd
from od_model import build_network, parse_code

HERE = os.path.dirname(os.path.abspath(__file__))
GT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "gtfs")
PEN = 4
# Saturdays and Sundays/public holidays in each month (weekend/holiday days = their sum); needed to blend the
# GTFS Saturday and Sunday/PH timetables. Months not listed are weighted equally.
WEEKEND_MIX = {"2026-07": [4, 4], "2026-08": [5, 6], "2026-09": [4, 4]}

s = open(os.path.join(HERE, "..", "data", "od-network.js")).read()
net = json.loads(s[s.index("Object.assign(OD,") + 17:s.rindex(")")])
codes = [st["code"] for st in net["stations"]]
N = len(codes)
b64 = lambda b: base64.b64encode(gzip.compress(b, 9)).decode()

line_stations, edges = build_network(codes)
LINES = sorted(edges)
node, nodes, at = {}, [], defaultdict(list)
for ln in LINES:
    for st in sorted(line_stations[ln]):
        node[(st, ln)] = len(nodes); nodes.append((st, ln)); at[st].append(node[(st, ln)])
adj = [[] for _ in nodes]
seg_id, segs = {}, []          # directed segment (line, a, b)
for ln, es in edges.items():
    for k, (a, b) in enumerate(es):
        for x, y in ((a, b), (b, a)):
            # [from, to, line, position of the edge along the line, 1 if travelling in the listed order]
            seg_id[(ln, x, y)] = len(segs); segs.append((x, y, LINES.index(ln), k, 1 if (x, y) == (a, b) else 0))
            adj[node[(x, ln)]].append((node[(y, ln)], 1, seg_id[(ln, x, y)]))
for st, ns in at.items():
    for u in ns:
        for v in ns:
            if u != v: adj[u].append((v, PEN, -1))
radj = [[] for _ in nodes]      # graph is symmetric, so the reverse graph is the same graph
n = len(nodes)

def dijk(src):
    """dist and number of shortest paths from the nodes of station src."""
    dist = [1e9] * n; cnt = [0.0] * n; heap = []
    for u in at[src]:
        dist[u] = 0; cnt[u] = 1.0; heapq.heappush(heap, (0, u))
    done = [False] * n
    while heap:
        d, u = heapq.heappop(heap)
        if done[u]: continue
        done[u] = True
        for v, w, _ in adj[u]:
            nd = d + w
            if nd < dist[v]: dist[v] = nd; cnt[v] = cnt[u]; heapq.heappush(heap, (nd, v))
            elif nd == dist[v] and not done[v]: cnt[v] += cnt[u]
    return dist, cnt

D = [dijk(o) for o in range(N)]
pair, sg, wt = [], [], []
for o in range(N):
    do, co = D[o]
    for d in range(N):
        if d == o: continue
        dd, cd = D[d]
        best = min(do[t] for t in at[d])
        total = sum(co[t] for t in at[d] if do[t] == best)
        acc = defaultdict(float)
        for u in range(n):
            if do[u] >= 1e9 or co[u] == 0: continue
            for v, w, sid in adj[u]:
                if sid < 0: continue
                if do[u] + w + dd[v] == best and dd[v] < 1e9:
                    acc[sid] += co[u] * cd[v] / total
        for sid, f in acc.items():
            pair.append(o * N + d); sg.append(sid); wt.append(min(65535, round(f * 65535)))
print("segments", len(segs), "entries", len(pair))

# ---- GTFS: trains per segment per hour ----
sp = pd.read_csv(os.path.join(GT, "stops.txt"), dtype=str)
st_t = pd.read_csv(os.path.join(GT, "stop_times.txt"), dtype=str)
tr = pd.read_csv(os.path.join(GT, "trips.txt"), dtype=str)
cal = pd.read_csv(os.path.join(GT, "calendar.txt"), dtype=str)
part = {}
for i, c in enumerate(codes):
    for p, k in parse_code(c): part[p + (str(k) if k else "")] = i
part["CG"] = part["EW4"]   # GTFS gives the Tanah Merah platform on the Changi Airport branch the code CG
def st_of(sc): return part.get(sc)
code_of = dict(zip(sp.stop_id, sp.stop_code))
st_t["code"] = st_t.stop_id.map(code_of)
st_t["seq"] = st_t.stop_sequence.astype(int)
st_t = st_t.sort_values(["trip_id", "seq"])
st_t["ncode"] = st_t.groupby("trip_id").code.shift(-1)
x = st_t.dropna(subset=["ncode"]).merge(tr[["trip_id", "service_id"]], on="trip_id")
x["h"] = x.departure_time.str.split(":").str[0].astype(int).clip(5, 23) - 5
x["a"] = x.code.map(st_of); x["b"] = x.ncode.map(st_of)
def prefix(c): return re.match(r"[A-Z]+", c).group(0)
hubless = {"CG", "SE", "SW", "PE", "PW", "BP"}
def line_of(r):
    pa, pb = prefix(r[0]), prefix(r[1])
    for p in (pa, pb):
        if p in hubless: return p
    return pa if pa == pb else None
SERV = {"SERVICE_WD": 0, "SERVICE_WE": 1, "SERVICE_PH": 2}
trains = np.zeros((3, 19, len(segs)), dtype=np.uint16)
miss = defaultdict(int)
grp = x.groupby(["code", "ncode", "a", "b", "service_id", "h"], dropna=False).size().reset_index(name="k")
for r in grp.itertuples():
    if pd.isna(r.a) or pd.isna(r.b): miss["unknown station " + str(r.code) + ">" + str(r.ncode)] += r.k; continue
    ln = line_of((r.code, r.ncode))
    sid = seg_id.get((LINES[LINES.index(ln)] if ln in LINES else None, int(r.a), int(r.b)))
    if sid is None:
        # lines that share a segment name in GTFS (e.g. interchange hub codes): try every line on the edge
        cands = [seg_id[(l, int(r.a), int(r.b))] for l in LINES if (l, int(r.a), int(r.b)) in seg_id]
        if len(cands) == 1: sid = cands[0]
    if sid is None: miss["no segment %s>%s" % (r.code, r.ncode)] += r.k; continue
    trains[SERV[r.service_id], r.h, sid] += r.k
print("unmatched GTFS segments:", len(miss), sum(miss.values()))
for k, v in sorted(miss.items(), key=lambda kv: -kv[1])[:15]: print("  ", k, v)
tot = trains.sum(axis=(0, 1))
print("segments with no timetable trains:", int((tot == 0).sum()), [(codes[segs[i][0]], codes[segs[i][1]], LINES[segs[i][2]]) for i in np.where(tot == 0)[0][:20]])

out = {"lines": LINES, "segs": [list(s_) for s_ in segs],
       "pair": b64(np.array(pair, dtype=np.uint16).tobytes()), "seg": b64(np.array(sg, dtype=np.uint16).tobytes()),
       "w": b64(np.array(wt, dtype=np.uint16).tobytes()), "trains": b64(trains.tobytes()),
       "weekendMix": WEEKEND_MIX, "gtfsVersion": open(os.path.join(GT, "feed_info.txt")).read().splitlines()[1].split(",")[-1] if os.path.exists(os.path.join(GT, "feed_info.txt")) else ""}
with open(os.path.join(HERE, "..", "data", "od-load.js"), "w") as fh:
    fh.write("window.OD=window.OD||{};OD.load=" + json.dumps(out, separators=(",", ":")) + ";\n")
print("wrote od-load.js", round(os.path.getsize(os.path.join(HERE, "..", "data", "od-load.js")) / 1e6, 2), "MB")
