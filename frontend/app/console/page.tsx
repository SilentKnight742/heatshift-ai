import ConsoleWorkspace from "@/components/ConsoleWorkspace";
import ProductHeader from "@/components/ProductHeader";

export default function ConsolePage() {
  return (
    <main className="console-page">
      <ProductHeader consoleMode />
      <ConsoleWorkspace />
    </main>
  );
}
