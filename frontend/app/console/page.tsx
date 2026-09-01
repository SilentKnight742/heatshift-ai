import WeeklyConsole from "@/components/WeeklyConsole";
import ProductHeader from "@/components/ProductHeader";

export default function ConsolePage() {
  return (
    <main className="console-page">
      <ProductHeader consoleMode />
      <WeeklyConsole />
    </main>
  );
}
