// app.js (patched)
// Handles image upload, pan/zoom, touch gestures, and export.
// Defensive fixes: ensure containerRect is computed before render/export, ensure render called after image load,
// and use a Promise for toBlob during export so download reliably runs.

// CONFIG: proportions (percent of total frame height)
const TOP_HEIGHT_PCT = 12.5;
const BOTTOM_HEIGHT_PCT = 25.0;

const fileInput = document.getElementById('fileInput');
const photoCanvas = document.getElementById('photoCanvas');
const topOverlay = document.getElementById('topOverlay');
const bottomOverlay = document.getElementById('bottomOverlay');
const zoomRange = document.getElementById('zoomRange');
const resetBtn = document.getElementById('resetBtn');
const downloadBtn = document.getElementById('downloadBtn');

const ctx = photoCanvas.getContext('2d', { alpha: true });

const container = document.getElementById('frame');
let containerRect = null;

// user image state
let userImg = null;
let imgNaturalW = 0, imgNaturalH = 0;

let state = {
  scale: 1,
  minScale: 0.5,
  maxScale: 3,
  offsetX: 0,
  offsetY: 0,
};

// interaction state
let dragging = false;
let lastPointer = null;
let pointers = new Map();

// Ensure containerRect exists (callable anywhere)
function ensureContainerRect() {
  if (!container) return;
  const rect = container.getBoundingClientRect();
  // ignore zero-sized rects (not laid out yet)
  if (rect.width && rect.height) containerRect = rect;
  return containerRect;
}

function resizeCanvasToDisplaySize() {
  const rect = container.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    // If layout not ready yet, try later
    return;
  }
  containerRect = rect;

  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);

  photoCanvas.style.width = w + 'px';
  photoCanvas.style.height = h + 'px';
  photoCanvas.width = Math.round(w * dpr);
  photoCanvas.height = Math.round(h * dpr);

  // scale drawing so coordinates are in CSS pixels
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // position overlays proportionally
  topOverlay.style.height = (TOP_HEIGHT_PCT) + "%";
  bottomOverlay.style.height = (BOTTOM_HEIGHT_PCT) + "%";

  render();
}

window.addEventListener('resize', resizeCanvasToDisplaySize);
window.addEventListener('orientationchange', () => setTimeout(resizeCanvasToDisplaySize, 120));

// File input
fileInput.addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  const img = new Image();
  img.onload = () => {
    userImg = img;
    imgNaturalW = img.naturalWidth;
    imgNaturalH = img.naturalHeight;
    // reset transform
    state.scale = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    zoomRange.value = state.scale;
    // ensure layout and sizes are ready then render
    ensureContainerRect();
    resizeCanvasToDisplaySize();
    render();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    alert('Could not load the image file.');
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

// Render: draw the user's image clipped to the middle rect, then draw overlays
function render() {
  // make sure we have container dimensions
  if (!containerRect) {
    const rect = ensureContainerRect();
    if (!rect) return; // still not ready
  }
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);

  const W = containerRect.width;
  const H = containerRect.height;
  const topH = (TOP_HEIGHT_PCT / 100) * H;
  const bottomH = (BOTTOM_HEIGHT_PCT / 100) * H;
  const middleY = topH;
  const middleH = H - topH - bottomH;
  const middleX = 0;
  const middleW = W;

  // optional white background
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  if (userImg) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(middleX, middleY, middleW, middleH);
    ctx.clip();

    const centerX = middleX + middleW / 2;
    const centerY = middleY + middleH / 2;

    const fitScale = Math.max(middleW / imgNaturalW, middleH / imgNaturalH);
    const drawScale = fitScale * state.scale;

    const drawW = imgNaturalW * drawScale;
    const drawH = imgNaturalH * drawScale;

    const drawX = centerX - drawW / 2 + state.offsetX;
    const drawY = centerY - drawH / 2 + state.offsetY;

    ctx.drawImage(userImg, drawX, drawY, drawW, drawH);
    ctx.restore();
  }
}

// Zoom control
zoomRange.addEventListener('input', (e) => {
  state.scale = parseFloat(e.target.value);
  render();
});

// Reset button
resetBtn.addEventListener('click', () => {
  state.scale = 1;
  state.offsetX = 0;
  state.offsetY = 0;
  zoomRange.value = state.scale;
  render();
});

