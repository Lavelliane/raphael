import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUp,
  Brain,
  ChatCircleDots,
  CheckCircle,
  CaretDown,
  CaretRight,
  Desktop,
  FileCode,
  FolderSimple,
  GearSix,
  GitBranch,
  Hash,
  Headphones,
  Lightning,
  MagnifyingGlass,
  NotePencil,
  Paperclip,
  Plus,
  SidebarSimple,
  SlidersHorizontal,
  Slideshow,
  Sparkle,
  Square,
  TextAlignLeft,
  Waveform,
} from "@phosphor-icons/react";
import { Avatar, personas } from "./icons";
import {
  AudioDialog,
  Dialog,
  FolderDialog,
  ModelOptions,
  Settings,
} from "./Dialogs";
import { exampleTurns, examples } from "./example";
import {
  leaf,
  message,
  request,
  useMeeting,
  type Action,
  type Card,
  type Turn,
} from "./meeting";

type Modal = "settings" | "audio" | "folder" | "new" | "source" | null;
type Filter = "all" | "transcript" | "assistant";
const actions: { key: Action; label: string; icon: typeof Brain }[] = [
  { key: "answer", label: "Answer question", icon: ChatCircleDots },
  { key: "check", label: "Check claim", icon: CheckCircle },
  { key: "explain", label: "Explain", icon: TextAlignLeft },
  { key: "insight", label: "Suggest a follow-up", icon: Lightning },
  { key: "diagram", label: "Draw diagram", icon: GitBranch },
];
const kindNames: Record<string, string> = {
  answer: "Suggested answer",
  check: "Claim check",
  correction: "Claim check",
  possible_correction: "Possible correction",
  explain: "Explanation",
  insight: "Follow-up",
  followup: "Follow-up",
  diagram: "Diagram",
  ask: "Answer",
};
const clock = (n: number) =>
  [Math.floor(n / 60), Math.floor(n % 60)]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
function Tool({
  label,
  children,
  click,
  selected,
  disabled,
}: {
  label: string;
  children: ReactNode;
  click: () => void;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={"icon " + (selected ? "picked" : "")}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={click}
    >
      {children}
    </button>
  );
}
function Reply({
  card,
  avatar,
  openSource,
}: {
  card: Card;
  avatar: string;
  openSource: (card: Card) => void;
}) {
  return (
    <section className="reply">
      <div className="author">
        <span className="face">
          <Avatar name={avatar} size={17} />
        </span>
        <b>Raphael</b>
        <span className="dot">·</span>
        {kindNames[card.kind] || "Insight"}
      </div>
      <h3>{card.title}</h3>
      <p>{card.body}</p>
      {!!card.nodes?.length && (
        <div className="diagram">
          {card.nodes.map((n, i) => (
            <span key={i}>
              {i > 0 && <ArrowRight />}
              <code>{n}</code>
            </span>
          ))}
        </div>
      )}
      {card.source && (
        <button className="citation" onClick={() => openSource(card)}>
          <FileCode />
          {card.source}
        </button>
      )}
    </section>
  );
}

