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
const STORAGE_ACKNOWLEDGED_KEY = "resume-studio:storage-acknowledged";
let engine;
let renderer;
let currentOverlay = "";
let currentFile = "master";
let overlayLabels = new Map();
let saveTimer;
let previewTimer;
let transfer;
let checksRequest = 0;
let previewRequest = 0;

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
  if (!persistent && localStorage.getItem(STORAGE_ACKNOWLEDGED_KEY) !== "true") {
    showGate("persistence");
    return;
  }
  if (!(await repository.exists())) {
    showGate("project");
    return;
  }
  const repair = await repository.repairHistoryIfNeeded();
  if (repair) $("#project-state").textContent = "Recovered · back up now";
  await openProject();
  if (repair) {
    $("#backup-reminder").hidden = false;
    $("#backup-message").textContent = "Resume Studio recovered your current work after an incomplete save. Download a fresh backup now.";
  }
}

function bindUi() {
  $("#enable-storage").addEventListener("click", enableStorage);
  $("#new-project").addEventListener("click", createStarter);
  $("#receive-project").addEventListener("click", receiveAtGate);
  $("#import-project").addEventListener("click", () => $("#project-file").click());
  $("#project-file").addEventListener("change", importSelectedProject);
  $("#overlay-select").addEventListener("change", changeOverlay);
  $("#new-overlay-button").addEventListener("click", showOverlayForm);
  $("#overlay-form").addEventListener("submit", createOverlay);
  $$(".file-tab").forEach((button) => button.addEventListener("click", () => switchFile(button.dataset.file)));
  editor.addEventListener("input", editorChanged);
  $("#save-version-button").addEventListener("click", saveVersion);
  $("#lint-button").addEventListener("click", () => refreshChecks());
  $("#refresh-preview").addEventListener("click", () => refreshPreview());
  $("#open-preview").addEventListener("click", () => $(".preview-pane").classList.add("open"));
  $("#close-preview").addEventListener("click", () => $(".preview-pane").classList.remove("open"));
  $("#download-pdf").addEventListener("click", downloadPdf);
  $("#backup-button").addEventListener("click", (event) => downloadBackup(event.currentTarget));
  $("#backup-reminder-button").addEventListener("click", (event) => downloadBackup(event.currentTarget));
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
  $("#accept-transfer").addEventListener("click", () => {
    try {
      transfer?.accept();
    } catch (error) {
      $("#receive-transfer-status").textContent = error.message;
    }
  });
  $("#share-project").addEventListener("click", shareProject);
  $("#download-project").addEventListener("click", downloadProject);
  $$(".transfer-back").forEach((button) => button.addEventListener("click", () => {
    if (app.hidden) $("#transfer-dialog").close();
    else resetTransferUi();
  }));
  $$(".close-dialog").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  $("#transfer-dialog").addEventListener("close", resetTransferUi);
  document.addEventListener("visibilitychange", () => { if (document.hidden) void flushEditor(); });
  window.addEventListener("beforeunload", () => void flushEditor());
  updateTransferAvailability();
}

function showGate(mode) {
  app.hidden = true;
  gate.hidden = false;
  $("#persistence-actions").hidden = mode !== "persistence";
  $("#project-actions").hidden = mode !== "project";
  $("#gate-copy").textContent = mode === "persistence"
    ? "Your work stays on this device. Keep regular backups so it is never tied to one browser."
    : "Open a project file or create a starter project.";
}

async function enableStorage() {
  const button = $("#enable-storage");
  button.disabled = true;
  $("#gate-error").textContent = "";
  try {
    const result = await requirePersistentStorage();
    localStorage.setItem(STORAGE_ACKNOWLEDGED_KEY, "true");
    showGate("project");
    if (!result.granted) {
      $("#gate-error").textContent = "This browser may clear local work when space is low. Keep an up-to-date backup.";
    }
  } catch (error) {
    localStorage.setItem(STORAGE_ACKNOWLEDGED_KEY, "true");
    showGate("project");
    $("#gate-error").textContent = "Browser protection was unavailable. Keep an up-to-date backup.";
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
    updateTransferAvailability();
  }
}

