// Genera un refresh token de Gmail para UNA cuenta, corriendo localmente.
//
// Uso:
//   npx tsx scripts/gmail-auth.ts gmail_1
//
// Abre el navegador, te pide loguearte con la cuenta de Gmail correspondiente
// (tiene que ser una de las agregadas como "Test user" en el OAuth consent
// screen de Google Cloud), y al terminar imprime el refresh token en la
// terminal — nunca lo manda a ningún lado más que a tu pantalla. Copialo a
// mano a Vercel como GMAIL_1_REFRESH_TOKEN / GMAIL_2_REFRESH_TOKEN /
// GMAIL_3_REFRESH_TOKEN (o a tu .env.local si estás probando en dev).
//
// Requiere GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env.local
// (`vercel env pull .env.local` los trae).

import { config } from "dotenv";
import { createServer } from "node:http";
import { google } from "googleapis";

config({ path: ".env.local" });

const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
];

const label = process.argv[2];
if (!label) {
  console.error("Uso: npx tsx scripts/gmail-auth.ts <label>  (ej: gmail_1)");
  process.exit(1);
}

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
  prompt: "consent", // fuerza que Google reemita refresh_token aunque ya hayas autorizado esta app antes
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
    res.end(
      `<h1>Listo</h1>El refresh token para <b>${label}</b> quedo impreso en tu terminal. Podés cerrar esta pestaña.`
    );

    console.log(`\n✅ Refresh token para "${label}":\n`);
    console.log(tokens.refresh_token ?? "(no vino refresh_token — revisa que uses prompt=consent y access_type=offline)");
    console.log(
      `\nGuardalo como la env var correspondiente (ej: GMAIL_${label.toUpperCase()}_REFRESH_TOKEN) en Vercel y/o .env.local.\n`
    );
  } catch (err) {
    console.error("Error canjeando el code por tokens:", err);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(3000, () => {
  console.log(`\nAbriendo el navegador para autenticar la cuenta "${label}"...`);
  console.log(`Si no se abre solo, entrá manualmente a:\n\n${authUrl}\n`);
  openInBrowser(authUrl);
});

function openInBrowser(url: string) {
  const platform = process.platform;
  const cmd =
    platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ exec }) => exec(`${cmd} "${url}"`));
}
