// Cola de revision para el dashboard: mensajes pending/drafted + contacto +
// historial reciente + skills ya tildadas para cada uno, en una sola
// respuesta para que el front no tenga que encadenar requests.
import { NextResponse } from 'next/server';
import {
  getMessageSkillIds,
  getQueueMessages,
  getQueueStats,
  getRecentContactHistory,
} from '@/lib/db/client';
import { serializeError } from '@/lib/api-error';

export async function GET() {
  try {
    const [items, stats] = await Promise.all([getQueueMessages(), getQueueStats()]);

    const enriched = await Promise.all(
      items.map(async (item) => {
        const [history, skillIds] = await Promise.all([
          item.contact_id ? getRecentContactHistory(item.contact_id, item.id, 5) : Promise.resolve([]),
          getMessageSkillIds(item.id),
        ]);
        return { ...item, history, skillIds };
      })
    );

    return NextResponse.json({ ok: true, items: enriched, stats });
  } catch (err) {
    console.error('[/api/queue] failed:', err);
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
