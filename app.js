/* app.js - Gliese Delay Planetary Acoustics Lab Engine */

// --- Audio Context Setup ---
let audioCtx = null;
let renderedBuffer = null;
let activeSourceNode = null;
let isPlaying = false;
let isLooping = false;
let uploadedDryBuffer = null;

// --- State Variables for Physical Simulation ---
let world = {
    r0: 1.0,
    a: 0.4,
    b: 1.6,
    C2: 1.0,
    C3: 1.0,
    peak: 2.0,
    refl: 0.6
};

let simConfig = {
    rays: 250,
    steps: 2500,
    dt: 0.012,
    targetFirstMs: 70.0,
    mix: 0.40
};

let tempoConfig = {
    bpm: 120,
    note: 'free'
};

// Source and Receiver Coordinates
const sourcePos = { x: 1.0, y: 0.0, z: 0.0 }; // initially placed on r0 axis
const recvPos = { x: -0.42, y: 0.91, z: 0.0 };  // initially at angle 115 deg on r0 shell
const recvRadius = 0.12;

// --- Visualizer 3D State ---
let camera = {
    lat: 22.0 * Math.PI / 180, // Elevation
    azi: 35.0 * Math.PI / 180, // Azimuth
    zoom: 95.0,
    distance: 10.0,
    autoOrbit: true
};
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };
let lastTraceResult = null; // Stored results for rendering
let animationFrameId = null;
let copyFeedbackTimer = null;

// Wavefront Pulse Animation State
let isPulseActive = false;
let pulseFrame = 0;
const pulseStride = 8; // animate every 8 steps
let pulseMaxFrames = 0;

// Presets Definition
const PRESETS = {
    earth: {
        r0: 1.0, a: 0.4, b: 1.6, C2: 1.0, C3: 1.0, peak: 2.0, refl: 0.6,
        targetFirstMs: 70.0, mix: 0.40, rays: 250, steps: 2500, dt: 0.012
    },
    gliese: {
        r0: 1.2, a: 0.3, b: 1.8, C2: 0.4, C3: 2.2, peak: 2.2, refl: 0.7,
        targetFirstMs: 90.0, mix: 0.50, rays: 300, steps: 3000, dt: 0.012
    },
    kepler: {
        r0: 0.8, a: 0.5, b: 1.2, C2: 3.5, C3: 0.6, peak: 1.8, refl: 0.85,
        targetFirstMs: 40.0, mix: 0.65, rays: 350, steps: 2000, dt: 0.010
    },
    chaotic: {
        r0: 1.0, a: 0.1, b: 2.5, C2: 1.8, C3: 1.8, peak: 3.0, refl: 0.4,
        targetFirstMs: 110.0, mix: 0.30, rays: 400, steps: 2800, dt: 0.012
    }
};

const PLANET_HASH_VERSION = 'v1';
const PLANET_PARAM_KEYS = [
    'r0', 'a', 'b', 'C2', 'C3', 'peak', 'refl',
    'rays', 'steps', 'dt', 'targetFirstMs', 'mix'
];
const PLANET_INTEGER_KEYS = new Set(['rays', 'steps', 'targetFirstMs']);
const TEMPO_NOTES = {
    free: { label: 'FREE', beats: null },
    '1_8': { label: '1/8', beats: 0.5 },
    '1_8T': { label: '1/8T', beats: 1 / 3 },
    '1_16': { label: '1/16', beats: 0.25 },
    '1_16T': { label: '1/16T', beats: 1 / 6 },
    '1_32': { label: '1/32', beats: 0.125 }
};

// --- DOM References ---
const canvas3D = document.getElementById('canvas-3d');
const canvasIR = document.getElementById('canvas-ir');

// Sliders and displays
const sliders = {
    r0: document.getElementById('param-r0'),
    a: document.getElementById('param-a'),
    b: document.getElementById('param-b'),
    C2: document.getElementById('param-c2'),
    C3: document.getElementById('param-c3'),
    peak: document.getElementById('param-peak'),
    refl: document.getElementById('param-refl'),
    rays: document.getElementById('param-rays'),
    steps: document.getElementById('param-steps'),
    dt: document.getElementById('param-dt'),
    targetFirstMs: document.getElementById('param-target-first'),
    mix: document.getElementById('param-mix')
};

const displays = {
    r0: document.getElementById('val-r0'),
    a: document.getElementById('val-a'),
    b: document.getElementById('val-b'),
    C2: document.getElementById('val-c2'),
    C3: document.getElementById('val-c3'),
    peak: document.getElementById('val-peak'),
    refl: document.getElementById('val-refl'),
    rays: document.getElementById('val-rays'),
    steps: document.getElementById('val-steps'),
    dt: document.getElementById('val-dt'),
    targetFirstMs: document.getElementById('val-target-first'),
    mix: document.getElementById('val-mix'),
    tempoReadout: document.getElementById('tempo-sync-readout'),
    
    // Readouts
    lat: document.getElementById('readout-lat'),
    azi: document.getElementById('readout-azi'),
    statRays: document.getElementById('stat-rays'),
    statTaps: document.getElementById('stat-taps'),
    irArrival: document.getElementById('ir-arrival-info'),
    fileName: document.getElementById('file-name'),
    planetCode: document.getElementById('planet-code'),
    planetMetrics: {
        taps: document.getElementById('planet-metric-taps'),
        span: document.getElementById('planet-metric-span'),
        caustic: document.getElementById('planet-metric-caustic'),
        asym: document.getElementById('planet-metric-asym'),
        depth: document.getElementById('planet-metric-depth')
    },
    statusText: document.querySelector('.status-readout')
};

// Buttons
const btns = {
    orbit: document.getElementById('btn-orbit'),
    resetView: document.getElementById('btn-reset-view'),
    pulse: document.getElementById('btn-pulse'),
    generate: document.getElementById('btn-generate'),
    play: document.getElementById('btn-play'),
    stop: document.getElementById('btn-stop'),
    loop: document.getElementById('btn-loop'),
    export: document.getElementById('btn-export'),
    copyPlanet: document.getElementById('btn-copy-planet'),
    tempoNotes: document.querySelectorAll('.tempo-note-btn'),
    presets: document.querySelectorAll('.preset-btn')
};

const selectSound = document.getElementById('sound-source');
const uploadWrapper = document.getElementById('upload-wrapper');
const fileInput = document.getElementById('audio-upload');
const tempoBpmInput = document.getElementById('tempo-bpm');

// --- Initialization ---
function init() {
    setupEventListeners();
    resizeCanvases();

    const loadedPlanetFromHash = applyPlanetHashToSliders();
    
    // Load default values into state and sync sliders
    readInputs();
    
    // Set initial source and receiver positions based on r0
    updateSourceReceiverCoords();
    updateActivePresetFromState();
    updateTempoControls();
    syncPlanetHashFromState();
    if (loadedPlanetFromHash) {
        updateStatus("PLANET LINK LOADED. CLICK GENERATE.");
    }

    // Perform initial fast trace (for graphics preview only)
    runFastTrace();
    
    // Start drawing loop
    requestAnimationFrame(renderLoop);
}

