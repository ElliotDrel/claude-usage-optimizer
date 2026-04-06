import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Claude Usage Tracker",
  description: "Track Claude.ai usage patterns and identify peak usage windows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
