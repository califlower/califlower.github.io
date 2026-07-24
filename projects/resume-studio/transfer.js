const CHUNK_SIZE = 16 * 1024;
const HIGH_WATER = 4 * 1024 * 1024;
const LOW_WATER = 512 * 1024;
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024;
const WORDS = [
  "amber", "apple", "atlas", "birch", "blue", "cedar", "comet", "coral",
  "dawn", "ember", "fern", "fox", "glass", "gold", "harbor", "indigo",
  "juniper", "kite", "lake", "linen", "maple", "mint", "moon", "north",
  "olive", "orchid", "pearl", "pine", "river", "silver", "tiger", "violet",
];

export class NearbyTransfer {
  constructor(config = window.RESUME_STUDIO_CONFIG || {}) {
    this.config = config;
    this.peer = null;
    this.socket = null;
    this.channel = null;
    this.role = null;
    this.callbacks = {};
    this.incoming = null;
    this.expectedPhrase = "";
    this.phraseVerified = false;
    this.transferStarted = false;
  }

  on(name, callback) {
    this.callbacks[name] = callback;
    return this;
  }

  emit(name, payload) {
    this.callbacks[name]?.(payload);
  }

  async startSender(blob) {
    if (blob.size > MAX_TRANSFER_BYTES) throw new Error("This project is too large for nearby transfer.");
    this.role = "sender";
    this.outgoingBlob = blob;
    const base = requireSignalUrl(this.config.signalingUrl);
    const response = await fetch(`${base}/rooms`, { method: "POST" });
    if (!response.ok) throw new Error(`Could not create transfer room (${response.status}).`);
    const room = await response.json();
    this.emit("code", room.code);
    await this.connectSocket(room.code, "sender", room.senderToken);
    await this.createSenderPeer();
  }

  async startReceiver(code) {
    this.role = "receiver";
    await this.connectSocket(normalizeCode(code), "receiver");
    this.emit("status", "Waiting for the sending device…");
  }

