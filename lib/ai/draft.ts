// Ensamblador de prompt + llamada a Claude para generar el draft de un
// mensaje pending. Contexto que se inyecta en cada prompt:
//   - contacts.context_notes (nota estatica, entera, sin RAG)
//   - historial reciente del contacto via context_chunks (RAG, pgvector)
//   - contenido de los skills tildados para este mensaje (tono/contexto/formato)
//   - el mensaje original + el canal por el que llego
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { Channel, DraftResult, Message } from '@/lib/db/types';
import {
  getAllSkills,
  getContact,
  getMessage,
  getMessageSkillIds,
  getPendingMessages,
  insertContextChunk,
  saveDraft,
  searchContextChunks,
} from '@/lib/db/client';
import { readSkillContent } from '@/lib/ai/skills';
import { embed } from '@/lib/ai/embeddings';

const DraftSchema = z.object({
  draft: z.string().describe('El texto de la respuesta, listo para enviar (el usuario lo puede editar despues).'),
  meeting_intent: z
    .boolean()
    .describe('true si el mensaje original sugiere coordinar una reunion, llamada o encuentro.'),
  suggested_meeting_at: z
    .string()
    .nullable()
    .describe('Horario sugerido en ISO 8601 si meeting_intent es true y el mensaje da pistas de horario; null en cualquier otro caso.'),
});

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic(); // toma ANTHROPIC_API_KEY del entorno
  return _client;
}

const CHANNEL_LABEL: Record<Channel, string> = {
  gmail_1: 'Gmail',
  gmail_2: 'Gmail',
  gmail_3: 'Gmail',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
};

async function buildPrompt(message: Message, instruction?: string): Promise<string> {
  const contact = message.contact_id ? await getContact(message.contact_id) : null;
  const contactLabel = contact?.name ?? 'Desconocido';

  const skillIds = await getMessageSkillIds(message.id);
  let skillsSection = '';
  if (skillIds.length > 0) {
    const allSkills = await getAllSkills();
    const selected = allSkills.filter((s) => skillIds.includes(s.id));
    const contents = await Promise.all(
      selected.map(async (s) => `### ${s.label}\n${await readSkillContent(s)}`)
    );
    skillsSection = `\n\nInstrucciones de tono/contexto/formato para esta respuesta:\n${contents.join('\n\n')}`;
  }

  let historySection = '';
  if (contact) {
    const queryEmbedding = await embed(message.content, 'query');
    const chunks = await searchContextChunks(contact.id, queryEmbedding, 5);
    if (chunks.length > 0) {
      historySection = `\n\nHistorial reciente con este contacto:\n${chunks
        .map((c) => `- ${c.content}`)
        .join('\n')}`;
    }
  }

  const instructionSection = instruction
    ? `\n\nRafa dicto por audio esta indicacion puntual de que decir en esta respuesta (es una instruccion para vos, no el texto final — redacta la respuesta con tus propias palabras siguiendola):\n"""\n${instruction}\n"""`
    : '';

  return `Contacto: ${contactLabel}${contact?.context_notes ? `\nNotas sobre este contacto: ${contact.context_notes}` : ''}
Canal: ${CHANNEL_LABEL[message.channel]}
${skillsSection}${historySection}${instructionSection}

Mensaje original recibido:
"""
${message.content}
"""

Redacta una respuesta a este mensaje.`;
}

const SYSTEM_PROMPT = `Sos el asistente de Rafa que redacta borradores de respuesta para su bandeja de
comunicaciones (Gmail, Telegram, WhatsApp). Tu trabajo es escribir un draft que Rafa pueda
revisar y enviar casi sin editar.

Reglas:
- Escribi en español rioplatense salvo que el mensaje original este en otro idioma (ahi respondes en ese idioma).
- Usa el tono/contexto/formato indicados si estan presentes; si no hay ninguno indicado, usa un tono neutral-profesional.
- Nunca inventes datos, numeros o compromisos que no esten en el mensaje original o el historial.
- El draft es solo el cuerpo de la respuesta, sin asunto de email ni firma.
- Marca meeting_intent en true solo si el mensaje ORIGINAL busca coordinar una reunion/llamada/encuentro.
- Si Rafa dio una indicacion puntual dictada por audio, priorizala por sobre el tono/contexto por defecto,
  pero segui redactando vos la respuesta — no repitas la indicacion literal.`;

export async function generateDraft(messageId: string, opts?: { instruction?: string }): Promise<DraftResult> {
  const message = await getMessage(messageId);
  if (!message) throw new Error(`Mensaje ${messageId} no encontrado`);

  const prompt = await buildPrompt(message, opts?.instruction);

  const response = await getClient().messages.parse({
    model: 'claude-opus-5',
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('Claude no devolvio un draft parseable');

  const result: DraftResult = {
    draft: parsed.draft,
    meeting_intent: parsed.meeting_intent,
    suggested_meeting_at: parsed.suggested_meeting_at,
  };

  await saveDraft(messageId, result);

  // Este mensaje pasa a formar parte del historial RAG para futuros drafts del mismo contacto.
  if (message.contact_id) {
    const docEmbedding = await embed(message.content, 'document');
    await insertContextChunk({
      contact_id: message.contact_id,
      channel: message.channel,
      content: message.content,
      embedding: docEmbedding,
    });
  }

  return result;
}

export interface DraftBatchResult {
  messageId: string;
  ok: boolean;
  error?: string;
}

// `limit` acota cuantos mensajes se draftean en una sola invocacion — en
// Vercel Hobby las funciones serverless cortan a los 60s, y cada draft hace
// 1-2 llamadas a APIs externas (Voyage + Claude), asi que un backlog grande
// de pendientes se va vaciando de a tandas en corridas sucesivas del cron
// en vez de timeoutear intentando hacerlo todo de una.
export async function draftPendingMessages(limit?: number): Promise<DraftBatchResult[]> {
  const pending = await getPendingMessages();
  const batch = limit ? pending.slice(0, limit) : pending;
  const results: DraftBatchResult[] = [];
  for (const message of batch) {
    try {
      await generateDraft(message.id);
      results.push({ messageId: message.id, ok: true });
    } catch (err) {
      results.push({ messageId: message.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
