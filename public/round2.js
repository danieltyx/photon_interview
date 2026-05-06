const sessionId = window.location.pathname.split("/").pop();
const state = {
  questions: [],
  cameraStream: null,
  screenStream: null,
  recorders: {},      // idx -> { camera, screen }
  uploaded: { 0: { camera: false, screen: false }, 1: { camera: false, screen: false }, 2: { camera: false, screen: false } },
  recording: { 0: false, 1: false, 2: false },
  selfReported: { 0: false, 1: false, 2: false },
  submitted: false,
};

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

window.addEventListener("beforeunload", (e) => {
  if (Object.values(state.recording).some(Boolean) && !state.submitted) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function init() {
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia) {
    document.getElementById("screen-loading").innerHTML =
      "<p class='error'>Your browser doesn't support recording or screen sharing. Please use a recent Chrome, Edge, or Firefox on a desktop computer.</p>";
    return;
  }

  let session;
  try {
    const res = await fetch(`/api/session/${sessionId}`);
    if (res.status === 404) { show("screen-not-found"); return; }
    if (!res.ok) throw new Error(await res.text());
    session = await res.json();
  } catch (err) {
    document.getElementById("screen-loading").innerHTML = `<p class='error'>${escapeHtml(err.message || err)}</p>`;
    return;
  }

  if (session.round2SubmittedAt) { show("screen-already-submitted"); return; }

  document.getElementById("candidate-name").textContent = session.name;
  const qRes = await fetch("/questions.json");
  state.questions = await qRes.json();

  // Camera
  const camStatus = document.getElementById("permission-status");
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    document.getElementById("preview").srcObject = state.cameraStream;
    camStatus.textContent = "Camera and mic ready.";
    document.getElementById("share-screen-btn").disabled = false;
  } catch (err) {
    camStatus.innerHTML = `<span class='error'>Could not access camera/mic: ${escapeHtml(err.message || err)}</span>`;
    show("screen-round2");
    return;
  }

  document.getElementById("share-screen-btn").addEventListener("click", shareScreen);
  document.getElementById("submit-all").addEventListener("click", submitAll);

  renderCards();
  show("screen-round2");
}

async function shareScreen() {
  const status = document.getElementById("screen-status");
  const btn = document.getElementById("share-screen-btn");
  status.textContent = "Waiting for screen share permission…";
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor", frameRate: 15 },
      audio: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "exclude",
    });
    const surface = stream.getVideoTracks()[0]?.getSettings()?.displaySurface;
    if (surface && surface !== "monitor") {
      status.innerHTML = `<span class="error">Please share your <strong>entire screen</strong>, not a window or tab.</span>`;
      stream.getTracks().forEach((t) => t.stop());
      btn.textContent = "Share screen (try again)";
      return;
    }
    state.screenStream = stream;
    document.getElementById("screen-preview").srcObject = stream;
    status.textContent = "Screen share ready.";
    btn.textContent = "Re-share screen";
    btn.disabled = false;
    enableRecBtns();
    stream.getVideoTracks()[0].addEventListener("ended", () => {
      state.screenStream = null;
      status.innerHTML = `<span class="error">Screen share stopped. Click <em>Re-share screen</em> before recording.</span>`;
      enableRecBtns();
    });
  } catch (err) {
    status.innerHTML = `<span class="error">Could not start screen share: ${escapeHtml(err.message || err)}</span>`;
    btn.textContent = "Share screen (try again)";
  }
}

function enableRecBtns() {
  const ready = !!state.screenStream && !!state.cameraStream;
  document.querySelectorAll(".rec-btn").forEach((b) => {
    const idx = Number(b.dataset.idx);
    b.disabled = !ready || state.recording[idx];
  });
}

