import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tamtam Agents",
  description:
    "AI multi-agent system for Tamtam — Lupandu SARL's WhatsApp Status influencer marketing platform.",
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-screen bg-tamtam text-white antialiased">
        {children}
      </body>
    </html>
  );
}
