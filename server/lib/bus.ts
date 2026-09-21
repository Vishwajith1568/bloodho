import type { Response } from 'express';

type Client = { id: number; res: Response; role: string; accountId: number | null };
const clients: Client[] = [];
let seq = 1;

export function addClient(res: Response, role: string, accountId: number | null) {
  const client: Client = { id: seq++, res, role, accountId };
  clients.push(client);
  res.write(`event: hello\ndata: ${JSON.stringify({ clientId: client.id })}\n\n`);
  return () => {
    const i = clients.findIndex((c) => c.id === client.id);
    if (i >= 0) clients.splice(i, 1);
  };
}

/** Broadcast to every open stream. Portals filter client-side by topic. */
export function emit(topic: string, payload: unknown) {
  const frame = `event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try { c.res.write(frame); } catch { /* client vanished; sweep on next write */ }
  }
}

export function clientCount() {
  return clients.length;
}

setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': keep-alive\n\n'); } catch { /* ignore */ }
  }
}, 25_000).unref();
