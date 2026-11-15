import { DurableObject } from "cloudflare:workers";

interface Env {
  ALF_API_BASE: string;
  ALF_INTERNAL_TOKEN: string;
}

interface WordRow extends Record<string, SqlStorageValue> {
  id: string;
  text: string;
  participant_id: string | null;
  created_at: string;
}

interface CountRow extends Record<string, SqlStorageValue> {
  text: string;
  count: number;
}

interface TotalRow extends Record<string, SqlStorageValue> {
  n: number;
}

type RealtimeMessage = Record<string, unknown> & { type: string };

const MAX_WORD_LENGTH = 80;
const MAX_BATCH_SIZE = 500;

export class ActivityRoom extends DurableObject<Env> {
  private readonly sql: DurableObjectState["storage"]["sql"];
  private code: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;

    ctx.blockConcurrencyWhile(async () => {
      this.code = (await ctx.storage.get<string>("code")) ?? null;
      this.sql.exec(
        `CREATE TABLE IF NOT EXISTS words (
          id TEXT PRIMARY KEY,
          text TEXT NOT NULL,
          participant_id TEXT,
          created_at TEXT NOT NULL,
          synced INTEGER NOT NULL DEFAULT 0
        )`,
      );
      this.sql.exec(
        "CREATE INDEX IF NOT EXISTS words_synced_idx ON words (synced, created_at)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/ws/")) {
      const code = decodeURIComponent(url.pathname.slice(4)).toUpperCase();
      if (!/^[A-Z0-9]{1,12}$/.test(code)) {
        return new Response("Invalid activity code", { status: 400 });
      }
      await this.setCode(code);
      return this.handleWebSocket();
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const code = url.searchParams.get("code");
      if (code) {
        await this.setCode(code.toUpperCase());
      }
      return this.handleBroadcast(request);
    }

    if (url.pathname === "/snapshot" && request.method === "GET") {
      return new Response(JSON.stringify(this.snapshot()), {
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let payload: unknown;
    try {
      payload = JSON.parse(message);
    } catch {
      return;
    }
    if (!isRecord(payload)) return;

    if (payload.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (payload.type === "word") {
      await this.addWord(payload);
    }
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    this.broadcastPresence();
  }

  async alarm(): Promise<void> {
    try {
      await this.flushWords();
    } catch (error) {
      console.error("word batch flush failed", error);
      await this.ctx.storage.setAlarm(Date.now() + 2000);
      return;
    }

    this.broadcastSnapshot();
    if (this.pendingCount() > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  private async setCode(code: string): Promise<void> {
    if (this.code === code) return;
    this.code = code;
    await this.ctx.storage.put("code", code);
  }

  private handleWebSocket(): Response {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify(this.snapshot()));
    this.broadcastPresence();

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit);
  }

  private async addWord(payload: Record<string, unknown>): Promise<void> {
    const text = cleanText(payload.text);
    if (!text) return;

    const participantId = cleanId(payload.participant_id);
    const id = cleanId(payload.id) ?? crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.sql.exec(
      "INSERT OR IGNORE INTO words (id, text, participant_id, created_at, synced) VALUES (?, ?, ?, ?, 0)",
      id,
      text,
      participantId,
      createdAt,
    );
    await this.scheduleFlush();
  }

  private async scheduleFlush(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!isRecord(payload) || typeof payload.type !== "string") {
      return new Response("Invalid message", { status: 400 });
    }

    if (payload.type === "word_added") {
      const text = cleanText(payload.text);
      if (text) {
        this.sql.exec(
          "INSERT OR IGNORE INTO words (id, text, participant_id, created_at, synced) VALUES (?, ?, ?, ?, 1)",
          cleanId(payload.id) ?? crypto.randomUUID(),
          text,
          cleanId(payload.participant_id),
          typeof payload.created_at === "string"
            ? payload.created_at
            : new Date().toISOString(),
        );
        this.broadcastSnapshot();
      }
      return new Response(null, { status: 204 });
    }

    if (payload.type === "activity_deleted") {
      this.broadcast(payload as RealtimeMessage);
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, "activity deleted");
        } catch {
          /* already closed */
        }
      }
      this.sql.exec("DELETE FROM words");
      await this.ctx.storage.deleteAlarm();
      return new Response(null, { status: 204 });
    }

    this.broadcast(payload as RealtimeMessage);
    return new Response(null, { status: 204 });
  }

  private async flushWords(): Promise<void> {
    if (!this.code) return;

    const rows = this.sql
      .exec<WordRow>(
        "SELECT id, text, participant_id, created_at FROM words WHERE synced = 0 ORDER BY created_at LIMIT ?",
        MAX_BATCH_SIZE,
      )
      .toArray();
    if (rows.length === 0) return;

    const base = this.env.ALF_API_BASE.replace(/\/$/, "");
    const response = await fetch(
      `${base}/api/internal/activities/${encodeURIComponent(this.code)}/words/batch`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-alf-internal-token": this.env.ALF_INTERNAL_TOKEN,
        },
        body: JSON.stringify({
          words: rows.map((row) => ({
            id: row.id,
            text: row.text,
            participant_id: row.participant_id,
            created_at: row.created_at,
          })),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 401 &&
        response.status !== 403
      ) {
        console.warn(`dropping undeliverable word batch: ${response.status} ${body}`);
        this.markSynced(rows);
        return;
      }
      throw new Error(`batch failed with ${response.status}: ${body}`);
    }

    this.markSynced(rows);
  }

  private markSynced(rows: WordRow[]): void {
    const placeholders = rows.map(() => "?").join(",");
    this.sql.exec(
      `UPDATE words SET synced = 1 WHERE id IN (${placeholders})`,
      ...rows.map((row) => row.id),
    );
  }

  private pendingCount(): number {
    const row = this.sql
      .exec<TotalRow>("SELECT COUNT(*) AS n FROM words WHERE synced = 0")
      .one();
    return Number(row.n);
  }

  private snapshot(): RealtimeMessage {
    const rows = this.sql
      .exec<CountRow>(
        "SELECT text, COUNT(*) AS count FROM words GROUP BY text ORDER BY count DESC, text LIMIT 200",
      )
      .toArray();
    const occurrences: Record<string, number> = {};
    for (const row of rows) {
      occurrences[row.text] = Number(row.count);
    }

    const total = this.sql.exec<TotalRow>("SELECT COUNT(*) AS n FROM words").one();
    return {
      type: "word_snapshot",
      occurrences,
      total: Number(total.n),
    };
  }

  private broadcastSnapshot(): void {
    this.broadcast(this.snapshot());
  }

  private broadcastPresence(): void {
    this.broadcast({
      type: "presence",
      count: this.ctx.getWebSockets().length,
    });
  }

  private broadcast(message: RealtimeMessage): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        try {
          ws.close(1011, "send failed");
        } catch {
          /* already closed */
        }
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_WORD_LENGTH) : "";
}

function cleanId(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 36) : null;
}
