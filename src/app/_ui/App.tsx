"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, signIn, ROLE_LABEL, type ApiResult, type Json, type Persona } from "./client";
import type { ReaderKey } from "./explain";
import { Overview } from "./views/Overview";
import { ReviewView } from "./views/Review";
import { PublishView } from "./views/Publish";
import { VerifyView } from "./views/Verify";
import { ActivityView } from "./views/Activity";
import { DeveloperView } from "./views/Developer";
import { GuidedDemo } from "./GuidedDemo";

export const PID = "pub_drivedesk";
export const OPS = "ops.drivedesk";
export const REVIEWER = "reviewer.drivedesk";

export type View = "overview" | "review" | "publish" | "verify" | "activity" | "developer";
const VIEWS: View[] = ["overview", "review", "publish", "verify", "activity", "developer"];

export interface Data {
  proposals: Json[];
  grant: Json | null;
  versions: Json[];
  activeVersion: number | null;
  audit: Json[];
  denied: { status: number; code: string; detail: string } | null;
}

interface Ctx {
  personas: Persona[];
  persona: Persona | null;
  switchTo: (persona: string) => Promise<boolean>;
  data: Data;
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Runs an action as the current persona and reports the result. */
  act: (label: string, fn: () => Promise<ApiResult>, needs?: string) => Promise<ApiResult>;
  busy: boolean;
  notice: Notice | null;
  setNotice: (n: Notice | null) => void;
  view: View;
  go: (v: View) => void;
  reader: ReaderKey;
  setReader: (r: ReaderKey) => void;
  dsp: string;
  setDsp: (d: string) => void;
  lastResolve: Json | null;
  setLastResolve: (r: Json | null) => void;
  seenScenarios: Set<string>;
  markScenario: (k: string) => void;
  demoOpen: boolean;
  setDemoOpen: (b: boolean) => void;
}

export interface Notice {
  tone: "ok" | "bad" | "info";
  text: string;
  /** Offer to switch to a persona that may do this. */
  switchTo?: string;
}

const AppContext = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppContext)!;

const EMPTY: Data = { proposals: [], grant: null, versions: [], activeVersion: null, audit: [], denied: null };

