import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

const ROOT = import.meta.dir;
const SUBMISSIONS_DIR = process.env.SUBMISSIONS_DIR ?? join(ROOT, "submissions");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "changeme";
const PORT = Number(process.env.PORT ?? 3000);

await mkdir(SUBMISSIONS_DIR, { recursive: true });
const QUESTIONS = JSON.parse(await readFile(join(ROOT, "questions.json"), "utf8"));

async function checkFfmpeg(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}
const FFMPEG_AVAILABLE = await checkFfmpeg();
if (!FFMPEG_AVAILABLE) {
  console.warn("[warn] ffmpeg not found on PATH — uploads will only be available as .webm");
}

const transcodeQueue: Array<() => Promise<void>> = [];
let runningTranscodes = 0;
const MAX_CONCURRENT_TRANSCODES = 2;

function drainTranscode() {
  while (runningTranscodes < MAX_CONCURRENT_TRANSCODES && transcodeQueue.length > 0) {
    const task = transcodeQueue.shift()!;
    runningTranscodes++;
    task();
  }
}

function enqueueTranscode(srcPath: string) {
  if (!FFMPEG_AVAILABLE || !srcPath.endsWith(".webm")) return;
  transcodeQueue.push(async () => {
    try {
      const dst = srcPath.replace(/\.webm$/, ".mp4");
      const proc = Bun.spawn(
        [
          "ffmpeg",
          "-i", srcPath,
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "26",
          "-c:a", "aac",
          "-b:a", "96k",
          "-movflags", "+faststart",
          "-y",
          dst,
        ],
        { stdout: "ignore", stderr: "ignore" }
      );
      const exit = await proc.exited;
      if (exit !== 0) console.error("[transcode]", srcPath, "ffmpeg exit", exit);
    } catch (err) {
      console.error("[transcode]", srcPath, err);
    } finally {
      runningTranscodes--;
      drainTranscode();
    }
  });
  drainTranscode();
}

type Upload = { filename: string; size: number; uploadedAt: string };
type QUploads = { camera?: Upload; screen?: Upload };
type Meta = {
  sessionId: string;
  name: string;
  email: string;
  linkedin: string;
  github: string;
  resumeFile: string;
  createdAt: string;
  round1CompletedAt: string | null;
  round2SubmittedAt: string | null;
  uploads: {
    round1: Record<string, QUploads>;
    round2: Record<string, QUploads>;
  };
};

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  webm: "video/webm",
  mp4: "video/mp4",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function contentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function checkAdminAuth(req: Request): boolean {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;
  try {
    const [, pass] = atob(auth.slice(6)).split(":");
    const a = Buffer.from(pass ?? "");
    const b = Buffer.from(ADMIN_PASSWORD);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function unauthorized() {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="photon-admin"' },
  });
}

function sessionDir(sessionId: string): string {
  return join(SUBMISSIONS_DIR, sessionId);
}

async function readMeta(sessionId: string): Promise<Meta | null> {
  const p = join(sessionDir(sessionId), "meta.json");
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, "utf8"));
}

