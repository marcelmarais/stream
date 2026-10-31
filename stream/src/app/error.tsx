"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen w-screen items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-md flex-col gap-4">
        <h1 className="font-serif text-[32px] text-heading leading-[1.1]">
          Something went wrong
        </h1>
        <div className="rounded-sm border border-well-rule bg-well p-3">
          <code className="block break-words text-destructive text-xs">
            {error.message || "Unknown error"}
          </code>
          {error.digest && (
            <div className="mt-2 text-muted-foreground text-xs">
              Error ID: {error.digest}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button onClick={() => router.push("/")} variant="outline">
            Go to home
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          If this keeps happening, restart the app.
        </p>
      </div>
    </div>
  );
}
