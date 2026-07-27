import LightningFS from "https://cdn.jsdelivr.net/npm/@isomorphic-git/lightning-fs@4.6.3/+esm";
import * as git from "https://cdn.jsdelivr.net/npm/isomorphic-git@1.38.9/+esm";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const DATABASE_NAME = "resume-studio-v1";
const PROJECT_DIR = "/project";
const IMPORT_DIR = "/project-import";
const PREVIOUS_DIR = "/project-previous";
const RECOVERY_DIR = "/recovery";
const MAX_RECOVERIES = 3;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 10_000;
const BACKUP_HEAD_KEY = "resume-studio:last-backup-head";
const BACKUP_AT_KEY = "resume-studio:last-backup-at";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class BrowserProjectRepository {
  constructor() {
    this.fs = new LightningFS(DATABASE_NAME, { wipe: false });
    this.pfs = this.fs.promises;
    this.dir = PROJECT_DIR;
  }

  async exists() {
    return this.pathExists(`${this.dir}/master.yaml`);
  }

  async importArchive(input, { preserveCurrent = true } = {}) {
    const archiveSize = input instanceof Blob ? input.size : input?.byteLength;
    if (Number.isFinite(archiveSize) && archiveSize > MAX_ARCHIVE_BYTES) {
      throw new Error("This project file is too large to open safely.");
    }

    const zip = await JSZip.loadAsync(input);
    await validateManifest(zip);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    if (entries.length > MAX_ARCHIVE_FILES) {
      throw new Error("This project file contains too many items.");
    }

    const projectPrefix = detectProjectPrefix(entries.map((entry) => entry.name));
    if (projectPrefix === null) {
      throw new Error("This is not a Resume Studio project file.");
    }

    const extracted = new Map();
    let expandedBytes = 0;
    for (const entry of entries) {
      let relative = entry.name;
      if (relative === "manifest.json" || relative === "resume-studio-manifest.json") continue;
      if (projectPrefix && !relative.startsWith(projectPrefix)) continue;
      relative = projectPrefix ? relative.slice(projectPrefix.length) : relative;
      relative = sanitizeRelativePath(relative);
      if (!relative) continue;
      if (extracted.has(relative)) throw new Error("This project file contains duplicate items.");
      const bytes = await entry.async("uint8array");
      expandedBytes += bytes.byteLength;
      if (expandedBytes > MAX_EXPANDED_BYTES) {
        throw new Error("This project file is too large to open safely.");
      }
      extracted.set(relative, bytes);
    }
    if (!extracted.has("master.yaml")) {
      throw new Error("Imported project is missing master.yaml.");
    }

    await this.removeTree(IMPORT_DIR);
    await this.mkdirp(IMPORT_DIR);
    try {
      for (const [relative, bytes] of extracted) {
        await this.writeBytesAt(IMPORT_DIR, relative, bytes);
      }
      await this.ensureGitRepositoryAt(IMPORT_DIR, "Import Resume Studio project");

      let recoveryName = null;
      if (preserveCurrent && await this.exists()) {
        recoveryName = await this.saveRecovery(await this.exportArchiveBlob());
      }

      await this.swapImportedProject();
      clearBackupMarkerIfUnrelated(await this.history(200));
      return { head: await this.currentHead(), recoveryName };
    } catch (error) {
      await this.removeTree(IMPORT_DIR).catch(() => undefined);
      throw error;
    }
  }

  async createStarter(url = "./assets/starter.resume-studio") {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load starter project (${response.status}).`);
    return this.importArchive(await response.arrayBuffer());
  }

  async ensureGitRepository(initialMessage = "Initialize Resume Studio project") {
    return this.ensureGitRepositoryAt(this.dir, initialMessage);
  }

  async ensureGitRepositoryAt(dir, initialMessage) {
    if (!(await this.pathExists(`${dir}/.git/HEAD`))) {
      await git.init({ fs: this.fs, dir, defaultBranch: "main" });
      await this.stageAllAt(dir);
      await git.commit({
        fs: this.fs,
        dir,
        message: initialMessage,
        author: defaultAuthor(),
      });
    }
    await this.pfs.flush();
  }

  async readText(relative) {
    const bytes = await this.pfs.readFile(this.absolute(relative));
    return decoder.decode(bytes);
  }

  async writeText(relative, text) {
    await this.writeBytes(relative, encoder.encode(text));
  }

  async writeBytes(relative, bytes) {
    await this.writeBytesAt(this.dir, relative, bytes);
    await this.pfs.flush();
  }

  async writeBytesAt(root, relative, bytes) {
    const path = this.absoluteAt(root, relative);
    await this.mkdirp(parentPath(path));
    await this.pfs.writeFile(path, bytes);
  }

  async pathExists(path) {
    try {
      await this.pfs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async overlayIds() {
    const root = `${this.dir}/overlays`;
    if (!(await this.pathExists(root))) return [];
    const files = await this.walkFiles(root);
    return files
      .filter((path) => path.endsWith(".yaml"))
      .map((path) => path.slice(`${root}/`.length, -".yaml".length))
      .sort();
  }

  async stageAll() {
    return this.stageAllAt(this.dir);
  }

  async stageAllAt(dir) {
    const matrix = await git.statusMatrix({ fs: this.fs, dir });
    for (const [filepath, head, workdir, stage] of matrix) {
      if (filepath.startsWith("output/")) continue;
      if (workdir === 0 && (head !== 0 || stage !== 0)) {
        await git.remove({ fs: this.fs, dir, filepath });
      } else if (workdir !== stage || head !== workdir) {
        await git.add({ fs: this.fs, dir, filepath });
      }
    }
  }

  async isDirty() {
    const matrix = await git.statusMatrix({ fs: this.fs, dir: this.dir });
    return matrix.some(([filepath, head, workdir, stage]) =>
      !filepath.startsWith("output/") && (head !== workdir || workdir !== stage)
    );
  }

  async commit(message) {
    await this.stageAll();
    if (!(await this.isDirty())) return this.currentHead();
    const oid = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: defaultAuthor(),
    });
    await this.pfs.flush();
    return oid;
  }

  async currentHead() {
    try {
      return await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
    } catch {
      return "";
    }
  }

  async createAnnotatedTag(ref, message) {
    await git.annotatedTag({
      fs: this.fs,
      dir: this.dir,
      ref,
      message,
      tagger: defaultAuthor(),
    });
    await this.pfs.flush();
  }

  async repairHistoryIfNeeded() {
    const head = await this.currentHead();
    if (!head) {
      await this.ensureGitRepository();
      return null;
    }
    try {
      await git.readCommit({ fs: this.fs, dir: this.dir, oid: head });
      return null;
    } catch (error) {
      if (!/Could not find|ENOENT/.test(error.message)) throw error;
      const recoveryName = await this.saveRecovery(await this.exportArchiveBlob());
      await this.removeTree(`${this.dir}/.git`);
      await this.ensureGitRepository("Recover Resume Studio project");
      clearBackupMarker();
      return { recoveryName };
    }
  }

  async listTags() {
    return git.listTags({ fs: this.fs, dir: this.dir });
  }

  async history(depth = 60) {
    const entries = await git.log({ fs: this.fs, dir: this.dir, depth });
    const tags = await this.listTags();
    const tagsByOid = new Map();
    for (const tag of tags) {
      let oid;
      try {
        const tagOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/tags/${tag}` });
        try {
          oid = (await git.readTag({ fs: this.fs, dir: this.dir, oid: tagOid })).tag.object;
        } catch {
          oid = tagOid;
        }
      } catch {
        continue;
      }
      const current = tagsByOid.get(oid) || [];
      current.push(tag);
      tagsByOid.set(oid, current);
    }
    return entries.map((entry) => ({
      oid: entry.oid,
      message: entry.commit.message.trim(),
      author: entry.commit.author,
      tags: tagsByOid.get(entry.oid) || [],
    }));
  }

  async restore(oid) {
    const originalHead = await this.currentHead();
    if (!originalHead) throw new Error("The current saved version is unavailable.");

    const branch = await git.currentBranch({ fs: this.fs, dir: this.dir }) || "main";
    await git.checkout({ fs: this.fs, dir: this.dir, ref: oid, force: true, noUpdateHead: true });
    const snapshot = await this.readWorkingTree();
    await git.checkout({ fs: this.fs, dir: this.dir, ref: branch, force: true, noUpdateHead: true });
    await this.replaceWorkingTree(snapshot);
    return this.commit(`resume: restore ${oid.slice(0, 12)}`);
  }

  async readWorkingTree() {
    const snapshot = new Map();
    const files = await this.walkFiles(this.dir);
    for (const absolute of files) {
      const relative = absolute.slice(`${this.dir}/`.length);
      if (relative.startsWith(".git/") || relative.startsWith("output/")) continue;
      snapshot.set(relative, new Uint8Array(await this.pfs.readFile(absolute)));
    }
    return snapshot;
  }

  async replaceWorkingTree(snapshot) {
    const files = await this.walkFiles(this.dir);
    for (const absolute of files) {
      const relative = absolute.slice(`${this.dir}/`.length);
      if (relative.startsWith(".git/") || relative.startsWith("output/")) continue;
      await this.pfs.unlink(absolute);
    }
    for (const [relative, bytes] of snapshot) await this.writeBytes(relative, bytes);
  }

  async engineSnapshot() {
    const result = {};
    const files = await this.walkFiles(this.dir);
    for (const absolute of files) {
      const relative = absolute.slice(`${this.dir}/`.length);
      if (!isEngineFile(relative)) continue;
      result[relative] = decoder.decode(await this.pfs.readFile(absolute));
    }
    return result;
  }

  async exportArchiveBlob() {
    const zip = new JSZip();
    const head = await this.currentHead();
    const manifest = {
      format: "resume-studio-project",
      version: 1,
      createdAt: new Date().toISOString(),
      head,
      includesGit: true,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
    const files = await this.walkFiles(this.dir);
    for (const absolute of files) {
      const relative = absolute.slice(`${this.dir}/`.length);
      if (relative.startsWith("output/")) continue;
      zip.file(`project/${relative}`, await this.pfs.readFile(absolute));
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 9 } });
  }

  async backupStatus() {
    const history = await this.history(200);
    const head = history[0]?.oid || "";
    const storedHead = localStorage.getItem(BACKUP_HEAD_KEY) || "";
    const index = history.findIndex((entry) => entry.oid === storedHead);
    const lastHead = index >= 0 ? storedHead : "";
    const lastAt = lastHead ? localStorage.getItem(BACKUP_AT_KEY) : null;
    const commitsSince = lastHead ? index : history.length;
    const daysSince = lastAt ? (Date.now() - Date.parse(lastAt)) / 86_400_000 : Infinity;
    return { head, lastHead, lastAt, commitsSince, daysSince };
  }

  markBackedUp(head) {
    localStorage.setItem(BACKUP_HEAD_KEY, head);
    localStorage.setItem(BACKUP_AT_KEY, new Date().toISOString());
  }

  async saveRecovery(blob) {
    await this.mkdirp(RECOVERY_DIR);
    const name = `previous-${new Date().toISOString().replace(/[:.]/g, "-")}.resume-studio`;
    await this.pfs.writeFile(`${RECOVERY_DIR}/${name}`, new Uint8Array(await blob.arrayBuffer()));
    const names = (await this.pfs.readdir(RECOVERY_DIR)).sort().reverse();
    for (const old of names.slice(MAX_RECOVERIES)) await this.pfs.unlink(`${RECOVERY_DIR}/${old}`);
    await this.pfs.flush();
    return name;
  }

  async latestRecovery() {
    if (!(await this.pathExists(RECOVERY_DIR))) return null;
    const names = (await this.pfs.readdir(RECOVERY_DIR)).sort().reverse();
    const name = names[0];
    if (!name) return null;
    const bytes = await this.pfs.readFile(`${RECOVERY_DIR}/${name}`);
    return { name, blob: new Blob([bytes], { type: "application/zip" }) };
  }

  async releaseIds() {
    const root = `${this.dir}/releases`;
    if (!(await this.pathExists(root))) return [];
    return (await this.walkFiles(root))
      .map((path) => path.slice(`${root}/`.length))
      .filter((name) => /^r\d{4}\.yaml$/.test(name))
      .map((name) => name.slice(0, -5))
      .sort();
  }

  async submissionIds() {
    const root = `${this.dir}/submissions`;
    if (!(await this.pathExists(root))) return [];
    return (await this.walkFiles(root))
      .map((path) => path.slice(`${root}/`.length))
      .filter((name) => /^s\d{4}\.yaml$/.test(name))
      .map((name) => name.slice(0, -5))
      .sort();
  }

  absolute(relative) {
    return this.absoluteAt(this.dir, relative);
  }

  absoluteAt(root, relative) {
    const safe = sanitizeRelativePath(relative);
    if (!safe) throw new Error("Invalid project path.");
    return `${root}/${safe}`;
  }

  async swapImportedProject() {
    await this.removeTree(PREVIOUS_DIR);
    let movedPrevious = false;
    try {
      if (await this.pathExists(this.dir)) {
        await this.pfs.rename(this.dir, PREVIOUS_DIR);
        movedPrevious = true;
      }
      await this.pfs.rename(IMPORT_DIR, this.dir);
      if (movedPrevious) await this.removeTree(PREVIOUS_DIR);
      await this.pfs.flush();
    } catch (error) {
      if (await this.pathExists(this.dir)) await this.removeTree(this.dir).catch(() => undefined);
      if (movedPrevious && await this.pathExists(PREVIOUS_DIR)) {
        await this.pfs.rename(PREVIOUS_DIR, this.dir).catch(() => undefined);
      }
      throw new Error(`Could not replace the local project safely: ${error.message}`);
    }
  }

  async walkFiles(root) {
    const result = [];
    if (!(await this.pathExists(root))) return result;
    const names = await this.pfs.readdir(root);
    for (const name of names) {
      const child = `${root}/${name}`;
      const stat = await this.pfs.stat(child);
      if (stat.isDirectory()) result.push(...await this.walkFiles(child));
      else result.push(child);
    }
    return result;
  }

  async mkdirp(path) {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current += `/${part}`;
      if (!(await this.pathExists(current))) await this.pfs.mkdir(current);
    }
  }

  async removeTree(path) {
    if (!(await this.pathExists(path))) return;
    const stat = await this.pfs.stat(path);
    if (!stat.isDirectory()) {
      await this.pfs.unlink(path);
      return;
    }
    for (const name of await this.pfs.readdir(path)) await this.removeTree(`${path}/${name}`);
    await this.pfs.rmdir(path);
  }
}

