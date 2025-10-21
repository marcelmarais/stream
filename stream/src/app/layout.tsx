import type { Metadata } from "next";
import { Fira_Code, Inter } from "next/font/google";
import { ApiKeyInitializer } from "@/components/api-key-initializer";
import { AutoUpdater } from "@/components/auto-updater";
import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const firaCode = Fira_Code({
  variable: "--font-fira-code",
  subsets: ["latin"],
});

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
        className={`${inter.variable} ${firaCode.variable} optimizeLegibility antialiased`}
      >
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem={false}
            disableTransitionOnChange
          >
            <ApiKeyInitializer />
            {children}
            <Toaster />
            <AutoUpdater />
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
