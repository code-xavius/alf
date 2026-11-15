import { ActivityRoom } from "./activity-room";

export { ActivityRoom };

interface Env {
  ACTIVITY_ROOM: DurableObjectNamespace<ActivityRoom>;
  ALF_INTERNAL_TOKEN: string;
  ALLOWED_ORIGINS?: string;
}

const CODE_PATTERN = /^[A-Z0-9]{1,12}$/;
const TOKEN_HEADER = "x-alf-internal-token";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname.startsWith("/ws/")) {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket", { status: 426 });
      }

      const code = url.pathname.slice(4).toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        return new Response("Invalid activity code", { status: 400 });
      }
      if (!originAllowed(request, env)) {
        return new Response("Forbidden", { status: 403 });
      }

      const stub = env.ACTIVITY_ROOM.getByName(code);
      return stub.fetch(new Request(`https://do/ws/${code}`, request));
    }

    const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{1,12})\/broadcast$/);
    if (match && request.method === "POST") {
      const expected = env.ALF_INTERNAL_TOKEN;
      const received = request.headers.get(TOKEN_HEADER) ?? "";
      if (!expected || !timingSafeEqual(received, expected)) {
        return new Response("Forbidden", { status: 403 });
      }

      const code = match[1];
      const stub = env.ACTIVITY_ROOM.getByName(code);
      return stub.fetch(
        new Request(`https://do/broadcast?code=${encodeURIComponent(code)}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: await request.text(),
        }),
      );
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function originAllowed(request: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowed.length === 0) return true;

  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return allowed.includes(origin);
}

function timingSafeEqual(received: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(received);
  const right = encoder.encode(expected);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}
