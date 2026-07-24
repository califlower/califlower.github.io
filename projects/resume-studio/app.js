import {
  BrowserProjectRepository,
  downloadBlob,
  persistentStorageState,
  requirePersistentStorage,
  sha256Hex,
} from "./storage.js";
import { ResumeEngine } from "./engine.js";
import { BrowserTypstRenderer, BROWSER_RENDERER_VERSION, previewDocument } from "./renderer.js";
import { NearbyTransfer } from "./transfer.js";

const repository = new BrowserProjectRepository();
let engine;
let renderer;
let currentOverlay = "";
let currentFile = "master";
let saveTimer;
let previewTimer;
let currentResume;
let currentDocument;
let transfer;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const gate = $("#gate");
const app = $("#app");
const editor = $("#editor");

void boot().catch((error) => {
  showGate("project");
  $("#gate-error").textContent = `Could not open the local project: ${error.message}`;
});

async function boot() {
  bindUi();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => undefined);

  const persistent = await persistentStorageState();
  if (!persistent) {
    showGate("persistence");
    return;
  }
  if (!(await repository.exists())) {
    showGate("project");
    return;
  }
  await openProject();
}

function bindUi() {
  $("#enable-storage").addEventListener("click", enableStorage);
  $("#new-project").addEventListener("click", createStarter);
  $("#receive-project").addEventListener("click", receiveAtGate);
  $("#import-project").addEventListener("click", () => $("#project-file").click());
  $("#project-file").addEventListener("change", importSelectedProject);
  $("#overlay-select").addEventListener("change", changeOverlay);
  $$(".file-tab").forEach((button) => button.addEventListener("click", () => switchFile(button.dataset.file)));
  editor.addEventListener("input", editorChanged);
  $("#save-version-button").addEventListener("click", saveVersion);
  $("#lint-button").addEventListener("click", refreshChecks);
  $("#refresh-preview").addEventListener("click", refreshPreview);
  $("#download-pdf").addEventListener("click", downloadPdf);
  $("#backup-button").addEventListener("click", downloadBackup);
  $("#backup-reminder-button").addEventListener("click", downloadBackup);
  $("#history-button").addEventListener("click", showHistory);
  $("#recovery-button").addEventListener("click", downloadRecovery);
  $("#transfer-button").addEventListener("click", showTransfer);
  $("#release-button").addEventListener("click", showRelease);
  $("#submission-button").addEventListener("click", showSubmission);
  $("#release-form").addEventListener("submit", createRelease);
  $("#submission-form").addEventListener("submit", createSubmission);
  $("#send-nearby").addEventListener("click", sendNearby);
  $("#receive-nearby").addEventListener("click", showReceiveForm);
  $("#receive-form").addEventListener("submit", receiveNearby);
  $("#accept-transfer").addEventListener("click", () => transfer?.accept());
  $("#share-project").addEventListener("click", shareProject);
  $$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.addEventListener("visibilitychange", () => { if (document.hidden) void flushEditor(); });
  window.addEventListener("beforeunload", () => void flushEditor());
}

function showGate(mode) {
  app.hidden = true;
  gate.hidden = false;
  $("#persistence-actions").hidden = mode !== "persistence";
  $("#project-actions").hidden = mode !== "project";
  $("#gate-copy").textContent = mode === "persistence"
    ? "Your project stays on this device. Resume Studio requires persistent browser storage before it will create or open anything."
    : "Persistent storage is protected. Open a project archive or create a clean starter project.";
}

