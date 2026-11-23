import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Segment Manager",
  description: "Internal API that validates, translates and policy-checks publisher targeting segments. Prototype with synthetic data.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
