"""
Gliese Delay -- v1 prototype
============================================================
A multi-tap delay whose taps are *derived* from ray propagation through a
spherically-symmetric graded-index channel (the RHO profile from the thesis),
rather than dialed in by hand.

Pipeline:
  1. Define the RHO profile  n^2(r)  (peak at r0, harmonic shell outside,
     inverse-harmonic shell inside) -> the ray-as-particle force a(x).
  2. Trace a bundle of rays from a point source through the channel.
  3. (a) Static 3D plot of the bundle, coloured by travel time.
     (b) Animated 3D wavefront  (Appendix A pulse-evolution, lifted to 3D).
  4. Catch every pass of every ray through a finite RECEIVER SPHERE
     -> a list of (delay, gain) taps == the impulse response.
  5. Convolve a dry test signal with that IR -> hear the world.

Notes on physics fidelity:
  - The OCR'd continuity constant in the thesis was garbled, so the profile
    is re-parameterised in an equivalent, numerically-robust way: same peak-at-r0
    shape, same force signs (-C2*r outside, +C3*r inside), same omega1=sqrt(C2),
    omega2=sqrt(C3). The trajectory is independent of the n^2 offset (as the
    thesis notes), so this changes nothing about the ray paths -- only the
    optical-path weighting used for delay/gain.
  - Delay  ~  optical path length  L = integral( n ds )  (== acoustic travel
    time up to a constant), mapped to seconds by a single DELAY_SCALE knob so
    musical timing is yours, not dictated by model units.
  - Eikonal consistency: a light/sound ray has |v| = n(r) at every point, so
    the source launches every ray at speed n(r_source).
"""

import numpy as np
from scipy.signal import fftconvolve
from scipy.io import wavfile
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import animation

OUT = "/mnt/user-data/outputs"
RNG = np.random.default_rng(7)

# ----------------------------------------------------------------------
# 1.  THE WORLD  (a "symmetric smooth channel" -- the tame, reverb-like one)
# ----------------------------------------------------------------------
class World:
    def __init__(self, r0=1.0, a=0.40, b=1.60, C2=1.0, C3=1.0, peak=2.0,
                 refl=0.6):
        self.r0   = r0          # channel axis (max-index shell)
        self.a    = a           # inner boundary
        self.b    = b           # outer boundary
        self.C2   = C2          # outer stiffness  -> omega1 = sqrt(C2)
        self.C3   = C3          # inner stiffness  -> omega2 = sqrt(C3)
        self.peak = peak        # n^2 at r0
        self.refl = refl        # boundary reflection coefficient (amplitude)

    def n2(self, r):
        """Squared refractive index: peaks at r0, decreases either side."""
        out = self.peak - self.C2 * (r**2 - self.r0**2)   # r > r0
        inn = self.peak - self.C3 * (self.r0**2 - r**2)   # r <= r0
        return np.where(r > self.r0, out, inn)

    def n(self, r):
        return np.sqrt(np.clip(self.n2(r), 1e-9, None))

    def accel(self, pos):
        """Ray-as-particle acceleration  a = +1/2 grad(n^2).
        Outer shell:  a = -C2 * r  (harmonic, pulls inward)
        Inner shell:  a = +C3 * r  (inverse-harmonic, pushes outward)."""
        r = np.linalg.norm(pos, axis=-1, keepdims=True)
        outer = r > self.r0
        k = np.where(outer, -self.C2, self.C3)
        return k * pos


