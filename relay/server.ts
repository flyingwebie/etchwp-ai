/**
 * etchwp-ai WebSocket relay (Mode B broker).
 *
 * A stateless forwarder: each room pairs exactly one controller (the MCP server)
 * with one agent (the WordPress plugin's in-page agent). Every non-join frame
 * from one peer is forwarded verbatim to the other. The relay understands
 * nothing about Etch — it only routes by room + token.
 *
 * Run with Bun:  RELAY_PORT=8787 bun relay/server.ts
 * Put it behind a TLS-terminating proxy (Caddy/nginx) so clients use wss://.
 */
import type { ServerWebSocket } from "bun";

type Role = "controller" | "agent";

interface SocketData {
  role: Role | null;
  room: string | null;
}

interface Room {
  controller: ServerWebSocket<SocketData> | null;
  agent: ServerWebSocket<SocketData> | null;
  token: string | null;
}

const PORT = Number(process.env.RELAY_PORT ?? 8787);
const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  let r = rooms.get(id);
  if (!r) {
    r = { controller: null, agent: null, token: null };
    rooms.set(id, r);
  }
  return r;
}

function peer(room: Room, role: Role): ServerWebSocket<SocketData> | null {
  return role === "controller" ? room.agent : room.controller;
}

const server = Bun.serve<SocketData>({
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req, { data: { role: null, room: null } })) return;
    return new Response("etchwp-ai relay", { status: 200 });
  },
  websocket: {
    message(ws, message) {
      let frame: { t?: string; role?: Role; room?: string; token?: string };
      try {
        frame = JSON.parse(typeof message === "string" ? message : message.toString());
      } catch {
        return;
      }

      // First frame must be a join; it binds this socket to a room slot.
      if (frame.t === "join") {
        if (ws.data.role) return; // already joined
        const role: Role = frame.role === "controller" ? "controller" : "agent";
        const roomId = String(frame.room ?? "default");
        const room = getRoom(roomId);

        // First joiner fixes the room token; later joiners must match.
        if (room.token === null) {
          room.token = frame.token ?? "";
        } else if ((frame.token ?? "") !== room.token) {
          ws.close(4001, "bad token");
          return;
        }
        if (room[role]) {
          ws.close(4002, `${role} slot already occupied`);
          return;
        }
        room[role] = ws;
        ws.data.role = role;
        ws.data.room = roomId;
        return;
      }

      // Forward everything else to the paired peer.
      const { role, room: roomId } = ws.data;
      if (!role || !roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const target = peer(room, role);
      if (target && target.readyState === 1) {
        target.send(typeof message === "string" ? message : message.toString());
      }
    },
    close(ws) {
      const { role, room: roomId } = ws.data;
      if (!role || !roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (room[role] === ws) room[role] = null;
      if (!room.controller && !room.agent) rooms.delete(roomId);
    },
  },
});

console.error(`[etchwp-ai-relay] listening on :${server.port}`);
