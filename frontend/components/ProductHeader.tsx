import Link from "next/link";

export default function ProductHeader({ consoleMode = false }: { consoleMode?: boolean }) {
  return (
    <header className={`product-header${consoleMode ? " console-header" : ""}`}>
      <Link className="brand" href="/" aria-label="HeatShift AI home"><span className="brand-mark"><i /><b>H</b></span><span><strong>HeatShift AI</strong><small>Industrial heat operations</small></span></Link>
      <nav aria-label="Primary navigation"><Link href="/">Evidence</Link><Link href="/#method">How it works</Link><Link className={consoleMode ? "nav-console active" : "nav-console"} href="/console">Console <span>↗</span></Link></nav>
    </header>
  );
}