# ----------------------------------------------------------------------
# 2.  RAY TRACER  (velocity-Verlet, vectorised over the whole bundle)
# ----------------------------------------------------------------------
def trace_bundle(world, source, dirs, n_steps=3200, dt=0.012):
    """Propagate len(dirs) rays in lockstep.
    Returns:
      traj   (n_steps+1, N, 3)  positions over time  (for plotting)
      Lpath  (n_steps+1, N)     cumulative optical path  integral(n ds)
      nrefl  (n_steps+1, N)     reflection count so far
    """
    N = len(dirs)
    speed = world.n(np.linalg.norm(source))          # |v| = n(r_source)
    pos = np.tile(source, (N, 1)).astype(float)
    vel = dirs * speed

    traj  = np.empty((n_steps + 1, N, 3))
    Lpath = np.zeros((n_steps + 1, N))
    nrefl = np.zeros((n_steps + 1, N), dtype=int)
    traj[0] = pos
    refl_count = np.zeros(N, dtype=int)

    acc = world.accel(pos)
    for s in range(n_steps):
        prev = pos.copy()
        vel_half = vel + 0.5 * acc * dt
        pos = pos + vel_half * dt

        # --- boundary reflection (specular) at a and b ---
        r = np.linalg.norm(pos, axis=1)
        hit = (r > world.b) | (r < world.a)
        if hit.any():
            nhat = pos[hit] / r[hit, None]
            vn = np.sum(vel_half[hit] * nhat, axis=1, keepdims=True)
            vel_half[hit] -= 2 * vn * nhat                 # flip normal comp
            # nudge back inside the shell
            tgt = np.clip(r[hit], world.a + 1e-6, world.b - 1e-6)
            pos[hit] = nhat * tgt[:, None]
            refl_count[hit] += 1

        acc = world.accel(pos)
        vel = vel_half + 0.5 * acc * dt

        # accumulate optical path  integral(n ds)
        ds = np.linalg.norm(pos - prev, axis=1)
        rmid = np.linalg.norm(0.5 * (pos + prev), axis=1)
        Lpath[s + 1] = Lpath[s] + world.n(rmid) * ds
        nrefl[s + 1] = refl_count
        traj[s + 1] = pos
    return traj, Lpath, nrefl


def fibonacci_dirs(n):
    """n roughly-uniform unit directions on the sphere."""
    i = np.arange(n) + 0.5
    phi = np.arccos(1 - 2 * i / n)
    gold = np.pi * (1 + 5 ** 0.5)
    theta = gold * i
    return np.column_stack([np.sin(phi) * np.cos(theta),
                            np.sin(phi) * np.sin(theta),
                            np.cos(phi)])


# ----------------------------------------------------------------------
# 4.  TAP EXTRACTION  (every pass through the receiver sphere == one tap)
# ----------------------------------------------------------------------
def extract_taps(traj, Lpath, nrefl, world, recv_c, recv_r,
                 delay_scale=0.16, l0=2.0):
    """Walk every ray; each fresh entry into the receiver sphere is a tap."""
    d = np.linalg.norm(traj - recv_c, axis=2)        # (steps, N)
    inside = d < recv_r
    fresh = inside[1:] & ~inside[:-1]                 # rising edges
    step_idx, ray_idx = np.where(fresh)
    step_idx += 1

    L = Lpath[step_idx, ray_idx]
    nr = nrefl[step_idx, ray_idx]
    spreading = 1.0 / (1.0 + L / l0)                  # geometric spreading
    gain = spreading * (world.refl ** nr)
    polarity = np.where(nr % 2 == 0, 1.0, -1.0)       # phase flip per bounce
    return L, gain * polarity, nr                     # raw optical path


def taps_to_ir(delay_s, gain, fs=48000, tail_pad=0.05):
    length = int((delay_s.max() + tail_pad) * fs) + 1
    ir = np.zeros(length)
    idx = np.round(delay_s * fs).astype(int)
    np.add.at(ir, idx, gain)                          # accumulate (caustics!)
    # light band-limiting so taps aren't single-sample clicks
    k = np.hanning(9); k /= k.sum()
    ir = fftconvolve(ir, k, mode="same")
    ir /= np.max(np.abs(ir)) + 1e-12
    return ir


