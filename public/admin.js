async function loadList() {
  const status = document.getElementById("admin-status");
  status.textContent = "Loading…";
  try {
    const res = await fetch("/admin/api/list");
    if (!res.ok) throw new Error(await res.text());
    const items = await res.json();
    if (items.length === 0) {
      status.textContent = "No submissions yet.";
      document.getElementById("list").innerHTML = "";
      return;
    }
    status.textContent = `${items.length} submission${items.length === 1 ? "" : "s"}.`;
    document.getElementById("list").innerHTML = items.map(renderItem).join("");
  } catch (err) {
    status.innerHTML = `<span class="error">Failed to load: ${escapeHtml(err.message || String(err))}</span>`;
  }
}

function renderItem(meta) {
  const created = new Date(meta.createdAt).toLocaleString();
  const r1 = meta.round1CompletedAt ? new Date(meta.round1CompletedAt).toLocaleString() : null;
  const r2 = meta.round2SubmittedAt ? new Date(meta.round2SubmittedAt).toLocaleString() : null;
  let lateNote = "";
  if (meta.round2SubmittedAt && meta.round1CompletedAt) {
    const hours = (new Date(meta.round2SubmittedAt) - new Date(meta.round1CompletedAt)) / 36e5;
    if (hours > 24) lateNote = ` <span class="late">(LATE — ${hours.toFixed(1)}h after round 1)</span>`;
  }
  const round2Url = `${window.location.origin}/round2/${meta.sessionId}`;

  return `
    <div class="submission">
      <h2>${escapeHtml(meta.name)} <span class="muted small">— ${escapeHtml(meta.email)}</span></h2>
      <div class="row">
        ${meta.linkedin ? `<div><strong>LinkedIn:</strong> <a href="${escapeAttr(meta.linkedin)}" target="_blank" rel="noreferrer">${escapeHtml(meta.linkedin)}</a></div>` : ""}
        ${meta.github ? `<div><strong>GitHub:</strong> <a href="${escapeAttr(meta.github)}" target="_blank" rel="noreferrer">${escapeHtml(meta.github)}</a></div>` : ""}
        <div><strong>Resume:</strong> <a href="/admin/file/${meta.sessionId}/${escapeAttr(meta.resumeFile)}" target="_blank">${escapeHtml(meta.resumeFile)}</a></div>
      </div>
      <div class="row"><div><strong>Created:</strong> ${created}</div></div>
      <div class="row">
        <div><strong>Round 1:</strong> ${r1 ? `<span class="pill ok">complete</span> ${r1}` : `<span class="pill pending">in progress</span>`}</div>
      </div>
      ${r1 ? renderVideos(meta.sessionId, "round1", meta.uploads.round1) : ""}
      <div class="row">
        <div><strong>Round 2:</strong> ${r2 ? `<span class="pill ok">submitted</span> ${r2}${lateNote}` : `<span class="pill pending">not submitted</span> — <a href="${escapeAttr(round2Url)}" target="_blank">round 2 link</a>`}</div>
      </div>
      ${(r2 || hasAnyRound2Upload(meta)) ? renderVideos(meta.sessionId, "round2", meta.uploads.round2) : ""}
    </div>
  `;
}

function hasAnyRound2Upload(meta) {
  return meta.uploads && meta.uploads.round2 && Object.keys(meta.uploads.round2).length > 0;
}

function renderVideos(sessionId, round, uploads) {
  const cells = ["q1", "q2", "q3"].map((q) => {
    const u = uploads?.[q] || {};
    const subs = ["camera", "screen"].map((kind) => {
      const v = u[kind];
      if (!v) return `<div class="vid-sub"><div class="vid-label-row"><span>${kind}</span><span class="muted small">missing</span></div></div>`;
      const sizeMB = (v.size / 1024 / 1024).toFixed(1);
      // Prefer .mp4 — server falls back to .webm if transcode is still in progress
      const mp4Filename = v.filename.replace(/\.webm$/, ".mp4");
      const url = `/admin/file/${sessionId}/${round}/${mp4Filename}`;
      return `<div class="vid-sub">
        <div class="vid-label-row"><span>${kind} <a href="${url}" target="_blank">open</a></span><span class="muted small">${sizeMB} MB</span></div>
        <video src="${url}" controls preload="metadata"></video>
      </div>`;
    }).join("");
    return `<div class="vid-cell"><div class="vid-q-label">${q}</div>${subs}</div>`;
  }).join("");
  return `<div class="video-grid">${cells}</div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}
function escapeAttr(s) { return escapeHtml(s); }

document.getElementById("refresh-btn").addEventListener("click", loadList);
loadList();
