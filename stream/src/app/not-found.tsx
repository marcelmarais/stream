"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Titlebar } from "@/components/titlebar-header";

export default function NotFound() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home page after a brief delay
    const timeout = setTimeout(() => {
      router.push("/?back=true");
    }, 1000);

    return () => clearTimeout(timeout);
  }, [router]);

  return (
    <>
      <Titlebar isLoading={false} />
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-8 pt-9">
        <div className="w-full max-w-md space-y-8 text-center">
          <div className="space-y-2">
            <h1 className="cursor-default select-none font-serif text-[32px] text-heading">
              404 - Page Not Found
            </h1>
            <p className="cursor-default select-none text-muted-foreground">
              Redirecting to home page...
            </p>
          </div>
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      </div>
    </>
  );
}