# ----------------------------------------------------------------------
#   A dry test signal so the multipath is actually audible
# ----------------------------------------------------------------------
def dry_signal(fs=48000):
    def pluck(f0, dur, t0):
        n = int(dur * fs)
        t = np.arange(n) / fs
        env = np.exp(-t * 7)
        tone = (np.sin(2*np.pi*f0*t) + 0.4*np.sin(2*np.pi*2*f0*t)) * env
        click = np.zeros(n); click[:40] = np.hanning(80)[:40]
        return t0, 0.8*tone + 0.5*click
    total = int(3.4 * fs)
    sig = np.zeros(total)
    for f0, t0 in [(196, 0.05), (262, 0.75), (330, 1.35), (262, 1.9)]:
        s, w = pluck(f0, 0.9, t0)
        i = int(s * fs); m = min(len(w), total - i); sig[i:i+m] += w[:m]
    return sig / (np.max(np.abs(sig)) + 1e-9) * 0.9


def write_wav(path, x, fs=48000):
    x = np.clip(x, -1, 1)
    wavfile.write(path, fs, (x * 32767).astype(np.int16))


# ======================================================================
#   RENDERERS
# ======================================================================
def shell_wire(ax, R, color, alpha):
    u, v = np.mgrid[0:2*np.pi:24j, 0:np.pi:12j]
    ax.plot_wireframe(R*np.cos(u)*np.sin(v), R*np.sin(u)*np.sin(v),
                      R*np.cos(v), color=color, alpha=alpha, linewidth=0.4)


def render_static(world, traj, Lpath, source, recv_c, recv_r, path):
    fig = plt.figure(figsize=(9, 8)); ax = fig.add_subplot(111, projection="3d")
    Lmax = Lpath[-1].max()
    cmap = plt.cm.plasma
    step = max(1, traj.shape[1] // 220)               # thin out for clarity
    for j in range(0, traj.shape[1], step):
        L = Lpath[:, j]
        c = cmap(L[-1] / Lmax)
        ax.plot(traj[:, j, 0], traj[:, j, 1], traj[:, j, 2],
                color=c, alpha=0.35, linewidth=0.6)
    shell_wire(ax, world.r0, "deepskyblue", 0.5)
    shell_wire(ax, world.a, "white", 0.15)
    shell_wire(ax, world.b, "white", 0.15)
    ax.scatter(*source, color="lime", s=60, label="source")
    # receiver sphere
    u, v = np.mgrid[0:2*np.pi:16j, 0:np.pi:8j]
    ax.plot_surface(recv_c[0]+recv_r*np.cos(u)*np.sin(v),
                    recv_c[1]+recv_r*np.sin(u)*np.sin(v),
                    recv_c[2]+recv_r*np.cos(v), color="red", alpha=0.5)
    ax.set_title("Gliese Delay -- ray bundle through a symmetric RHO channel\n"
                 "(colour = travel time / optical path)", color="w")
    for f in (ax.xaxis, ax.yaxis, ax.zaxis):
        f.set_pane_color((0, 0, 0, 0))
    ax.set_facecolor("black"); fig.patch.set_facecolor("black")
    ax.tick_params(colors="grey"); ax.grid(False)
    lim = world.b * 1.05
    ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_zlim(-lim, lim)
    sm = plt.cm.ScalarMappable(cmap=cmap); sm.set_array([0, Lmax])
    cb = fig.colorbar(sm, ax=ax, shrink=0.5, pad=0.08)
    cb.set_label("optical path  (delay)", color="w"); cb.ax.yaxis.set_tick_params(color="w")
    plt.setp(plt.getp(cb.ax, "yticklabels"), color="w")
    fig.savefig(path, dpi=130, facecolor="black", bbox_inches="tight")
    plt.close(fig)


def render_wavefront(world, traj, source, recv_c, recv_r, path,
                     n_frames=160, stride=None):
    steps = traj.shape[0]
    stride = stride or max(1, steps // n_frames)
    frames = range(0, steps, stride)
    r_all = np.linalg.norm(traj, axis=2)
    fig = plt.figure(figsize=(8, 8)); ax = fig.add_subplot(111, projection="3d")
    fig.patch.set_facecolor("black")

    def draw(fi):
        ax.clear()
        f = frames[fi]
        p = traj[f]
        c = r_all[f]
        ax.scatter(p[:, 0], p[:, 1], p[:, 2], c=c, cmap="plasma",
                   s=5, alpha=0.7, vmin=world.a, vmax=world.b)
        shell_wire(ax, world.r0, "deepskyblue", 0.35)
        ax.scatter(*source, color="lime", s=40)
        u, v = np.mgrid[0:2*np.pi:10j, 0:np.pi:6j]
        ax.plot_surface(recv_c[0]+recv_r*np.cos(u)*np.sin(v),
                        recv_c[1]+recv_r*np.sin(u)*np.sin(v),
                        recv_c[2]+recv_r*np.cos(v), color="red", alpha=0.6)
        lim = world.b * 1.05
        ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_zlim(-lim, lim)
        ax.set_facecolor("black")
        for fa in (ax.xaxis, ax.yaxis, ax.zaxis):
            fa.set_pane_color((0, 0, 0, 0))
        ax.grid(False); ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])
        ax.set_title(f"wavefront evolution   t = {f*0.012:5.2f}", color="w")
        ax.view_init(elev=22, azim=fi * 1.4)          # slow orbit
        return ax,

    anim = animation.FuncAnimation(fig, draw, frames=len(frames), blit=False)
    anim.save(path, writer=animation.FFMpegWriter(fps=24, bitrate=2400),
              savefig_kwargs={"facecolor": "black"})
    plt.close(fig)