function renderCards() {
  const container = document.getElementById("cards");
  container.innerHTML = "";
  state.questions.forEach((q, idx) => {
    const card = document.createElement("div");
    card.className = "qcard";
    const linkHtml = q.leetcodeUrl
      ? `<a class="leetcode-cta" href="${escapeHtml(q.leetcodeUrl)}" target="_blank" rel="noopener">Open problem on LeetCode →</a>`
      : "";
    const isCoding = q.kind === "leetcode-coding";
    const reportHtml = isCoding ? `
      <div class="sr-block" data-idx="${idx}">
        <div class="sr-block-label">Result of your LeetCode session</div>
        <div class="sr-options compact">
          <label class="sr-option"><input type="radio" name="sr-${idx}" value="passed" /><span class="sr-label">Passed</span></label>
          <label class="sr-option"><input type="radio" name="sr-${idx}" value="failed" /><span class="sr-label">Did not pass</span></label>
          <label class="sr-option"><input type="radio" name="sr-${idx}" value="other" /><span class="sr-label">Partial / Other</span></label>
        </div>
        <textarea class="sr-notes" id="sr-notes-${idx}" rows="2" placeholder="Notes (optional) — e.g. passed 3/5 test cases"></textarea>
        <span class="status sr-status" id="sr-status-${idx}">Required before submit</span>
      </div>
    ` : "";
    card.innerHTML = `
      <h3>Question ${idx + 1}: ${escapeHtml(q.title)}</h3>
      ${linkHtml}
      <pre>${escapeHtml(q.body)}</pre>
      <div class="rec-controls">
        <button type="button" class="rec-btn" data-idx="${idx}" disabled>Start recording</button>
        <button type="button" class="stop-btn secondary" data-idx="${idx}" disabled>Stop</button>
        <span class="status" id="status-${idx}">Share your screen above to enable recording</span>
      </div>
      ${reportHtml}
    `;
    container.appendChild(card);
  });
  container.querySelectorAll(".rec-btn").forEach((b) =>
    b.addEventListener("click", (e) => startRecording(Number(e.currentTarget.dataset.idx)))
  );
  container.querySelectorAll(".stop-btn").forEach((b) =>
    b.addEventListener("click", (e) => stopRecording(Number(e.currentTarget.dataset.idx)))
  );
  // Self-report wiring (radio change + debounced save on notes blur)
  state.questions.forEach((q, idx) => {
    if (q.kind !== "leetcode-coding") return;
    const radios = document.querySelectorAll(`input[name="sr-${idx}"]`);
    const notes = document.getElementById(`sr-notes-${idx}`);
    const save = async () => {
      const chosen = [...radios].find((r) => r.checked);
      if (!chosen) return;
      setSrStatus(idx, "Saving…", "");
      try {
        const res = await fetch(`/self-report/${sessionId}/round2/${idx + 1}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: chosen.value, notes: notes.value }),
        });
        if (!res.ok) throw new Error(await res.text());
        state.selfReported[idx] = true;
        setSrStatus(idx, "Saved", "ok");
        maybeEnableSubmit();
      } catch (err) {
        state.selfReported[idx] = false;
        setSrStatus(idx, "Save failed: " + (err.message || err), "err");
        maybeEnableSubmit();
      }
    };
    radios.forEach((r) => r.addEventListener("change", save));
    notes.addEventListener("blur", () => {
      if ([...radios].some((r) => r.checked)) save();
    });
  });
}

function setSrStatus(idx, text, cls) {
  const el = document.getElementById(`sr-status-${idx}`);
  if (!el) return;
  el.textContent = text;
  el.className = "status sr-status" + (cls ? " " + cls : "");
}

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function setStatus(idx, text, cls) {
  const el = document.getElementById(`status-${idx}`);
  el.textContent = text;
  el.className = "status" + (cls ? " " + cls : "");
}

function startRecording(idx) {
  if (Object.values(state.recording).some(Boolean)) {
    alert("Stop the current recording before starting another.");
    return;
  }
  if (!state.screenStream) {
    alert("Share your screen first.");
    return;
  }
  const mime = pickMimeType();
  const camOpts = { videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000 };
  if (mime) camOpts.mimeType = mime;
  const screenOpts = { videoBitsPerSecond: 2_000_000 };
  if (mime) screenOpts.mimeType = mime;

  const camChunks = [];
  const scrChunks = [];
  const camRec = new MediaRecorder(state.cameraStream, camOpts);
  const scrRec = new MediaRecorder(state.screenStream, screenOpts);
  camRec.ondataavailable = (e) => { if (e.data?.size > 0) camChunks.push(e.data); };
  scrRec.ondataavailable = (e) => { if (e.data?.size > 0) scrChunks.push(e.data); };

  let camDone = false, scrDone = false;
  const finalize = async () => {
    if (!camDone || !scrDone) return;
    state.recording[idx] = false;
    document.querySelector(`.rec-btn[data-idx="${idx}"]`).textContent = "Re-record";
    document.querySelector(`.stop-btn[data-idx="${idx}"]`).disabled = true;
    enableRecBtns();
    const camBlob = new Blob(camChunks, { type: camRec.mimeType || mime || "video/webm" });
    const scrBlob = new Blob(scrChunks, { type: scrRec.mimeType || mime || "video/webm" });
    setStatus(idx, "Uploading…", "");
    try {
      await Promise.all([
        uploadVideo(idx + 1, "camera", camBlob),
        uploadVideo(idx + 1, "screen", scrBlob),
      ]);
      state.uploaded[idx].camera = true;
      state.uploaded[idx].screen = true;
      setStatus(idx, "Uploaded (camera + screen)", "ok");
      maybeEnableSubmit();
    } catch (err) {
      state.uploaded[idx].camera = false;
      state.uploaded[idx].screen = false;
      setStatus(idx, "Upload failed: " + (err.message || err), "err");
    }
  };
  camRec.onstop = () => { camDone = true; finalize(); };
  scrRec.onstop = () => { scrDone = true; finalize(); };

  state.recorders[idx] = { camera: camRec, screen: scrRec };
  state.recording[idx] = true;
  state.uploaded[idx].camera = false;
  state.uploaded[idx].screen = false;
  camRec.start(1000);
  scrRec.start(1000);
  document.querySelector(`.rec-btn[data-idx="${idx}"]`).disabled = true;
  document.querySelector(`.stop-btn[data-idx="${idx}"]`).disabled = false;
  setStatus(idx, "Recording…", "recording");
  maybeEnableSubmit();
}

function stopRecording(idx) {
  const recs = state.recorders[idx];
  if (!recs) return;
  for (const r of [recs.camera, recs.screen]) {
    if (r && r.state !== "inactive") {
      try { r.stop(); } catch {}
    }
  }
}

async function uploadVideo(qNum, kind, blob) {
  const ext = (blob.type && blob.type.includes("mp4")) ? "mp4" : "webm";
  const fd = new FormData();
  fd.append("video", blob, `q${qNum}_${kind}.${ext}`);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/upload/${sessionId}/round2/${qNum}/${kind}`, {
        method: "POST",
        body: fd,
      });
      if (res.ok) return;
      lastErr = new Error(await res.text());
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw lastErr || new Error("upload failed");
}

function maybeEnableSubmit() {
  const allUploaded = [0, 1, 2].every((i) => state.uploaded[i].camera && state.uploaded[i].screen);
  const anyRecording = Object.values(state.recording).some(Boolean);
  const codingReported = state.questions.every((q, i) =>
    q.kind === "leetcode-coding" ? state.selfReported[i] : true
  );
  document.getElementById("submit-all").disabled = !allUploaded || anyRecording || !codingReported;
}

async function submitAll() {
  if (!confirm("Submit all 3 answers? You can't change them after this.")) return;
  const btn = document.getElementById("submit-all");
  const errEl = document.getElementById("submit-error");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  errEl.hidden = true;
  try {
    const res = await fetch(`/submit-round2/${sessionId}`, { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    state.submitted = true;
    if (state.cameraStream) state.cameraStream.getTracks().forEach((t) => t.stop());
    if (state.screenStream) state.screenStream.getTracks().forEach((t) => t.stop());
    show("screen-done");
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Submit all 3 answers";
    errEl.textContent = err.message || String(err);
    errEl.hidden = false;
  }
}

init();
