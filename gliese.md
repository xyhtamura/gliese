# Gliese Delay — Planetary Acoustics Lab

A physics-derived multi-tap delay and reverb generator. Delay taps are derived from ray-tracing acoustic paths through a spherically-symmetric graded-index atmospheric channel (the RHO profile), rather than dialed in by hand. Based on an undergraduate physics thesis on ray propagation in a Refractive Harmonic Oscillator (RHO) profile via the Lagrangian ray-particle analogy.

Theme: **Acoustic propagation through exotic planetary atmospheres.**

---

## 1. Physics Engine & Model

The medium is defined by a refractive-index profile $n(r)$ that peaks at a sound channel axis $r_0$. The acoustic travel time is proportional to the optical path length $L = \int n(r) \, ds$.

*   **Refractive Profile $n^2(r)$**:
    *   Outer shell ($r > r_0$): Harmonic potential, force pull $-C_2 \cdot \vec{r}$, stiffness $C_2$ ($\omega_1^2$).
    *   Inner shell ($r \le r_0$): Repulsive harmonic potential, force push $+C_3 \cdot \vec{r}$, stiffness $C_3$ ($\omega_2^2$).
    *   $n^2(r) = n^2_{peak} - C_2(r^2 - r_0^2)$ for $r > r_0$
    *   $n^2(r) = n^2_{peak} - C_3(r_0^2 - r^2)$ for $r \le r_0$
*   **Ray Tracing**:
    *   Rays are launched from a point source at speed $v_0 = n(r_{source})$.
    *   Integration uses the **Velocity Verlet** algorithm with step size $dt$.
    *   Specular reflection occurs at the inner core boundary $a$ and outer boundary $b$. Each reflection flips the phase polarity and dampens amplitude by the reflection coefficient $refl$.
*   **Tap Extraction**:
    *   A tap is registered when a ray crosses into a finite receiver sphere.
    *   Gain is determined by geometric spreading ($1 / (1 + L / L_0)$) and absorption losses ($refl^{bounces}$).
    *   Delays are scaled to align the first arrival with a musical `target_first_ms` knob (e.g., 70 ms).

---

## 2. Web MVP (Planetary Acoustics Console)

The HTML/JS MVP is located in `gliese/web/` and runs entirely client-side.

*   **Structure (`index.html`)**: Follows a **CD-ROM Ecology Kiosk / Field Station Cockpit** layout. Immediate, scrollable single-screen dashboard with no hero-landing delay.
*   **Aesthetics (`style.css`)**: Built under **Eerie-Aero** design calibration:
    *   *Colors*: Plum-black (`hsl(285, 20%, 6%)`) background, dark steel-gray-green (`hsl(165, 12%, 10%)`) panels, neon aquamarine (`hsl(165, 85%, 50%)`), lime (`hsl(84, 90%, 52%)`), and amber-orange (`hsl(45, 90%, 55%)`) accents. No zero-chroma neutrals.
    *   *Tactile Events*: Asymmetric panel rounding (`border-radius: 20px 14px 24px 16px`), raised glossy buttons utilizing radial-gradient gel overlays that slump/yield under active click pressure (micro-slump interaction).
*   **Engine (`app.js`)**:
    *   *Real-time Trajectory Draft*: Traces a visual subset of rays instantly upon dragging sliders to show how physical coordinates warp the sound paths.
    *   *Wavefront Animator*: Draws a visual "Pulse" expanding, bouncing, and focusing at caustics in 3D.
    *   *Offline Audio Realizer*: Runs the convolution in a batch using `OfflineAudioContext`, preventing real-time audio stutters.
    *   *Stereo Custom Audio*: Accepts drag-and-dropped audio files, decoding and convolving in stereo if the source is multi-channel.
    *   *WAV Exporter*: Converts the output buffer into a 16-bit PCM `.wav` file for download.
    *   *URL Planets*: Slider-backed physical and acoustic parameters serialize into `#planet=v1...` links, with a cockpit copy control for sharing exact worlds.
    *   *Planet Card*: Each world shows derived acoustic quantities (tap count, arrival span, caustic peak, stiffness asymmetry, shell depth) from the current ray bundle.

---

## 3. Discoveries & Making-Process Notes

### Problem 1: Real-time Convolver Sweeps Clicking
*   **Discovery**: In the Web Audio API, updating a `ConvolverNode`'s impulse response buffer in real time during active playback causes severe clicks and audio dropouts. 
*   **Solution**: Shifted the architecture to an **Offline Convolution Pipeline**. The physics simulation and convolution run as a fast batch process inside an `OfflineAudioContext` when parameters are committed. Playback runs glitch-free from a static, cached buffer.

### Problem 2: Viewport Squashing on Short Screens
*   **Discovery**: Restricting the page height strictly to `100vh` with `overflow: hidden` (a standard mock kiosk layout) caused the bottom Acoustic Realizer and playback controls to get clipped on screens with short viewports (under ~760px).
*   **Solution**: Replaced the fixed viewport constraint with `min-height: 100vh` and `overflow-y: auto`. The main cockpit grid uses a flex-grow setting so it stretches to fill the vertical space on large viewports, while collapsing cleanly and allowing the whole page to scroll on smaller screens.

