import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/lib/providers";
import { ToastContainer } from "@/components/ui/toast-container";
import "./globals.css";

export const metadata: Metadata = {
  title: "Paadi",
  description: "Split and settle bills together",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <ToastContainer />
      </body>
    </html>
  );
}