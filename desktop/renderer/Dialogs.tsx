import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, FolderOpen, Headphones, X } from "@phosphor-icons/react";
import { Avatar, avatars, personas } from "./icons";
import { message, request, type Meeting } from "./meeting";

export function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="dialog-inner">
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="Close" onClick={close}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Settings({ m, close }: { m: Meeting; close: () => void }) {
  const [draft, set] = useState({ ...m.prefs }),
    [topics, setTopics] = useState(draft.topics.join("\n")),
    [error, err] = useState(""),
    [saving, busy] = useState(false);
  return (
    <Dialog
      title="Session settings"
      close={() => {
        if (!saving) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          busy(true);
          try {
            await m.update({
              ...draft,
              topics: [
                ...new Set(
                  topics
                    .split(/[\n,]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                ),
              ].slice(0, 12),
            });
            close();
          } catch (e) {
            err(message(e));
          } finally {
            busy(false);
          }
        }}
      >
        <label>
          Watch topics
          <textarea
            rows={3}
            value={topics}
            onChange={(e) => setTopics(e.target.value)}
            placeholder="One topic per line"
          />
        </label>
        <div className="field-pair">
          <label>
            Personality
            <select
              value={draft.personality}
              onChange={(e) => set({ ...draft, personality: e.target.value })}
            >
              {Object.entries(personas).map(([v, s]) => (
                <option key={v} value={v}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            Codex model
            <select
              value={draft.model}
              onChange={(e) => set({ ...draft, model: e.target.value })}
            >
              <ModelOptions m={m} />
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Avatar</legend>
          <div className="avatar-list">
            {Object.entries(avatars).map(([id, name]) => (
              <button
                aria-pressed={draft.avatar === id}
                type="button"
                key={id}
                onClick={() => set({ ...draft, avatar: id })}
              >
                <Avatar name={id} />
                {name}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.handsFree}
            onChange={(e) => set({ ...draft, handsFree: e.target.checked })}
          />
          Hands-free assistance
        </label>
        <p className="hint">
          Recent speech and relevant workspace context go to Codex when
          assistance is enabled.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button disabled={saving} className="primary" type="submit">
            <Check />
            Save settings
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function ModelOptions({ m }: { m: Meeting }) {
  return (
    <>
      <option value="fast">
        Fast{m.models.fast ? " · " + m.models.fast : ""}
      </option>
      <option value="default">Codex default</option>
      {!["fast", "default"].includes(m.prefs.model) &&
        !m.models.models.some((x) => x.id === m.prefs.model) && (
          <option value={m.prefs.model}>{m.prefs.model} (unavailable)</option>
        )}
      {m.models.models.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
        </option>
      ))}
    </>
  );
}
export function AudioDialog({
  m,
  close,
  started,
}: {
  m: Meeting;
  close: () => void;
  started: () => void;
}) {
  const [devices, setDevices] = useState<{ id: string; name: string }[]>([]),
    [device, setDevice] = useState(""),
    [auto, setAuto] = useState(m.prefs.handsFree);
  const [error, err] = useState(""),
    [loading, wait] = useState(true),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    wait(true);
    err("");
    request<typeof devices>("devices")
      .then((ds) => {
        if (!active) return;
        setDevices(ds);
        setDevice(
          ds.find((d) => d.id === m.prefs.device)?.id || ds[0]?.id || "",
        );
        if (!ds.length)
          err("No playback device found. Check the system audio setup.");
      })
      .catch((e) => {
        if (active) err(message(e));
      })
      .finally(() => {
        if (active) wait(false);
      });
    return () => {
      active = false;
    };
  }, [retry, m.prefs.device]);
  return (
    <Dialog
      title="Start listening"
      close={() => {
        if (!m.transition) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          err("");
          try {
            await m.start(device, auto);
            started();
          } catch (e) {
            err(message(e));
          }
        }}
      >
        <label>
          Playback device
          <select value={device} onChange={(e) => setDevice(e.target.value)}>
            {!device && (
              <option value="">
                {loading ? "Finding devices…" : "No device selected"}
              </option>
            )}
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          Hands-free assistance
        </label>
        <p className="hint">
          Whisper transcribes this output locally. Hands-free assistance sends
          recent speech to Codex. Let meeting participants know before starting.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          {!device && !loading && (
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Refresh devices
            </button>
          )}
          <button
            className="primary"
            disabled={!device || m.transition}
            type="submit"
          >
            <Headphones />
            {m.transition ? "Preparing Whisper…" : "Listen"}
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
export function FolderDialog({ m, close }: { m: Meeting; close: () => void }) {
  const [folder, set] = useState(m.prefs.folder),
    [error, err] = useState("");
  return (
    <Dialog title="Workspace folder" close={close}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const result = folder.trim()
              ? await request<{ path: string }>("folder", {
                  path: folder.trim(),
                })
              : { path: "" };
            await m.update({ folder: result.path });
            close();
          } catch (e) {
            err(message(e));
          }
        }}
      >
        <label>
          Local checkout or folder
          <input
            value={folder}
            placeholder="/path/to/project"
            onChange={(e) => set(e.target.value)}
          />
        </label>
        {window.raphael && (
          <button
            className="subtle"
            type="button"
            onClick={async () => {
              try {
                const path = await window.raphael!.chooseFolder();
                if (path) set(path);
              } catch (e) {
                err(message(e));
              }
            }}
          >
            <FolderOpen />
            Browse folders
          </button>
        )}
        <p className="hint">
          Codex can read this folder for answers. Clearing the path disconnects
          it.
        </p>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button className="primary">Apply</button>
        </footer>
      </form>
    </Dialog>
  );
}
