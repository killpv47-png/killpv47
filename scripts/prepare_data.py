#!/usr/bin/env python3
"""
Prepare the FlyWire v783 (FAFB, adult female Drosophila) whole-brain connectome
into compact binary files used by the Node.js LIF engine and the 3D viewer.

Sources (public Codex dumps, CC BY-NC 4.0):
  https://storage.googleapis.com/flywire-data/codex/data/fafb/783/
    classification.csv.gz          root_id, flow, super_class, class, sub_class, hemilineage, side, nerve
    consolidated_cell_types.csv.gz root_id, primary_type, additional_type(s)
    coordinates.csv.gz             root_id, position "[x y z]" (nm), supervoxel_id
    connections.csv.gz             pre_root_id, post_root_id, neuropil, syn_count, nt_type

Outputs (data/brain/):
    meta.json         counts, dictionaries, bounds
    neurons.bin       per neuron: superClass u8, classId u8, ntOut u8, side u8, typeId u16  (6 bytes LE)
    positions.bin     Float32 x,y,z per neuron (normalised to roughly [-1,1], y-up)
    csr_ptr.bin       Int32  N+1 row pointers (rows = presynaptic neuron)
    csr_idx.bin       Int32  post-synaptic neuron index per edge
    csr_w.bin         Float32 signed synapse count (ACh/DA/5HT/OA +, GABA/Glu -)
Outputs (public/data/):
    brain_points.bin  Float32 xyz per neuron + Uint8 superClass per neuron (viewer)
    brain_meta.json
"""
import csv, gzip, json, os, sys
import numpy as np
import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else '/tmp/flywire'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'brain')
PUB = os.path.join(ROOT, 'public', 'data')
os.makedirs(OUT, exist_ok=True); os.makedirs(PUB, exist_ok=True)

BASE = 'https://storage.googleapis.com/flywire-data/codex/data/fafb/783'
FILES = ['classification.csv.gz', 'consolidated_cell_types.csv.gz', 'coordinates.csv.gz', 'connections.csv.gz']
for f in FILES:
    p = os.path.join(SRC, f)
    if not os.path.exists(p):
        os.makedirs(SRC, exist_ok=True)
        print('downloading', f)
        os.system(f'curl -sL -o "{p}" "{BASE}/{f}"')

NT_NAMES = ['unknown', 'ACH', 'GABA', 'GLUT', 'DA', 'SER', 'OCT']
NT_ID = {n: i for i, n in enumerate(NT_NAMES)}
NT_SIGN = np.array([0.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0], dtype=np.float32)  # Shiu et al. 2024 convention

# ---------------- neurons ----------------
print('reading classification')
cls = pd.read_csv(os.path.join(SRC, 'classification.csv.gz'), dtype=str, keep_default_na=False)
root_ids = cls['root_id'].astype(np.int64).to_numpy()
N = len(root_ids)
index = pd.Series(np.arange(N, dtype=np.int64), index=root_ids)
super_classes = sorted(set(cls['super_class'].replace('', 'unknown')))
sc_id = {s: i for i, s in enumerate(super_classes)}
classes = sorted(set(cls['class']))
cl_id = {s: i for i, s in enumerate(classes)}
sides = ['', 'left', 'right', 'center']
side_id = {s: i for i, s in enumerate(sides)}

print('reading cell types')
ct = pd.read_csv(os.path.join(SRC, 'consolidated_cell_types.csv.gz'), dtype=str, keep_default_na=False)
type_of = np.array([''] * N, dtype=object)
ct_idx = index.reindex(ct['root_id'].astype(np.int64)).to_numpy()
ok = ~np.isnan(ct_idx)
type_of[ct_idx[ok].astype(int)] = ct['primary_type'].to_numpy()[ok]
types = sorted(set(type_of.tolist()))
type_id = {t: i for i, t in enumerate(types)}
assert len(types) < 65535

print('reading coordinates')
pos = np.zeros((N, 3), dtype=np.float64); has = np.zeros(N, dtype=bool)
with gzip.open(os.path.join(SRC, 'coordinates.csv.gz'), 'rt') as f:
    r = csv.reader(f); next(r)
    for row in r:
        i = index.get(int(row[0]))
        if i is None or has[i]: continue
        p = row[1].strip('[]').split()
        pos[i] = [float(p[0]), float(p[1]), float(p[2])]
        has[i] = True
print('neurons with coords', int(has.sum()), '/', N)
gmean = pos[has].mean(axis=0)
pos[~has] = gmean
lo = pos[has].min(axis=0); hi = pos[has].max(axis=0)
center = (lo + hi) / 2; scale = (hi - lo).max() / 2
posn = ((pos - center) / scale).astype(np.float32)
# FAFB: x = left-right, y = dorsal(-)/ventral(+), z = anterior/posterior. Viewer frame is y-up.
posn[:, 1] *= -1