// --- Event Listeners ---
function setupEventListeners() {
    window.addEventListener('resize', () => {
        resizeCanvases();
        drawIR();
    });

    // Slider inputs trigger real-time graphics updates
    Object.keys(sliders).forEach(key => {
        sliders[key].addEventListener('input', () => {
            readInputs();
            if (key === 'targetFirstMs') {
                tempoConfig.note = 'free';
            }
            // Bound checks: ensure core 'a' is inside channel 'r0' and 'r0' is inside 'b'
            let adjusted = false;
            if (key === 'a' || key === 'r0' || key === 'b') {
                if (world.a >= world.r0 - 0.05) {
                    world.a = world.r0 - 0.05;
                    sliders.a.value = world.a;
                    adjusted = true;
                }
                if (world.r0 >= world.b - 0.05) {
                    world.r0 = world.b - 0.05;
                    sliders.r0.value = world.r0;
                    adjusted = true;
                }
                if (adjusted) {
                    updateDisplays();
                }
                updateSourceReceiverCoords();
            }
            
            runFastTrace();
            invalidateRenderedBuffer();
            updateActivePresetFromState();
            updateTempoControls();
            syncPlanetHashFromState();
        });
    });

    // Preset buttons
    btns.presets.forEach(btn => {
        btn.addEventListener('click', () => {
            const presetKey = btn.dataset.preset;
            loadPreset(presetKey);
        });
    });

    if (btns.copyPlanet) {
        btns.copyPlanet.addEventListener('click', copyPlanetUrl);
    }

    if (tempoBpmInput) {
        tempoBpmInput.addEventListener('input', () => {
            tempoConfig.bpm = clampTempoBpm(tempoBpmInput.value);
            tempoBpmInput.value = tempoConfig.bpm;
            if (tempoConfig.note !== 'free') {
                applyTempoNoteToTarget();
            } else {
                updateTempoControls();
                syncPlanetHashFromState();
            }
        });
    }

    btns.tempoNotes.forEach(btn => {
        btn.addEventListener('click', () => {
            setTempoNote(btn.dataset.note);
        });
    });

    window.addEventListener('hashchange', () => {
        if (!applyPlanetHashToSliders()) return;

        readInputs();
        updateSourceReceiverCoords();
        runFastTrace();
        invalidateRenderedBuffer();
        updateActivePresetFromState();
        updateTempoControls();
        syncPlanetHashFromState();
        updateStatus("PLANET LINK LOADED. CLICK GENERATE.");
    });

    // Orbit controls
    btns.orbit.addEventListener('click', () => {
        camera.autoOrbit = !camera.autoOrbit;
        btns.orbit.classList.toggle('active', camera.autoOrbit);
    });

    btns.resetView.addEventListener('click', () => {
        camera.lat = 22.0 * Math.PI / 180;
        camera.azi = 35.0 * Math.PI / 180;
        camera.autoOrbit = false;
        btns.orbit.classList.remove('active');
        updateReadouts();
    });

    // Pulse triggering
    btns.pulse.addEventListener('click', () => {
        if (!lastTraceResult) return;
        isPulseActive = true;
        pulseFrame = 0;
        pulseMaxFrames = Math.floor(simConfig.steps / pulseStride);
    });

    // Mouse drag on 3D canvas for orbit rotation
    canvas3D.addEventListener('mousedown', (e) => {
        isDragging = true;
        camera.autoOrbit = false;
        btns.orbit.classList.remove('active');
        lastMousePos = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastMousePos.x;
        const dy = e.clientY - lastMousePos.y;
        
        camera.azi -= dx * 0.005;
        camera.lat = Math.max(-Math.PI/2 + 0.05, Math.min(Math.PI/2 - 0.05, camera.lat + dy * 0.005));
        
        lastMousePos = { x: e.clientX, y: e.clientY };
        updateReadouts();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Sound source selection
    selectSound.addEventListener('change', () => {
        if (selectSound.value === 'custom') {
            uploadWrapper.classList.remove('hidden');
        } else {
            uploadWrapper.classList.add('hidden');
        }
        invalidateRenderedBuffer();
    });

    // Custom audio file decoding
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        displays.fileName.textContent = "Loading file...";
        invalidateRenderedBuffer();
        
        initAudioContext();
        
        const reader = new FileReader();
        reader.onload = function(evt) {
            audioCtx.decodeAudioData(evt.target.result)
                .then(decoded => {
                    uploadedDryBuffer = decoded;
                    displays.fileName.textContent = file.name + ` (${decoded.duration.toFixed(1)}s)`;
                    updateStatus("CUSTOM AUDIO LOADED. READY TO GENERATE ACOUSTICS.");
                })
                .catch(err => {
                    console.error("Audio decode error:", err);
                    displays.fileName.textContent = "Decode failed.";
                    uploadedDryBuffer = null;
                });
        };
        reader.readAsArrayBuffer(file);
    });

    // Action triggers
    btns.generate.addEventListener('click', generateAcoustics);
    btns.play.addEventListener('click', playAudio);
    btns.stop.addEventListener('click', stopAudio);
    btns.loop.addEventListener('click', toggleLoop);
    btns.export.addEventListener('click', exportAudioWav);

    // Drag and drop uploader on the player pod container
    const playerPod = document.querySelector('.player-pod');
    
    ['dragenter', 'dragover'].forEach(eventName => {
        playerPod.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            playerPod.classList.add('drag-over');
        }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        playerPod.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            playerPod.classList.remove('drag-over');
        }, false);
    });
    
    playerPod.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('audio/')) {
                selectSound.value = 'custom';
                uploadWrapper.classList.remove('hidden');
                displays.fileName.textContent = "Loading file...";
                invalidateRenderedBuffer();
                initAudioContext();
                
                const reader = new FileReader();
                reader.onload = function(evt) {
                    audioCtx.decodeAudioData(evt.target.result)
                        .then(decoded => {
                            uploadedDryBuffer = decoded;
                            displays.fileName.textContent = file.name + ` (${decoded.duration.toFixed(1)}s)`;
                            updateStatus("CUSTOM AUDIO DROPPED. READY TO GENERATE ACOUSTICS.");
                        })
                        .catch(err => {
                            console.error("Audio decode error:", err);
                            displays.fileName.textContent = "Decode failed.";
                            uploadedDryBuffer = null;
                        });
                };
                reader.readAsArrayBuffer(file);
            } else {
                updateStatus("ERROR: DROPPED FILE IS NOT AUDIO.");
            }
        }
    }, false);
}