export function App({ personas, initialPersona, demoMode }: { personas: Persona[]; initialPersona: string | null; demoMode: boolean }) {
  const [personaKey, setPersonaKey] = useState<string | null>(initialPersona);
  const [data, setData] = useState<Data>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<View>("overview");
  const [reader, setReader] = useState<ReaderKey>("eu-consented");
  const [dsp, setDsp] = useState("ttd");
  const [lastResolve, setLastResolve] = useState<Json | null>(null);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [demoOpen, setDemoOpen] = useState(false);
  const started = useRef(false);

  const persona = useMemo(() => personas.find((p) => p.persona === personaKey) ?? null, [personas, personaKey]);

  const refresh = useCallback(async () => {
    const [p, g, v, a] = await Promise.all([
      api(`/v1/publishers/${PID}/proposals`),
      api(`/v1/publishers/${PID}/grant`),
      api(`/v1/publishers/${PID}/mapping-versions`),
      api(`/v1/publishers/${PID}/audit`),
    ]);
    const denied = !p.ok ? { status: p.status, code: p.data.code ?? "", detail: p.data.detail ?? "" } : null;
    setData({
      proposals: p.ok ? p.data.proposals : [],
      grant: g.ok ? g.data.grant : null,
      versions: v.ok ? v.data.versions : [],
      activeVersion: v.ok ? v.data.active_version : null,
      audit: a.ok ? a.data.events : [],
      denied,
    });
    setLoaded(true);
  }, []);

  const switchTo = useCallback(
    async (key: string) => {
      const r = await signIn(key);
      if (!r.ok) {
        setNotice({ tone: "bad", text: `Couldn't switch role: ${r.data.detail ?? r.status}` });
        return false;
      }
      setPersonaKey(key);
      await refresh();
      return true;
    },
    [refresh],
  );

  // First visit in demo mode: start as DriveDesk publisher ops so every screen has something to show.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const fromHash = (typeof window !== "undefined" ? window.location.hash.slice(1) : "") as View;
    if (VIEWS.includes(fromHash)) setView(fromHash);
    if (!initialPersona && demoMode) switchTo(OPS);
    else refresh();
  }, [initialPersona, demoMode, switchTo, refresh]);

  // Keep the view in step with the address bar (links, back and forward).
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.slice(1) as View;
      setView(VIEWS.includes(h) ? h : "overview");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    setNotice(null);
    if (typeof window !== "undefined") {
      if (window.location.hash !== `#${v}`) history.pushState(null, "", `#${v}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const act = useCallback(
    async (label: string, fn: () => Promise<ApiResult>, needs?: string) => {
      setBusy(true);
      setNotice(null);
      try {
        const r = await fn();
        if (r.ok) setNotice({ tone: "ok", text: label });
        else if (r.status === 403 || (r.status === 404 && r.data.code === "PUBLISHER_NOT_FOUND")) {
          setNotice({
            tone: "bad",
            text: `Your current role (${persona ? ROLE_LABEL[persona.role] ?? persona.role : "signed out"}) isn't allowed to do this. ${r.data.detail ?? ""}`,
            switchTo: needs,
          });
        } else setNotice({ tone: "bad", text: `${r.data.detail ?? "Something went wrong."}${r.data.code ? ` (${r.data.code})` : ""}` });
        await refresh();
        return r;
      } finally {
        setBusy(false);
      }
    },
    [persona, refresh],
  );

  const ctx: Ctx = {
    personas,
    persona,
    switchTo,
    data,
    loaded,
    refresh,
    act,
    busy,
    notice,
    setNotice,
    view,
    go,
    reader,
    setReader,
    dsp,
    setDsp,
    lastResolve,
    setLastResolve,
    seenScenarios: seen,
    markScenario: (k) => setSeen((s) => (s.has(k) ? s : new Set(s).add(k))),
    demoOpen,
    setDemoOpen,
  };

  return (
    <AppContext.Provider value={ctx}>
      <div className={`shell ${demoOpen ? "with-demo" : ""}`}>
        <TopBar demoMode={demoMode} />
        <div className="body">
          <SideNav />
          <main className="content" id="main">
            {notice && <NoticeBar />}
            {view === "overview" && <Overview />}
            {view === "review" && <ReviewView />}
            {view === "publish" && <PublishView />}
            {view === "verify" && <VerifyView />}
            {view === "activity" && <ActivityView />}
            {view === "developer" && <DeveloperView />}
          </main>
          {demoOpen && <GuidedDemo />}
        </div>
      </div>
    </AppContext.Provider>
  );
}

function NoticeBar() {
  const { notice, setNotice, switchTo, personas } = useApp();
  if (!notice) return null;
  const target = personas.find((p) => p.persona === notice.switchTo);
  return (
    <div className={`notice ${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
      <span>{notice.text}</span>
      <span className="row">
        {target && (
          <button className="btn small" onClick={() => switchTo(target.persona).then(() => setNotice({ tone: "info", text: `You're now ${target.displayName}. Try again.` }))}>
            Switch to {target.displayName}
          </button>
        )}
        <button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button>
      </span>
    </div>
  );
}