  async connectSocket(code, role, token = "") {
    const base = requireSignalUrl(this.config.signalingUrl);
    const url = new URL(`${base}/rooms/${code}/socket`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("role", role);
    if (token) url.searchParams.set("token", token);
    this.socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Signaling connection timed out.")), 10_000);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not reach the signaling service.")); }, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      try {
        void this.handleSignal(JSON.parse(event.data)).catch((error) => this.fail(error));
      } catch {
        this.fail(new Error("The signaling service sent an invalid message."));
      }
    });
    this.socket.addEventListener("close", () => this.emit("signalClosed"));
  }

  async createPeer() {
    const peer = new RTCPeerConnection({ iceServers: await buildIceServers(this.config) });
    peer.addEventListener("connectionstatechange", () => {
      this.emit("status", describeConnectionState(peer.connectionState));
      if (["failed", "disconnected"].includes(peer.connectionState)) {
        this.fail(new Error("Direct connection failed. Try AirDrop, share, or download instead."));
      }
    });
    this.peer = peer;
    return peer;
  }

  async createSenderPeer() {
    const peer = await this.createPeer();
    const channel = peer.createDataChannel("resume-studio", { ordered: true });
    this.bindChannel(channel);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitForIceGathering(peer);
    this.sendSignal({ type: "offer", description: peer.localDescription });
    this.emit("status", "Waiting for the other device to enter the code…");
  }

  async handleSignal(message) {
    if (message.type === "offer" && this.role === "receiver") {
      const peer = await this.createPeer();
      peer.addEventListener("datachannel", (event) => this.bindChannel(event.channel), { once: true });
      await peer.setRemoteDescription(message.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);
      this.sendSignal({ type: "answer", description: peer.localDescription });
      this.emit("status", "Opening a direct connection…");
      return;
    }
    if (message.type === "answer" && this.role === "sender" && this.peer) {
      await this.peer.setRemoteDescription(message.description);
      this.emit("status", "Opening a direct connection…");
      return;
    }
    if (message.type === "error") this.fail(new Error(message.message));
  }

  bindChannel(channel) {
    this.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = LOW_WATER;
    channel.addEventListener("open", () => {
      void this.channelOpened().catch((error) => this.fail(error));
    });
    channel.addEventListener("message", (event) => {
      void this.handleChannelMessage(event.data).catch((error) => this.fail(error));
    });
    channel.addEventListener("close", () => this.emit("status", "Transfer connection closed."));
    channel.addEventListener("error", () => this.fail(new Error("The direct transfer connection failed.")));
  }

  async channelOpened() {
    this.expectedPhrase = await verificationPhrase(this.peer);
    this.emit("phrase", this.expectedPhrase);
    this.emit("status", this.role === "sender"
      ? "Connected. Confirm the phrase on both devices."
      : "Connected. Confirm the phrase, then accept the project.");
    this.channel.send(JSON.stringify({ type: "hello", phrase: this.expectedPhrase }));
  }

  accept() {
    if (!this.channel || this.channel.readyState !== "open") throw new Error("The devices are not connected yet.");
    if (!this.phraseVerified) throw new Error("The other device has not verified the matching phrase yet.");
    this.channel.send(JSON.stringify({ type: "accept" }));
    this.emit("status", "Receiving project…");
  }

  async handleChannelMessage(data) {
    if (typeof data === "string") {
      const message = JSON.parse(data);
      if (message.type === "hello") {
        if (!this.expectedPhrase || message.phrase !== this.expectedPhrase) {
          throw new Error("Device verification failed. Cancel this transfer.");
        }
        this.phraseVerified = true;
        this.emit("verified");
      } else if (message.type === "accept" && this.role === "sender") {
        if (!this.phraseVerified) throw new Error("The receiving device could not be verified.");
        if (this.transferStarted) return;
        this.transferStarted = true;
        await this.sendBlob(this.outgoingBlob);
      } else if (message.type === "manifest" && this.role === "receiver") {
        validateTransferManifest(message);
        this.incoming = { manifest: message, chunks: [], received: 0 };
        this.emit("progress", { received: 0, total: message.size });
      } else if (message.type === "complete" && this.role === "receiver") {
        await this.finishIncoming();
      } else if (message.type === "ack" && this.role === "sender") {
        this.emit("complete", { sent: true });
        this.emit("status", "Project transferred successfully.");
      }
      return;
    }

    if (this.role !== "receiver" || !this.incoming) return;
    const chunk = new Uint8Array(data);
    if (chunk.byteLength > this.incoming.manifest.chunkSize) throw new Error("Received an oversized transfer chunk.");
    this.incoming.received += chunk.byteLength;
    if (this.incoming.received > this.incoming.manifest.size) throw new Error("Received more project data than expected.");
    this.incoming.chunks.push(chunk);
    this.emit("progress", { received: this.incoming.received, total: this.incoming.manifest.size });
  }

  async sendBlob(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sha256 = await digestHex(bytes);
    this.channel.send(JSON.stringify({
      type: "manifest",
      format: "resume-studio-project",
      version: 1,
      size: bytes.byteLength,
      sha256,
      chunkSize: CHUNK_SIZE,
    }));
    for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
      await waitForBuffer(this.channel);
      this.channel.send(bytes.slice(offset, offset + CHUNK_SIZE));
      this.emit("progress", { sent: Math.min(offset + CHUNK_SIZE, bytes.byteLength), total: bytes.byteLength });
    }
    this.channel.send(JSON.stringify({ type: "complete" }));
    this.emit("status", "Sent. Waiting for the other device to import it…");
  }

  async finishIncoming() {
    if (!this.incoming || this.incoming.received !== this.incoming.manifest.size) {
      throw new Error("The transfer ended before the complete project arrived.");
    }
    const blob = new Blob(this.incoming.chunks, { type: "application/zip" });
    const actualHash = await digestHex(new Uint8Array(await blob.arrayBuffer()));
    if (actualHash !== this.incoming.manifest.sha256) throw new Error("The received project failed its integrity check.");
    await this.emitAsync("receive", blob);
    this.channel.send(JSON.stringify({ type: "ack" }));
    this.emit("complete", { received: true });
    this.emit("status", "Project imported successfully.");
  }

  async emitAsync(name, payload) {
    const callback = this.callbacks[name];
    if (callback) await callback(payload);
  }

  sendSignal(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error("Signaling is not connected.");
    this.socket.send(JSON.stringify(message));
  }

  fail(error) {
    this.emit("error", error instanceof Error ? error : new Error(String(error)));
  }

  close() {
    this.channel?.close();
    this.peer?.close();
    this.socket?.close();
  }
}

