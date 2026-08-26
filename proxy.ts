// Gatekeeper de todo el dashboard: sin esto, cualquiera que encuentre la
// URL de Vercel puede ver los mensajes/drafts de las 3 cuentas de Gmail +
// Telegram, o pegarle a los endpoints directo. Password unica compartida
// (DASHBOARD_PASSWORD), no es multi-usuario — alcanza para este proyecto
// personal.
//
// El webhook de WhatsApp queda afuera a proposito: Meta le pega sin
// credenciales de sesion (tiene su propia verificacion via hub.verify_token).
//
// /api/sync y /api/draft tambien quedan afuera del chequeo de cookie
// cuando el request trae `Authorization: Bearer <CRON_SECRET>` — asi los
// dispara el cron de Vercel automaticamente (ver vercel.json), que
// obviamente no tiene la cookie de sesion del login.
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sha256Hex } from "@/lib/auth";

const CRON_PATHS = new Set(["/api/sync", "/api/draft"]);

export async function proxy(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  // Sin password configurada no se bloquea nada — asi `npm run dev` local
  // sigue andando sin friccion mientras no se cargue esta env var.
  if (!password) return NextResponse.next();

  if (req.nextUrl.pathname === "/login" || req.nextUrl.pathname === "/api/login") {
    return NextResponse.next();
  }

  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret &&
    CRON_PATHS.has(req.nextUrl.pathname) &&
    req.headers.get("authorization") === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next();
  }

  const expected = await sha256Hex(password);
  const session = req.cookies.get(SESSION_COOKIE)?.value;
  if (session === expected) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks).*)"],
};
