// Embeddings via Voyage AI (voyage-3, 1024 dims) — Claude no tiene endpoint
// de embeddings propio, Voyage es el partner que recomienda Anthropic.
// Si se cambia de proveedor, hay que migrar la columna vector(1024) en
// context_chunks ANTES de cargar datos (ver handoff).

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

interface VoyageResponse {
  data: { embedding: number[] }[];
}

export async function embed(text: string, inputType: 'document' | 'query' = 'document'): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('Falta VOYAGE_API_KEY en el entorno');

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-3',
      input: [text],
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage API error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as VoyageResponse;
  const vector = json.data[0]?.embedding;
  if (!vector) throw new Error('Voyage no devolvio ningun embedding');
  return vector;
}
