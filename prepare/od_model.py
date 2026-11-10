"""OD model: station network, routing by stops + transfer penalty, per-day OD aggregation.

Routing rules (agreed with the user):
  * cost 1 per stop ridden
  * transfer penalty P stops for changing line at a station (default 4; sensitivity 2 and 6)
  * ties: split equally between distinct optimal routes
  * matrix cell = (first line ridden, last line ridden), lines grouped into
    NS, EW (incl. CG branch), NE, CC, DT, TE, LRT (BP, Sengkang, Punggol)
"""
import heapq
import re
from collections import defaultdict

import numpy as np
import pandas as pd

CLASSES = ["NS", "EW", "NE", "CC", "DT", "TE", "LRT"]
LINE_CLASS = {
    "NS": "NS", "EW": "EW", "CG": "EW", "NE": "NE", "CC": "CC", "DT": "DT", "TE": "TE",
    "BP": "LRT", "SE": "LRT", "SW": "LRT", "PE": "LRT", "PW": "LRT",
}
HOURS = list(range(5, 24))  # hour 0 is folded into 23
DAYS = ["WEEKDAY", "WEEKENDS/HOLIDAY"]


def parse_code(code):
    out = []
    for part in code.split("/"):
        m = re.fullmatch(r"([A-Z]+)(\d*)", part)
        out.append((m.group(1), int(m.group(2)) if m.group(2) else 0))
    return out


def build_network(codes):
    """codes: sorted list of station codes (combined codes for interchanges).
    Returns (line_stations, edges) where edges is {line_id: [(station_a, station_b), ...]}."""
    idx = {c: i for i, c in enumerate(codes)}
    comp = defaultdict(dict)  # prefix -> {number: station index}
    hub = {}
    for c in codes:
        for p, n in parse_code(c):
            if p in ("STC", "PTC"):
                hub[p] = idx[c]
            else:
                comp[p][n] = idx[c]

    edges = defaultdict(list)

    def chain(prefix, line=None):
        line = line or prefix
        seq = [comp[prefix][n] for n in sorted(comp[prefix])]
        for a, b in zip(seq, seq[1:]):
            edges[line].append((a, b))
        return seq

    for p in ["NS", "EW", "NE", "CC", "DT", "TE", "BP"]:
        chain(p)
    # Circle line loop closure: Bayfront (CC34) -> Promenade (CC4)
    edges["CC"].append((comp["CC"][34], comp["CC"][4]))
    # Bukit Panjang LRT: loop BP13 -> BP6 (PROVISIONAL, verify against GeoJSON)
    edges["BP"].append((comp["BP"][13], comp["BP"][6]))
    # Changi Airport branch hangs off Tanah Merah (EW4)
    cg = [comp["CG"][n] for n in sorted(comp["CG"])]
    edges["CG"].append((comp["EW"][4], cg[0]))
    for a, b in zip(cg, cg[1:]):
        edges["CG"].append((a, b))
    # Sengkang / Punggol LRT loops, each loop is its own line, hub = STC / PTC
    for prefix, h in [("SE", "STC"), ("SW", "STC"), ("PE", "PTC"), ("PW", "PTC")]:
        seq = [hub[h]] + [comp[prefix][n] for n in sorted(comp[prefix])] + [hub[h]]
        for a, b in zip(seq, seq[1:]):
            edges[prefix].append((a, b))

    line_stations = defaultdict(set)
    for line, es in edges.items():
        for a, b in es:
            line_stations[line].update((a, b))
    return line_stations, edges


def build_graph(codes, penalty):
    line_stations, edges = build_network(codes)
    node_id = {}
    nodes = []
    at_station = defaultdict(list)
    for line in sorted(line_stations):
        for s in sorted(line_stations[line]):
            node_id[(s, line)] = len(nodes)
            nodes.append((s, line))
            at_station[s].append(node_id[(s, line)])
    adj = [[] for _ in nodes]
    for line, es in edges.items():
        for a, b in es:
            u, v = node_id[(a, line)], node_id[(b, line)]
            adj[u].append((v, 1))
            adj[v].append((u, 1))
    for s, ns in at_station.items():
        for u in ns:
            for v in ns:
                if u != v:
                    adj[u].append((v, penalty))
    return nodes, adj, at_station