// --- Setup helper functions ---
function resizeCanvases() {
    // 3D Canvas
    const d3Rect = canvas3D.parentElement.getBoundingClientRect();
    canvas3D.width = d3Rect.width;
    canvas3D.height = d3Rect.height;
    
    // Zoom factor based on canvas size
    camera.zoom = Math.min(canvas3D.width, canvas3D.height) / (world.b * 2.3);

    // IR Canvas
    const irRect = canvasIR.parentElement.getBoundingClientRect();
    canvasIR.width = irRect.width;
    canvasIR.height = irRect.height;
}

function readInputs() {
    // Read parameters from inputs
    world.r0 = parseFloat(sliders.r0.value);
    world.a = parseFloat(sliders.a.value);
    world.b = parseFloat(sliders.b.value);
    world.C2 = parseFloat(sliders.C2.value);
    world.C3 = parseFloat(sliders.C3.value);
    world.peak = parseFloat(sliders.peak.value);
    world.refl = parseFloat(sliders.refl.value);

    simConfig.rays = parseInt(sliders.rays.value);
    simConfig.steps = parseInt(sliders.steps.value);
    simConfig.dt = parseFloat(sliders.dt.value);
    simConfig.targetFirstMs = parseFloat(sliders.targetFirstMs.value);
    simConfig.mix = parseFloat(sliders.mix.value) / 100.0;

    updateDisplays();
}

function updateDisplays() {
    displays.r0.textContent = world.r0.toFixed(2);
    displays.a.textContent = world.a.toFixed(2);
    displays.b.textContent = world.b.toFixed(2);
    displays.C2.textContent = world.C2.toFixed(2);
    displays.C3.textContent = world.C3.toFixed(2);
    displays.peak.textContent = world.peak.toFixed(2);
    displays.refl.textContent = world.refl.toFixed(2);
    displays.rays.textContent = simConfig.rays;
    displays.steps.textContent = simConfig.steps;
    displays.dt.textContent = simConfig.dt.toFixed(3);
    displays.targetFirstMs.textContent = simConfig.targetFirstMs + " ms";
    displays.mix.textContent = Math.round(simConfig.mix * 100) + " %";
    
    displays.statRays.textContent = simConfig.rays;
}

function updateReadouts() {
    displays.lat.textContent = (camera.lat * 180 / Math.PI).toFixed(1) + "°";
    displays.azi.textContent = (camera.azi * 180 / Math.PI).toFixed(1) + "°";
}

function updateSourceReceiverCoords() {
    // Source placed on peak axis (r0) at zero angle
    sourcePos.x = world.r0;
    sourcePos.y = 0.0;
    sourcePos.z = 0.0;

    // Receiver placed on peak axis (r0) at angle 115 degrees
    const ang = 115.0 * Math.PI / 180;
    recvPos.x = world.r0 * Math.cos(ang);
    recvPos.y = world.r0 * Math.sin(ang);
    recvPos.z = 0.0;
}

function loadPreset(key) {
    const config = PRESETS[key];
    if (!config) return;

    applyPlanetConfigToSliders(config);
    tempoConfig.note = 'free';

    readInputs();
    updateSourceReceiverCoords();
    runFastTrace();
    invalidateRenderedBuffer();
    updateActivePresetFromState();
    updateTempoControls();
    syncPlanetHashFromState();
    updateStatus(`PRESET LOADED: ${key.toUpperCase()}. CLICK GENERATE.`);
}

function getPlanetConfigFromState() {
    return {
        r0: world.r0,
        a: world.a,
        b: world.b,
        C2: world.C2,
        C3: world.C3,
        peak: world.peak,
        refl: world.refl,
        rays: simConfig.rays,
        steps: simConfig.steps,
        dt: simConfig.dt,
        targetFirstMs: simConfig.targetFirstMs,
        mix: simConfig.mix
    };
}

function planetValueToSliderValue(key, value) {
    return key === 'mix' ? value * 100.0 : value;
}

function clampSliderValue(key, value) {
    const slider = sliders[key];
    if (!slider) return value;

    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const step = parseFloat(slider.step);
    let clamped = Number(value);

    if (!Number.isFinite(clamped)) return null;
    if (Number.isFinite(min)) clamped = Math.max(min, clamped);
    if (Number.isFinite(max)) clamped = Math.min(max, clamped);

    if (Number.isFinite(step) && step > 0 && Number.isFinite(min)) {
        clamped = Math.round((clamped - min) / step) * step + min;
        const decimals = getDecimalPlaces(slider.step);
        clamped = Number(clamped.toFixed(Math.max(decimals, 3)));
    }

    return clamped;
}

function getDecimalPlaces(value) {
    const text = String(value);
    const dotIndex = text.indexOf('.');
    return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

function applyPlanetConfigToSliders(config) {
    PLANET_PARAM_KEYS.forEach(key => {
        if (config[key] === undefined || !sliders[key]) return;

        const sliderValue = clampSliderValue(key, planetValueToSliderValue(key, config[key]));
        if (sliderValue === null) return;
        sliders[key].value = sliderValue;
    });
}

function clampTempoBpm(value) {
    const bpm = Number(value);
    if (!Number.isFinite(bpm)) return tempoConfig.bpm;
    return Math.max(40, Math.min(240, Math.round(bpm)));
}

function setTempoNote(noteKey) {
    tempoConfig.note = TEMPO_NOTES[noteKey] ? noteKey : 'free';

    if (tempoConfig.note !== 'free') {
        applyTempoNoteToTarget();
    } else {
        updateTempoControls();
        syncPlanetHashFromState();
    }
}

function getTempoTargetMs(noteKey = tempoConfig.note) {
    const note = TEMPO_NOTES[noteKey];
    if (!note || note.beats === null) return null;
    return (60000.0 / tempoConfig.bpm) * note.beats;
}

function applyTempoNoteToTarget() {
    const targetMs = getTempoTargetMs();
    if (!Number.isFinite(targetMs)) return;

    const sliderValue = clampSliderValue('targetFirstMs', targetMs);
    if (sliderValue === null) return;

    sliders.targetFirstMs.value = sliderValue;
    readInputs();
    runFastTrace();
    invalidateRenderedBuffer();
    updateActivePresetFromState();
    updateTempoControls();
    syncPlanetHashFromState();
}

function updateTempoControls() {
    if (tempoBpmInput) {
        tempoBpmInput.value = tempoConfig.bpm;
    }

    btns.tempoNotes.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.note === tempoConfig.note);
    });

    if (!displays.tempoReadout) return;

    if (tempoConfig.note === 'free') {
        displays.tempoReadout.textContent = 'First arrival free';
        return;
    }

    const note = TEMPO_NOTES[tempoConfig.note];
    displays.tempoReadout.textContent = `${note.label} @ ${tempoConfig.bpm} BPM -> ${Math.round(simConfig.targetFirstMs)} ms`;
}