async function openProject() {
  gate.hidden = true;
  app.hidden = false;
  engine ||= new ResumeEngine(repository);
  renderer ||= new BrowserTypstRenderer();

  const overlays = await repository.overlayIds();
  if (!overlays.length) throw new Error("This project has no resume targets.");
  const preferred = localStorage.getItem("resume-studio:overlay");
  currentOverlay = overlays.includes(preferred) ? preferred : overlays[0];
  await renderOverlayOptions(overlays);
  await loadEditor();
  await Promise.all([refreshChecks(), refreshPreview(), updateBackupReminder(), updateRecoveryButton()]);
}

async function renderOverlayOptions(overlays) {
  overlayLabels = new Map(await Promise.all(overlays.map(async (id) => {
    try {
      const source = await repository.readText(`overlays/${id}.yaml`);
      const target = source.match(/^# Target:\s*(.+)$/m)?.[1]?.trim();
      return [id, target || humanizeId(id)];
    } catch {
      return [id, humanizeId(id)];
    }
  })));
  $("#overlay-select").replaceChildren(
    ...overlays.map((id) => new Option(overlayLabels.get(id), id, false, id === currentOverlay)),
  );
}

async function changeOverlay(event) {
  await flushEditor();
  currentOverlay = event.target.value;
  localStorage.setItem("resume-studio:overlay", currentOverlay);
  if (currentFile === "overlay") await loadEditor();
  await Promise.all([refreshChecks(), refreshPreview()]);
}

async function showOverlayForm() {
  await flushEditor();
  const overlays = await repository.overlayIds();
  const form = $("#overlay-form");
  form.reset();
  $("#overlay-base").replaceChildren(
    ...overlays.map((id) => new Option(overlayLabels.get(id) || humanizeId(id), id, false, id === currentOverlay)),
  );
  $("#overlay-base").value = currentOverlay;
  $("#overlay-status").textContent = "";
  $("#overlay-dialog").showModal();
  $("#overlay-company").focus();
}

async function createOverlay(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  const status = $("#overlay-status");
  try {
    const company = $("#overlay-company").value.trim();
    const role = $("#overlay-role").value.trim();
    const base = $("#overlay-base").value;
    const id = targetOverlayId(company, role);
    const overlays = await repository.overlayIds();
    if (!id) throw new Error("Enter a company name that can be used as a filename.");
    if (overlays.includes(id)) throw new Error("A target for this company and role already exists.");
    if (!overlays.includes(base)) throw new Error("Choose an existing target to start from.");

    const label = role ? `${company} - ${role}` : company;
    await repository.writeText(`overlays/${id}.yaml`, [
      `# Target: ${label.replaceAll("\n", " ")}`,
      "# Add only fields that should differ from the base target.",
      `extends: ${JSON.stringify(base)}`,
      "",
    ].join("\n"));

    currentOverlay = id;
    currentFile = "overlay";
    localStorage.setItem("resume-studio:overlay", currentOverlay);
    await renderOverlayOptions([...overlays, id].sort());
    $$(".file-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.file === currentFile));
    await loadEditor();
    $("#overlay-dialog").close();
    await Promise.all([refreshChecks(), refreshPreview()]);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
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
    overlay: overlayLabels.get(currentOverlay) || humanizeId(currentOverlay),
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
    await repository.commit(`resume: save ${currentOverlay}`);
    $("#dirty-state").textContent = "Version saved";
    $("#dirty-state").classList.remove("dirty");
    await updateBackupReminder();
  });
}

async function refreshChecks(overlay = currentOverlay) {
  const request = ++checksRequest;
  const target = $("#diagnostics");
  if (overlay === currentOverlay) {
    $("#checks-icon").className = "checks-icon running";
    $("#checks-icon").textContent = "...";
    $("#checks-summary").textContent = "Running checks";
    target.innerHTML = '<p class="muted">Running checks…</p>';
  }
  try {
    const result = await engine.inspect(overlay);
    if (request === checksRequest && overlay === currentOverlay) renderDiagnostics(result.diagnostics);
    return result.diagnostics;
  } catch (error) {
    if (request === checksRequest && overlay === currentOverlay) {
      renderDiagnostics([{ severity: "error", location: "project", message: error.message }]);
    }
    return [{ severity: "error", message: error.message }];
  }
}

function renderDiagnostics(diagnostics) {
  const target = $("#diagnostics");
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.filter((item) => item.severity === "warning").length;
  const icon = $("#checks-icon");
  icon.className = `checks-icon ${errorCount ? "error" : warningCount ? "warning" : "clear"}`;
  icon.textContent = errorCount || warningCount ? "!" : "OK";
  $("#checks-summary").textContent = diagnosticsSummary(errorCount, warningCount);

  if (!diagnostics.length) {
    const item = document.createElement("div");
    item.className = "diagnostic clear";
    const mark = document.createElement("span");
    mark.className = "diagnostic-mark";
    mark.textContent = "OK";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = "No issues found";
    content.append(title, document.createTextNode("Selected content and references passed."));
    item.append(mark, content);
    target.replaceChildren(item);
    return;
  }
  target.replaceChildren(...diagnostics.map((diagnostic) => {
    const item = document.createElement("div");
    item.className = `diagnostic ${diagnostic.severity}`;
    const mark = document.createElement("span");
    mark.className = "diagnostic-mark";
    mark.textContent = "!";
    mark.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = diagnosticLabel(diagnostic.location);
    content.append(strong, document.createTextNode(diagnostic.message));
    item.append(mark, content);
    return item;
  }));
}

function diagnosticsSummary(errors, warnings) {
  if (!errors && !warnings) return "No issues found";
  const parts = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function diagnosticLabel(location = "") {
  const profile = location.match(/^master\.yaml:profile\.([^[]+)/);
  if (profile) return `Profile · ${humanizeId(profile[1])}`;
  const experience = location.match(/^master\.yaml:experience\.([^.]+)(?:\.(.+))?/);
  if (experience) return `Experience · ${humanizeId(experience[1])}${experience[2] ? ` · ${humanizeId(experience[2])}` : ""}`;
  const education = location.match(/^master\.yaml:education\.([^.]+)/);
  if (education) return `Education · ${humanizeId(education[1])}`;
  const skills = location.match(/^master\.yaml:skill_groups\.([^.]+)/);
  if (skills) return `Skills · ${humanizeId(skills[1])}`;
  const selected = location.match(/^overlay [^:]+:(.+)/);
  if (selected) return `Selected resume · ${selected[1]}`;
  if (location.startsWith("overlays/")) return "Selected resume";
  if (location.startsWith("releases/")) return "Saved release";
  if (location.startsWith("submissions/")) return "Submission record";
  return "Project";
}

async function refreshPreview() {
  const request = ++previewRequest;
  const overlay = currentOverlay;
  const status = $("#preview-status");
  status.textContent = "Updating your preview…";
  try {
    const resume = await engine.resolve(overlay);
    const document = previewDocument(resume, overlay);
    const template = await repository.readText("template/resume.typ");
    const svg = await renderer.svg(template, resume, document);
    if (request !== previewRequest || overlay !== currentOverlay) return;
    $("#preview").innerHTML = svg;
    status.textContent = "Rendered locally · nothing uploaded";
  } catch (error) {
    if (request !== previewRequest || overlay !== currentOverlay) return;
    $("#preview").replaceChildren();
    status.textContent = `Preview unavailable: ${error.message}`;
  }
}

async function buildPdf(overlay = currentOverlay) {
  await flushEditor();
  const resume = await engine.resolve(overlay);
  const document = previewDocument(resume, overlay);
  const template = await repository.readText("template/resume.typ");
  const bytes = await renderer.pdf(template, resume, document);
  return new Blob([bytes], { type: "application/pdf" });
}

async function downloadPdf() {
  const button = $("#download-pdf");
  await buttonOperation(button, async () => {
    const overlay = currentOverlay;
    const blob = await buildPdf(overlay);
    downloadBlob(blob, `${safeName(overlay)}.pdf`);
  });
}

async function downloadBackup(button) {
  await buttonOperation(button, async () => {
    const { blob, head } = await createProjectArchive();
    downloadBlob(blob, backupFilename());
    repository.markBackedUp(head);
    await updateBackupReminder();
  });
}

async function shareProject() {
  const button = $("#share-project");
  const status = $("#archive-transfer-status");
  button.disabled = true;
  status.textContent = "Preparing your complete project and saved versions…";
  try {
    const { blob, head } = await createProjectArchive();
    const file = new File([blob], backupFilename(), { type: "application/zip" });
    if (!canShareFile(file)) throw new Error("Sharing is unavailable here. Download the project file instead.");
    await navigator.share({ title: "Resume Studio project", files: [file] });
    repository.markBackedUp(head);
    await updateBackupReminder();
    status.textContent = "Project shared.";
  } catch (error) {
    status.textContent = error.name === "AbortError" ? "Share canceled." : error.message;
  } finally {
    button.disabled = false;
  }
}

async function downloadProject(event) {
  const button = event.currentTarget;
  const status = $("#archive-transfer-status");
  await buttonOperation(button, async () => {
    status.textContent = "Preparing your complete project and saved versions…";
    const { blob, head } = await createProjectArchive();
    downloadBlob(blob, backupFilename());
    repository.markBackedUp(head);
    await updateBackupReminder();
    status.textContent = "Project file download started.";
  });
}

async function createProjectArchive() {
  await flushEditor();
  await repository.commit(`resume: save ${currentOverlay}`);
  const blob = await repository.exportArchiveBlob();
  return { blob, head: await repository.currentHead() };
}

async function updateBackupReminder() {
  const status = await repository.backupStatus();
  const reminder = $("#backup-reminder");
  const stale = !status.lastHead || status.commitsSince >= 5 || status.daysSince >= 14;
  reminder.hidden = !stale;
  if (!stale) return;
  if (!status.lastHead) {
    $("#backup-message").textContent = "This project has never been backed up outside this browser.";
  } else if (status.daysSince >= 14 && status.commitsSince === 0) {
    $("#backup-message").textContent = `The last backup was ${Math.floor(status.daysSince)} days ago.`;
  } else {
    $("#backup-message").textContent = `${status.commitsSince} version${status.commitsSince === 1 ? "" : "s"} since the last backup.`;
  }
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
  target.innerHTML = '<p class="muted">Loading saved versions…</p>';
  dialog.showModal();
  const history = await repository.history();
  target.replaceChildren(...history.map((entry, index) => {
    const row = document.createElement("div");
    row.className = "history-item";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = historyTitle(entry.message);
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = new Date(entry.author.timestamp * 1000).toLocaleString();
    content.append(title, meta);
    for (const tag of entry.tags) {
      const badge = document.createElement("span");
      badge.className = "tag";
      badge.textContent = tag.startsWith("resume/") ? `Release ${tag.slice("resume/".length)}` : tag;
      content.append(badge);
    }
    row.append(content);
    if (index > 0) {
      const restore = document.createElement("button");
      restore.className = "secondary compact";
      restore.textContent = "Restore";
      restore.addEventListener("click", async () => {
        if (!confirm("Restore this version? Newer saved versions will remain available.")) return;
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
    const overlay = currentOverlay;
    const diagnostics = await refreshChecks(overlay);
    if (diagnostics.some((item) => item.severity === "error")) throw new Error("Fix the project errors before creating a release.");
    await repository.commit(`resume: save before release (${overlay})`);
    const sourceCommit = await repository.currentHead();
    const releaseId = nextId(await repository.releaseIds(), "r");
    const description = $("#release-description").value.trim();
    status.textContent = "Creating PDF…";
    const pdf = await buildPdf(overlay);
    const pdfSha256 = await sha256Hex(pdf);
    const createdAt = new Date().toISOString();
    status.textContent = "Saving the fixed version…";
    const yaml = await engine.createRelease({
      overlay,
      releaseId,
      description,
      createdAt,
      sourceCommit,
      rendererVersion: BROWSER_RENDERER_VERSION,
      pdfSha256,
    });
    await repository.writeText(`releases/${releaseId}.yaml`, yaml);
    await repository.commit(`resume: release ${releaseId} (${overlay})`);
    await repository.createAnnotatedTag(`resume/${releaseId}`, [
      `Resume release ${releaseId}`,
      `Overlay: ${overlay}`,
      `Description: ${description}`,
      `Source commit: ${sourceCommit}`,
      `Renderer: ${BROWSER_RENDERER_VERSION}`,
      `PDF SHA-256: ${pdfSha256}`,
    ].join("\n"));
    downloadBlob(pdf, `${releaseId}.pdf`);
    status.textContent = `Release ${releaseId} created. PDF download started.`;
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
  updateTransferAvailability();
  $("#transfer-dialog").showModal();
}

async function sendNearby() {
  $("#transfer-home").hidden = true;
  $("#transfer-send").hidden = false;
  try {
    const { blob } = await createProjectArchive();
    transfer = wireTransfer(new NearbyTransfer());
    await transfer.startSender(blob);
  } catch (error) {
    transfer?.close();
    transfer = null;
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
  const button = event.submitter;
  button.disabled = true;
  try {
    if (await repository.exists()) {
      await flushEditor();
      await repository.commit(`resume: save before nearby receive (${currentOverlay})`);
    }
    transfer = wireTransfer(new NearbyTransfer());
    await transfer.startReceiver($("#receive-code").value);
  } catch (error) {
    transfer?.close();
    transfer = null;
    $("#receive-transfer-status").textContent = error.message;
    button.disabled = false;
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
    .on("signalClosed", () => {
      const message = "This transfer code expired. Go back and create a new one.";
      $("#send-transfer-status").textContent = message;
      $("#receive-transfer-status").textContent = message;
    })
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
  $("#archive-transfer-status").textContent = "";
  $("#receive-code").value = "";
  $("#receive-form button[type=submit]").disabled = false;
  updateTransferAvailability();
}

function updateTransferAvailability() {
  const configured = Boolean(window.RESUME_STUDIO_CONFIG?.signalingUrl);
  const gateReceive = $("#receive-project");
  gateReceive.hidden = !configured;
  $("#direct-transfer-method").hidden = !configured;
  [$("#send-nearby"), $("#receive-nearby"), gateReceive].forEach((button) => {
    button.disabled = !configured;
    button.title = configured ? "" : "Direct transfer is currently unavailable.";
  });
  $("#direct-transfer-note").textContent = configured
    ? "Ready for direct transfer."
    : "Direct transfer is currently unavailable.";

  const shareAvailable = typeof File !== "undefined"
    && canShareFile(new File([""], "project.resume-studio", { type: "application/zip" }));
  $("#share-project").hidden = !shareAvailable;
  $("#share-method-copy").textContent = shareAvailable
    ? "Your device may offer AirDrop, Mail, Messages, or another installed app."
    : "Sharing is unavailable here. Download the project file and send it with another app.";
}

function canShareFile(file) {
  try {
    return Boolean(navigator.share && navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
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

function historyTitle(message) {
  const release = message.match(/resume: release (r\d+)/);
  if (release) return `Created release ${release[1]}`;
  if (message.startsWith("resume: record submission")) return "Recorded a submission";
  if (message.startsWith("resume: restore")) return "Restored an earlier version";
  if (message.startsWith("Import")) return "Imported project";
  if (message.startsWith("Initialize")) return "Created project";
  return "Saved changes";
}

function safeName(value) {
  return value.replaceAll("/", "-").replace(/[^A-Za-z0-9._-]/g, "-");
}

function targetOverlayId(company, role) {
  return [company, role]
    .map((value) => value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, ""))
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("-");
}

function humanizeId(value) {
  return value
    .split("/")
    .at(-1)
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