export async function buildIceServers(config = {}) {
  const servers = [{
    urls: [
      "stun:stun.cloudflare.com:3478",
      "stun:stun.cloudflare.com:53",
    ],
  }];
  if (config.turnCredentialsUrl) {
    const response = await fetch(config.turnCredentialsUrl, { credentials: "omit" });
    if (!response.ok) throw new Error("Could not obtain TURN credentials.");
    const payload = await response.json();
    const additional = Array.isArray(payload) ? payload : payload.iceServers;
    if (Array.isArray(additional)) servers.push(...additional);
  }
  return servers;
}

function validateTransferManifest(message) {
  if (message.format !== "resume-studio-project" || message.version !== 1) {
    throw new Error("The other device sent an unsupported project format.");
  }
  if (!Number.isSafeInteger(message.size) || message.size <= 0 || message.size > MAX_TRANSFER_BYTES) {
    throw new Error("The incoming project size is invalid.");
  }
  if (!Number.isSafeInteger(message.chunkSize) || message.chunkSize <= 0 || message.chunkSize > 64 * 1024) {
    throw new Error("The incoming transfer chunk size is invalid.");
  }
  if (!/^[0-9a-f]{64}$/.test(message.sha256)) throw new Error("The incoming project has an invalid integrity hash.");
}

function requireSignalUrl(value) {
  if (!value) throw new Error("Nearby transfer is not configured yet. Set signalingUrl in config.js.");
  return value.replace(/\/$/, "");
}

function normalizeCode(value) {
  const code = String(value).replace(/\D/g, "");
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the six-digit transfer code.");
  return code;
}

async function waitForIceGathering(peer) {
  if (peer.iceGatheringState === "complete") return;
  await new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", listener);
      resolve();
    };
    const timeout = setTimeout(finish, 8_000);
    const listener = () => { if (peer.iceGatheringState === "complete") finish(); };
    peer.addEventListener("icegatheringstatechange", listener);
  });
}

async function verificationPhrase(peer) {
  const local = fingerprint(peer.localDescription?.sdp || "");
  const remote = fingerprint(peer.remoteDescription?.sdp || "");
  const joined = [local, remote].sort().join("|");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(joined)));
  return `${WORDS[digest[0] % WORDS.length]} ${WORDS[digest[1] % WORDS.length]} ${WORDS[digest[2] % WORDS.length]}`;
}

function fingerprint(sdp) {
  return sdp.match(/a=fingerprint:\S+\s+([^\r\n]+)/i)?.[1]?.trim() || "missing";
}

async function digestHex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function waitForBuffer(channel) {
  if (channel.readyState !== "open") throw new Error("Transfer connection closed.");
  if (channel.bufferedAmount <= HIGH_WATER) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      channel.removeEventListener("bufferedamountlow", low);
      channel.removeEventListener("close", closed);
      channel.removeEventListener("error", closed);
    };
    const low = () => { cleanup(); resolve(); };
    const closed = () => { cleanup(); reject(new Error("Transfer connection closed.")); };
    channel.addEventListener("bufferedamountlow", low, { once: true });
    channel.addEventListener("close", closed, { once: true });
    channel.addEventListener("error", closed, { once: true });
  });
}

function describeConnectionState(state) {
  return {
    new: "Preparing direct connection…",
    connecting: "Connecting devices…",
    connected: "Direct connection established.",
    disconnected: "Connection interrupted.",
    failed: "Could not establish a direct connection.",
    closed: "Connection closed.",
  }[state] || state;
}
