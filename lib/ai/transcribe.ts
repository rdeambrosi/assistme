// Transcribe audio a texto via la API de Whisper de OpenAI — Anthropic no
// tiene endpoint de speech-to-text propio, asi que "Responder con audio"
// depende de esta unica llamada externa a OpenAI.
export async function transcribeAudio(audio: Blob): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY en el entorno');

  const form = new FormData();
  form.append('file', audio, 'audio.webm');
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Whisper respondio ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { text: string };
  return json.text;
}
