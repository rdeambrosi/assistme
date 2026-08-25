// Genera el TELEGRAM_SESSION_STRING una sola vez, corriendo esto local e
// interactivamente (te pide loguearte con tu cuenta personal de Telegram).
// MTProto vía GramJS/teleproto — no es un bot, lee/escribe como vos mismo,
// por eso el login es interactivo la primera vez y despues queda la
// session guardada.
//
// Uso: npx tsx scripts/telegram-auth.ts
//
// Requiere TELEGRAM_API_ID y TELEGRAM_API_HASH en .env.local (los sacas en
// https://my.telegram.org -> API Development Tools).

import { config } from "dotenv";
config({ path: ".env.local" });

import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import input from "input";

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash) {
  console.error(
    "Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH en .env.local. Corré `vercel env pull .env.local` primero."
  );
  process.exit(1);
}

async function main() {
  const client = new TelegramClient(new StringSession(""), apiId, apiHash!, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await input.text("Numero de telefono (con codigo de pais, ej +5491...): "),
    password: async () => await input.text("Password 2FA (si no tenes, Enter en blanco): "),
    phoneCode: async () => await input.text("Codigo que te llego por Telegram: "),
    onError: (err) => console.error(err),
  });

  console.log("\n✅ Conectado. Este es tu TELEGRAM_SESSION_STRING:\n");
  console.log(client.session.save());
  console.log("\nGuardalo en Vercel como TELEGRAM_SESSION_STRING (y/o en .env.local).\n");

  await client.disconnect();
  process.exit(0);
}

main();
