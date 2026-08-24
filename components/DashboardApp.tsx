"use client";

import { useEffect, useRef, useState } from "react";
import {
  channelLabel,
  contactsData,
  queueData,
  skillGroups,
  type Contact,
  type UiChannel,
} from "@/lib/mock-data";
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
type Status = "approved" | "skipped";
type Filter = "all" | UiChannel;

interface SkillSelection {
  tono: string | null;
  contexto: string[];
  formato: string | null;
}

function emptySelection(): SkillSelection {
  return { tono: null, contexto: [], formato: null };
}

export default function DashboardApp() {
  const [view, setView] = useState<View>("queue");
  const [tab, setTab] = useState<Tab>("draft");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(queueData.map((d) => [d.id, d.draft]))
  );
  const [skillSelections, setSkillSelections] = useState<
    Record<number, SkillSelection>
  >({});
  const [skillsPanelOpen, setSkillsPanelOpen] = useState(false);
  const [meetPanelOpen, setMeetPanelOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(contactsData);
  const [savedContactId, setSavedContactId] = useState<number | null>(null);

  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    document.body.classList.toggle("contacts-open", contactsOpen);
  }, [contactsOpen]);

  const selectedItem =
    selectedId != null ? queueData.find((d) => d.id === selectedId) ?? null : null;

  const approvedCount = Object.values(status).filter((s) => s === "approved").length;
  const skippedCount = Object.values(status).filter((s) => s === "skipped").length;
  const pendingLeft = queueData.length - approvedCount - skippedCount;

  function selectItem(id: number) {
    setSelectedId(id);
    setMeetPanelOpen(false);
    setSkillsPanelOpen(false);
    stopRecording(true);
    setView("detail");
    setTab("draft");
  }

  function getSelection(id: number): SkillSelection {
    return skillSelections[id] ?? emptySelection();
  }

  function toggleSkill(itemId: number, group: "tono" | "contexto" | "formato", id: string) {
    setSkillSelections((prev) => {
      const sel = prev[itemId] ?? emptySelection();
      const multi = skillGroups[group].multi;
      let next: SkillSelection;
      if (multi) {
        const list = sel.contexto;
        const idx = list.indexOf(id);
        next = {
          ...sel,
          contexto: idx >= 0 ? list.filter((x) => x !== id) : [...list, id],
        };
      } else {
        next = { ...sel, [group]: sel[group as "tono" | "formato"] === id ? null : id };
      }
      return { ...prev, [itemId]: next };
    });
  }

  function skillsCount(id: number) {
    const sel = getSelection(id);
    return (sel.tono ? 1 : 0) + sel.contexto.length + (sel.formato ? 1 : 0);
  }

  function regenDraft() {
    if (selectedId == null || !selectedItem) return;
    const sel = getSelection(selectedId);
    const labels: string[] = [];
    if (sel.tono)
      labels.push(skillGroups.tono.options.find((o) => o.id === sel.tono)!.label);
    sel.contexto.forEach((id) =>
      labels.push(skillGroups.contexto.options.find((o) => o.id === id)!.label)
    );
    if (sel.formato)
      labels.push(skillGroups.formato.options.find((o) => o.id === sel.formato)!.label);
    const tagLine = labels.length ? `[Generado con: ${labels.join(" · ")}]\n\n` : "";
    setDrafts((prev) => ({ ...prev, [selectedId]: tagLine + selectedItem.draft }));
  }

  function approve() {
    if (selectedId == null) return;
    setStatus((prev) => ({ ...prev, [selectedId]: "approved" }));
  }

  function skip() {
    if (selectedId == null) return;
    setStatus((prev) => ({ ...prev, [selectedId]: "skipped" }));
  }

  function startRecording() {
    setRecording(true);
    setRecSeconds(0);
    recTimerRef.current = setInterval(() => {
      setRecSeconds((s) => s + 1);
    }, 1000);
  }

  function stopRecording(silent: boolean) {
    if (!recording) return;
    setRecording(false);
    if (recTimerRef.current) clearInterval(recTimerRef.current);
    if (!silent && recSeconds > 0 && selectedId != null) {
      setDrafts((prev) => ({
        ...prev,
        [selectedId]: (prev[selectedId] ? prev[selectedId] + " " : "") +
          "[transcripcion de audio agregada aca]",
      }));
    }
  }

  useEffect(() => () => {
    if (recTimerRef.current) clearInterval(recTimerRef.current);
  }, []);

  const recMin = Math.floor(recSeconds / 60);
  const recSec = recSeconds % 60;

  const filteredQueue = queueData.filter(
    (item) => filter === "all" || item.channel === filter
  );

  function saveContactNotes(id: number, notes: string) {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, notes } : c)));
    setSavedContactId(id);
    setTimeout(() => setSavedContactId((cur) => (cur === id ? null : cur)), 1400);
  }

  return (
    <>
      <div className="ticker">
        <span className="ticker-brand">COMMS/HUB</span>
        <div className="ticker-item">
          <span className="dot gmail" />
          GMAIL <b>12</b>
        </div>
        <div className="ticker-item">
          <span className="dot telegram" />
          TG <b>4</b>
        </div>
        <div className="ticker-item">
          <span className="dot whatsapp" />
          WA <b>7</b>
        </div>
        <div className="ticker-item">
          <span className="dot live" />
          PEND <b>{pendingLeft}</b>
        </div>
        <div className="ticker-sync">
          sync <b>14:32</b>
        </div>
        <button className="contacts-btn" onClick={() => setContactsOpen(true)}>
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
          <span className="mt-name">{selectedItem?.name ?? ""}</span>
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
              {filteredQueue.map((item) => (
                <button
                  key={item.id}
                  className={`queue-item${
                    status[item.id] === "approved" ? " status-approved" : ""
                  }${status[item.id] === "skipped" ? " status-skipped" : ""}`}
                  onClick={() => selectItem(item.id)}
                >
                  <div className="qi-top">
                    <span className={`qi-channel ${item.channel}`}>
                      <span className={`dot ${item.channel}`} />
                      {channelLabel[item.channel]}
                    </span>
                    <span className="qi-wait">espera {item.wait}</span>
                  </div>
                  <span className="qi-name">{item.name}</span>
                  <span className="qi-snippet">{item.snippet}</span>
                </button>
              ))}
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
                  <span className="thread-name">{selectedItem.name}</span>
                  <span
                    className="thread-channel-tag"
                    style={{
                      color: `var(--${selectedItem.channel})`,
                      borderColor: `var(--${selectedItem.channel})`,
                    }}
                  >
                    {channelLabel[selectedItem.channel]}
                  </span>
                </div>

                <div>
                  <span className="block-label">Mensaje original</span>
                  <div className="original-msg">{selectedItem.original}</div>
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
                        className={`skills-badge${
                          skillsCount(selectedItem.id) > 0 ? " has-selection" : ""
                        }`}
                      >
                        {skillsCount(selectedItem.id)}
                      </span>
                      <IconChevron />
                    </span>
                  </button>
                  <div className={`skills-panel${skillsPanelOpen ? " open" : ""}`}>
                    {(["tono", "contexto", "formato"] as const).map((group) => {
                      const sel = getSelection(selectedItem.id);
                      const { multi, options } = skillGroups[group];
                      const titleMap = { tono: "Tono y voz", contexto: "Contexto", formato: "Formato" };
                      return (
                        <div key={group}>
                          <span className="skill-group-title">{titleMap[group]}</span>
                          <div className="skill-chips">
                            {options.map((opt) => {
                              const isSelected = multi
                                ? sel.contexto.includes(opt.id)
                                : sel[group as "tono" | "formato"] === opt.id;
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
                      <button className="btn-regen" onClick={regenDraft}>
                        Regenerar draft
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

                <div className={`meet-suggestion${selectedItem.meetingIntent ? " visible" : ""}`}>
                  <button
                    className="meet-suggestion-header"
                    onClick={() => setMeetPanelOpen((o) => !o)}
                  >
                    <IconCalendar />
                    <span>Se detecto intencion de reunion — proponer horario</span>
                  </button>
                  <div className={`meet-panel${meetPanelOpen ? " visible" : ""}`}>
                    <input type="date" defaultValue="" />
                    <input type="time" defaultValue="15:00" />
                    <MeetConfirmButton />
                  </div>
                </div>

                <div className="actions">
                  <button className="btn btn-approve" onClick={approve}>
                    Aprobar y enviar
                  </button>
                  <button className="btn btn-skip" onClick={skip}>
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
                  <span className="name">{selectedItem.name}</span>
                  <span className="sub">{selectedItem.contactSub}</span>
                </div>
                <div>
                  <span className="block-label">Historial reciente</span>
                  <div className="history-list">
                    {selectedItem.history.map((h, i) => (
                      <div className="history-item" key={i}>
                        <span className="h-when">{h.when}</span>
                        <span className="h-text">{h.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <span className="block-label">Estado de la cola</span>
                  <div className="stat-row">
                    <span>Pendientes hoy</span>
                    <span>{pendingLeft}</span>
                  </div>
                  <div className="stat-row">
                    <span>Aprobados hoy</span>
                    <span>{approvedCount}</span>
                  </div>
                  <div className="stat-row">
                    <span>Descartados hoy</span>
                    <span>{skippedCount}</span>
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

function MeetConfirmButton() {
  const [label, setLabel] = useState("Crear evento + Meet");
  return (
    <button
      className="btn btn-approve"
      onClick={() => {
        setLabel("Evento creado");
        setTimeout(() => setLabel("Crear evento + Meet"), 1800);
      }}
    >
      {label}
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
  const [notes, setNotes] = useState(contact.notes);
  return (
    <div className="contact-edit-card">
      <div className="cec-top">
        <div>
          <div className="cec-name">{contact.name}</div>
          <div className="cec-sub">{contact.sub}</div>
        </div>
        <div className="cec-channels">
          {contact.channels.map((ch) => (
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
