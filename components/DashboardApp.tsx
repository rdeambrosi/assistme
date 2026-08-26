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
  IconSkills,
} from "@/components/icons";

type View = "queue" | "detail";
type Tab = "draft" | "context";
type Filter = "all" | UiChannel;

interface QueueItem extends Message {
  contact: Contact | null;
  history: Message[];
  skillIds: string[];
}

interface QueueStats {
  pending: number;
  approved_today: number;
  skipped_today: number;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats>({ pending: 0, approved_today: 0, skipped_today: 0 });
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

  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function getSelection(id: string): SkillSelection {
    if (skillSelections[id]) return skillSelections[id];
    const item = items.find((i) => i.id === id);
    return item ? selectionFromSkillIds(item.skillIds, skills) : emptySelection();
  }

  function selectItem(id: string) {
    setSelectedId(id);
    setMeetPanelOpen(false);
    setSkillsPanelOpen(false);
    stopRecording(true);
    setView("detail");
    setTab("draft");

    const item = items.find((i) => i.id === id);
    setMeetDate(item?.suggested_meeting_at ? item.suggested_meeting_at.slice(0, 10) : "");
    setMeetTime(item?.suggested_meeting_at ? new Date(item.suggested_meeting_at).toISOString().slice(11, 16) : "15:00");
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

  async function setStatus(id: string, status: "approved" | "skipped") {
    try {
      await fetchJson(`/api/messages/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (selectedId === id) {
        setSelectedId(null);
        setView("queue");
      }
      await loadQueue();
    } catch (err) {
      alert(`No se pudo actualizar el mensaje: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function startRecording() {
    setRecording(true);
    setRecSeconds(0);
    recTimerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
  }

  function stopRecording(silent: boolean) {
    if (!recording) return;
    setRecording(false);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    if (!silent && recSeconds > 0 && selectedId) {
      setDrafts((prev) => {
        const text = (prev[selectedId] ? prev[selectedId] + " " : "") + "[transcripcion de audio agregada aca]";
        saveDraftText(selectedId, text);
        return { ...prev, [selectedId]: text };
      });
    }
  }

  useEffect(
    () => () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    },
    []
  );

  const recMin = Math.floor(recSeconds / 60);
  const recSec = recSeconds % 60;

  const filteredQueue = useMemo(
    () => items.filter((item) => filter === "all" || uiChannel(item.channel) === filter),
    [items, filter]
  );

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
            <div className="queue">
              {!loading && filteredQueue.length === 0 && (
                <div className="draft-empty" style={{ padding: 24 }}>
                  {loadError ? "No se pudo cargar la cola" : "No hay mensajes pendientes"}
                </div>
              )}
              {filteredQueue.map((item) => {
                const ch = uiChannel(item.channel);
                return (
                  <button key={item.id} className="queue-item" onClick={() => selectItem(item.id)}>
                    <div className="qi-top">
                      <span className={`qi-channel ${ch}`}>
                        <span className={`dot ${ch}`} />
                        {channelLabel[ch]}
                      </span>
                      <span className="qi-wait">espera {formatWait(item.received_at)}</span>
                    </div>
                    <span className="qi-name">{item.contact?.name ?? "Desconocido"}</span>
                    <span className="qi-snippet">{item.content.slice(0, 160)}</span>
                  </button>
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
                  <div className="original-msg">{selectedItem.content}</div>
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
                  >
                    {recording ? (
                      <>
                        <span className="rec-dot" />
                        <span className="rec-time">
                          {recMin}:{recSec.toString().padStart(2, "0")}
                        </span>
                      </>
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
                  <div className={`meet-panel${meetPanelOpen ? " visible" : ""}`}>
                    <input type="date" value={meetDate} onChange={(e) => setMeetDate(e.target.value)} />
                    <input type="time" value={meetTime} onChange={(e) => setMeetTime(e.target.value)} />
                    <MeetConfirmButton messageId={selectedItem.id} date={meetDate} time={meetTime} />
                  </div>
                </div>

                <div className="actions">
                  <button className="btn btn-approve" onClick={() => setStatus(selectedItem.id, "approved")}>
                    Aprobar y enviar
                  </button>
                  <button className="btn btn-skip" onClick={() => setStatus(selectedItem.id, "skipped")}>
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
