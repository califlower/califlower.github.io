const ROOM_TTL_SECONDS = 5 * 60;
const MAX_SIGNAL_BYTES = 256 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = isAllowedOrigin(request, env);
    const cors = allowed ? corsHeaders(request) : {};

    if (request.method === "OPTIONS") {
      return allowed ? new Response(null, { headers: cors }) : new Response("Origin not allowed", { status: 403 });
    }

    if ((url.pathname === "/rooms" || url.pathname.startsWith("/rooms/")) && !allowed) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (request.method === "POST" && url.pathname === "/rooms") {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
        const id = env.TRANSFER_ROOMS.idFromName(code);
        const stub = env.TRANSFER_ROOMS.get(id);
        const senderToken = crypto.randomUUID() + crypto.randomUUID();
        const response = await stub.fetch("https://room.internal/create", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, senderToken, ttl: ROOM_TTL_SECONDS }),
        });
        if (response.status === 201) {
          return Response.json({ code, senderToken, expiresAt: Date.now() + ROOM_TTL_SECONDS * 1000 }, { headers: cors });
        }
      }
      return Response.json({ error: "Could not create a transfer code." }, { status: 503, headers: cors });
    }

    const match = url.pathname.match(/^\/rooms\/(\d{6})\/socket$/);
    if (match) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426, headers: cors });
      }
      const id = env.TRANSFER_ROOMS.idFromName(match[1]);
      return env.TRANSFER_ROOMS.get(id).fetch(request);
    }

    return Response.json({ service: "resume-studio-signaling", status: "ok" }, { headers: cors });
  },
};

export class TransferRoom {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/create") {
      const current = await this.ctx.storage.get("room");
      if (current && current.expiresAt > Date.now()) return new Response("active", { status: 409 });
      const body = await request.json();
      const room = {
        code: body.code,
        senderToken: body.senderToken,
        expiresAt: Date.now() + body.ttl * 1000,
        offer: null,
        answer: null,
        senderCandidates: [],
        receiverCandidates: [],
      };
      await this.ctx.storage.put("room", room);
      await this.ctx.storage.setAlarm(room.expiresAt);
      return new Response("created", { status: 201 });
    }

    const room = await this.ctx.storage.get("room");
    if (!room || room.expiresAt <= Date.now()) return new Response("Room expired", { status: 404 });

    const role = url.searchParams.get("role");
    if (!["sender", "receiver"].includes(role)) return new Response("Invalid role", { status: 400 });
    if (role === "sender" && url.searchParams.get("token") !== room.senderToken) {
      return new Response("Invalid sender token", { status: 403 });
    }
    if (this.ctx.getWebSockets(role).length > 0) return new Response("Role already connected", { status: 409 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [role]);

    const cachedDescription = role === "receiver" ? room.offer : room.answer;
    if (cachedDescription) server.send(JSON.stringify(cachedDescription));
    const cachedCandidates = role === "receiver" ? room.senderCandidates : room.receiverCandidates;
    for (const candidate of cachedCandidates || []) server.send(JSON.stringify(candidate));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, message) {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    if (text.length > MAX_SIGNAL_BYTES) {
      socket.close(1009, "Signaling message too large");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      socket.send(JSON.stringify({ type: "error", message: "Could not connect the devices." }));
      return;
    }
    if (!parsed || typeof parsed !== "object") {
      socket.send(JSON.stringify({ type: "error", message: "Could not connect the devices." }));
      return;
    }
    const [role] = this.ctx.getTags(socket);
    if (parsed.type === "candidate") {
      if (parsed.role !== role || !validCandidate(parsed.candidate)) {
        socket.send(JSON.stringify({ type: "error", message: "Could not connect the devices." }));
        return;
      }
      const room = await this.ctx.storage.get("room");
      if (!room || room.expiresAt <= Date.now()) {
        socket.close(1008, "Transfer room expired");
        return;
      }
      const key = role === "sender" ? "senderCandidates" : "receiverCandidates";
      const candidates = room[key] || [];
      if (candidates.length >= 128) {
        socket.send(JSON.stringify({ type: "error", message: "Could not continue this transfer." }));
        return;
      }
      candidates.push(parsed);
      room[key] = candidates;
      await this.ctx.storage.put("room", room);
      const targetRole = role === "sender" ? "receiver" : "sender";
      for (const target of this.ctx.getWebSockets(targetRole)) target.send(JSON.stringify(parsed));
      return;
    }
    if (!["offer", "answer"].includes(parsed.type)) return;

    const expectedRole = parsed.type === "offer" ? "sender" : "receiver";
    if (role !== expectedRole || !validDescription(parsed.description, parsed.type)) {
      socket.send(JSON.stringify({ type: "error", message: "Could not connect the devices." }));
      return;
    }

    const room = await this.ctx.storage.get("room");
    if (!room || room.expiresAt <= Date.now()) {
      socket.close(1008, "Transfer room expired");
      return;
    }
    room[parsed.type] = parsed;
    await this.ctx.storage.put("room", room);
    const targetRole = parsed.type === "offer" ? "receiver" : "sender";
    for (const target of this.ctx.getWebSockets(targetRole)) target.send(JSON.stringify(parsed));
  }

  async webSocketClose() {}
  async webSocketError() {}

  async alarm() {
    for (const socket of this.ctx.getWebSockets()) socket.close(1000, "Transfer room expired");
    await this.ctx.storage.deleteAll();
  }
}

function validDescription(description, expectedType) {
  return description
    && description.type === expectedType
    && typeof description.sdp === "string"
    && description.sdp.length > 0
    && description.sdp.length <= MAX_SIGNAL_BYTES;
}

function validCandidate(candidate) {
  return candidate
    && typeof candidate.candidate === "string"
    && candidate.candidate.length > 0
    && candidate.candidate.length <= 4_096
    && (candidate.sdpMid === null || candidate.sdpMid === undefined || typeof candidate.sdpMid === "string")
    && (candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === undefined || Number.isSafeInteger(candidate.sdpMLineIndex));
}

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173,http://localhost:8788,http://127.0.0.1:8788")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  return Boolean(origin) && (allowed.includes("*") || allowed.includes(origin));
}

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.get("Origin"),
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}