def render_ir(delay_s, gain, ir, fs, path):
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(10, 6))
    a1.stem(delay_s, gain, basefmt=" ", markerfmt=".")
    a1.set_title("Extracted taps  (each = one ray pass through the receiver)")
    a1.set_xlabel("delay (s)"); a1.set_ylabel("gain"); a1.grid(alpha=0.3)
    t = np.arange(len(ir)) / fs
    a2.plot(t, ir, linewidth=0.6)
    a2.set_title("Impulse response  (band-limited tap train)")
    a2.set_xlabel("time (s)"); a2.set_ylabel("amplitude"); a2.grid(alpha=0.3)
    fig.tight_layout(); fig.savefig(path, dpi=120); plt.close(fig)


# ======================================================================
#   MAIN
# ======================================================================
def main():
    fs = 48000
    world = World()
    source = np.array([world.r0, 0.0, 0.0])
    ang = np.deg2rad(115)                              # receiver around the shell
    recv_c = world.r0 * np.array([np.cos(ang), np.sin(ang), 0.0])
    recv_r = 0.12

    # --- trace ---
    dirs = fibonacci_dirs(1800)
    traj, Lpath, nrefl = trace_bundle(world, source, dirs, n_steps=4200)

    # --- visuals ---
    render_static(world, traj, Lpath, source, recv_c, recv_r,
                  f"{OUT}/gliese_ray_bundle.png")
    render_wavefront(world, traj, source, recv_c, recv_r,
                     f"{OUT}/gliese_wavefront.mp4")

    # --- taps -> IR ---
    L, gain, nr = extract_taps(traj, Lpath, nrefl, world, recv_c, recv_r)
    target_first_ms = 70.0                             # map nearest tap here
    delay_s = L * (target_first_ms / 1000.0 / L.min())
    keep = delay_s <= 2.0                              # trim the very-late stragglers
    delay_s, gain, nr = delay_s[keep], gain[keep], nr[keep]
    print(f"taps captured: {len(delay_s)}")
    print(f"first arrival: {delay_s.min()*1000:6.1f} ms   "
          f"last: {delay_s.max()*1000:6.1f} ms")
    ir = taps_to_ir(delay_s, gain, fs)
    render_ir(delay_s, gain, ir, fs, f"{OUT}/gliese_impulse_response.png")

    # --- audio ---
    dry = dry_signal(fs)
    wet = fftconvolve(dry, ir)[:len(dry) + len(ir)]
    wet /= np.max(np.abs(wet)) + 1e-9
    mix = np.zeros(len(wet)); mix[:len(dry)] += 0.6 * dry; mix += 0.7 * wet
    mix /= np.max(np.abs(mix)) + 1e-9
    write_wav(f"{OUT}/gliese_dry.wav", dry, fs)
    write_wav(f"{OUT}/gliese_wet.wav", mix, fs)
    print("done.")


if __name__ == "__main__":
    main()
