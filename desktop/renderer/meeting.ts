import { useEffect, useRef, useState } from "react";

export type Action =
  "answer" | "check" | "explain" | "insight" | "diagram" | "ask";
export type Preferences = {
  folder: string;
  topics: string[];
  personality: string;
  avatar: string;
  model: string;
  handsFree: boolean;
  device: string;
};
export type Turn = { id: number; timestamp: number; text: string };
export type Card = {
  title: string;
  body: string;
  source?: string;
  nodes?: string[];
  folder?: string;
  kind: string;
  timestamp: number;
  id?: number;
};
export type Snapshot = {
  active: boolean;
  turns: Turn[];
  started: number | null;
  error: string;
  level: number;
  dropped: number;
  copilot: { enabled: boolean; busy: boolean; error: string; cards: Card[] };
};
type Models = { models: { id: string; name: string }[]; fast: string };
declare global {
  interface Window {
    raphael?: {
      platform: string;
      request: (route: string, data?: unknown) => Promise<unknown>;
      chooseFolder: () => Promise<string | null>;
    };
  }
}
export const initial: Snapshot = {
  active: false,
  turns: [],
  started: null,
  error: "",
  level: 0,
  dropped: 0,
  copilot: { enabled: false, busy: false, error: "", cards: [] },
};
const defaults: Preferences = {
  folder: "",
  topics: ["codebase refactoring", "architecture", "software design"],
  personality: "sage",
  avatar: "sage",
  model: "fast",
  handsFree: true,
  device: "",
};
function load(): Preferences {
  try {
    return {
      ...defaults,
      ...JSON.parse(
        localStorage.getItem("raphael.desktop.preferences") || "{}",
      ),
    };
  } catch {
    return defaults;
  }
}
export function message(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    "",
  );
}
export async function request<T>(
  route: string,
  data: unknown = {},
): Promise<T> {
  if (!window.raphael)
    throw Error("Open the desktop app to use live audio and Codex.");
  return (await window.raphael.request(route, data)) as T;
}
function config(p: Preferences) {
  return {
    enabled: p.handsFree,
    folder: p.folder,
    topics: p.topics,
    personality: p.personality,
    model: p.model,
  };
}
export const leaf = (folder: string) =>
  folder.split(/[\\/]/).filter(Boolean).at(-1) || "Workspace";

export function useMeeting() {
  const [prefs, setPrefs] = useState(load);
  const [live, setLive] = useState<Snapshot>(initial);
  const [manual, setManual] = useState<Card[]>([]);
  const [models, setModels] = useState<Models>({ models: [], fast: "" });
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("");
  const [asking, setAsking] = useState(false);
  const [transition, setTransition] = useState(false);
  const revision = useRef(0),
    session = useRef(0),
    liveRef = useRef(live),
    prefsRef = useRef(prefs);
  function publish(state: Snapshot) {
    revision.current++;
    liveRef.current = state;
    setLive(state);
  }
  useEffect(() => {
    if (!window.raphael) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const seq = revision.current;
      try {
        const state = await request<Snapshot>("state");
        if (!cancelled && seq === revision.current) {
          liveRef.current = state;
          setLive(state);
          setConnection("");
        }
      } catch (e) {
        if (!cancelled) setConnection(message(e));
      }
      if (!cancelled) timer = setTimeout(poll, 800);
    }
    void poll();
    request<Models>("models")
      .then((m) => {
        if (!cancelled) setModels(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  function store(next: Preferences) {
    prefsRef.current = next;
    setPrefs(next);
    localStorage.setItem("raphael.desktop.preferences", JSON.stringify(next));
  }
  async function update(patch: Partial<Preferences>) {
    const next = { ...prefsRef.current, ...patch };
    if (liveRef.current.active)
      publish(await request<Snapshot>("assistant", config(next)));
    store(next);
  }
  async function start(device: string, handsFree: boolean) {
    const next = { ...prefsRef.current, device, handsFree };
    setTransition(true);
    try {
      publish(
        await request<Snapshot>("start", { device, assistant: config(next) }),
      );
      store(next);
      setNotice("");
    } finally {
      setTransition(false);
    }
  }
  async function stop() {
    setTransition(true);
    try {
      publish(await request<Snapshot>("stop"));
    } finally {
      setTransition(false);
    }
  }
  async function reset() {
    publish(await request<Snapshot>("new"));
    session.current++;
    setManual([]);
    setAsking(false);
    setNotice("");
  }
  async function ask(action: Action, question: string) {
    if (asking) return;
    if (!question && !live.turns.length)
      throw Error("Start listening or type a question first.");
    setAsking(true);
    setNotice("");
    const epoch = session.current,
      folder = prefs.folder;
    try {
      const result = await request<Card>("answer", {
        action,
        question,
        turns: live.turns.slice(-12).map((t) => t.text),
        ...config(prefs),
      });
      if (epoch === session.current)
        setManual((old) =>
          [...old, { ...result, folder, timestamp: Date.now() / 1000 }].slice(
            -50,
          ),
        );
    } finally {
      if (epoch === session.current) setAsking(false);
    }
  }
  return {
    live,
    prefs,
    manual,
    models,
    notice,
    setNotice,
    connection,
    asking,
    transition,
    update,
    start,
    stop,
    reset,
    ask,
  };
}
export type Meeting = ReturnType<typeof useMeeting>;
