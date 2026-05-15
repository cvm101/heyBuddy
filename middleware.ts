import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { CookieOptions } from "@supabase/ssr";

const PUBLIC_PATHS = new Set<string>(["/login", "/signup"]);

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated users to /login when they hit a protected page.
 *
 * Logged-in users who land on /login or /signup are bounced to /.
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    // Misconfigured env -- fail open so the dev still sees the page error
    // (the supabase client will throw a clear message).
    // eslint-disable-next-line no-console
    console.error("[middleware] missing supabase env");
    return res;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        res.cookies.set({ name, value: "", ...options, maxAge: 0 });
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const isAuthed = !!data.user;
  const path = req.nextUrl.pathname;

  const isPublic = PUBLIC_PATHS.has(path);

  if (!isAuthed && !isPublic) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthed && isPublic) {
    const home = req.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return res;
}

export const config = {
  // Run on everything except Next internals, static assets, and the log API.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/log).*)"],
};