def route_table(codes, penalty):
    """For every ordered station pair return {(first_class, last_class): weight} (weights sum to 1)
    plus the optimal cost, as dict[(o, d)] -> (cost, {cell: weight})."""
    nodes, adj, at_station = build_graph(codes, penalty)
    lines = sorted({l for _, l in nodes})
    lidx = {l: i for i, l in enumerate(lines)}
    cls_of_line = [CLASSES.index(LINE_CLASS[l]) for l in lines]
    n = len(nodes)
    result = {}
    for o in range(len(codes)):
        dist = [float("inf")] * n
        cnt = [None] * n
        heap = []
        for u in at_station[o]:
            dist[u] = 0
            vec = np.zeros(len(lines))
            vec[lidx[nodes[u][1]]] = 1.0
            cnt[u] = vec
            heapq.heappush(heap, (0, u))
        done = [False] * n
        while heap:
            d, u = heapq.heappop(heap)
            if done[u]:
                continue
            done[u] = True
            for v, w in adj[u]:
                nd = d + w
                if nd < dist[v]:
                    dist[v] = nd
                    cnt[v] = cnt[u].copy()
                    heapq.heappush(heap, (nd, v))
                elif nd == dist[v] and not done[v]:
                    cnt[v] = cnt[v] + cnt[u]
        for dst in range(len(codes)):
            if dst == o:
                continue
            terms = at_station[dst]
            best = min(dist[t] for t in terms)
            cells = defaultdict(float)
            for t in terms:
                if dist[t] != best:
                    continue
                last = cls_of_line[lidx[nodes[t][1]]]
                for fi, c in enumerate(cnt[t]):
                    if c:
                        cells[(cls_of_line[fi], last)] += c
            tot = sum(cells.values())
            result[(o, dst)] = (best, {k: v / tot for k, v in cells.items()})
    return result


# Station codes that LTA spells two ways for the same physical station. July 2026 uses both the
# old (CC34, CC33) and the new (CE1, CE2) Circle line extension codes for Bayfront and Marina Bay;
# August 2026 only the old ones. Merge into the spelling the rest of the data uses.
CODE_ALIASES = {"CE1/DT16": "CC34/DT16", "NS27/CE2/TE20": "NS27/CC33/TE20"}


def read_codes(path):
    df = pd.read_csv(path, encoding="utf-8-sig", usecols=["ORIGIN_PT_CODE", "DESTINATION_PT_CODE"])
    return {CODE_ALIASES.get(c, c) for c in set(df.ORIGIN_PT_CODE) | set(df.DESTINATION_PT_CODE)}


def load_od(path, day_counts, codes=None):
    """Aggregate an OD csv into per-pair monthly totals with hour 0 folded into 23.
    Returns (codes, cube) with cube uint16 [2 days][19 hours][O][D] of MONTHLY TOTAL trips.
    Per-day averages are computed in the dashboard as total / day_counts."""
    df = pd.read_csv(path, encoding="utf-8-sig")
    df.loc[df.TIME_PER_HOUR == 0, "TIME_PER_HOUR"] = 23
    df["ORIGIN_PT_CODE"] = df.ORIGIN_PT_CODE.replace(CODE_ALIASES)
    df["DESTINATION_PT_CODE"] = df.DESTINATION_PT_CODE.replace(CODE_ALIASES)
    own = sorted(set(df.ORIGIN_PT_CODE) | set(df.DESTINATION_PT_CODE))
    codes = list(codes) if codes is not None else own
    assert set(own) <= set(codes), "csv has station codes missing from the station list"
    idx = {c: i for i, c in enumerate(codes)}
    df["o"] = df.ORIGIN_PT_CODE.map(idx)
    df["d"] = df.DESTINATION_PT_CODE.map(idx)
    df["day"] = df.DAY_TYPE.map({k: i for i, k in enumerate(DAYS)})
    df["h"] = df.TIME_PER_HOUR - 5
    g = df.groupby(["day", "h", "o", "d"]).TOTAL_TRIPS.sum().reset_index()
    cube = np.zeros((2, len(HOURS), len(codes), len(codes)), dtype=np.uint16)
    assert g.TOTAL_TRIPS.max() < 65536
    cube[g.day.values, g.h.values, g.o.values, g.d.values] = g.TOTAL_TRIPS.values.astype(np.uint16)
    return codes, cube
