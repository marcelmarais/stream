import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { GeistSerif } from "geist/font/serif/variable";
import type { Metadata } from "next";
import { AutoUpdater } from "@/components/auto-updater";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stream",
  description: "Note taking for developers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} ${GeistSerif.variable} optimizeLegibility antialiased`}
      >
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            {children}
            <Toaster />
            <AutoUpdater />
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
