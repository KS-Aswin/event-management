// Socket peer address for lib/client-ip.ts (QA-005). Node runtime only;
// installed once from instrumentation.ts.
//
// Route handlers only see headers, and Next keeps a client-sent
// X-Forwarded-For as is (it adds the socket address only when the header is
// missing), so on a self-hosted server without a trusted proxy there is no
// header the client can't forge. This copies req.socket.remoteAddress into a
// header whose name is random per process (published on globalThis for
// client-ip.ts), overwriting anything the client sent, before Next sees the
// request.

import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";

// Same value as PEER_HEADER_KEY in lib/client-ip.ts (a literal, so this file
// has only node: imports and the tests can load it directly).
const PEER_HEADER_KEY = "__velaPeerIpHeader";

const INSTALLED = Symbol.for("vela.peerIp.installed");

type Emit = (this: unknown, event: string | symbol, ...args: unknown[]) => boolean;

function patch(proto: { emit: Emit }, header: string) {
  const original = proto.emit;
  proto.emit = function (this: unknown, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      const req = args[0] as http.IncomingMessage | undefined;
      if (req?.headers) {
        const addr = req.socket?.remoteAddress;
        if (addr) req.headers[header] = addr;
        else delete req.headers[header];
      }
    }
    return original.call(this, event, ...args);
  };
}

export function installPeerIp(): void {
  const g = globalThis as Record<string | symbol, unknown>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  const header = `x-vela-peer-${randomBytes(8).toString("hex")}`;
  patch(http.Server.prototype as unknown as { emit: Emit }, header);
  if (https.Server.prototype.emit !== http.Server.prototype.emit) {
    patch(https.Server.prototype as unknown as { emit: Emit }, header);
  }
  g[PEER_HEADER_KEY] = header;
}
