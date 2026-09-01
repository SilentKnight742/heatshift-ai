import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://heatshift-ai-zeta.vercel.app"),
  title: "HeatShift AI · Move the work. Keep the shift.",
  description: "HeatShift turns real hyperlocal heat evidence and work constraints into a feasible, explainable shift plan.",
  openGraph: {
    title: "HeatShift AI · Move the work. Keep the shift.",
    description: "See which work should move, when it can move, and which heat risk still requires human action.",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "HeatShift AI — Plan the work. Respect the heat." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HeatShift AI · Move the work. Keep the shift.",
    description: "See which work should move, when it can move, and which heat risk still requires human action.",
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
