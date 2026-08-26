"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contact, Message, Skill } from "@/lib/db/types";
import { channelLabel, formatWait, uiChannel, type UiChannel } from "@/lib/channels";
import {
  IconBack,
  IconCalendar,
  IconChevron,
  IconContacts,
  IconMic,
  IconRefresh,
  IconSkills,
} from "@/components/icons";

// El cron de Vercel (vercel.json) solo puede correr una vez por dia en el
// plan actual — mientras el dashboard este abierto, este intervalo cubre el
// "quiero mensajes de como minimo hace 15 minutos" sin depender de eso.
const AUTO_REFRESH_MS = 15 * 60 * 1000;

type View = "queue" | "detail";
type Tab = "draft" | "context";
type Filter = "all" | UiChannel;

interface QueueItem extends Message {
  contact: Contact | null;
  history: Message[];
  skillIds: string[];
}

// Agrupa mensajes pendientes por conversacion: un chat de grupo de Telegram
// (o cualquier canal) es un unico contact_id con muchos mensajes sueltos
// esperando revision — sin esto la cola muestra ese mismo grupo repetido
// una vez por mensaje. contact_id ya identifica de forma unica tanto un
// chat directo como un grupo (ver findOrCreateContactByChannel), asi que
// agrupar por canal+contacto alcanza para ambos casos.
interface QueueGroup {
  key: string;
  channel: QueueItem["channel"];
  contact: Contact | null;
  messages: QueueItem[]; // orden ascendente por received_at
}

function groupKeyFor(item: QueueItem): string {
  return `${item.channel}:${item.contact_id ?? item.thread_id ?? item.id}`;
}

function groupQueue(items: QueueItem[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  for (const item of items) {
    const key = groupKeyFor(item);
    const existing = groups.get(key);
    if (existing) existing.messages.push(item);
    else groups.set(key, { key, channel: item.channel, contact: item.contact, messages: [item] });
  }
  const result = Array.from(groups.values());
  for (const g of result) g.messages.sort((a, b) => a.received_at.localeCompare(b.received_at));
  // Mas reciente arriba: ordena por el ultimo mensaje de cada grupo, descendente.
  result.sort((a, b) =>
    b.messages[b.messages.length - 1].received_at.localeCompare(a.messages[a.messages.length - 1].received_at)
  );
  return result;
}

interface QueueStats {
  pending: number;
  approved_today: number;
  skipped_today: number;
  read_today: number;
}

interface SkillSelection {
  tono: string | null;
  contexto: string[];
  formato: string | null;
}

function emptySelection(): SkillSelection {
  return { tono: null, contexto: [], formato: null };
}

function selectionFromSkillIds(skillIds: string[], skills: Skill[]): SkillSelection {
  const sel = emptySelection();
  for (const id of skillIds) {
    const skill = skills.find((s) => s.id === id);
    if (!skill) continue;
    if (skill.group_name === "tono") sel.tono = id;
    else if (skill.group_name === "formato") sel.formato = id;
    else sel.contexto.push(id);
  }
  return sel;
}

function contactSubtitle(item: QueueItem): string {
  const ref = item.contact?.channels.find((ch) => ch.channel === item.channel);
  if (ref?.address) return ref.address;
  if (item.contact?.context_notes) return item.contact.context_notes.slice(0, 70);
  return "";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `${url} -> ${res.status}`);
  return json;
}