function parsePlanetHash() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash) return null;

    const params = new URLSearchParams(hash);
    if (params.get('planet') !== PLANET_HASH_VERSION) return null;

    const config = {};
    let validCount = 0;

    PLANET_PARAM_KEYS.forEach(key => {
        if (!params.has(key)) return;

        const value = Number(params.get(key));
        if (!Number.isFinite(value)) return;

        config[key] = value;
        validCount += 1;
    });

    if (params.has('tempoBpm')) {
        config.tempoBpm = clampTempoBpm(params.get('tempoBpm'));
    }

    if (params.has('tempoNote')) {
        const noteKey = params.get('tempoNote');
        config.tempoNote = TEMPO_NOTES[noteKey] ? noteKey : 'free';
    }

    return validCount > 0 ? config : null;
}

function applyPlanetHashToSliders() {
    const config = parsePlanetHash();
    if (!config) return false;

    applyPlanetConfigToSliders(config);
    tempoConfig.bpm = config.tempoBpm || 120;
    tempoConfig.note = config.tempoNote || 'free';
    return true;
}

function formatPlanetHashValue(key, value) {
    if (PLANET_INTEGER_KEYS.has(key)) return String(Math.round(value));
    if (key === 'dt' || key === 'mix') return Number(value.toFixed(3)).toString();
    return Number(value.toFixed(2)).toString();
}

function serializePlanetParams() {
    const params = new URLSearchParams();
    const config = getPlanetConfigFromState();

    params.set('planet', PLANET_HASH_VERSION);
    PLANET_PARAM_KEYS.forEach(key => {
        params.set(key, formatPlanetHashValue(key, config[key]));
    });
    params.set('tempoBpm', String(tempoConfig.bpm));
    params.set('tempoNote', tempoConfig.note);

    return params.toString();
}

function getPlanetUrl() {
    const url = new URL(window.location.href);
    url.hash = serializePlanetParams();
    return url.toString();
}

function syncPlanetHashFromState() {
    const hash = serializePlanetParams();
    const currentHash = window.location.hash.replace(/^#/, '');

    if (currentHash !== hash) {
        const url = new URL(window.location.href);
        url.hash = hash;
        window.history.replaceState(null, '', url.toString());
    }

    updatePlanetLinkDisplay();
}

function updatePlanetLinkDisplay() {
    if (!displays.planetCode) return;
    displays.planetCode.textContent = `#${serializePlanetParams()}`;
}

function scalePlanetTaps(taps) {
    if (!taps || taps.length === 0) return [];

    const targetFirstS = simConfig.targetFirstMs / 1000.0;
    const minL = Math.min(...taps.map(t => t.L));

    if (!Number.isFinite(minL) || minL <= 0) return [];

    return taps.map(t => ({
        delayMs: t.L * (targetFirstS / minL) * 1000.0,
        gain: t.gain,
        nr: t.nr
    }));
}

function formatMetricMs(ms) {
    if (!Number.isFinite(ms)) return '--';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
    return `${Math.round(ms)} ms`;
}

function formatMetricSpan(firstMs, lastMs) {
    if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return '--';
    if (lastMs >= 1000) {
        return `${(firstMs / 1000).toFixed(2)}-${(lastMs / 1000).toFixed(2)} s`;
    }
    return `${Math.round(firstMs)}-${Math.round(lastMs)} ms`;
}

function getCausticPeakMs(scaledTaps) {
    if (!scaledTaps || scaledTaps.length === 0) return null;

    const binMs = 25;
    const bins = new Map();

    scaledTaps.forEach(t => {
        const bin = Math.round(t.delayMs / binMs);
        bins.set(bin, (bins.get(bin) || 0) + Math.abs(t.gain));
    });

    let peakBin = null;
    let peakEnergy = -Infinity;
    bins.forEach((energy, bin) => {
        if (energy > peakEnergy) {
            peakEnergy = energy;
            peakBin = bin;
        }
    });

    return peakBin === null ? null : peakBin * binMs;
}

function formatAsymmetry() {
    const ratio = world.C3 / world.C2;
    if (!Number.isFinite(ratio) || ratio <= 0) return '--';
    if (Math.abs(ratio - 1.0) < 0.05) return 'BALANCED';
    if (ratio > 1.0) return `${ratio.toFixed(2)}x IN`;
    return `${(1.0 / ratio).toFixed(2)}x OUT`;
}

function updatePlanetCard(traceResult = lastTraceResult) {
    const metricDisplays = displays.planetMetrics;
    if (!metricDisplays) return;

    const taps = traceResult?.taps || [];
    const scaledTaps = scalePlanetTaps(taps);
    const causticMs = getCausticPeakMs(scaledTaps);

    if (metricDisplays.taps) metricDisplays.taps.textContent = String(taps.length);
    if (metricDisplays.asym) metricDisplays.asym.textContent = formatAsymmetry();
    if (metricDisplays.depth) metricDisplays.depth.textContent = `${(world.b - world.a).toFixed(2)} R`;

    if (scaledTaps.length === 0) {
        if (metricDisplays.span) metricDisplays.span.textContent = 'SHADOW';
        if (metricDisplays.caustic) metricDisplays.caustic.textContent = '--';
        return;
    }

    const arrivals = scaledTaps.map(t => t.delayMs);
    const firstMs = Math.min(...arrivals);
    const lastMs = Math.max(...arrivals);

    if (metricDisplays.span) metricDisplays.span.textContent = formatMetricSpan(firstMs, lastMs);
    if (metricDisplays.caustic) metricDisplays.caustic.textContent = formatMetricMs(causticMs);
}

function updateActivePresetFromState() {
    const current = getPlanetConfigFromState();
    let activePreset = null;

    Object.entries(PRESETS).forEach(([key, config]) => {
        const isMatch = PLANET_PARAM_KEYS.every(paramKey => {
            const currentValue = current[paramKey];
            const presetValue = config[paramKey];
            return Math.abs(currentValue - presetValue) < 0.0005;
        });

        if (isMatch) activePreset = key;
    });

    btns.presets.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === activePreset);
    });
}

async function copyPlanetUrl() {
    syncPlanetHashFromState();

    const url = getPlanetUrl();
    let copied = false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
            await navigator.clipboard.writeText(url);
            copied = true;
        } catch (err) {
            copied = false;
        }
    }

    if (!copied) {
        copied = fallbackCopyText(url);
    }

    setCopyPlanetFeedback(copied ? 'COPIED' : 'COPY FAILED');
    updateStatus(copied ? "PLANET URL COPIED." : "COPY FAILED. SELECT THE HASH FIELD.");
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.setAttribute('readonly', '');
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();

    let copied = false;
    try {
        copied = document.execCommand('copy');
    } catch (err) {
        copied = false;
    }

    document.body.removeChild(textArea);
    return copied;
}

function setCopyPlanetFeedback(label) {
    if (!btns.copyPlanet) return;

    window.clearTimeout(copyFeedbackTimer);
    btns.copyPlanet.textContent = label;
    copyFeedbackTimer = window.setTimeout(() => {
        btns.copyPlanet.textContent = 'COPY PLANET URL';
    }, 1400);
}

function invalidateRenderedBuffer() {
    renderedBuffer = null;
    btns.play.disabled = true;
    btns.stop.disabled = true;
    btns.loop.disabled = true;
    btns.export.disabled = true;
    btns.play.classList.remove('active-play');
}

