const state = {
  sessionId: null,
  questions: [],
  cameraStream: null,
  screenStream: null,
  cameraRecorder: null,
  screenRecorder: null,
  cameraChunks: [],
  screenChunks: [],
  currentQ: 0,
  phase: "intake",
};

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showError(msg) {
  state.phase = "error";
  document.getElementById("error-message").textContent = msg;
  show("screen-error");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

window.addEventListener("beforeunload", (e) => {
  if (state.phase !== "intake" && state.phase !== "done" && state.phase !== "error") {
    e.preventDefault();
    e.returnValue = "";
  }
});

if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.getDisplayMedia) {
  showError("Your browser doesn't support recording or screen sharing. Please use a recent Chrome, Edge, or Firefox on a desktop computer.");
}

document.getElementById("intake-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const btn = document.getElementById("intake-submit");
  const errEl = document.getElementById("intake-error");
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Working…";
  try {
    const res = await fetch("/start", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    state.sessionId = data.sessionId;
    const qRes = await fetch("/questions.json");
    state.questions = await qRes.json();
    state.phase = "permission";
    show("screen-permission");
    await requestCamera();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Continue";
    errEl.textContent = err.message || String(err);
    errEl.hidden = false;
  }
});

async function requestCamera() {
  const status = document.getElementById("permission-status");
  const shareBtn = document.getElementById("share-screen-btn");
  status.textContent = "Requesting camera and microphone…";
  try {
    state.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    document.getElementById("preview").srcObject = state.cameraStream;
    status.textContent = "Camera and mic ready.";
    shareBtn.disabled = false;
  } catch (err) {
    status.innerHTML = `<span class="error">Could not access camera/mic: ${escapeHtml(err.message || err)}</span>`;
  }
}

document.getElementById("share-screen-btn").addEventListener("click", async () => {
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
    state.screenStream = stream;
    document.getElementById("screen-preview").srcObject = stream;
    const surface = stream.getVideoTracks()[0]?.getSettings()?.displaySurface;
    if (surface && surface !== "monitor") {
      status.innerHTML = `<span class="error">Please share your <strong>entire screen</strong>, not a window or tab. Click below to try again.</span>`;
      stream.getTracks().forEach((t) => t.stop());
      state.screenStream = null;
      btn.textContent = "Share screen (try again)";
      return;
    }
    status.textContent = "Screen share ready.";
    btn.disabled = true;
    btn.textContent = "Screen shared";
    document.getElementById("ready-btn").disabled = false;
  } catch (err) {
    status.innerHTML = `<span class="error">Could not start screen share: ${escapeHtml(err.message || err)}</span>`;
    btn.textContent = "Share screen (try again)";
  }
});

document.getElementById("ready-btn").addEventListener("click", () => {
  if (!state.cameraStream || !state.screenStream) return;
  state.phase = "question";
  state.currentQ = 0;
  startQuestion();
});

function pickMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function startRecorders() {
  state.cameraChunks = [];
  state.screenChunks = [];
  const mime = pickMimeType();

  const camOpts = { videoBitsPerSecond: 800_000, audioBitsPerSecond: 64_000 };
  if (mime) camOpts.mimeType = mime;
  state.cameraRecorder = new MediaRecorder(state.cameraStream, camOpts);
  state.cameraRecorder.ondataavailable = (e) => { if (e.data?.size > 0) state.cameraChunks.push(e.data); };
  state.cameraRecorder.start(1000);

  const screenOpts = { videoBitsPerSecond: 1_200_000 };
  if (mime) screenOpts.mimeType = mime;
  state.screenRecorder = new MediaRecorder(state.screenStream, screenOpts);
  state.screenRecorder.ondataavailable = (e) => { if (e.data?.size > 0) state.screenChunks.push(e.data); };
  state.screenRecorder.start(1000);
}

function stopOne(recorder, chunks) {
  return new Promise((resolve) => {
    const finish = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    if (recorder.state === "inactive") return finish();
    recorder.onstop = finish;
    try { recorder.stop(); } catch { finish(); }
  });
}