export default function DashboardApp() {
  const [view, setView] = useState<View>("queue");
  const [tab, setTab] = useState<Tab>("draft");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null);

  // Modo seleccion multiple de la cola ("Marcar leido"/"Descartar" en lote) —
  // selectedGroupKeys es independiente de selectedGroupKey (el grupo abierto
  // en el panel de detalle), son dos cosas distintas.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  const [topN, setTopN] = useState(7);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, approved_today: 0, skipped_today: 0, read_today: 0 });
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [skillSelections, setSkillSelections] = useState<Record<string, SkillSelection>>({});
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [meetPanelOpen, setMeetPanelOpen] = useState(false);
  const [meetDate, setMeetDate] = useState("");
  const [meetTime, setMeetTime] = useState("15:00");
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [savedContactId, setSavedContactId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const loadQueue = useCallback(async () => {
    try {
      const res = await fetchJson<{ items: QueueItem[]; stats: QueueStats }>("/api/queue");
      setItems(res.items);
      setStats(res.stats);
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of res.items) {
          if (!(item.id in next)) next[item.id] = item.draft_content ?? "";
        }
        return next;
      });
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount es intencional aca
    loadQueue();
    fetchJson<{ skills: Skill[] }>("/api/skills")
      .then((res) => setSkills(res.skills))
      .catch(() => {
        /* el selector de skills se muestra vacio si esto falla, no es bloqueante */
      });
  }, [loadQueue]);

  // Botón "Actualizar": dispara el sync real (trae mensajes nuevos de Gmail/
  // Telegram) y despues recarga la cola — a diferencia de loadQueue solo,
  // que releería lo que ya esta en la base sin ir a buscar nada nuevo.
  const refreshQueue = useCallback(async () => {
    setSyncing(true);
    try {
      await fetchJson("/api/sync", { method: "POST" });
    } catch (err) {
      console.error("No se pudo sincronizar:", err);
    } finally {
      await loadQueue();
      setSyncing(false);
    }
  }, [loadQueue]);

  useEffect(() => {
    // El cron de Vercel corre una vez al dia (limite del plan actual) — este
    // intervalo mantiene la cola razonablemente al dia mientras el
    // dashboard este abierto en el navegador.
    const id = setInterval(refreshQueue, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshQueue]);

  useEffect(() => {
    document.body.classList.toggle("contacts-open", contactsOpen);
  }, [contactsOpen]);

  useEffect(() => {
    if (!contactsOpen) return;
    fetchJson<{ contacts: Contact[] }>("/api/contacts")
      .then((res) => setContacts(res.contacts))
      .catch(() => {});
  }, [contactsOpen]);

  const selectedItem = selectedId != null ? items.find((i) => i.id === selectedId) ?? null : null;
  const selectedGroupMessages = useMemo(
    () => (selectedGroupKey ? items.filter((i) => groupKeyFor(i) === selectedGroupKey) : []),
    [items, selectedGroupKey]
  );
  const filteredQueue = useMemo(
    () => items.filter((item) => filter === "all" || uiChannel(item.channel) === filter),
    [items, filter]
  );
  const groupedQueue = useMemo(() => groupQueue(filteredQueue), [filteredQueue]);
  const visibleQueue = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groupedQueue;
    return groupedQueue.filter((g) => {
      if (g.contact?.name?.toLowerCase().includes(q)) return true;
      // El titulo/asunto de cada mensaje es su primera linea (el subject de
      // Gmail viene concatenado como `subject\n\nbody`, ver connectors/gmail.ts).
      return g.messages.some((m) => m.content.split("\n")[0].toLowerCase().includes(q));
    });
  }, [groupedQueue, search]);

  function getSelection(id: string): SkillSelection {
    if (skillSelections[id]) return skillSelections[id];
    const item = items.find((i) => i.id === id);
    return item ? selectionFromSkillIds(item.skillIds, skills) : emptySelection();
  }

  function selectGroup(group: QueueGroup) {
    // el mensaje mas reciente del grupo maneja draft/skills/deteccion de reunion —
    // los anteriores del mismo grupo se muestran como contexto en "Mensaje original"
    const latest = group.messages[group.messages.length - 1];
    setSelectedGroupKey(group.key);
    setSelectedId(latest.id);
    setMeetPanelOpen(false);
    setSkillsPanelOpen(false);
    stopRecording(true);
    setView("detail");
    setTab("draft");

    setMeetDate(latest.suggested_meeting_at ? latest.suggested_meeting_at.slice(0, 10) : "");
    setMeetTime(
      latest.suggested_meeting_at ? new Date(latest.suggested_meeting_at).toISOString().slice(11, 16) : "15:00"
    );
  }

  function toggleSkill(itemId: string, group: "tono" | "contexto" | "formato", id: string) {
    setSkillSelections((prev) => {
      const sel = prev[itemId] ?? getSelection(itemId);
      let next: SkillSelection;
      if (group === "contexto") {
        const list = sel.contexto;
        const idx = list.indexOf(id);
        next = { ...sel, contexto: idx >= 0 ? list.filter((x) => x !== id) : [...list, id] };
      } else {
        next = { ...sel, [group]: sel[group] === id ? null : id };
      }
      return { ...prev, [itemId]: next };
    });
  }

  function skillsCount(id: string) {
    const sel = getSelection(id);
    return (sel.tono ? 1 : 0) + sel.contexto.length + (sel.formato ? 1 : 0);
  }

  async function regenDraft() {
    if (!selectedId) return;
    const sel = getSelection(selectedId);
    setRegenerating(true);
    try {
      const res = await fetchJson<{
        result: { draft: string; meeting_intent: boolean; suggested_meeting_at: string | null };
      }>(`/api/messages/${selectedId}/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sel),
      });
      setDrafts((prev) => ({ ...prev, [selectedId]: res.result.draft }));
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId
            ? { ...i, meeting_intent: res.result.meeting_intent, suggested_meeting_at: res.result.suggested_meeting_at }
            : i
        )
      );
    } catch (err) {
      alert(`No se pudo regenerar el draft: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRegenerating(false);
    }
  }

  function saveDraftText(id: string, text: string) {
    fetchJson(`/api/messages/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft: text }),
    }).catch(() => {
      /* si falla el guardado, el texto sigue editable local; se reintenta en el proximo blur */
    });
  }

  async function insertBookingLink(id: string) {
    try {
      const res = await fetchJson<{ url: string }>(`/api/messages/${id}/booking-link`);
      setDrafts((prev) => {
        const text = (prev[id] ? prev[id] + "\n\n" : "") + res.url;
        saveDraftText(id, text);
        return { ...prev, [id]: text };
      });
    } catch (err) {
      alert(`No se pudo obtener el link de reserva: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function setStatus(ids: string[], status: "approved" | "skipped" | "read") {
    try {
      await Promise.all(
        ids.map((id) =>
          fetchJson(`/api/messages/${id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status }),
          })
        )
      );
      setSelectedId(null);
      setSelectedGroupKey(null);
      setView("queue");
      await loadQueue();
    } catch (err) {
      alert(`No se pudo actualizar el mensaje: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function toggleSelectionMode() {
    setSelectionMode((on) => !on);
    setSelectedGroupKeys(new Set());
  }

  function toggleGroupSelected(key: string) {
    setSelectedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Preselecciona los primeros N grupos de la cola filtrada actual — no
  // ejecuta ninguna accion todavia, solo tilda para que el usuario confirme
  // con "Marcar leido"/"Descartar".
  function selectTopN(n: number) {
    setSelectedGroupKeys(new Set(visibleQueue.slice(0, n).map((g) => g.key)));
  }

  async function bulkSetStatus(status: "read" | "skipped") {
    const targetGroups = groupedQueue.filter((g) => selectedGroupKeys.has(g.key));
    const ids = targetGroups.flatMap((g) => g.messages.map((m) => m.id));
    if (ids.length === 0) return;
    const verb = status === "read" ? "marcar como leidos" : "descartar";
    if (
      targetGroups.length > 3 &&
      !confirm(`¿Seguro que queres ${verb} ${targetGroups.length} mensajes/conversaciones?`)
    ) {
      return;
    }
    await setStatus(ids, status);
    setSelectedGroupKeys(new Set());
  }

  // "Responder con audio": no es dictado literal del draft — Rafa le dice a
  // su asistente que quiere que diga la respuesta, y esa instruccion se
  // transcribe y se le pasa a Claude para que redacte el draft con eso.
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
      setRecSeconds(0);
      recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (err) {
      alert(`No se pudo acceder al microfono: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stopRecording(discard: boolean) {
    const recorder = mediaRecorderRef.current;
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    setRecording(false);
    if (!recorder) return;

    const messageId = selectedId;
    recorder.onstop = () => {
      recorder.stream.getTracks().forEach((t) => t.stop());
      mediaRecorderRef.current = null;
      if (discard || !messageId || audioChunksRef.current.length === 0) return;
      const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      sendVoiceInstruction(messageId, blob);
    };
    recorder.stop();
  }

  async function sendVoiceInstruction(messageId: string, blob: Blob) {
    setTranscribing(true);
    try {
      const form = new FormData();
      form.append("audio", blob, "audio.webm");
      const res = await fetch(`/api/messages/${messageId}/voice-instruction`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo procesar el audio");
      setDrafts((prev) => ({ ...prev, [messageId]: json.result.draft }));
      setItems((prev) =>
        prev.map((i) =>
          i.id === messageId
            ? { ...i, meeting_intent: json.result.meeting_intent, suggested_meeting_at: json.result.suggested_meeting_at }
            : i
        )
      );
    } catch (err) {
      alert(`No se pudo generar el draft desde el audio: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTranscribing(false);
    }
  }

  useEffect(
    () => () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  const recMin = Math.floor(recSeconds / 60);
  const recSec = recSeconds % 60;

  function saveContactNotes(id: string, notes: string) {
    fetchJson(`/api/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    })
      .then(() => {
        setSavedContactId(id);
        setTimeout(() => setSavedContactId((cur) => (cur === id ? null : cur)), 1400);
      })
      .catch((err) => alert(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}`));
  }

  return (
    <>
      <div className="ticker">
        <span className="ticker-brand">COMMS/HUB</span>
        <div className="ticker-item">
          <span className="dot live" />
          PEND <b>{stats.pending}</b>
        </div>
        <div className="ticker-sync">
          {loading ? "cargando…" : loadError ? `error: ${loadError}` : `${items.length} en cola`}
        </div>
        <button className="contacts-btn" id="btn-open-contacts" onClick={() => setContactsOpen(true)}>
          <IconContacts />
          Contactos
        </button>
      </div>

      {!contactsOpen && (
        <div className="mobile-topbar" style={{ display: view === "detail" ? "flex" : "none" }}>
          <button className="back-btn" onClick={() => setView("queue")}>
            <IconBack />
            Cola
          </button>
          <span className="mt-name">{selectedItem?.contact?.name ?? ""}</span>
          <div className="tab-group">
            <button
              className={`tab-btn${tab === "draft" ? " active" : ""}`}
              onClick={() => setTab("draft")}
            >
              Draft
            </button>
            <button
              className={`tab-btn${tab === "context" ? " active" : ""}`}
              onClick={() => setTab("context")}
            >
              Contexto
            </button>
          </div>
        </div>
      )}

      {!contactsOpen && (
        <div className="layout" data-view={view} data-tab={tab}>
          {/* QUEUE */}
          <div className="col" data-role="queue">
            <div className="col-header">
              <span className="col-title">Cola de revision</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className={`refresh-btn${syncing ? " spinning" : ""}`}
                  onClick={refreshQueue}
                  disabled={syncing}
                  title="Buscar mensajes nuevos"
                  aria-label="Actualizar"
                >
                  <IconRefresh />
                </button>
                <button className="select-toggle" onClick={toggleSelectionMode}>
                  {selectionMode ? "Cancelar" : "Seleccionar"}
                </button>
              </div>
            </div>
            <div className="filters">
              {(["all", "gmail", "telegram", "whatsapp"] as Filter[]).map((f) => (
                <button
                  key={f}
                  className={`chip${filter === f ? " active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "Todos" : channelLabel[f as UiChannel]}
                </button>
              ))}
            </div>
            <div className="search-row">
              <input
                type="search"
                className="search-input"
                placeholder="Buscar por contacto o asunto…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {selectionMode && (
              <div className="selection-bar">
                <span className="selection-count">{selectedGroupKeys.size} seleccionados</span>
                <input
                  type="number"
                  min={1}
                  className="topn-input"
                  value={topN}
                  onChange={(e) => setTopN(Math.max(1, Number(e.target.value) || 1))}
                />
                <button className="chip" onClick={() => selectTopN(topN)}>
                  Primeros {topN}
                </button>
                <button
                  className="btn-regen"
                  disabled={selectedGroupKeys.size === 0}
                  onClick={() => bulkSetStatus("read")}
                >
                  Marcar leído
                </button>
                <button
                  className="btn-regen bulk-discard"
                  disabled={selectedGroupKeys.size === 0}
                  onClick={() => bulkSetStatus("skipped")}
                >
                  Descartar
                </button>
              </div>
            )}
            <div className="queue">
              {!loading && visibleQueue.length === 0 && (
                <div className="draft-empty" style={{ padding: 24 }}>
                  {loadError
                    ? "No se pudo cargar la cola"
                    : search.trim()
                      ? "Sin resultados para la busqueda"
                      : "No hay mensajes pendientes"}
                </div>
              )}
              {visibleQueue.map((group) => {
                const ch = uiChannel(group.channel);
                const latest = group.messages[group.messages.length - 1];
                const isSelected = selectedGroupKeys.has(group.key);
                return (
                  <div
                    key={group.key}
                    role="button"
                    tabIndex={0}
                    className={`queue-item${isSelected ? " selected" : ""}`}
                    onClick={() => (selectionMode ? toggleGroupSelected(group.key) : selectGroup(group))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      if (selectionMode) toggleGroupSelected(group.key);
                      else selectGroup(group);
                    }}
                  >
                    <div className="qi-top">
                      {selectionMode && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleGroupSelected(group.key)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <span className={`qi-channel ${ch}`}>
                        <span className={`dot ${ch}`} />
                        {channelLabel[ch]}
                      </span>
                      <span className="qi-wait">hace {formatWait(latest.received_at)}</span>
                    </div>
                    <span className="qi-name">
                      {group.contact?.name ?? "Desconocido"}
                      {group.messages.length > 1 && <span className="qi-count">{group.messages.length}</span>}
                    </span>
                    <span className="qi-snippet">{latest.content.slice(0, 160)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DRAFT */}
          <div className="col draft-col" data-role="draft">
            <div className="col-header desktop-only">
              <span className="col-title">Draft</span>
            </div>
            {!selectedItem ? (
              <div className="draft-empty">Elegi un mensaje de la cola</div>
            ) : (
              <div className="draft-body visible">
                <div className="thread-meta">
                  <span className="thread-name">{selectedItem.contact?.name ?? "Desconocido"}</span>
                  <span
                    className="thread-channel-tag"
                    style={{
                      color: `var(--${uiChannel(selectedItem.channel)})`,
                      borderColor: `var(--${uiChannel(selectedItem.channel)})`,
                    }}
                  >
                    {channelLabel[uiChannel(selectedItem.channel)]}
                  </span>
                </div>

                <div>
                  <span className="block-label">Mensaje original</span>
                  {selectedGroupMessages.length > 1 ? (
                    <div className="original-msg-stack">
                      {selectedGroupMessages.map((m) => {
                        const sender = m.sender_name ?? (m.direction === "outbound" ? "Vos" : null);
                        return (
                          <div className="original-msg" key={m.id}>
                            <span className="original-msg-text">{m.content}</span>
                            {sender && <span className="original-msg-sender">{sender}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="original-msg">{selectedItem.content}</div>
                  )}
                </div>

                <div>
                  <button
                    className={`skills-toggle${skillsPanelOpen ? " open" : ""}`}
                    onClick={() => setSkillsPanelOpen((o) => !o)}
                  >
                    <span className="skills-toggle-left">
                      <IconSkills />
                      Skills y contexto para este mensaje
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        className={`skills-badge${skillsCount(selectedItem.id) > 0 ? " has-selection" : ""}`}
                      >
                        {skillsCount(selectedItem.id)}
                      </span>
                      <IconChevron />
                    </span>
                  </button>
                  <div className={`skills-panel${skillsPanelOpen ? " open" : ""}`}>
                    {(["tono", "contexto", "formato"] as const).map((group) => {
                      const sel = getSelection(selectedItem.id);
                      const options = skills.filter((s) => s.group_name === group);
                      const titleMap = { tono: "Tono y voz", contexto: "Contexto", formato: "Formato" };
                      return (
                        <div key={group}>
                          <span className="skill-group-title">{titleMap[group]}</span>
                          <div className="skill-chips">
                            {options.length === 0 && (
                              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin opciones</span>
                            )}
                            {options.map((opt) => {
                              const isSelected =
                                group === "contexto" ? sel.contexto.includes(opt.id) : sel[group] === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  className={`skill-chip${isSelected ? " selected" : ""}`}
                                  onClick={() => toggleSkill(selectedItem.id, group, opt.id)}
                                >
                                  {opt.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    <div className="skills-panel-footer">
                      <button className="btn-regen" onClick={regenDraft} disabled={regenerating}>
                        {regenerating ? "Regenerando…" : "Regenerar draft"}
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="block-label">Respuesta (editable)</span>
                  <textarea
                    className="draft-textarea"
                    value={drafts[selectedItem.id] ?? ""}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [selectedItem.id]: e.target.value }))
                    }
                    onBlur={(e) => saveDraftText(selectedItem.id, e.target.value)}
                  />
                </div>

                <div className="audio-row">
                  <button
                    className={`btn-audio${recording ? " recording" : ""}`}
                    onClick={() => (recording ? stopRecording(false) : startRecording())}
                    disabled={transcribing}
                  >
                    {recording ? (
                      <>
                        <span className="rec-dot" />
                        <span className="rec-time">
                          {recMin}:{recSec.toString().padStart(2, "0")}
                        </span>
                      </>
                    ) : transcribing ? (
                      <span>Transcribiendo…</span>
                    ) : (
                      <>
                        <IconMic />
                        <span>Responder con audio</span>
                      </>
                    )}
                  </button>
                </div>

                <div className={`meet-suggestion${selectedItem.meeting_intent ? " visible" : ""}`}>
                  <button
                    className="meet-suggestion-header"
                    onClick={() => setMeetPanelOpen((o) => !o)}
                  >
                    <IconCalendar />
                    <span>Se detecto intencion de reunion — proponer horario</span>
                  </button>
                  <div className={`meet-panel${meetPanelOpen ? " visible" : ""}`} style={{ flexWrap: "wrap" }}>
                    <input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
                    <input type="time" value={meetTime} onChange={(e) => setMeetTime(e.target.value)} />
                    <MeetConfirmButton messageId={selectedItem.id} date={meetDate} time={meetTime} />
                    <button
                      className="btn-regen"
                      style={{ flex: "1 0 100%" }}
                      onClick={() => insertBookingLink(selectedItem.id)}
                    >
                      Insertar link para que agenden ellos
                    </button>
                  </div>
                </div>

                <div className="actions">
                  <button
                    className="btn btn-approve"
                    onClick={() => setStatus(selectedGroupMessages.map((m) => m.id), "approved")}
                  >
                    Aprobar y enviar
                  </button>
                  <button
                    className="btn btn-skip"
                    onClick={() => setStatus(selectedGroupMessages.map((m) => m.id), "skipped")}
                  >
                    Descartar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CONTEXT */}
          <div className="col context-col" data-role="context">
            <div className="col-header desktop-only">
              <span className="col-title">Contexto</span>
            </div>
            {!selectedItem ? (
              <div className="context-empty">Sin contacto seleccionado</div>
            ) : (
              <div className="context-body visible">
                <div className="contact-card">
                  <span className="name">{selectedItem.contact?.name ?? "Desconocido"}</span>
                  <span className="sub">{contactSubtitle(selectedItem)}</span>
                </div>
                <div>
                  <span className="block-label">Historial reciente</span>
                  {selectedItem.history.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Sin historial previo</div>
                  ) : (
                    <div className="history-list">
                      {selectedItem.history.map((h) => (
                        <div className="history-item" key={h.id}>
                          <span className="h-when">{new Date(h.received_at).toLocaleString("es-AR")}</span>
                          <span className="h-text">{h.content.slice(0, 200)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <span className="block-label">Estado de la cola</span>
                  <div className="stat-row">
                    <span>Pendientes</span>
                    <span>{stats.pending}</span>
                  </div>
                  <div className="stat-row">
                    <span>Aprobados hoy</span>
                    <span>{stats.approved_today}</span>
                  </div>
                  <div className="stat-row">
                    <span>Descartados hoy</span>
                    <span>{stats.skipped_today}</span>
                  </div>
                  <div className="stat-row">
                    <span>Leídos hoy</span>
                    <span>{stats.read_today}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONTACTS / CONTEXT MANAGEMENT */}
      <div id="contacts-view" className={contactsOpen ? "visible" : ""}>
        <div className="contacts-header">
          <button className="back-btn" onClick={() => setContactsOpen(false)}>
            <IconBack />
            Volver
          </button>
          <h1>Contactos y contexto</h1>
        </div>
        <div className="contacts-list">
          {contacts.map((c) => (
            <ContactEditCard
              key={c.id}
              contact={c}
              saved={savedContactId === c.id}
              onSave={(notes) => saveContactNotes(c.id, notes)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

function MeetConfirmButton({ messageId, date, time }: { messageId: string; date: string; time: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [meetLink, setMeetLink] = useState<string | null>(null);

  async function handleClick() {
    if (!date || !time) {
      alert("Elegí fecha y horario primero");
      return;
    }
    setStatus("loading");
    try {
      const res = await fetch(`/api/messages/${messageId}/create-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "No se pudo crear el evento");
      setMeetLink(json.meetLink ?? json.eventLink ?? null);
      setStatus("idle");
    } catch (err) {
      setStatus("error");
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  if (meetLink) {
    return (
      <a href={meetLink} target="_blank" rel="noreferrer" className="btn btn-approve" style={{ textAlign: "center" }}>
        Ver evento creado ↗
      </a>
    );
  }

  return (
    <button className="btn btn-approve" onClick={handleClick} disabled={status === "loading"}>
      {status === "loading" ? "Creando…" : "Crear evento + Meet"}
    </button>
  );
}

function ContactEditCard({
  contact,
  saved,
  onSave,
}: {
  contact: Contact;
  saved: boolean;
  onSave: (notes: string) => void;
}) {
  const [notes, setNotes] = useState(contact.context_notes ?? "");
  const channels = Array.from(new Set(contact.channels.map((ch) => uiChannel(ch.channel))));
  return (
    <div className="contact-edit-card">
      <div className="cec-top">
        <div>
          <div className="cec-name">{contact.name}</div>
        </div>
        <div className="cec-channels">
          {channels.map((ch) => (
            <span className={`qi-channel ${ch}`} key={ch}>
              <span className={`dot ${ch}`} />
            </span>
          ))}
        </div>
      </div>
      <textarea
        className="cec-textarea"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <div className="cec-footer">
        <span className="cec-hint">se usa en cada draft para este contacto</span>
        <button className="cec-save" onClick={() => onSave(notes)}>
          {saved ? "Guardado" : "Guardar"}
        </button>
      </div>
    </div>
  );
}