function updateStatus(text) {
    if (!displays.statusText) return;
    displays.statusText.textContent = text;
}

// --- Physical Functions ---
function getn2(r) {
    if (r > world.r0) {
        return world.peak - world.C2 * (r*r - world.r0*world.r0);
    } else {
        return world.peak - world.C3 * (world.r0*world.r0 - r*r);
    }
}

function getn(r) {
    return Math.sqrt(Math.max(1e-9, getn2(r)));
}

// Fibonacci sphere mapping for ray directions
function getFibonacciDirections(n) {
    const dirs = [];
    const gold = Math.PI * (1 + Math.sqrt(5));
    for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const phi = Math.acos(1 - 2 * t);
        const theta = gold * (i + 0.5);
        
        dirs.push({
            x: Math.sin(phi) * Math.cos(theta),
            y: Math.sin(phi) * Math.sin(theta),
            z: Math.cos(phi)
        });
    }
    return dirs;
}

// --- Velocity Verlet Ray Tracer ---
// Runs a fast simulation of a few rays for 3D graphic display and tap counting
function runFastTrace() {
    const traceResult = runVerletTrace(simConfig.rays, simConfig.steps, simConfig.dt);
    lastTraceResult = traceResult;
    displays.statTaps.textContent = traceResult.taps.length;
    updatePlanetCard(traceResult);
}

function runVerletTrace(numRays, maxSteps, dt) {
    const N = numRays;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pz = new Float32Array(N);

    const vx = new Float32Array(N);
    const vy = new Float32Array(N);
    const vz = new Float32Array(N);

    const ax = new Float32Array(N);
    const ay = new Float32Array(N);
    const az = new Float32Array(N);

    const Lpath = new Float32Array(N);
    const nrefl = new Int32Array(N);
    const inside = new Uint8Array(N);

    const r_source = Math.sqrt(sourcePos.x**2 + sourcePos.y**2 + sourcePos.z**2);
    const speed = getn(r_source);
    const dirs = getFibonacciDirections(N);

    // Initialise positions and velocities
    for (let i = 0; i < N; i++) {
        px[i] = sourcePos.x;
        py[i] = sourcePos.y;
        pz[i] = sourcePos.z;

        vx[i] = dirs[i].x * speed;
        vy[i] = dirs[i].y * speed;
        vz[i] = dirs[i].z * speed;

        const r = r_source;
        const k = (r > world.r0) ? -world.C2 : world.C3;
        ax[i] = k * px[i];
        ay[i] = k * py[i];
        az[i] = k * pz[i];
    }

    // Trajectory capture (only capture 40 rays for visualization)
    const visRayCount = Math.min(N, 40);
    const visStride = 8;
    const maxVisSteps = Math.ceil(maxSteps / visStride);
    const visTraj = [];
    for (let i = 0; i < visRayCount; i++) {
        visTraj.push(new Float32Array(maxVisSteps * 3));
    }
    let visStepIdx = 0;

    // Wavefront pulse capture (captures all rays at high stride to animate expand)
    const wfRayCount = Math.min(N, 200); // max 200 points to keep canvas fast
    const wfTraj = new Float32Array(maxSteps * wfRayCount * 3);

    const taps = [];

    // Integration loop
    for (let s = 0; s < maxSteps; s++) {
        const isVisStep = (s % visStride === 0);
        const wfOffset = s * wfRayCount * 3;

        for (let i = 0; i < N; i++) {
            const old_px = px[i], old_py = py[i], old_pz = pz[i];

            // Velocity Verlet: Position update
            const vx_half = vx[i] + 0.5 * ax[i] * dt;
            const vy_half = vy[i] + 0.5 * ay[i] * dt;
            const vz_half = vz[i] + 0.5 * az[i] * dt;

            let npx = old_px + vx_half * dt;
            let npy = old_py + vy_half * dt;
            let npz = old_pz + vz_half * dt;

            // Reflect boundaries
            let nr = Math.sqrt(npx*npx + npy*npy + npz*npz);
            if (nr > world.b || nr < world.a) {
                nrefl[i]++;
                const nx = npx / nr;
                const ny = npy / nr;
                const nz = npz / nr;

                const vn = vx_half * nx + vy_half * ny + vz_half * nz;
                
                // Reflect velocity
                const rvx = vx_half - 2 * vn * nx;
                const rvy = vy_half - 2 * vn * ny;
                const rvz = vz_half - 2 * vn * nz;

                // Nudge position inside
                const tgt = Math.max(world.a + 1e-6, Math.min(world.b - 1e-6, nr));
                npx = nx * tgt;
                npy = ny * tgt;
                npz = nz * tgt;
                nr = tgt;

                vx[i] = rvx;
                vy[i] = rvy;
                vz[i] = rvz;
            } else {
                vx[i] = vx_half;
                vy[i] = vy_half;
                vz[i] = vz_half;
            }

            // New acceleration
            const nk = (nr > world.r0) ? -world.C2 : world.C3;
            const nax = nk * npx;
            const nay = nk * npy;
            const naz = nk * npz;

            // Velocity final update
            vx[i] += 0.5 * nax * dt;
            vy[i] += 0.5 * nay * dt;
            vz[i] += 0.5 * naz * dt;

            ax[i] = nax; ay[i] = nay; az[i] = naz;
            px[i] = npx; py[i] = npy; pz[i] = npz;

            // Optical path calculation
            const dx = npx - old_px;
            const dy = npy - old_py;
            const dz = npz - old_pz;
            const ds = Math.sqrt(dx*dx + dy*dy + dz*dz);
            const rmid = Math.sqrt((0.5*(npx+old_px))**2 + (0.5*(npy+old_py))**2 + (0.5*(npz+old_pz))**2);
            Lpath[i] += getn(rmid) * ds;

            // Check receiver collision
            const rx = npx - recvPos.x;
            const ry = npy - recvPos.y;
            const rz = npz - recvPos.z;
            const dist = Math.sqrt(rx*rx + ry*ry + rz*rz);
            const is_inside = dist < recvRadius;

            if (is_inside && inside[i] === 0) {
                inside[i] = 1;
                const L = Lpath[i];
                const nr_count = nrefl[i];
                const spreading = 1.0 / (1.0 + L / 2.0); // L0 = 2.0
                const gain = spreading * Math.pow(world.refl, nr_count) * (nr_count % 2 === 0 ? 1.0 : -1.0);
                taps.push({ L, gain, nr: nr_count });
            } else if (!is_inside) {
                inside[i] = 0;
            }

            // Store visual trajectory paths
            if (i < visRayCount && isVisStep) {
                const offset = visStepIdx * 3;
                visTraj[i][offset] = npx;
                visTraj[i][offset+1] = npy;
                visTraj[i][offset+2] = npz;
            }

            // Store wavefront positions
            if (i < wfRayCount) {
                const offset = wfOffset + i * 3;
                wfTraj[offset] = npx;
                wfTraj[offset+1] = npy;
                wfTraj[offset+2] = npz;
            }
        }
        if (isVisStep) {
            visStepIdx++;
        }
    }

    return {
        visTraj,
        wfTraj,
        wfRayCount,
        taps
    };
}