function TopBar({ demoMode }: { demoMode: boolean }) {
  const { persona, personas, switchTo, setDemoOpen, demoOpen, go } = useApp();
  return (
    <header className="topbar">
      <button className="brand" onClick={() => go("overview")}>
        <span className="logo" aria-hidden>SM</span>
        <span>
          <strong>Segment Manager</strong>
          <span className="brand-sub">Publisher: DriveDesk India <span className="tag synthetic">Synthetic</span></span>
        </span>
      </button>
      <div className="topbar-right">
        {demoMode && (
          <label className="role-select">
            <span className="muted small">Acting as</span>
            <select value={persona?.persona ?? ""} onChange={(e) => e.target.value && switchTo(e.target.value)} aria-label="Acting as">
              {!persona && <option value="">Signed out</option>}
              {personas.map((p) => (
                <option key={p.persona} value={p.persona}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {demoMode && (
          <button className={`btn ${demoOpen ? "" : "primary"}`} onClick={() => setDemoOpen(!demoOpen)}>
            {demoOpen ? "Hide guide" : "Start guided demo"}
          </button>
        )}
      </div>
    </header>
  );
}

function SideNav() {
  const { view, go, data } = useApp();
  const pending = data.proposals.filter((p) => p.status === "PENDING_REVIEW").length;
  const approved = data.proposals.filter((p) => p.status === "APPROVED").length;
  const live = data.activeVersion !== null;
  const stage = (v: View, n: number, label: string, hint: string, done: boolean, badge?: number) => (
    <button className={`nav-item stage ${view === v ? "active" : ""}`} onClick={() => go(v)} aria-current={view === v ? "page" : undefined}>
      <span className={`step-dot ${done ? "done" : ""}`}>{done ? "✓" : n}</span>
      <span className="nav-text">
        <span className="nav-label">{label}</span>
        <span className="nav-hint">{hint}</span>
      </span>
      {badge ? <span className="count">{badge}</span> : null}
    </button>
  );
  return (
    <nav className="sidenav" aria-label="Main">
      <button className={`nav-item ${view === "overview" ? "active" : ""}`} onClick={() => go("overview")}>
        <span className="nav-icon" aria-hidden>◎</span>
        <span className="nav-label">Overview</span>
      </button>
      <div className="nav-group">Workflow</div>
      {stage("review", 1, "Import & review", "Map signals to IAB", data.proposals.length > 0 && pending === 0, pending)}
      {stage("publish", 2, "Configure & publish", "Buyers, versions", live && approved > 0)}
      {stage("verify", 3, "Verify results", "What buyers receive", false)}
      <div className="nav-group">More</div>
      <button className={`nav-item ${view === "activity" ? "active" : ""}`} onClick={() => go("activity")}>
        <span className="nav-icon" aria-hidden>≡</span>
        <span className="nav-label">Activity log</span>
      </button>
      <button className={`nav-item ${view === "developer" ? "active" : ""}`} onClick={() => go("developer")}>
        <span className="nav-icon" aria-hidden>{"</>"}</span>
        <span className="nav-label">API & technical</span>
      </button>
    </nav>
  );
}

/** Shown when the current role can't read the publisher's workspace. */
export function AccessState() {
  const { data, persona, switchTo } = useApp();
  if (!data.denied) return null;
  return (
    <div className="empty">
      <h3>You can't view DriveDesk's workspace in this role</h3>
      <p className="muted">
        {persona ? `${persona.displayName} (${ROLE_LABEL[persona.role] ?? persona.role})` : "Signed-out visitors"} can't see DriveDesk&apos;s
        signals. The server enforces this; it isn&apos;t just hidden in the page.
      </p>
      <div className="row">
        <button className="btn primary" onClick={() => switchTo(OPS)}>Switch to DriveDesk publisher ops</button>
        <button className="btn" onClick={() => switchTo(REVIEWER)}>Switch to DriveDesk reviewer</button>
      </div>
    </div>
  );
}

/** A button for an action only certain roles may take. Others see why, and can switch. */
export function RoleButton({ role, children, onClick, className = "btn", disabled, title }: { role: "publisher_ops" | "reviewer"; children: React.ReactNode; onClick: () => void; className?: string; disabled?: boolean; title?: string }) {
  const { persona, switchTo, busy } = useApp();
  const allowed = persona?.role === role && persona.publishers.includes(PID);
  const target = role === "reviewer" ? REVIEWER : OPS;
  if (allowed) {
    return (
      <button className={className} onClick={onClick} disabled={busy || disabled} title={title}>
        {children}
      </button>
    );
  }
  return (
    <button
      className={`${className} needs-role`}
      disabled={busy || disabled}
      title={`Only a DriveDesk ${ROLE_LABEL[role]?.toLowerCase()} can do this. Click to switch role, then do it.`}
      onClick={async () => {
        if (await switchTo(target)) onClick();
      }}
    >
      {children}
      <span className="role-chip">as {ROLE_LABEL[role]}</span>
    </button>
  );
}

export function PageHeader({ step, title, lead, children }: { step?: string; title: string; lead: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        {step && <div className="eyebrow">{step}</div>}
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function Tag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
