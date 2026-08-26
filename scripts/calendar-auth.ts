// Genera el GOOGLE_CALENDAR_REFRESH_TOKEN una sola vez, corriendo esto
// local. Reusa el mismo Google Cloud OAuth client que Gmail
// (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) — no hace falta crear una app
// nueva, solo pedir el scope de Calendar y habilitar esa API en el
// proyecto de Google Cloud.
//
// Uso: npx tsx scripts/calendar-auth.ts
//
// Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local
// (`vercel env pull .env.local` los trae).

import { config } from "dotenv";
import { createServer } from "node:http";
import { google } from "googleapis";

config({ path: ".env.local" });

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events"];

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET en .env.local. Corré `vercel env pull .env.local` primero."
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }

  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<h1>Error: ${error}</h1>Podés cerrar esta pestaña.`);
    console.error(`\nGoogle devolvió un error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400);
    res.end("Falta el parametro 'code'.");
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>Listo</h1>El refresh token quedo impreso en tu terminal. Podés cerrar esta pestaña.");

    console.log("\n✅ Refresh token para Google Calendar:\n");
    console.log(tokens.refresh_token ?? "(no vino refresh_token — revisa que uses prompt=consent y access_type=offline)");
    console.log("\nGuardalo como GOOGLE_CALENDAR_REFRESH_TOKEN en Vercel y/o .env.local.\n");
  } catch (err) {
    console.error("Error canjeando el code por tokens:", err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(3000, () => {
  console.log("\nAbriendo el navegador para autorizar Google Calendar...");
  console.log(`Si no se abre solo, entrá manualmente a:\n\n${authUrl}\n`);
  openInBrowser(authUrl);
});

function openInBrowser(url: string) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ exec }) => exec(`${cmd} "${url}"`));
}