// --- Graphical Rendering (Canvas 3D & IR) ---
function renderLoop() {
    if (camera.autoOrbit) {
        camera.azi += 0.003;
        if (camera.azi > 2*Math.PI) camera.azi -= 2*Math.PI;
        updateReadouts();
    }

    draw3D();
    
    // Wavefront animation state progression
    if (isPulseActive) {
        pulseFrame++;
        if (pulseFrame >= pulseMaxFrames) {
            isPulseActive = false;
        }
    }

    animationFrameId = requestAnimationFrame(renderLoop);
}

// Helper to project 3D point to orthographic screen coordinates
function project(pos) {
    const cosA = Math.cos(camera.azi);
    const sinA = Math.sin(camera.azi);
    const cosE = Math.cos(camera.lat);
    const sinE = Math.sin(camera.lat);

    // Y-axis horizontal rotation (azimuth)
    const x1 = pos.x * cosA - pos.z * sinA;
    const z1 = pos.x * sinA + pos.z * cosA;
    const y1 = pos.y;

    // X-axis vertical rotation (elevation)
    const x2 = x1;
    const y2 = y1 * cosE - z1 * sinE;
    const z2 = y1 * sinE + z1 * cosE;

    // Orthographic projection centered on canvas
    const cx = canvas3D.width / 2;
    const cy = canvas3D.height / 2;

    return {
        x: cx + x2 * camera.zoom,
        y: cy - y2 * camera.zoom,
        z: z2 // depth parameter for coloring or sorting
    };
}

// Draw a wireframe circle of radius R perpendicular to normal axes
function drawWireframeSphere(ctx, R, color, dash = []) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;
    ctx.setLineDash(dash);

    // Draw 3 horizontal rings (latitudes)
    const latAngles = [0, -Math.PI/4, Math.PI/4];
    latAngles.forEach(la => {
        ctx.beginPath();
        const rLat = R * Math.cos(la);
        const zLat = R * Math.sin(la);
        for (let i = 0; i <= 60; i++) {
            const th = (i / 60) * 2 * Math.PI;
            const pt = {
                x: rLat * Math.cos(th),
                y: rLat * Math.sin(th),
                z: zLat
            };
            const screen = project(pt);
            if (i === 0) ctx.moveTo(screen.x, screen.y);
            else ctx.lineTo(screen.x, screen.y);
        }
        ctx.stroke();
    });

    // Draw 4 vertical rings (longitudes)
    const lonAngles = [0, Math.PI/4, Math.PI/2, 3*Math.PI/4];
    lonAngles.forEach(lo => {
        ctx.beginPath();
        for (let i = 0; i <= 60; i++) {
            const phi = (i / 60) * 2 * Math.PI;
            const pt = {
                x: R * Math.cos(phi) * Math.cos(lo),
                y: R * Math.sin(phi),
                z: R * Math.cos(phi) * Math.sin(lo)
            };
            const screen = project(pt);
            if (i === 0) ctx.moveTo(screen.x, screen.y);
            else ctx.lineTo(screen.x, screen.y);
        }
        ctx.stroke();
    });

    ctx.restore();
}