// Helper to await toBlob
function canvasToBlobAsync(canvas, type = 'image/png', quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

// Download / Export
downloadBtn.addEventListener('click', async () => {
  // ensure we have layout info
  ensureContainerRect();
  if (!containerRect) {
    alert('Layout not ready yet. Try again in a moment.');
    return;
  }

  const W = Math.round(containerRect.width);
  const H = Math.round(containerRect.height);
  const dpr = window.devicePixelRatio || 1;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = Math.round(W * dpr);
  outCanvas.height = Math.round(H * dpr);
  const outCtx = outCanvas.getContext('2d');

  // scale to CSS pixel units
  outCtx.scale(dpr, dpr);

  // background
  outCtx.fillStyle = '#ffffff';
  outCtx.fillRect(0, 0, W, H);

  const topH = (TOP_HEIGHT_PCT / 100) * H;
  const bottomH = (BOTTOM_HEIGHT_PCT / 100) * H;
  const middleX = 0;
  const middleY = topH;
  const middleW = W;
  const middleH = H - topH - bottomH;

  if (userImg) {
    outCtx.save();
    outCtx.beginPath();
    outCtx.rect(middleX, middleY, middleW, middleH);
    outCtx.clip();

    const centerX = middleX + middleW / 2;
    const centerY = middleY + middleH / 2;
    const fitScale = Math.max(middleW / imgNaturalW, middleH / imgNaturalH);
    const drawScale = fitScale * state.scale;
    const drawW = imgNaturalW * drawScale;
    const drawH = imgNaturalH * drawScale;
    const drawX = centerX - drawW / 2 + state.offsetX;
    const drawY = centerY - drawH / 2 + state.offsetY;

    outCtx.drawImage(userImg, drawX, drawY, drawW, drawH);
    outCtx.restore();
  }

  // Draw overlays if loaded (they should be same-origin local assets)
  if (topOverlay && topOverlay.complete) {
    const oh = (TOP_HEIGHT_PCT / 100) * H;
    outCtx.drawImage(topOverlay, 0, 0, W, oh);
  }
  if (bottomOverlay && bottomOverlay.complete) {
    const oh = (BOTTOM_HEIGHT_PCT / 100) * H;
    outCtx.drawImage(bottomOverlay, 0, H - oh, W, oh);
  }

  const blob = await canvasToBlobAsync(outCanvas, 'image/png');
  if (!blob) {
    alert('Failed to generate image blob.');
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'framed-photo.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// Pointer / Touch handling for pan and pinch
photoCanvas.addEventListener('pointerdown', (ev) => {
  photoCanvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, ev);
  if (pointers.size === 1) {
    dragging = true;
    lastPointer = { x: ev.clientX, y: ev.clientY };
  }
});

photoCanvas.addEventListener('pointermove', (ev) => {
  if (!pointers.has(ev.pointerId)) return;
  pointers.set(ev.pointerId, ev);

  if (pointers.size === 1 && dragging && lastPointer) {
    const dx = ev.clientX - lastPointer.x;
    const dy = ev.clientY - lastPointer.y;
    lastPointer = { x: ev.clientX, y: ev.clientY };
    state.offsetX += dx;
    state.offsetY += dy;
    render();
  } else if (pointers.size === 2) {
    const pts = Array.from(pointers.values());
    const p1 = pts[0], p2 = pts[1];
    const curDist = Math.hypot(p2.clientX - p1.clientX, p2.clientY - p1.clientY);

    if (!photoCanvas._lastPinch) {
      photoCanvas._lastPinch = curDist;
    } else {
      const last = photoCanvas._lastPinch;
      const delta = curDist / last;
      const centerX = (p1.clientX + p2.clientX) / 2 - containerRect.left;
      const centerY = (p1.clientY + p2.clientY) / 2 - containerRect.top;

      const middleW = containerRect.width;
      const middleH = containerRect.height - (TOP_HEIGHT_PCT/100)*containerRect.height - (BOTTOM_HEIGHT_PCT/100)*containerRect.height;
      const prevScale = state.scale;
      const newScale = Math.min(state.maxScale, Math.max(state.minScale, state.scale * delta));

      const middleTop = (TOP_HEIGHT_PCT / 100) * containerRect.height;
      const relCenterX = centerX - (middleW / 2);
      const relCenterY = centerY - (middleTop + middleH / 2);

      state.offsetX = (state.offsetX - relCenterX) * (newScale / prevScale) + relCenterX;
      state.offsetY = (state.offsetY - relCenterY) * (newScale / prevScale) + relCenterY;
      state.scale = newScale;
      zoomRange.value = state.scale;
      render();
      photoCanvas._lastPinch = curDist;
    }
  }
});

photoCanvas.addEventListener('pointerup', (ev) => {
  pointers.delete(ev.pointerId);
  try { photoCanvas.releasePointerCapture(ev.pointerId); } catch(e) {}
  if (pointers.size === 0) {
    dragging = false;
    lastPointer = null;
    delete photoCanvas._lastPinch;
  }
});

photoCanvas.addEventListener('pointercancel', (ev) => {
  pointers.delete(ev.pointerId);
  dragging = false;
  lastPointer = null;
  delete photoCanvas._lastPinch;
});

// wheel for zoom
photoCanvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  ensureContainerRect();
  if (!containerRect) return;
  const delta = ev.deltaY > 0 ? 0.95 : 1.05;
  const oldScale = state.scale;
  const newScale = Math.min(state.maxScale, Math.max(state.minScale, oldScale * delta));

  const mouseX = ev.clientX - containerRect.left;
  const mouseY = ev.clientY - containerRect.top;

  const middleW = containerRect.width;
  const middleH = containerRect.height - (TOP_HEIGHT_PCT/100)*containerRect.height - (BOTTOM_HEIGHT_PCT/100)*containerRect.height;
  const middleTop = (TOP_HEIGHT_PCT / 100) * containerRect.height;
  const relCenterX = mouseX - (middleW / 2);
  const relCenterY = mouseY - (middleTop + middleH / 2);

  state.offsetX = (state.offsetX - relCenterX) * (newScale / oldScale) + relCenterX;
  state.offsetY = (state.offsetY - relCenterY) * (newScale / oldScale) + relCenterY;
  state.scale = newScale;
  zoomRange.value = state.scale;
  render();
}, { passive: false });

// Initialize after overlays load (so we can compute sizes)
function init() {
  Promise.all([
    new Promise((res) => { if (topOverlay.complete) res(); else topOverlay.onload = res; }),
    new Promise((res) => { if (bottomOverlay.complete) res(); else bottomOverlay.onload = res; })
  ]).then(() => {
    // compute container rect now and size canvas
    ensureContainerRect();
    resizeCanvasToDisplaySize();
  });
}
init();



//...........................


// Camera module - append to the end of your app.js
// Assumes your app already defines: userImg, imgNaturalW, imgNaturalH, state, zoomRange, resizeCanvasToDisplaySize(), render()

/* Recommended HTML to include in index.html (if not already present):
  <button id="openCameraBtn" type="button">Use Camera</button>
  <div id="cameraModal" class="camera-modal" hidden>
    <div class="camera-inner">
      <video id="cameraPreview" autoplay playsinline muted></video>
      <div class="camera-toolbar">
        <select id="cameraSelect"></select>
        <button id="captureBtn" type="button">Capture</button>
        <button id="closeCameraBtn" type="button">Close</button>
      </div>
    </div>
  </div>
  Add the CSS from the next block to style.css for a basic modal.
*/

const openCameraBtn = document.getElementById('openCameraBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraPreview = document.getElementById('cameraPreview');
const captureBtn = document.getElementById('captureBtn');
const closeCameraBtn = document.getElementById('closeCameraBtn');
const cameraSelect = document.getElementById('cameraSelect');

let cameraStream = null;

// Check secure context
function isSecureContextForCamera() {
  return (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

async function enumerateVideoDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'videoinput');
  } catch (err) {
    console.warn('enumerateDevices failed:', err);
    return [];
  }
}

async function openCamera(selectedDeviceId = null) {
  if (!isSecureContextForCamera()) {
    alert('Camera access requires HTTPS or localhost. Serve the page over HTTPS or run on localhost.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera API not supported in this browser.');
    return;
  }

  // Stop previous stream if any
  stopCamera();

  // Preferred constraints: try facingMode if no explicit device selected
  let constraints;
  if (selectedDeviceId) {
    constraints = { video: { deviceId: { exact: selectedDeviceId } }, audio: false };
  } else {
    // ask for environment-facing camera where possible
    constraints = { video: { facingMode: { ideal: 'environment' } }, audio: false };
  }

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraPreview.srcObject = cameraStream;
    cameraModal.hidden = false;

    // ensure the video element starts playing
    await cameraPreview.play();

    // populate device list and select current device
    populateDeviceList();
  } catch (err) {
    console.error('getUserMedia error:', err);
    // Fallback: if facingMode failed, try without constraints
    if (!selectedDeviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError' || err.name === 'NotReadableError')) {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraPreview.srcObject = cameraStream;
        cameraModal.hidden = false;
        await cameraPreview.play();
        populateDeviceList();
      } catch (err2) {
        console.error('Fallback getUserMedia failed:', err2);
        alert('Could not open camera. Check permissions and that a camera is available.');
      }
    } else {
      alert('Could not open camera. Check permissions and that a camera is available.');
    }
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  if (cameraPreview) cameraPreview.srcObject = null;
  if (cameraModal) cameraModal.hidden = true;
  // reset camera select
  if (cameraSelect) {
    cameraSelect.innerHTML = '';
  }
}