async function enableStorage() {
  const button = $("#enable-storage");
  button.disabled = true;
  $("#gate-error").textContent = "";
  try {
    const result = await requirePersistentStorage();
    if (!result.granted) throw new Error(`${result.reason} Resume Studio will not continue because local work could be evicted.`);
    showGate("project");
  } catch (error) {
    $("#gate-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function createStarter() {
  await gateOperation(async () => {
    await repository.createStarter();
    await openProject();
  });
}

async function receiveAtGate() {
  resetTransferUi();
  $("#transfer-dialog").showModal();
  showReceiveForm();
}

async function importSelectedProject(event) {
  const [file] = event.target.files;
  if (!file) return;
  await gateOperation(async () => {
    await repository.importArchive(file);
    await openProject();
  });
  event.target.value = "";
}

async function gateOperation(operation) {
  $("#gate-error").textContent = "";
  $$("#project-actions button").forEach((button) => button.disabled = true);
  try {
    await operation();
  } catch (error) {
    $("#gate-error").textContent = error.message;
  } finally {
    $$("#project-actions button").forEach((button) => button.disabled = false);
  }
}

async function openProject() {
  gate.hidden = true;
  app.hidden = false;
  engine ||= new ResumeEngine(repository);
  renderer ||= new BrowserTypstRenderer();

  const overlays = await repository.overlayIds();
  if (!overlays.length) throw new Error("Project has no overlays.");
  const preferred = localStorage.getItem("resume-studio:overlay");
  currentOverlay = overlays.includes(preferred) ? preferred : overlays[0];
  const select = $("#overlay-select");
  select.replaceChildren(...overlays.map((id) => new Option(id, id, false, id === currentOverlay)));
  $("#overlay-file-label").textContent = `${currentOverlay}.yaml`;
  await loadEditor();
  await Promise.all([refreshChecks(), refreshPreview(), updateBackupReminder(), updateRecoveryButton()]);
}

async function changeOverlay(event) {
  await flushEditor();
  currentOverlay = event.target.value;
  localStorage.setItem("resume-studio:overlay", currentOverlay);
  $("#overlay-file-label").textContent = `${currentOverlay}.yaml`;
  if (currentFile === "overlay") await loadEditor();
  await Promise.all([refreshChecks(), refreshPreview()]);
}

async function switchFile(file) {
  if (file === currentFile) return;
  await flushEditor();
  currentFile = file;
  $$(".file-tab").forEach((button) => button.classList.toggle("active", button.dataset.file === file));
  await loadEditor();
}

async function loadEditor() {
  editor.value = await repository.readText(currentPath());
  $("#editor-title").textContent = {
    master: "Master content",
    overlay: currentOverlay,
    template: "Visual template",
  }[currentFile];
  setDirtyState(false);
}

function editorChanged() {
  setDirtyState(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushEditor(), 450);
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshAfterEdit(), 1_000);
}

async function flushEditor() {
  clearTimeout(saveTimer);
  if (!editor.classList.contains("dirty")) return;
  await repository.writeText(currentPath(), editor.value);
  editor.classList.remove("dirty");
  $("#dirty-state").textContent = "Saved locally · not versioned";
  $("#dirty-state").classList.add("dirty");
}

function setDirtyState(dirty) {
  editor.classList.toggle("dirty", dirty);
  const pill = $("#dirty-state");
  pill.textContent = dirty ? "Saving locally…" : "Saved locally";
  pill.classList.toggle("dirty", dirty);
}

async function refreshAfterEdit() {
  await flushEditor();
  await Promise.all([refreshChecks(), refreshPreview()]);
}

async function saveVersion() {
  await flushEditor();
  const button = $("#save-version-button");
  await buttonOperation(button, async () => {
    const oid = await repository.commit(`resume: save ${currentOverlay}`);
    $("#dirty-state").textContent = `Version ${oid.slice(0, 8)}`;
    $("#dirty-state").classList.remove("dirty");
    await updateBackupReminder();
  });
}

async function refreshChecks() {
  const target = $("#diagnostics");
  target.innerHTML = '<p class="muted">Running checks…</p>';
  try {
    const result = await engine.inspect(currentOverlay);
    renderDiagnostics(result.diagnostics);
    return result.diagnostics;
  } catch (error) {
    renderDiagnostics([{ severity: "error", location: "project", message: error.message }]);
    return [{ severity: "error", message: error.message }];
  }
}

function renderDiagnostics(diagnostics) {
  const target = $("#diagnostics");
  if (!diagnostics.length) {
    target.innerHTML = '<p class="diagnostic"><strong>All clear</strong>No content or reference problems found.</p>';
    return;
  }
  target.replaceChildren(...diagnostics.map((diagnostic) => {
    const item = document.createElement("div");
    item.className = `diagnostic ${diagnostic.severity}`;
    const strong = document.createElement("strong");
    strong.textContent = diagnostic.location;
    item.append(strong, document.createTextNode(diagnostic.message));
    return item;
  }));
}

async function refreshPreview() {
  const status = $("#preview-status");
  status.textContent = "Resolving content and compiling Typst in this browser…";
  try {
    currentResume = await engine.resolve(currentOverlay);
    currentDocument = previewDocument(currentResume, currentOverlay);
    const template = await repository.readText("template/resume.typ");
    const svg = await renderer.svg(template, currentResume, currentDocument);
    $("#preview").innerHTML = svg;
    status.textContent = "Rendered locally · nothing uploaded";
  } catch (error) {
    $("#preview").replaceChildren();
    status.textContent = `Preview unavailable: ${error.message}`;
  }
}

async function buildPdf() {
  await flushEditor();
  currentResume = await engine.resolve(currentOverlay);
  currentDocument = previewDocument(currentResume, currentOverlay);
  const template = await repository.readText("template/resume.typ");
  const bytes = await renderer.pdf(template, currentResume, currentDocument);
  return new Blob([bytes], { type: "application/pdf" });
}

async function downloadPdf() {
  const button = $("#download-pdf");
  await buttonOperation(button, async () => {
    const blob = await buildPdf();
    downloadBlob(blob, `${safeName(currentOverlay)}.pdf`);
  });
}

async function downloadBackup() {
  const button = $("#backup-button");
  await buttonOperation(button, async () => {
    await flushEditor();
    await repository.commit(`resume: save ${currentOverlay}`);
    const blob = await repository.exportArchiveBlob();
    const head = await repository.currentHead();
    downloadBlob(blob, backupFilename());
    repository.markBackedUp(head);
    await updateBackupReminder();
  });
}

async function shareProject() {
  try {
    await flushEditor();
    await repository.commit(`resume: save ${currentOverlay}`);
    const blob = await repository.exportArchiveBlob();
    const file = new File([blob], backupFilename(), { type: "application/zip" });
    if (!navigator.canShare?.({ files: [file] })) {
      downloadBlob(blob, file.name);
      return;
    }
    await navigator.share({ title: "Resume Studio project", files: [file] });
    repository.markBackedUp(await repository.currentHead());
    await updateBackupReminder();
  } catch (error) {
    if (error.name !== "AbortError") alert(error.message);
  }
}

async function updateBackupReminder() {
  const status = await repository.backupStatus();
  const reminder = $("#backup-reminder");
  const stale = !status.lastHead || status.commitsSince >= 5 || status.daysSince >= 14;
  reminder.hidden = !stale;
  if (!stale) return;
  $("#backup-message").textContent = !status.lastHead
    ? "This project has never been backed up outside this browser."
    : `${status.commitsSince} version${status.commitsSince === 1 ? "" : "s"} since the last backup.`;
}


async function updateRecoveryButton() {
  $("#recovery-button").hidden = !(await repository.latestRecovery());
}

async function downloadRecovery() {
  const recovery = await repository.latestRecovery();
  if (!recovery) return;
  downloadBlob(recovery.blob, recovery.name);
}

async function showHistory() {
  await flushEditor();
  const dialog = $("#history-dialog");
  const target = $("#history-list");
  target.innerHTML = '<p class="muted">Reading local Git history…</p>';
  dialog.showModal();
  const history = await repository.history();
  target.replaceChildren(...history.map((entry, index) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = entry.message;
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${entry.oid.slice(0, 12)} · ${new Date(entry.author.timestamp * 1000).toLocaleString()}`;
    content.append(title, meta);
    for (const tag of entry.tags) {
      const badge = document.createElement("span");
      badge.className = "tag";
      badge.textContent = tag;
      content.append(badge);
    }
    row.append(content);
    if (index > 0) {
      const restore = document.createElement("button");
      restore.className = "secondary compact";
      restore.textContent = "Restore";
      restore.addEventListener("click", async () => {
        if (!confirm("Restore this version as a new commit? Current history will be preserved.")) return;
        restore.disabled = true;
        try {
          await repository.restore(entry.oid);
          dialog.close();
          await openProject();
        } catch (error) {
          alert(error.message);
          restore.disabled = false;
        }
      });
      row.append(restore);
    }
    return row;
  }));
}

function showRelease() {
  $("#release-status").textContent = "";
  $("#release-description").value = "";
  $("#release-dialog").showModal();
}

async function createRelease(event) {
  event.preventDefault();
  const submit = event.submitter;
  submit.disabled = true;
  const status = $("#release-status");
  try {
    status.textContent = "Checking and saving current work…";
    await flushEditor();
    const diagnostics = await refreshChecks();
    if (diagnostics.some((item) => item.severity === "error")) throw new Error("Fix the project errors before creating a release.");
    await repository.commit(`resume: save before release (${currentOverlay})`);
    const sourceCommit = await repository.currentHead();
    const releaseId = nextId(await repository.releaseIds(), "r");
    const description = $("#release-description").value.trim();
    status.textContent = "Rendering browser PDF…";
    const pdf = await buildPdf();
    const pdfSha256 = await sha256Hex(pdf);
    const createdAt = new Date().toISOString();
    status.textContent = "Writing immutable release snapshot…";
    const yaml = await engine.createRelease({
      overlay: currentOverlay,
      releaseId,
      description,
      createdAt,
      sourceCommit,
      rendererVersion: BROWSER_RENDERER_VERSION,
      pdfSha256,
    });
    await repository.writeText(`releases/${releaseId}.yaml`, yaml);
    const commit = await repository.commit(`resume: release ${releaseId} (${currentOverlay})`);
    await repository.createAnnotatedTag(`resume/${releaseId}`, [
      `Resume release ${releaseId}`,
      `Overlay: ${currentOverlay}`,
      `Description: ${description}`,
      `Source commit: ${sourceCommit}`,
      `Renderer: ${BROWSER_RENDERER_VERSION}`,
      `PDF SHA-256: ${pdfSha256}`,
    ].join("\n"));
    downloadBlob(pdf, `${releaseId}.pdf`);
    status.textContent = `Released ${releaseId} at ${commit.slice(0, 12)}. PDF downloaded.`;
    await updateBackupReminder();
    setTimeout(() => $("#release-dialog").close(), 1_300);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

async function showSubmission() {
  const releases = await repository.releaseIds();
  if (!releases.length) {
    alert("Create a release before recording where it was sent.");
    return;
  }
  const select = $("#submission-release");
  select.replaceChildren(...releases.map((id) => new Option(id, id, false, id === releases.at(-1))));
  $("#submission-form").reset();
  select.value = releases.at(-1);
  $("#submission-dialog").showModal();
}

async function createSubmission(event) {
  event.preventDefault();
  const button = event.submitter;
  await buttonOperation(button, async () => {
    const submissionId = nextId(await repository.submissionIds(), "s");
    const yaml = await engine.createSubmission({
      submissionId,
      releaseId: $("#submission-release").value,
      submittedAt: new Date().toISOString(),
      destination: $("#submission-destination").value.trim(),
      purpose: $("#submission-purpose").value.trim(),
      context: $("#submission-context").value,
      url: $("#submission-url").value,
      note: $("#submission-note").value,
    });
    await repository.writeText(`submissions/${submissionId}.yaml`, yaml);
    await repository.commit(`resume: record submission ${submissionId} (${$("#submission-destination").value.trim()})`);
    $("#submission-dialog").close();
    await updateBackupReminder();
  });
}

function showTransfer() {
  resetTransferUi();
  $("#transfer-dialog").showModal();
}

async function sendNearby() {
  $("#transfer-home").hidden = true;
  $("#transfer-send").hidden = false;
  try {
    await flushEditor();
    await repository.commit(`resume: save ${currentOverlay}`);
    const blob = await repository.exportArchiveBlob();
    transfer = wireTransfer(new NearbyTransfer());
    await transfer.startSender(blob);
  } catch (error) {
    $("#send-transfer-status").textContent = error.message;
  }
}

function showReceiveForm() {
  $("#transfer-home").hidden = true;
  $("#receive-form").hidden = false;
  $("#receive-code").focus();
}

async function receiveNearby(event) {
  event.preventDefault();
  try {
    if (await repository.exists()) {
      await flushEditor();
      await repository.commit(`resume: save before nearby receive (${currentOverlay})`);
    }
    transfer = wireTransfer(new NearbyTransfer());
    await transfer.startReceiver($("#receive-code").value);
  } catch (error) {
    $("#receive-transfer-status").textContent = error.message;
  }
}

function wireTransfer(instance) {
  return instance
    .on("code", (code) => $("#transfer-code").textContent = `${code.slice(0, 3)} ${code.slice(3)}`)
    .on("status", (message) => {
      $("#send-transfer-status").textContent = message;
      $("#receive-transfer-status").textContent = message;
    })
    .on("phrase", (phrase) => {
      const id = instance.role === "sender" ? "#send-phrase" : "#receive-phrase";
      $(id).textContent = phrase;
      $(id).hidden = false;
    })
    .on("verified", () => {
      if (instance.role === "receiver") $("#accept-transfer").hidden = false;
    })
    .on("progress", (progress) => {
      const done = progress.received ?? progress.sent ?? 0;
      const message = `Transferring ${Math.round(done / progress.total * 100)}%…`;
      $("#send-transfer-status").textContent = message;
      $("#receive-transfer-status").textContent = message;
    })
    .on("receive", async (blob) => {
      await repository.importArchive(blob);
      await openProject();
    })
    .on("complete", () => setTimeout(() => $("#transfer-dialog").close(), 1_500))
    .on("error", (error) => {
      $("#send-transfer-status").textContent = error.message;
      $("#receive-transfer-status").textContent = error.message;
    });
}

function resetTransferUi() {
  transfer?.close();
  transfer = null;
  $("#transfer-home").hidden = false;
  $("#transfer-send").hidden = true;
  $("#receive-form").hidden = true;
  $("#accept-transfer").hidden = true;
  $("#send-phrase").hidden = true;
  $("#receive-phrase").hidden = true;
  $("#send-transfer-status").textContent = "";
  $("#receive-transfer-status").textContent = "";
  $("#receive-code").value = "";
}

function currentPath() {
  if (currentFile === "master") return "master.yaml";
  if (currentFile === "template") return "template/resume.typ";
  return `overlays/${currentOverlay}.yaml`;
}

function nextId(ids, prefix) {
  const highest = ids.reduce((max, id) => Math.max(max, Number(id.slice(1)) || 0), 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

function safeName(value) {
  return value.replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/g, "-");
}

function backupFilename() {
  return `resume-studio-${new Date().toISOString().slice(0, 10)}.resume-studio`;
}

async function buttonOperation(button, operation) {
  button.disabled = true;
  try {
    await operation();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}