function draw3D() {
    const ctx = canvas3D.getContext('2d');
    ctx.clearRect(0, 0, canvas3D.width, canvas3D.height);

    // Background aesthetic grids
    ctx.strokeStyle = 'hsl(285, 20%, 10%)';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([]);
    
    // Draw outer shells
    drawWireframeSphere(ctx, world.b, 'rgba(157, 78, 221, 0.15)'); // Outer boundary
    drawWireframeSphere(ctx, world.r0, 'rgba(0, 240, 255, 0.35)', [4, 4]); // Peak axis
    drawWireframeSphere(ctx, world.a, 'rgba(118, 200, 147, 0.15)'); // Core

    // Draw static ray trajectories
    if (lastTraceResult && !isPulseActive) {
        ctx.save();
        ctx.lineWidth = 0.6;
        ctx.setLineDash([]);
        
        const paths = lastTraceResult.visTraj;
        paths.forEach((p, idx) => {
            ctx.beginPath();
            const totalSteps = p.length / 3;
            // Draw lines colored by travel length (plasma gradient mock)
            const hue = 285 - (idx / paths.length) * 120; // purple to cyan
            ctx.strokeStyle = `hsla(${hue}, 80%, 55%, 0.28)`;

            for (let s = 0; s < totalSteps; s++) {
                const sPos = { x: p[s*3], y: p[s*3+1], z: p[s*3+2] };
                const scr = project(sPos);
                if (s === 0) ctx.moveTo(scr.x, scr.y);
                else ctx.lineTo(scr.x, scr.y);
            }
            ctx.stroke();
        });
        ctx.restore();
    }

    // Draw Wavefront animation
    if (lastTraceResult && isPulseActive) {
        ctx.save();
        const stepIdx = pulseFrame * pulseStride;
        const offset = stepIdx * lastTraceResult.wfRayCount * 3;
        
        // Draw path traces leading up to wavefront
        ctx.lineWidth = 0.4;
        ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
        const paths = lastTraceResult.visTraj;
        paths.forEach((p) => {
            ctx.beginPath();
            const maxDrawSteps = Math.min(p.length / 3, stepIdx / 8);
            for (let s = 0; s < maxDrawSteps; s++) {
                const scr = project({ x: p[s*3], y: p[s*3+1], z: p[s*3+2] });
                if (s === 0) ctx.moveTo(scr.x, scr.y);
                else ctx.lineTo(scr.x, scr.y);
            }
            ctx.stroke();
        });

        // Draw propagating particles
        for (let i = 0; i < lastTraceResult.wfRayCount; i++) {
            const rx = lastTraceResult.wfTraj[offset + i*3];
            const ry = lastTraceResult.wfTraj[offset + i*3+1];
            const rz = lastTraceResult.wfTraj[offset + i*3+2];
            
            const scr = project({ x: rx, y: ry, z: rz });
            
            // Color based on radial position
            const rNorm = Math.sqrt(rx*rx + ry*ry + rz*rz);
            const ratio = (rNorm - world.a) / (world.b - world.a);
            const hue = 165 + ratio * 120; // Cyan -> Purple
            
            ctx.beginPath();
            ctx.arc(scr.x, scr.y, 1.8, 0, 2*Math.PI);
            ctx.fillStyle = `hsl(${hue}, 95%, 65%)`;
            ctx.fill();
        }
        ctx.restore();
    }

    // Draw source point
    const scrSource = project(sourcePos);
    ctx.beginPath();
    ctx.arc(scrSource.x, scrSource.y, 5, 0, 2*Math.PI);
    ctx.fillStyle = varColor('--clr-lime');
    ctx.shadowBlur = 10;
    ctx.shadowColor = varColor('--clr-lime');
    ctx.fill();
    ctx.shadowBlur = 0; // reset

    // Draw receiver sphere
    const scrRecv = project(recvPos);
    ctx.save();
    ctx.beginPath();
    ctx.arc(scrRecv.x, scrRecv.y, recvRadius * camera.zoom, 0, 2*Math.PI);
    ctx.fillStyle = 'rgba(255, 51, 102, 0.15)';
    ctx.strokeStyle = varColor('--clr-coral');
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 8;
    ctx.shadowColor = varColor('--clr-coral');
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

// Get variable color value in hex or hsl string
function varColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Draw extracted impulse response
function drawIR() {
    const ctx = canvasIR.getContext('2d');
    ctx.clearRect(0, 0, canvasIR.width, canvasIR.height);

    const w = canvasIR.width;
    const h = canvasIR.height;
    const centerY = h / 2;

    // Draw grid background
    ctx.strokeStyle = 'hsl(285, 20% , 11%)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    // vertical gridlines every 20% width
    for (let x = 0.2; x < 1.0; x += 0.2) {
        ctx.moveTo(x * w, 0);
        ctx.lineTo(x * w, h);
    }
    // center horizontal line
    ctx.moveTo(0, centerY);
    ctx.lineTo(w, centerY);
    ctx.stroke();

    if (!lastTraceResult || lastTraceResult.taps.length === 0) {
        ctx.fillStyle = varColor('--text-dim');
        ctx.font = '12px ' + varColor('--font-mono');
        ctx.textAlign = 'center';
        ctx.fillText('NO DATA SIGNAL. GENERATE ACOUSTICS TO MAP PATHS.', w / 2, centerY + 4);
        return;
    }

    const taps = lastTraceResult.taps;
    
    // Extracted delay values scaled
    const L_vals = taps.map(t => t.L);
    const minL = Math.min(...L_vals);
    const targetFirstS = simConfig.targetFirstMs / 1000.0;
    
    const scaledTaps = taps.map(t => {
        const tSec = t.L * (targetFirstS / minL);
        return {
            delay: tSec,
            gain: t.gain,
            nr: t.nr
        };
    }).filter(t => t.delay <= 2.0); // trim at 2.0s

    const maxDelay = Math.max(...scaledTaps.map(t => t.delay), 0.1);
    
    // Draw stems
    scaledTaps.forEach(t => {
        const x = (t.delay / maxDelay) * (w - 40) + 20;
        const amplitude = t.gain * (centerY - 15);
        const y = centerY - amplitude;

        ctx.beginPath();
        ctx.moveTo(x, centerY);
        ctx.lineTo(x, y);

        // Color nodes by reflection bounces
        let color = varColor('--clr-cyan');
        if (t.nr > 4) color = varColor('--clr-purple');
        else if (t.nr > 2) color = varColor('--clr-amber');
        else if (t.nr > 0) color = varColor('--clr-lime');

        ctx.strokeStyle = color + '80';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, 2*Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
    });

    // Write metadata
    displays.irArrival.textContent = `Taps: ${scaledTaps.length} | Duration: ${(maxDelay * 1000).toFixed(0)} ms`;
}

// --- Audio Generation & Convolution (Offline Rendering) ---
function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Generate the Hanning window smoothed Impulse Response buffer
function buildImpulseResponse(taps, fs) {
    const targetFirstS = simConfig.targetFirstMs / 1000.0;
    const L_vals = taps.map(t => t.L);
    const minL = Math.min(...L_vals);

    const scaledTaps = taps.map(t => {
        const tSec = t.L * (targetFirstS / minL);
        return {
            delay: tSec,
            gain: t.gain
        };
    }).filter(t => t.delay <= 2.0);

    const maxDelay = Math.max(...scaledTaps.map(t => t.delay), 0.1);
    const irLength = Math.ceil((maxDelay + 0.05) * fs);
    const ir = new Float32Array(irLength);

    // 9-point Hanning window coefficients normalized (summing to 1)
    const HANN = [0.0, 0.03661165, 0.125, 0.21338835, 0.25, 0.21338835, 0.125, 0.03661165, 0.0];

    scaledTaps.forEach(t => {
        const centerIdx = Math.round(t.delay * fs);
        for (let offset = -4; offset <= 4; offset++) {
            const idx = centerIdx + offset;
            if (idx >= 0 && idx < irLength) {
                ir[idx] += t.gain * HANN[offset + 4];
            }
        }
    });

    // Normalize
    let maxVal = 1e-9;
    for (let i = 0; i < irLength; i++) {
        if (Math.abs(ir[i]) > maxVal) maxVal = Math.abs(ir[i]);
    }
    for (let i = 0; i < irLength; i++) {
        ir[i] /= maxVal;
    }

    return ir;
}

// Synth Pluck sequence dry signal
function buildDryPluckSignal(fs) {
    const dur = 3.4;
    const length = Math.round(dur * fs);
    const sig = new Float32Array(length);

    function addPluck(f0, t0) {
        const pDur = 0.9;
        const pLength = Math.round(pDur * fs);
        const startIdx = Math.round(t0 * fs);
        for (let i = 0; i < pLength; i++) {
            const t = i / fs;
            if (startIdx + i >= length) break;
            const env = Math.exp(-t * 7);
            const tone = (Math.sin(2 * Math.PI * f0 * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f0 * t)) * env;
            
            let click = 0;
            if (i < 40) {
                // Hanning click burst
                click = 0.5 * (1 - Math.cos(2 * Math.PI * i / 39));
            }
            sig[startIdx + i] += 0.8 * tone + 0.5 * click;
        }
    }

    addPluck(196, 0.05);
    addPluck(262, 0.75);
    addPluck(330, 1.35);
    addPluck(262, 1.9);

    // Normalize
    let maxVal = 1e-9;
    for (let i = 0; i < length; i++) {
        if (Math.abs(sig[i]) > maxVal) maxVal = Math.abs(sig[i]);
    }
    for (let i = 0; i < length; i++) {
        sig[i] = (sig[i] / maxVal) * 0.9;
    }

    return sig;
}

// click burst impulse signal
function buildDryClickSignal(fs) {
    const dur = 1.0;
    const length = Math.round(dur * fs);
    const sig = new Float32Array(length);
    
    // Simple click burst at t=0.1
    const start = Math.round(0.1 * fs);
    for (let i = 0; i < 60; i++) {
        if (start + i < length) {
            // Hanning burst shape
            sig[start + i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / 59));
        }
    }
    return sig;
}

