import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, sha256Hex } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    // No deberia pasar en produccion (el middleware ya dejaria pasar todo
    // sin login si esto no esta seteado), pero por las dudas.
    return NextResponse.json({ ok: false, error: "DASHBOARD_PASSWORD no configurada" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  if (typeof body?.password !== "string" || body.password !== expected) {
    return NextResponse.json({ ok: false, error: "Contraseña incorrecta" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sha256Hex(expected), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });
  return res;
}