### Problem 3: Stereo Upload Convolutions
*   **Discovery**: Convolving custom user audio files in Web Audio defaults to mono output if the convolver or source buffers are hardcoded to a single channel.
*   **Solution**: Designed the offline context creation to dynamically read and inherit the channel count of the decoded audio buffer (`OfflineAudioContext(numChannels, outputLen, fs)`). Stereo WAV uploads now render as stereo convolved buffers and export as stereo WAV files.

### Problem 4: O(N) Band-Limiting
*   **Discovery**: Standard delta-impulse taps create single-sample clicks which sound metallic and harsh. The Python prototype used a full-buffer FFT convolution with a Hanning window to band-limit the taps, which is slow in JavaScript.
*   **Solution**: Instead of convolving the entire 96k sample buffer, we write a precomputed 9-point Hann window shape directly into the buffer around each tap index. This scales with $O(N_{taps})$ instead of $O(N_{buffer})$, running in under a microsecond.

---

## 4. Differentiation — Why Not Just Another Multitap

At the sample level the DSP is identical to any multitap ($\Sigma a_i \cdot x(t-\tau_i)$), and the handover doc's honest limit stands: few taps at static settings are indistinguishable from a hand-tuned delay. Differentiation therefore has to come from behaviors a hand-tuned delay *cannot* produce. Six pillars, in order of leverage:

### 4.1 Motion (the killer feature)
Sweeping one physical knob slides *all* taps along coherent physical trajectories — clusters converge/diverge, caustics sweep through the arrival pattern. No conventional delay offers one-parameter choreography of hundreds of taps. **Architectural blocker**: the current offline-convolution pipeline is commit-then-listen; motion requires a real-time tap engine (AudioWorklet reading the tap list per audio block, interpolating tap positions between physics solves as parameters move). Once taps are live objects, a **planet-morph** control (interpolate parameters between two presets and hear the atmosphere deform) falls out for free.

### 4.2 Inverted envelope & shadow zones (the fingerprint)
The deep-channel signature is an echo that *builds* — resolved early arrivals crescendo into dense clusters, then cut. A reversed-decay envelope that is physical, not reversed audio. Complementary: **shadow zones** — source/receiver geometries where no ray family reaches the receiver produce hard forbidden gaps in the IR. Conventional delays decay monotonically and have no forbidden regions. Lead the presentation with both; they are what a listener can actually point at.

### 4.3 True binaural from geometry
Place *two* receiver spheres at ear spacing and extract two tap sets from the same ray bundle. Interaural time and level differences fall out of the physics — a genuinely binaural planet, versus the current duplicate-channel stereo. No multitap derives its stereo image from propagation geometry.

### 4.4 Physically-lawful spectral behavior
Atmospheric absorption scales ~$f^2$: give each tap a one-pole lowpass whose cutoff is derived from its optical path length $L$ and bounce count. Later, more-traveled taps arrive darker *by law*, not by a generic damping knob. Cost is $O(N_{taps})$, consistent with the existing 9-point Hann trick.

### 4.5 Geometry as performance surface
Make source and receiver draggable in the 3D display, regenerating the tap structure live (pairs with 4.1). Position becomes an expressive control rather than configuration; receiver depth relative to the channel axis becomes audible geography (moving into/out of shadow zones, toward/away from caustics).

### 4.6 Planets as shareable objects
Serialize the parameter set into the URL hash so people trade *planets*, not presets. **Done in v1.1**: slider-backed world/audio parameters round-trip through `#planet=v1...`, a cockpit copy control, and a planet card of computed acoustic quantities. Remaining: add tempo-sync so `target_first_ms` can snap to note values.

**Priority note**: 4.4 and 4.6 are cheap wins inside the current offline architecture. 4.1/4.3/4.5 require the real-time tap engine and define v2.

---

## 5. Presets Configuration

*   **Earth SOFAR**: Symmetric channel, sound trapped near axis. $r_0=1.0, a=0.4, b=1.6, C_2=1.0, C_3=1.0$. Tame, balanced decay.
*   **Gliese 581g**: Strongly asymmetric shells. $r_0=1.2, a=0.3, b=1.8, C_2=0.4, C_3=2.2$. Creates double-flutter, complex lopsided echo timings.
*   **Kepler 186f**: Narrow atmosphere, high stiffness. $r_0=0.8, a=0.5, b=1.2, C_2=3.5, C_3=0.6, refl=0.85$. Dense, metallic comb-filter resonance.
*   **HD 189733b**: Deep atmosphere, high peak refraction. $r_0=1.0, a=0.1, b=2.5, C_2=1.8, C_3=1.8, refl=0.4$. Fast, scattered, highly damped reverb.
