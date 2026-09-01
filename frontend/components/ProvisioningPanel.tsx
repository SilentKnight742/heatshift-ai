"use client";

import { useEffect, useRef, useState } from "react";
import { weeklyApi, type AuthSession, type ProvisionStatus, type WeeklySite, type WorkspaceState } from "@/lib/api";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const REQUEST_KEY = "heatshift-live-provision-v1";

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function ProvisioningPanel({ session, workspace, site, onReady }: {
  session: AuthSession;
  workspace: WorkspaceState;
  site: WeeklySite;
  onReady: (siteId: string) => Promise<void>;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const widgetHost = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [token, setToken] = useState(session.mode === "local" ? `local-turnstile-test:${crypto.randomUUID()}` : "");
  const [status, setStatus] = useState<ProvisionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.mode === "local" || !siteKey || !widgetHost.current) return;
    let cancelled = false;
    const render = () => {
      if (cancelled || !widgetHost.current || !window.turnstile || widgetId.current) return;
      widgetId.current = window.turnstile.render(widgetHost.current, {
        sitekey: siteKey,
        action: "provision-site-week",
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(""),
        "error-callback": () => setError("Bot verification could not load. No provider request was submitted."),
      });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-heatshift-turnstile="true"]');
    if (existing) {
      if (window.turnstile) render(); else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true; script.defer = true; script.dataset.heatshiftTurnstile = "true";
      script.addEventListener("load", render, { once: true }); document.head.appendChild(script);
    }
    return () => { cancelled = true; if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current); widgetId.current = null; };
  }, [session.mode, siteKey, site.site_id]);

  const provision = async () => {
    if (!token) return;
    setBusy(true); setError(null);
    const saved = window.sessionStorage.getItem(REQUEST_KEY);
    let idempotencyKey = crypto.randomUUID();
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { siteId: string; weekStart: string; key: string };
        if (parsed.siteId === site.site_id && parsed.weekStart === workspace.week_start) idempotencyKey = parsed.key;
      } catch { window.sessionStorage.removeItem(REQUEST_KEY); }
    }
    window.sessionStorage.setItem(REQUEST_KEY, JSON.stringify({ siteId: site.site_id, weekStart: workspace.week_start, key: idempotencyKey }));
    try {
      let next = await weeklyApi.provision(session, site.site_id, token, idempotencyKey, workspace.week_start);
      setStatus(next);
      for (let attempt = 0; attempt < 180 && !["ready", "degraded", "failed"].includes(next.state); attempt += 1) {
        await sleep(next.state === "polling" ? 3000 : 900);
        next = await weeklyApi.provision(session, site.site_id, token, idempotencyKey, workspace.week_start);
        setStatus(next);
      }
      if (next.state === "ready" || next.state === "degraded") {
        window.sessionStorage.removeItem(REQUEST_KEY);
        await onReady(next.site_id);
      } else if (next.state === "failed") {
        setError(next.error || "Provider acquisition failed. Completed paid calls will not be repeated on a retry.");
      } else {
        setError("Provisioning is still running. You can safely resume this same request.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No provider request was submitted.");
    } finally {
      setBusy(false);
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      if (session.mode !== "local") setToken("");
    }
  };

  const completed = status?.completed_stages.filter((stage) => stage.startsWith("heatmap:") || stage.startsWith("environment:") || stage === "satellite").length || 0;
  const total = 15;
  return <section className="provision-panel" aria-label="Live FortyGuard site-week provisioning">
    <span className="provision-mark">FG</span>
    <div><span className="eyebrow">One protected live acquisition</span><h2>Fetch this exact site and week</h2><p>Seven 15:00 heatmaps, seven hourly environmental days and one satellite context request. Estimated <strong>64,240 credits</strong>; the server checks quota and preserves a 200,000-credit reserve before submitting anything.</p></div>
    {status && <div className="provision-progress" aria-live="polite"><div><i style={{ width: `${Math.min(100, completed / total * 100)}%` }} /></div><strong>{status.state}</strong><span>{completed} of {total} evidence stages complete</span></div>}
    {session.mode !== "local" && siteKey && <div ref={widgetHost} className="turnstile-host" />}
    {!siteKey && session.mode !== "local" && <p className="provision-warning">Turnstile is not configured. Live acquisition is fail-closed.</p>}
    {error && <p className="provision-error" role="alert">{error}</p>}
    <button type="button" disabled={busy || !token || workspace.live_site_weeks_remaining < 1} onClick={() => void provision()}>{busy ? "Acquiring evidence…" : workspace.live_site_weeks_remaining < 1 ? "Live allowance used" : "Provision this site-week"}</button>
    <small>Historical evidence only · 100m cells · no forecast · identical requests reuse their activity IDs</small>
  </section>;
}