# ---------------- connections ----------------
print('reading connections (3.9M rows)')
con = pd.read_csv(os.path.join(SRC, 'connections.csv.gz'),
                  usecols=['pre_root_id', 'post_root_id', 'syn_count', 'nt_type'],
                  dtype={'pre_root_id': np.int64, 'post_root_id': np.int64, 'syn_count': np.int32, 'nt_type': 'category'})
pre = index.reindex(con['pre_root_id'].to_numpy()).to_numpy()
post = index.reindex(con['post_root_id'].to_numpy()).to_numpy()
okm = ~(np.isnan(pre) | np.isnan(post))
pre = pre[okm].astype(np.int64); post = post[okm].astype(np.int64)
syn = con['syn_count'].to_numpy()[okm].astype(np.int64)
nt = np.array([NT_ID.get(x, 0) for x in con['nt_type'].cat.categories], dtype=np.int64)[con['nt_type'].cat.codes.to_numpy()[okm]]
del con
print('rows kept', len(pre))

# aggregate over neuropils -> unique (pre, post)
key = pre * N + post
order = np.argsort(key, kind='stable')
key = key[order]; syn = syn[order]; nt = nt[order]; pre = pre[order]; post = post[order]
uniq, start = np.unique(key, return_index=True)
end = np.append(start[1:], len(key))
E = len(uniq)
agg_syn = np.add.reduceat(syn, start)
grp = np.repeat(np.arange(E), end - start)
o2 = np.lexsort((-syn, grp))
first = np.unique(grp[o2], return_index=True)[1]
agg_nt = nt[o2][first]
agg_pre = pre[start]; agg_post = post[start]
del key, order, grp, o2, syn, nt, pre, post
print('unique edges', E, 'total synapses', int(agg_syn.sum()))

w = agg_syn.astype(np.float32) * NT_SIGN[agg_nt]

# dominant OUTPUT neurotransmitter per neuron
acc = np.zeros((N, 7), dtype=np.int64)
np.add.at(acc, (agg_pre, agg_nt), agg_syn)
nt_out = np.zeros(N, dtype=np.uint8)
has_out = acc.sum(axis=1) > 0
nt_out[has_out] = acc[has_out].argmax(axis=1)

ptr = np.zeros(N + 1, dtype=np.int32)
ptr[1:] = np.cumsum(np.bincount(agg_pre, minlength=N))
idx = agg_post.astype(np.int32)

# ---------------- write ----------------
neur = np.zeros(N, dtype=[('sc', 'u1'), ('cl', 'u1'), ('nt', 'u1'), ('side', 'u1'), ('type', '<u2')])
neur['sc'] = [sc_id[s or 'unknown'] for s in cls['super_class']]
neur['cl'] = [cl_id[s] for s in cls['class']]
neur['nt'] = nt_out
neur['side'] = [side_id.get(s, 0) for s in cls['side']]
neur['type'] = [type_id[t] for t in type_of]
neur.tofile(os.path.join(OUT, 'neurons.bin'))
posn.tofile(os.path.join(OUT, 'positions.bin'))
ptr.tofile(os.path.join(OUT, 'csr_ptr.bin'))
idx.tofile(os.path.join(OUT, 'csr_idx.bin'))
w.astype(np.float32).tofile(os.path.join(OUT, 'csr_w.bin'))

meta = {
    'dataset': 'FlyWire FAFB v783 (Codex public release)',
    'license': 'CC BY-NC 4.0 - Dorkenwald et al. 2024; Schlegel et al. 2024',
    'n_neurons': int(N), 'n_edges': int(E), 'n_synapses': int(agg_syn.sum()),
    'super_classes': super_classes, 'classes': classes, 'sides': sides, 'types': types,
    'nt_names': NT_NAMES,
    'bounds': {'center_nm': center.tolist(), 'scale_nm': float(scale)},
    'neuron_record': 'sc:u8 cl:u8 ntOut:u8 side:u8 typeId:u16 (little endian, 6 bytes)',
}
with open(os.path.join(OUT, 'meta.json'), 'w') as f: json.dump(meta, f)

with open(os.path.join(PUB, 'brain_points.bin'), 'wb') as f:
    f.write(posn.tobytes()); f.write(neur['sc'].tobytes())
with open(os.path.join(PUB, 'brain_meta.json'), 'w') as f:
    json.dump({'n': int(N), 'super_classes': super_classes, 'n_edges': int(E), 'n_synapses': int(agg_syn.sum())}, f)

print('done. neurons', N, 'edges', E, 'types', len(types))
print('super classes', super_classes)