function stopRecorders() {
  return Promise.all([
    stopOne(state.cameraRecorder, state.cameraChunks),
    stopOne(state.screenRecorder, state.screenChunks),
  ]);
}

async function startQuestion() {
  const idx = state.currentQ;
  const q = state.questions[idx];
  document.getElementById("qtitle").textContent = q.title;
  document.getElementById("qcontent").textContent = q.body;
  document.getElementById("qcount").textContent = `Question ${idx + 1} of ${state.questions.length}`;
  document.getElementById("recording-preview").srcObject = state.cameraStream;
  document.getElementById("screen-recording-preview").srcObject = state.screenStream;
  show("screen-question");

  startRecorders();
  await runPhase("thinking", 900);
  await runPhase("answering", 120);

  show("screen-uploading");
  const [cameraBlob, screenBlob] = await stopRecorders();
  try {
    await Promise.all([
      uploadVideo("round1", idx + 1, "camera", cameraBlob),
      uploadVideo("round1", idx + 1, "screen", screenBlob),
    ]);
  } catch (err) {
    offerDownload(cameraBlob, `q${idx + 1}_camera_failed.webm`);
    offerDownload(screenBlob, `q${idx + 1}_screen_failed.webm`);
    showError(`Upload failed for question ${idx + 1}. Both recordings were downloaded to your computer — please send them to the recruiter. (${err.message})`);
    return;
  }

  state.currentQ++;
  if (state.currentQ < state.questions.length) {
    startQuestion();
  } else {
    showDone();
  }
}

function runPhase(phase, seconds) {
  return new Promise((resolve) => {
    const badge = document.getElementById("phase-badge");
    const timer = document.getElementById("timer");
    const skipBtn = document.getElementById("skip-btn");
    const hint = document.getElementById("phase-hint");
    badge.className = "phase " + phase;
    badge.textContent = phase === "thinking" ? "THINKING TIME" : "ANSWER TIME";
    skipBtn.textContent = phase === "thinking" ? "Skip to answer" : "Done — next question";
    skipBtn.disabled = false;
    hint.textContent = phase === "thinking"
      ? "Use any tool you want — ChatGPT, Claude, Google, your IDE, anything. Just keep it on the screen we're recording."
      : "Walk us through your idea and approach. You don't need a full solution — code snippets are fine if they help. Keep it under 2 minutes.";

    let remaining = seconds;
    let done = false;
    const render = () => {
      const m = String(Math.floor(remaining / 60)).padStart(2, "0");
      const s = String(remaining % 60).padStart(2, "0");
      timer.textContent = `${m}:${s}`;
    };
    render();
    const tick = setInterval(() => {
      remaining--;
      render();
      if (remaining <= 0) finish();
    }, 1000);
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(tick);
      skipBtn.disabled = true;
      skipBtn.onclick = null;
      resolve();
    };
    skipBtn.onclick = finish;
  });
}

async function uploadVideo(round, qNum, kind, blob) {
  const ext = (blob.type && blob.type.includes("mp4")) ? "mp4" : "webm";
  const fd = new FormData();
  fd.append("video", blob, `q${qNum}_${kind}.${ext}`);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`/upload/${state.sessionId}/${round}/${qNum}/${kind}`, {
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

function offerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function showDone() {
  state.phase = "done";
  if (state.cameraStream) state.cameraStream.getTracks().forEach((t) => t.stop());
  if (state.screenStream) state.screenStream.getTracks().forEach((t) => t.stop());
  const url = `${window.location.origin}/round2/${state.sessionId}`;
  const input = document.getElementById("round2-url");
  input.value = url;
  document.getElementById("copy-btn").addEventListener("click", () => {
    input.select();
    try { navigator.clipboard.writeText(url); } catch { document.execCommand("copy"); }
    document.getElementById("copy-btn").textContent = "Copied";
  });
  show("screen-done");
}
