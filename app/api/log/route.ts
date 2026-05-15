import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export const runtime = "nodejs";

interface LogPayload {
  level?: "debug" | "info" | "warn" | "error";
  source?: string;
  message?: string;
  context?: unknown;
}

export async function POST(req: Request) {
  let body: LogPayload;
  try {
    body = (await req.json()) as LogPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const level = body.level ?? "error";
  const source = (body.source ?? "client").slice(0, 64);
  const message = (body.message ?? "").slice(0, 2000);
  const context = body.context ?? null;

  if (!["debug", "info", "warn", "error"].includes(level)) {
    return NextResponse.json({ ok: false, error: "bad_level" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ ok: false, error: "empty_message" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // eslint-disable-next-line no-console
    console.error("[api/log] missing supabase env, dropping log:", { level, source, message });
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 500 });
  }

  const cookieStore = cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(_name: string, _value: string, _options: CookieOptions) {
        // no-op: we don't need to mutate cookies from this route
      },
      remove(_name: string, _options: CookieOptions) {
        // no-op
      },
    },
  });

  const { data: userResult } = await supabase.auth.getUser();
  const userId = userResult?.user?.id ?? null;

  const { error } = await supabase.from("app_logs").insert({
    level,
    source,
    message,
    context,
    user_id: userId,
  });

  if (error) {
    // eslint-disable-next-line no-console
    console.error("[api/log] insert failed:", error.message, { level, source, message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
