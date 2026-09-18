"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ProviderState = {
  status: "available" | "provider_unavailable" | "credits_exhausted" | "not_configured" | null;
  checking: boolean;
};

function ProviderHeaderState() {
  const [provider, setProvider] = useState<ProviderState>({ status: null, checking: true });

  useEffect(() => {
    const update = (event: Event) => setProvider((event as CustomEvent<ProviderState>).detail);
    window.addEventListener("heatshift:provider-status", update);
    return () => window.removeEventListener("heatshift:provider-status", update);
  }, []);

  const live = provider.status === "available" && !provider.checking;
  const reason = provider.status === "credits_exhausted"
    ? "FortyGuard credits are exhausted. New-site conditions are simulated."
    : provider.status === "not_configured"
      ? "FortyGuard credentials are unavailable. New-site conditions are simulated."
      : "FortyGuard could not be reached securely. New-site conditions are simulated.";

  return <div className={`console-provider-state ${live ? "live" : provider.status ? "fallback" : "checking"}`} role="status" aria-live="polite">
    <i />
    <span>
      <strong>{live ? "FortyGuard live" : provider.checking || !provider.status ? "Checking FortyGuard" : "Simulated run"}</strong>
      <small>{live ? "The data provider responded successfully." : provider.checking || !provider.status ? "Confirming provider availability." : reason}</small>
    </span>
    {!live && provider.status && <button type="button" disabled={provider.checking} onClick={() => window.dispatchEvent(new Event("heatshift:provider-retry"))}>{provider.checking ? "Checking…" : "Retry"}</button>}
  </div>;
}

export default function ProductHeader({ consoleMode = false }: { consoleMode?: boolean }) {
  return (
    <header className={`product-header${consoleMode ? " console-header" : ""}`}>
      <Link className="brand" href="/" aria-label="HeatShift AI home"><span className="brand-mark"><i /><b>H</b></span><span><strong>HeatShift AI</strong><small>Industrial heat operations</small></span></Link>
      {consoleMode ? <><ProviderHeaderState /><nav className="console-header-actions" aria-label="Console actions">
        <Link className="console-home-link" href="/"><span>←</span> Homepage</Link>
        <button type="button" onClick={() => window.dispatchEvent(new Event("heatshift:open-guide"))}>Guide <span>?</span></button>
        <button className="console-reset-button" type="button" onClick={() => window.dispatchEvent(new Event("heatshift:reset-request"))}>Reset defaults <span>↺</span></button>
      </nav></> : <nav aria-label="Primary navigation"><Link href="/#what-it-does">Overview</Link><Link href="/#method">How it works</Link><Link href="/#research">Research</Link><Link className="nav-console" href="/console">Console <span>↗</span></Link></nav>}
    </header>
  );
}
