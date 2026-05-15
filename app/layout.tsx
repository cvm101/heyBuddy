import type { Metadata } from "next";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import ErrorBoundary from "@/components/ErrorBoundary";

export const metadata: Metadata = {
  title: "Travel with Friends",
  description: "Live shared map, chat, and rest-point for friends on the move.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  );
}