function generateAcoustics() {
    updateStatus("GENERATING DENSE RAY PATHS...");
    btns.generate.disabled = true;

    // Enforce AudioContext initialization
    initAudioContext();

    // 1. Run simulation with high ray density
    const traceResult = runVerletTrace(simConfig.rays, simConfig.steps, simConfig.dt);
    lastTraceResult = traceResult;
    displays.statTaps.textContent = traceResult.taps.length;

    // Draw update
    drawIR();

    if (traceResult.taps.length === 0) {
        updateStatus("ERROR: ZERO TAPS CAPTURED. WIDEN THE RECEIVER OR ROTATE CORE.");
        btns.generate.disabled = false;
        return;
    }

    const fs = audioCtx.sampleRate;

    // 2. Generate Impulse Response array
    const irBufferData = buildImpulseResponse(traceResult.taps, fs);

    // 3. Assemble dry signal
    let dryAudioBuf = null;
    const soundType = selectSound.value;

    if (soundType === 'pluck') {
        const drySignal = buildDryPluckSignal(fs);
        dryAudioBuf = audioCtx.createBuffer(1, drySignal.length, fs);
        dryAudioBuf.copyToChannel(drySignal, 0);
    } else if (soundType === 'click') {
        const drySignal = buildDryClickSignal(fs);
        dryAudioBuf = audioCtx.createBuffer(1, drySignal.length, fs);
        dryAudioBuf.copyToChannel(drySignal, 0);
    } else if (soundType === 'custom' && uploadedDryBuffer) {
        dryAudioBuf = uploadedDryBuffer;
    } else {
        updateStatus("ERROR: CUSTOM FILE NOT LOADED. SWITCH TO PLUCK SYNTH.");
        btns.generate.disabled = false;
        return;
    }

    const numChannels = dryAudioBuf.numberOfChannels;
    const dryLen = dryAudioBuf.length;
    const irLen = irBufferData.length;
    const outputLen = dryLen + irLen;

    // 4. Set up Offline Audio Context for batch rendering
    const offlineCtx = new OfflineAudioContext(numChannels, outputLen, fs);

    // Create IR Buffer
    const irAudioBuf = offlineCtx.createBuffer(1, irLen, fs);
    irAudioBuf.copyToChannel(irBufferData, 0);

    // Create Graph Nodes
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = dryAudioBuf;

    const convolverNode = offlineCtx.createConvolver();
    convolverNode.buffer = irAudioBuf;
    convolverNode.normalize = false;

    // Mix Gains
    const dryGainNode = offlineCtx.createGain();
    const wetGainNode = offlineCtx.createGain();

    dryGainNode.gain.value = 1.0 - simConfig.mix;
    wetGainNode.gain.value = simConfig.mix * 1.5; // slight boost to wet convolution loss

    // Routing: Source -> DryGain -> Out
    sourceNode.connect(dryGainNode);
    dryGainNode.connect(offlineCtx.destination);

    // Routing: Source -> Convolver -> WetGain -> Out
    sourceNode.connect(convolverNode);
    convolverNode.connect(wetGainNode);
    wetGainNode.connect(offlineCtx.destination);

    // Start playback trigger
    sourceNode.start(0);

    // Run offline convolution
    offlineCtx.startRendering()
        .then(resultBuffer => {
            renderedBuffer = resultBuffer;
            btns.generate.disabled = false;
            btns.play.disabled = false;
            btns.stop.disabled = false;
            btns.loop.disabled = false;
            btns.export.disabled = false;
            updateStatus(`PLANET RENDERED: ${traceResult.taps.length} TAPS // READY TO PLAY.`);
        })
        .catch(err => {
            console.error("Offline render error:", err);
            updateStatus("OFFLINE RENDER ERROR. SEE CONSOLE LOGS.");
            btns.generate.disabled = false;
        });
}

function playAudio() {
    if (!renderedBuffer) return;
    initAudioContext();
    
    stopAudio();

    activeSourceNode = audioCtx.createBufferSource();
    activeSourceNode.buffer = renderedBuffer;
    activeSourceNode.loop = isLooping;
    
    activeSourceNode.connect(audioCtx.destination);
    activeSourceNode.start(0);
    
    isPlaying = true;
    btns.play.classList.add('active-play');
    
    activeSourceNode.onended = () => {
        if (!isLooping) {
            isPlaying = false;
            btns.play.classList.remove('active-play');
        }
    };
}

function stopAudio() {
    if (activeSourceNode && isPlaying) {
        activeSourceNode.stop();
        activeSourceNode = null;
        isPlaying = false;
        btns.play.classList.remove('active-play');
    }
}

function toggleLoop() {
    isLooping = !isLooping;
    btns.loop.classList.toggle('active-loop', isLooping);
    
    if (activeSourceNode && isPlaying) {
        activeSourceNode.loop = isLooping;
    }
}

function exportAudioWav() {
    if (!renderedBuffer) return;
    updateStatus("EXPORTING WAV FILE...");
    
    try {
        const wavBlob = audioBufferToWav(renderedBuffer);
        const presetName = document.querySelector('.preset-btn.active')?.dataset.preset || 'custom';
        const filename = `gliese_delay_${presetName}_${Math.round(simConfig.targetFirstMs)}ms.wav`;
        
        const url = URL.createObjectURL(wavBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        setTimeout(() => {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            updateStatus("WAV FILE EXPORTED SUCCESSFULLY.");
        }, 100);
    } catch (err) {
        console.error("WAV Export error:", err);
        updateStatus("WAV EXPORT ERROR. SEE CONSOLE.");
    }
}

function audioBufferToWav(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * 2 * numOfChan + 44; // 16-bit PCM has 2 bytes per sample
    const bufferArr = new ArrayBuffer(length);
    const view = new DataView(bufferArr);
    
    const sampleRate = buffer.sampleRate;
    
    // Write WAV header
    writeString(view, 0, 'RIFF');                         // RIFF identifier
    view.setUint32(4, 36 + buffer.length * 2 * numOfChan, true); // file length minus RIFF identifier length
    writeString(view, 8, 'WAVE');                         // RIFF type
    writeString(view, 12, 'fmt ');                        // format chunk identifier
    view.setUint32(16, 16, true);                          // format chunk length
    view.setUint16(20, 1, true);                           // sample format (1 = raw PCM)
    view.setUint16(22, numOfChan, true);                   // channel count
    view.setUint32(24, sampleRate, true);                  // sample rate
    view.setUint32(28, sampleRate * 2 * numOfChan, true);  // byte rate (sample rate * block align)
    view.setUint16(32, numOfChan * 2, true);               // block align (channel count * bytes per sample)
    view.setUint16(34, 16, true);                          // bits per sample (16-bit)
    writeString(view, 36, 'data');                         // data chunk identifier
    view.setUint32(40, buffer.length * 2 * numOfChan, true); // data chunk length
    
    // Gather channel float arrays
    const channelData = [];
    for (let i = 0; i < numOfChan; i++) {
        channelData.push(buffer.getChannelData(i));
    }
    
    // Write PCM data
    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numOfChan; channel++) {
            let sample = channelData[channel][i];
            sample = Math.max(-1, Math.min(1, sample)); // clamp
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }
    }
    
    return new Blob([bufferArr], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Initialize on page load
window.onload = init;