export async function requirePersistentStorage() {
  if (!navigator.storage?.persisted || !navigator.storage?.persist) {
    return { granted: false, reason: "This browser cannot protect your work from automatic cleanup." };
  }
  if (await navigator.storage.persisted()) return { granted: true };
  const granted = await navigator.storage.persist();
  return {
    granted: granted && await navigator.storage.persisted(),
    reason: granted ? "Protection could not be verified." : "The browser did not allow this work to be protected.",
  };
}

export async function persistentStorageState() {
  if (!navigator.storage?.persisted) return false;
  return navigator.storage.persisted();
}

export function downloadBlob(blob, filename) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 5_000);
}

export async function sha256Hex(value) {
  const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function defaultAuthor() {
  return {
    name: localStorage.getItem("resume-studio:author-name") || "Resume Studio",
    email: localStorage.getItem("resume-studio:author-email") || "local@resume.studio",
    timestamp: Math.floor(Date.now() / 1000),
    timezoneOffset: new Date().getTimezoneOffset(),
  };
}

async function validateManifest(zip) {
  const entry = zip.file("manifest.json") || zip.file("resume-studio-manifest.json");
  if (!entry) return;
  let manifest;
  try {
    manifest = JSON.parse(await entry.async("text"));
  } catch {
    throw new Error("This project file is damaged or incomplete.");
  }
  if (manifest.format && manifest.format !== "resume-studio-project") {
    throw new Error("This project file is not supported.");
  }
  if (manifest.version && manifest.version !== 1) {
    throw new Error("This project file was created by an unsupported version.");
  }
}

function clearBackupMarkerIfUnrelated(history) {
  const storedHead = localStorage.getItem(BACKUP_HEAD_KEY);
  if (!storedHead || history.some((entry) => entry.oid === storedHead)) return;
  localStorage.removeItem(BACKUP_HEAD_KEY);
  localStorage.removeItem(BACKUP_AT_KEY);
}

function clearBackupMarker() {
  localStorage.removeItem(BACKUP_HEAD_KEY);
  localStorage.removeItem(BACKUP_AT_KEY);
}

function detectProjectPrefix(names) {
  if (names.includes("project/master.yaml")) return "project/";
  if (names.includes("master.yaml")) return "";
  const candidates = names.filter((name) => name.endsWith("/master.yaml"));
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0].slice(0, -"master.yaml".length);
}

function sanitizeRelativePath(value) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return "";
  return parts.join("/");
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function isEngineFile(relative) {
  if (relative === "master.yaml" || relative === "uv.lock" || relative === "pyproject.toml") return true;
  return /^(overlays|releases|submissions)\/.+\.yaml$/.test(relative) || relative === "template/resume.typ";
}