export default function App() {
  const m = useMeeting();
  const [example, setExample] = useState(!window.raphael),
    [sidebar, left] = useState(true),
    [context, right] = useState(true),
    [filter, setFilter] = useState<Filter>("all");
  const [query, search] = useState(""),
    [draft, write] = useState(""),
    [modal, setModal] = useState<Modal>(null),
    [menu, setMenu] = useState<"actions" | "view" | null>(null);
  const [extra, addExtra] = useState<Card[]>([]),
    [excerpt, setExcerpt] = useState(""),
    [sourceTitle, setSourceTitle] = useState("");
  const searchBox = useRef<HTMLInputElement>(null),
    composer = useRef<HTMLTextAreaElement>(null),
    log = useRef<HTMLDivElement>(null),
    follow = useRef(true),
    sourceVersion = useRef(0);
  const isMac = window.raphael?.platform === "darwin";
  const turns = example ? exampleTurns : m.live.turns,
    start = example ? 0 : m.live.started || 0;
  const cards = example
    ? [examples.explain, examples.answer, examples.insight, ...extra]
    : [...m.live.copilot.cards, ...m.manual];
  const folder = example ? "checkout-service" : m.prefs.folder;
  const title = example ? "Refactoring review" : "Live session";
  const topics = example
    ? ["codebase refactoring", "architecture", "software design"]
    : m.prefs.topics;
  const enabled = m.live.active ? m.live.copilot.enabled : m.prefs.handsFree;
  const entries = [
    ...(filter === "assistant"
      ? []
      : turns.map((t) => ({ type: "turn" as const, data: t }))),
    ...(filter === "transcript"
      ? []
      : cards.map((c) => ({ type: "card" as const, data: c }))),
  ].sort((a, b) => a.data.timestamp - b.data.timestamp);
  const error =
    m.notice ||
    (!example && (m.live.error || m.live.copilot.error || m.connection)) ||
    "";
  const subtitle = example
    ? "Scripted session"
    : m.live.active
      ? "Listening"
      : m.live.started
        ? "Stopped"
        : "Standby";
  function handle(task: Promise<unknown>) {
    void task.catch((e) => m.setNotice(message(e)));
  }
  function switchTo(demo: boolean) {
    if (demo && m.live.active) {
      m.setNotice("Stop listening before opening the example.");
      return;
    }
    setExample(demo);
    setMenu(null);
    setFilter("all");
    write("");
    follow.current = true;
    m.setNotice("");
  }
  async function newSession() {
    if (window.raphael) await m.reset();
    switchTo(false);
    setModal(null);
    search("");
  }
  function beginNew() {
    if (m.live.started || m.manual.length || m.live.active) setModal("new");
    else handle(newSession());
  }
  function audio() {
    if (m.live.active) {
      handle(m.stop());
    } else setModal("audio");
  }
  function openSource(card: Card) {
    const v = ++sourceVersion.current;
    setModal("source");
    setSourceTitle(card.source || "Source");
    setExcerpt("Loading excerpt…");
    request<{ excerpt: string }>("source", {
      folder: card.folder,
      source: card.source,
    })
      .then((r) => {
        if (v === sourceVersion.current) setExcerpt(r.excerpt);
      })
      .catch((e) => {
        if (v === sourceVersion.current) setExcerpt(message(e));
      });
  }
  async function send(action: Action) {
    setMenu(null);
    const q = action === "ask" ? draft.trim() : "";
    if (action === "ask" && !q) return;
    if (example) {
      addExtra((old) => [
        ...old,
        { ...examples[action], timestamp: 30 + old.length },
      ]);
      write("");
    } else {
      await m.ask(action, q);
      if (action === "ask") write("");
    }
    if (filter === "transcript") setFilter("all");
    follow.current = true;
  }
  useEffect(() => {
    if (follow.current && log.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [turns.length, cards.length, filter, example]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        left(true);
        requestAnimationFrame(() => searchBox.current?.focus());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setModal("settings");
      }
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-menu]")) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);
  const matches = (s: string) =>
    s.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <div
      className={[
        "app",
        sidebar ? "with-sidebar" : "",
        context ? "with-context" : "",
        isMac ? "mac" : "",
      ].join(" ")}
    >
      {sidebar && (
        <aside className="rail">
          <div className="rail-title drag">
            <Tool label="Hide sidebar" click={() => left(false)}>
              <SidebarSimple />
            </Tool>
            <span className="brand">Raphael</span>
          </div>
          <div className="rail-tools">
            <MagnifyingGlass />
            <input
              ref={searchBox}
              aria-label="Search sessions"
              placeholder="Search sessions"
              value={query}
              onChange={(e) => search(e.target.value)}
            />
            <Tool label="New session" click={beginNew}>
              <NotePencil />
            </Tool>
          </div>
          <div className="session-list">
            {matches("Live session " + leaf(m.prefs.folder)) && (
              <button
                className={"session " + (!example ? "current" : "")}
                onClick={() => switchTo(false)}
              >
                <span className="session-meta">
                  <span className="monogram">
                    <Waveform />
                  </span>
                  {leaf(m.prefs.folder)}
                  <small>{m.live.active ? "Live" : "Local"}</small>
                </span>
                <strong>Live session</strong>
                <span className="session-foot">
                  {m.live.active
                    ? "Listening"
                    : m.live.started
                      ? "Stopped"
                      : "Ready to listen"}
                  <Waveform />
                </span>
              </button>
            )}
            {matches("Example Refactoring review checkout-service") && (
              <button
                className={"session " + (example ? "current" : "")}
                onClick={() => switchTo(true)}
              >
                <span className="session-meta">
                  <span className="monogram">CS</span>checkout-service
                  <small>Example</small>
                </span>
                <strong>Refactoring review</strong>
                <span className="session-foot">
                  Architecture discussion
                  <ChatCircleDots />
                </span>
              </button>
            )}
            {!matches("Live session " + leaf(m.prefs.folder)) &&
              !matches("Example Refactoring review checkout-service") && (
                <p className="quiet">No matching sessions.</p>
              )}
          </div>
          <div className="rail-bottom">
            <div className="statusline">
              <span className={"status-dot " + (m.live.active ? "on" : "")} />
              {m.live.active ? "Listening" : "Local workspace"}
            </div>
            <div className="profile-row">
              <Tool label="Settings" click={() => setModal("settings")}>
                <GearSix />
              </Tool>
              <span className="profile-name">
                {personas[m.prefs.personality] || "Great Sage"}
              </span>
              <button
                className="profile-pic"
                aria-label="Assistant preferences"
                onClick={() => setModal("settings")}
              >
                <Avatar name={m.prefs.avatar} />
              </button>
            </div>
          </div>
        </aside>
      )}
      <header className="topbar drag">
        {!sidebar && (
          <Tool label="Show sidebar" click={() => left(true)}>
            <SidebarSimple />
          </Tool>
        )}
        <span className="crumb-project">
          <span className="monogram">
            {folder ? leaf(folder).slice(0, 2).toUpperCase() : "R"}
          </span>
          {folder ? leaf(folder) : "Workspace"}
        </span>
        <span className="slash">/</span>
        <b>{title}</b>
        <div className="top-tools">
          <div className="menu-anchor" data-menu>
            <Tool
              label="Conversation view"
              selected={menu === "view" || filter !== "all"}
              click={() => setMenu(menu === "view" ? null : "view")}
            >
              <Slideshow />
            </Tool>
            {menu === "view" && (
              <div className="popup view-popup">
                {(["all", "transcript", "assistant"] as Filter[]).map(
                  (id, i) => (
                    <button
                      key={id}
                      onClick={() => {
                        setFilter(id);
                        setMenu(null);
                      }}
                    >
                      {["Conversation", "Transcript only", "Raphael only"][i]}
                      {filter === id && <CheckCircle />}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
          <Tool
            label={context ? "Hide session context" : "Show session context"}
            selected={context}
            click={() => right(!context)}
          >
            <SidebarSimple mirrored />
          </Tool>
        </div>
      </header>
      <main className="body">
        <section className="center">
          <div
            ref={log}
            className="reading"
            onScroll={(e) => {
              const el = e.currentTarget;
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 55;
            }}
          >
            <div className="reading-inner">
              {entries.length > 0 ? (
                <>
                  <div className="log-heading">
                    <span>
                      {filter === "all"
                        ? "Conversation"
                        : filter === "assistant"
                          ? "Raphael"
                          : "Transcript"}
                    </span>
                    <span>{example ? "Example · EN / TL" : "EN / TL"}</span>
                  </div>
                  {entries.map(({ type, data }) =>
                    type === "turn" ? (
                      <div className="turn" key={"t" + (data as Turn).id}>
                        <time>
                          {clock(Math.max(0, data.timestamp - start))}
                        </time>
                        <p>{(data as Turn).text}</p>
                      </div>
                    ) : (
                      <Reply
                        key={"c" + data.timestamp + (data as Card).title}
                        card={data as Card}
                        avatar={m.prefs.avatar}
                        openSource={openSource}
                      />
                    ),
                  )}
                </>
              ) : (
                <div className="empty">
                  <div className="empty-mark">
                    <Waveform weight="light" />
                  </div>
                  <h1>
                    {m.live.active
                      ? "Listening to playback"
                      : filter !== "all"
                        ? "No " +
                          (filter === "assistant"
                            ? "suggestions"
                            : "transcript") +
                          " yet"
                        : "Live session"}
                  </h1>
                  <p>
                    {m.live.active
                      ? "Speech and short suggestions will appear here."
                      : filter !== "all"
                        ? "New meeting activity will appear here."
                        : "Listen to English and Tagalog from your system audio. Raphael can follow the discussion and suggest what to say next."}
                  </p>
                  {!m.live.active && !example && (
                    <div className="empty-actions">
                      <button className="primary" onClick={audio}>
                        <Headphones />
                        Start listening
                      </button>
                      <button
                        className="text-button"
                        onClick={() => switchTo(true)}
                      >
                        Open example
                        <CaretRight />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="dock">
            <div className="feedback" role="status">
              {error ||
                (!example && m.live.dropped
                  ? `Skipped ${m.live.dropped} audio segments`
                  : "") ||
                (!example && (m.asking || m.live.copilot.busy)
                  ? "Raphael is thinking…"
                  : "")}
            </div>
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault();
                handle(send("ask"));
              }}
            >
              <textarea
                ref={composer}
                aria-label="Ask Raphael"
                value={draft}
                placeholder="Ask Raphael about this session…"
                rows={2}
                maxLength={1600}
                onChange={(e) => write(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (!m.asking) handle(send("ask"));
                  }
                }}
              />
              <div className="composer-tools">
                <div className="menu-anchor" data-menu>
                  <Tool
                    label="Meeting actions"
                    selected={menu === "actions"}
                    click={() => setMenu(menu === "actions" ? null : "actions")}
                  >
                    <Plus />
                  </Tool>
                  {menu === "actions" && (
                    <div className="popup action-popup">
                      {actions.map(({ key, label, icon: Icon }) => (
                        <button
                          type="button"
                          key={key}
                          disabled={m.asking}
                          onClick={() => handle(send(key))}
                        >
                          <Icon />
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Tool
                  label="Attach workspace folder"
                  disabled={example}
                  click={() => setModal("folder")}
                >
                  <Paperclip />
                </Tool>
                <span className="spacer" />
                <label className="model-select">
                  <Brain />
                  <span>
                    {m.prefs.model === "fast"
                      ? m.models.fast || "Fast model"
                      : m.prefs.model === "default"
                        ? "Codex default"
                        : m.prefs.model}
                  </span>
                  <CaretDown size={11} />
                  <select
                    aria-label="Codex model"
                    value={m.prefs.model}
                    onChange={(e) =>
                      handle(m.update({ model: e.target.value }))
                    }
                  >
                    <ModelOptions m={m} />
                  </select>
                </label>
                <Tool
                  label={m.live.active ? "Stop listening" : "Start listening"}
                  disabled={m.transition}
                  selected={m.live.active}
                  click={audio}
                >
                  {m.live.active ? <Square weight="fill" /> : <Headphones />}
                </Tool>
                <button
                  className="send"
                  disabled={!draft.trim() || m.asking}
                  aria-label="Send question"
                >
                  <ArrowUp weight="bold" />
                </button>
              </div>
            </form>
          </div>
        </section>
        {context && (
          <aside className="inspector">
            <div className="context-box">
              <div className="context-title">
                <Desktop />
                <b>Session context</b>
              </div>
              <button
                className="context-row"
                disabled={example}
                onClick={() => setModal("folder")}
              >
                <FolderSimple />
                <span>{folder ? leaf(folder) : "Attach workspace"}</span>
                <CaretRight />
              </button>
              <div className="context-row">
                <Waveform />
                <span>{example ? "Example recording" : "System playback"}</span>
                {m.live.active && !example && (
                  <meter
                    min={0}
                    max={1}
                    value={m.live.level}
                    aria-label="Playback level"
                  />
                )}
              </div>
              <div className="context-sep" />
              <button
                className="context-row"
                disabled={example}
                onClick={() => setModal("settings")}
              >
                <Hash />
                <span>Watch topics</span>
                <SlidersHorizontal />
              </button>
              <div className="topics">
                {topics.length ? (
                  topics.map((t) => <span key={t}>{t}</span>)
                ) : (
                  <span>Any topic</span>
                )}
              </div>
              <div className="context-sep" />
              <button
                className="context-row"
                disabled={example}
                role="switch"
                aria-checked={enabled}
                aria-label="Hands-free assistance"
                onClick={() => handle(m.update({ handsFree: !enabled }))}
              >
                <Sparkle />
                <span>Hands-free</span>
                <span
                  className={"switch " + (enabled ? "checked" : "")}
                  aria-hidden="true"
                />
              </button>
              <div className="context-state">
                <span
                  className={
                    "status-dot " + (m.live.active && !example ? "on" : "")
                  }
                />
                {subtitle}
              </div>
            </div>
          </aside>
        )}
      </main>
      {modal === "settings" && <Settings m={m} close={() => setModal(null)} />}
      {modal === "audio" && (
        <AudioDialog
          m={m}
          close={() => setModal(null)}
          started={() => {
            switchTo(false);
            setModal(null);
          }}
        />
      )}
      {modal === "folder" && (
        <FolderDialog m={m} close={() => setModal(null)} />
      )}
      {modal === "source" && (
        <Dialog title={sourceTitle} close={() => setModal(null)}>
          <pre>{excerpt}</pre>
        </Dialog>
      )}
      {modal === "new" && (
        <Dialog title="New session" close={() => setModal(null)}>
          <p>
            Clear the current transcript and suggestions? Your workspace and
            preferences carry over.
          </p>
          <footer>
            <button onClick={() => setModal(null)}>Cancel</button>
            <button className="primary" onClick={() => handle(newSession())}>
              New session
            </button>
          </footer>
        </Dialog>
      )}
    </div>
  );
}