async function populateDeviceList() {
  if (!cameraSelect) return;
  const devices = await enumerateVideoDevices();
  cameraSelect.innerHTML = '';

  // Add an option to let the browser choose (facingMode)
  const optAuto = document.createElement('option');
  optAuto.value = '';
  optAuto.text = 'Auto (preferred)';
  cameraSelect.appendChild(optAuto);

  devices.forEach((d) => {
    const option = document.createElement('option');
    option.value = d.deviceId;
    option.text = d.label || `Camera ${cameraSelect.length + 1}`;
    cameraSelect.appendChild(option);
  });

  // Pre-select the active device if possible
  if (cameraStream) {
    const track = cameraStream.getVideoTracks()[0];
    if (track && track.getSettings) {
      const settings = track.getSettings();
      if (settings.deviceId) {
        cameraSelect.value = settings.deviceId;
      }
    }
  }
}

// Capture current frame and feed into userImg pipeline used by the app.
function captureFromCamera() {
  if (!cameraPreview || !cameraPreview.videoWidth) {
    alert('Camera preview not ready yet.');
    return;
  }

  const vw = cameraPreview.videoWidth;
  const vh = cameraPreview.videoHeight;
  const tmp = document.createElement('canvas');
  tmp.width = vw;
  tmp.height = vh;
  const tctx = tmp.getContext('2d');
  // draw the current frame
  tctx.drawImage(cameraPreview, 0, 0, vw, vh);

  tmp.toBlob((blob) => {
    if (!blob) {
      alert('Capture failed.');
      return;
    }
    // Create an object URL and load as Image (same as file input path)
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      userImg = img;
      imgNaturalW = img.naturalWidth;
      imgNaturalH = img.naturalHeight;
      state.scale = 1;
      state.offsetX = 0;
      state.offsetY = 0;
      zoomRange.value = state.scale;
      ensureContainerRect && ensureContainerRect();
      resizeCanvasToDisplaySize && resizeCanvasToDisplaySize();
      render && render();
      URL.revokeObjectURL(url);
    };
    img.onerror = (e) => {
      console.error('Captured image load error', e);
      URL.revokeObjectURL(url);
      alert('Captured image could not be loaded.');
    };
    img.src = url;
    stopCamera();
  }, 'image/png');
}

// UI wiring
if (openCameraBtn) {
  openCameraBtn.addEventListener('click', () => {
    openCamera();
  });
}
if (captureBtn) {
  captureBtn.addEventListener('click', captureFromCamera);
}
if (closeCameraBtn) {
  closeCameraBtn.addEventListener('click', stopCamera);
}
if (cameraSelect) {
  cameraSelect.addEventListener('change', async () => {
    const id = cameraSelect.value;
    // reopen camera with selected device ('' means auto/facingMode)
    stopCamera();
    if (id) {
      await openCamera(id);
    } else {
      await openCamera();
    }
  });
}

// Stop camera if page hidden/unloaded
window.addEventListener('pagehide', stopCamera);
window.addEventListener('beforeunload', stopCamera);