import sys, pandas as pd, numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
f = sys.argv[1]
df = pd.read_excel(f, header=None)
names = [n for n in df.iloc[0, 1:76].tolist() if isinstance(n, str)]
names = ['SpineMid' if n == 'Midspain' else n for n in names]
xyz = df.iloc[1:, 1:76].to_numpy(dtype=float).reshape(-1, 25, 3)
J = {n: i for i, n in enumerate(names)}
B = [('Head','Neck'),('Neck','SpineShoulder'),('SpineShoulder','SpineMid'),('SpineMid','SpineBase'),
     ('SpineShoulder','ShoulderLeft'),('ShoulderLeft','ElbowLeft'),('ElbowLeft','WristLeft'),('WristLeft','HandLeft'),('HandLeft','HandTipLeft'),('WristLeft','ThumbLeft'),
     ('SpineShoulder','ShoulderRight'),('ShoulderRight','ElbowRight'),('ElbowRight','WristRight'),('WristRight','HandRight'),('HandRight','HandTipRight'),('WristRight','ThumbRight'),
     ('SpineBase','HipLeft'),('HipLeft','KneeLeft'),('KneeLeft','AnkleLeft'),('AnkleLeft','FootLeft'),
     ('SpineBase','HipRight'),('HipRight','KneeRight'),('KneeRight','AnkleRight'),('AnkleRight','FootRight')]
LEFT = '0039A6'; RIGHT = 'E3A400'; MID = '0B1F4B'
def col(a, b):
    s = a + b
    return '#' + (LEFT if 'Left' in s else RIGHT if 'Right' in s else MID)
T = len(xyz)
# Side view strobe: horizontal = distance to camera (Z), vertical = Y
fig, ax = plt.subplots(figsize=(8, 4.2), dpi=220)
frames = np.linspace(0, T - 1, 5).astype(int)
for k, t in enumerate(frames):
    p = xyz[t]; alpha = 0.35 + 0.65 * k / (len(frames) - 1)
    for a, b in B:
        ax.plot([-p[J[a], 2], -p[J[b], 2]], [p[J[a], 1], p[J[b], 1]], color=col(a, b), lw=3, alpha=alpha, solid_capstyle='round')
    ax.scatter(-p[:, 2], p[:, 1], s=14, color='#' + MID, alpha=alpha, zorder=3)
ax.set_aspect('equal'); ax.axis('off')
fig.savefig('assets/skeleton_walk.png', transparent=True, bbox_inches='tight', pad_inches=0.05)
# Front view, single frame
fig, ax = plt.subplots(figsize=(3, 4.5), dpi=220)
p = xyz[T // 2]
for a, b in B:
    ax.plot([p[J[a], 0], p[J[b], 0]], [p[J[a], 1], p[J[b], 1]], color=col(a, b), lw=4, solid_capstyle='round')
ax.scatter(p[:, 0], p[:, 1], s=26, color='#' + MID, zorder=3)
ax.set_aspect('equal'); ax.axis('off')
fig.savefig('assets/skeleton_front.png', transparent=True, bbox_inches='tight', pad_inches=0.05)
print(T, 'frames')
