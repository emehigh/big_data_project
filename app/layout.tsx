import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Big Data Image Processor",
  description: "Distributed image processing with parallel execution",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
