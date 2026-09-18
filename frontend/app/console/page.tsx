import DailyConsole from "@/components/DailyConsole";
import ProductHeader from "@/components/ProductHeader";

export default function ConsolePage() {
  return (
    <main className="console-page">
      <ProductHeader consoleMode />
      <DailyConsole />
    </main>
  );
}
