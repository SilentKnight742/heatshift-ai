import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://heatshift-ai-zeta.vercel.app"),
  title: "HeatShift AI · Plan the work. Respect the heat.",
  description: "Evidence-led industrial heat screening and constraint-aware shift planning.",
  openGraph: {
    title: "HeatShift AI · Plan the work. Respect the heat.",
    description: "Evidence-led industrial heat screening and constraint-aware shift planning.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "HeatShift AI — Plan the work. Respect the heat." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HeatShift AI · Plan the work. Respect the heat.",
    description: "Evidence-led industrial heat screening and constraint-aware shift planning.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