async function writeMeta(meta: Meta): Promise<void> {
  await writeFile(join(sessionDir(meta.sessionId), "meta.json"), JSON.stringify(meta, null, 2));
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

function extForMime(mime: string): string {
  if (mime.includes("mp4")) return ".mp4";
  return ".webm";
}

async function listSubmissions(): Promise<Meta[]> {
  const dirs = await readdir(SUBMISSIONS_DIR);
  const out: Meta[] = [];
  for (const dir of dirs) {
    const meta = await readMeta(dir);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

async function serveStatic(name: string): Promise<Response> {
  const file = Bun.file(join(ROOT, "public", name));
  if (!(await file.exists())) return new Response("Not found", { status: 404 });
  return new Response(file, { headers: { "content-type": contentType(name) } });
}

function questionsTxt(): string {
  const lines: string[] = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    lines.push(`Question ${i + 1}: ${QUESTIONS[i].title}`);
    lines.push("");
    lines.push(QUESTIONS[i].body);
    lines.push("");
    lines.push("=".repeat(80));
    lines.push("");
  }
  return lines.join("\n");
}

const SESSION_RE = /^[a-f0-9]{32}$/;

Bun.serve({
  port: PORT,
  maxRequestBodySize: 250 * 1024 * 1024,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // ---------- Public static ----------
      if (method === "GET" && path === "/") return serveStatic("index.html");
      if (method === "GET" && path === "/style.css") return serveStatic("style.css");
      if (method === "GET" && path === "/app.js") return serveStatic("app.js");
      if (method === "GET" && path === "/round2.js") return serveStatic("round2.js");
      if (method === "GET" && path === "/questions.json") {
        return new Response(JSON.stringify(QUESTIONS), {
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }
      if (method === "GET" && path === "/questions.txt") {
        return new Response(questionsTxt(), {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="photon_interview_questions.txt"',
          },
        });
      }

      // ---------- Round 2 page ----------
      const r2match = path.match(/^\/round2\/([a-f0-9]{32})$/);
      if (method === "GET" && r2match) {
        const meta = await readMeta(r2match[1]);
        if (!meta) return new Response("Session not found", { status: 404 });
        return serveStatic("round2.html");
      }

      // ---------- Session API ----------
      const sMatch = path.match(/^\/api\/session\/([a-f0-9]{32})$/);
      if (method === "GET" && sMatch) {
        const meta = await readMeta(sMatch[1]);
        if (!meta) return new Response("not found", { status: 404 });
        return Response.json({
          name: meta.name,
          round1CompletedAt: meta.round1CompletedAt,
          round2SubmittedAt: meta.round2SubmittedAt,
        });
      }

      // ---------- Start session ----------
      if (method === "POST" && path === "/start") {
        let fd: FormData;
        try {
          fd = await req.formData();
        } catch {
          return new Response("Expected multipart/form-data", { status: 400 });
        }
        const name = String(fd.get("name") ?? "").trim();
        const email = String(fd.get("email") ?? "").trim();
        const linkedin = String(fd.get("linkedin") ?? "").trim();
        const github = String(fd.get("github") ?? "").trim();
        const resume = fd.get("resume");

        if (!name || !email) {
          return new Response("Name and email are required", { status: 400 });
        }
        if (!(resume instanceof File) || resume.size === 0) {
          return new Response("Resume file is required", { status: 400 });
        }
        if (resume.size > 20 * 1024 * 1024) {
          return new Response("Resume too large (max 20MB)", { status: 400 });
        }
        const allowedExt = [".pdf", ".doc", ".docx"];
        const ext = extname(resume.name).toLowerCase();
        if (!allowedExt.includes(ext)) {
          return new Response("Resume must be PDF, DOC, or DOCX", { status: 400 });
        }

        const sessionId = randomBytes(16).toString("hex");
        const dir = sessionDir(sessionId);
        await mkdir(join(dir, "round1"), { recursive: true });
        await mkdir(join(dir, "round2"), { recursive: true });

        const resumeFilename = `resume${ext}`;
        await writeFile(join(dir, resumeFilename), Buffer.from(await resume.arrayBuffer()));

        const meta: Meta = {
          sessionId,
          name,
          email,
          linkedin,
          github,
          resumeFile: resumeFilename,
          createdAt: new Date().toISOString(),
          round1CompletedAt: null,
          round2SubmittedAt: null,
          uploads: { round1: {}, round2: {} },
        };
        await writeMeta(meta);
        return Response.json({ sessionId });
      }

      // ---------- Upload video ----------
      const upMatch = path.match(/^\/upload\/([a-f0-9]{32})\/(round1|round2)\/([1-3])\/(camera|screen)$/);
      if (method === "POST" && upMatch) {
        const [, sessionId, round, qIdx, kind] = upMatch;
        const meta = await readMeta(sessionId);
        if (!meta) return new Response("session not found", { status: 404 });
        if (round === "round2" && meta.round2SubmittedAt) {
          return new Response("round 2 already submitted", { status: 400 });
        }
        let fd: FormData;
        try {
          fd = await req.formData();
        } catch {
          return new Response("Expected multipart/form-data", { status: 400 });
        }
        const video = fd.get("video");
        if (!(video instanceof File)) return new Response("missing video", { status: 400 });

        const ext = extForMime(video.type);
        const filename = `q${qIdx}_${kind}${ext}`;
        const dest = join(sessionDir(sessionId), round, filename);
        await writeFile(dest, Buffer.from(await video.arrayBuffer()));
        enqueueTranscode(dest);

        const r = round as "round1" | "round2";
        const qKey = `q${qIdx}`;
        meta.uploads[r][qKey] ??= {};
        meta.uploads[r][qKey][kind as "camera" | "screen"] = {
          filename,
          size: video.size,
          uploadedAt: new Date().toISOString(),
        };
        // Round 1 complete only when q3 has both camera and screen
        if (round === "round1" && qIdx === "3") {
          const q3 = meta.uploads.round1.q3;
          if (q3?.camera && q3?.screen) {
            meta.round1CompletedAt = new Date().toISOString();
          }
        }
        await writeMeta(meta);
        return Response.json({ ok: true });
      }

      // ---------- Submit round 2 ----------
      const submitMatch = path.match(/^\/submit-round2\/([a-f0-9]{32})$/);
      if (method === "POST" && submitMatch) {
        const meta = await readMeta(submitMatch[1]);
        if (!meta) return new Response("session not found", { status: 404 });
        if (meta.round2SubmittedAt) return new Response("already submitted", { status: 400 });
        for (const q of ["q1", "q2", "q3"]) {
          const u = meta.uploads.round2[q];
          if (!u?.camera || !u?.screen) {
            return new Response(`missing ${q} (need both camera and screen)`, { status: 400 });
          }
        }
        meta.round2SubmittedAt = new Date().toISOString();
        await writeMeta(meta);
        return Response.json({ ok: true });
      }

      // ---------- Admin (basic auth) ----------
      if (path === "/admin" || path === "/admin.js" || path.startsWith("/admin/")) {
        if (!checkAdminAuth(req)) return unauthorized();

        if (method === "GET" && path === "/admin") return serveStatic("admin.html");
        if (method === "GET" && path === "/admin.js") return serveStatic("admin.js");
        if (method === "GET" && path === "/admin/api/list") {
          return Response.json(await listSubmissions());
        }
        const fileMatch = path.match(/^\/admin\/file\/([a-f0-9]{32})\/(.+)$/);
        if (method === "GET" && fileMatch) {
          const [, sessionId, rest] = fileMatch;
          if (rest.includes("..") || !SESSION_RE.test(sessionId)) {
            return new Response("forbidden", { status: 403 });
          }
          let filePath = join(sessionDir(sessionId), rest);
          // If .mp4 requested but transcode not done yet, fall back to .webm
          if (rest.endsWith(".mp4") && !existsSync(filePath)) {
            const webmPath = filePath.replace(/\.mp4$/, ".webm");
            if (existsSync(webmPath)) filePath = webmPath;
          }
          const file = Bun.file(filePath);
          if (!(await file.exists())) return new Response("not found", { status: 404 });
          const downloadName = filePath.split("/").pop() ?? "file";
          return new Response(file, {
            headers: {
              "content-type": contentType(filePath),
              "content-disposition": `inline; filename="${downloadName}"`,
              "accept-ranges": "bytes",
            },
          });
        }
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("[error]", err);
      return new Response(String(err instanceof Error ? err.message : err), { status: 500 });
    }
  },
});

console.log(`photon_interview listening on :${PORT}`);
console.log(`  submissions dir: ${SUBMISSIONS_DIR}`);
console.log(`  admin:           http://localhost:${PORT}/admin (password: ADMIN_PASSWORD env)`);
