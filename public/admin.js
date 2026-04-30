const DECISIONS = [
  { value: "pending",  label: "Pending" },
  { value: "accept",   label: "Accept" },
  { value: "waitlist", label: "Waitlist" },
  { value: "pass",     label: "Pass" },
];

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
    const counts = items.reduce((acc, m) => {
      acc[m.decision || "pending"] = (acc[m.decision || "pending"] || 0) + 1;
      return acc;
    }, {});
    status.innerHTML = `${items.length} submission${items.length === 1 ? "" : "s"}` +
      ` · ${counts.accept || 0} accept · ${counts.waitlist || 0} waitlist · ${counts.pass || 0} pass · ${counts.pending || 0} pending`;
    renderTable(items);
  } catch (err) {
    status.innerHTML = `<span class="error">Failed to load: ${escapeHtml(err.message || String(err))}</span>`;
  }
}

function renderTable(items) {
  const head = `
    <div class="db-head">
      <span class="col col-name">Candidate</span>
      <span class="col col-meta">Created</span>
      <span class="col col-status">R1 / R2</span>
      <span class="col col-decision">Decision</span>
      <span class="col col-actions"></span>
    </div>
  `;
  const rows = items.map(renderRow).join("");
  document.getElementById("list").innerHTML = head + rows;

  // wire decision selects
  document.querySelectorAll('select[data-action="decision"]').forEach((sel) => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const value = e.target.value;
      e.target.disabled = true;
      try {
        const res = await fetch(`/admin/decision/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: value }),
        });
        if (!res.ok) throw new Error(await res.text());
        const row = e.target.closest("details");
        if (row) row.dataset.decision = value;
      } catch (err) {
        alert("Failed to update decision: " + err.message);
      } finally {
        e.target.disabled = false;
      }
    });
  });

  // wire delete buttons
  document.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.dataset.id;
      const name = e.currentTarget.dataset.name || "this submission";
      if (!confirm(`Delete "${name}"? This permanently removes their videos, resume, and metadata. Cannot be undone.`)) return;
      try {
        const res = await fetch(`/admin/delete/${id}`, { method: "POST" });
        if (!res.ok) throw new Error(await res.text());
        loadList();
      } catch (err) {
        alert("Failed to delete: " + err.message);
      }
    });
  });
}

function renderRow(meta) {
  const decision = meta.decision || "pending";
  const created = new Date(meta.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const r1 = meta.round1CompletedAt ? "ok" : "pending";
  const r2 = meta.round2SubmittedAt ? "ok" : "pending";
  const r2Late = (meta.round2SubmittedAt && meta.round1CompletedAt &&
    (new Date(meta.round2SubmittedAt) - new Date(meta.round1CompletedAt)) / 36e5 > 24) ? "late" : "";

  const decisionOpts = DECISIONS.map((d) =>
    `<option value="${d.value}"${d.value === decision ? " selected" : ""}>${d.label}</option>`
  ).join("");

  return `
    <details class="submission" data-decision="${decision}">
      <summary class="db-row">
        <span class="col col-name">
          <span class="row-name">${escapeHtml(meta.name)}</span>
          <span class="row-email">${escapeHtml(meta.email)}</span>
        </span>
        <span class="col col-meta">${created}</span>
        <span class="col col-status">
          <span class="pill ${r1}">R1</span>
          <span class="pill ${r2} ${r2Late}">R2${r2Late ? " · late" : ""}</span>
        </span>
        <span class="col col-decision">
          <select data-action="decision" data-id="${meta.sessionId}" class="decision-select decision-${decision}">
            ${decisionOpts}
          </select>
        </span>
        <span class="col col-actions">
          <button type="button" class="ghost-btn delete-btn" data-action="delete" data-id="${meta.sessionId}" data-name="${escapeAttr(meta.name)}">Delete</button>
        </span>
      </summary>
      <div class="submission-body">
        ${renderBody(meta)}
      </div>
    </details>
  `;
}

function renderBody(meta) {
  const r1 = meta.round1CompletedAt ? new Date(meta.round1CompletedAt).toLocaleString() : null;
  const r2 = meta.round2SubmittedAt ? new Date(meta.round2SubmittedAt).toLocaleString() : null;
  let lateNote = "";
  if (meta.round2SubmittedAt && meta.round1CompletedAt) {
    const hours = (new Date(meta.round2SubmittedAt) - new Date(meta.round1CompletedAt)) / 36e5;
    if (hours > 24) lateNote = ` <span class="late">— ${hours.toFixed(1)}h after round 1</span>`;
  }
  const round2Url = `${window.location.origin}/round2/${meta.sessionId}`;

  return `
    <div class="kv-rows">
      ${meta.linkedin ? `<div class="kv"><span class="k">LinkedIn</span><span class="v"><a href="${escapeAttr(meta.linkedin)}" target="_blank" rel="noreferrer">${escapeHtml(meta.linkedin)}</a></span></div>` : ""}
      ${meta.github ? `<div class="kv"><span class="k">GitHub</span><span class="v"><a href="${escapeAttr(meta.github)}" target="_blank" rel="noreferrer">${escapeHtml(meta.github)}</a></span></div>` : ""}
      <div class="kv"><span class="k">Resume</span><span class="v"><a href="/admin/file/${meta.sessionId}/${escapeAttr(meta.resumeFile)}" target="_blank">${escapeHtml(meta.resumeFile)}</a></span></div>
      <div class="kv"><span class="k">Created</span><span class="v">${new Date(meta.createdAt).toLocaleString()}</span></div>
      <div class="kv"><span class="k">Round 1</span><span class="v">${r1 ? `<span class="ok-text">complete</span> · ${r1}` : `<span class="muted">in progress</span>`}</span></div>
      <div class="kv"><span class="k">Round 2</span><span class="v">${r2 ? `<span class="ok-text">submitted</span> · ${r2}${lateNote}` : `<span class="muted">not submitted</span> · <a href="${escapeAttr(round2Url)}" target="_blank">round 2 link</a>`}</span></div>
    </div>

    ${meta.round1CompletedAt || hasAny(meta.uploads.round1) ? `<div class="round-block"><div class="round-label">Round 01</div>${renderVideos(meta.sessionId, "round1", meta.uploads.round1)}</div>` : ""}
    ${(meta.round2SubmittedAt || hasAny(meta.uploads.round2)) ? `<div class="round-block"><div class="round-label">Round 02</div>${renderVideos(meta.sessionId, "round2", meta.uploads.round2)}</div>` : ""}
  `;
}

function hasAny(uploads) {
  return uploads && Object.keys(uploads).length > 0;
}

function renderVideos(sessionId, round, uploads) {
  const cells = ["q1", "q2", "q3"].map((q) => {
    const u = uploads?.[q] || {};
    const subs = ["camera", "screen"].map((kind) => {
      const v = u[kind];
      if (!v) return `<div class="vid-sub"><div class="vid-label-row"><span>${kind}</span><span class="muted small">missing</span></div></div>`;
      const sizeMB = (v.size / 1024 / 1024).toFixed(1);
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
