"use client";

import { ArrowCounterClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <div className="flex min-h-screen w-screen items-center justify-center bg-stone-950 p-8">
      <Card className="w-full max-w-2xl border-stone-800 bg-stone-900">
        <CardHeader className="pb-4 text-center">
          <div className="mb-4 flex justify-center">
            <WarningIcon className="h-8 w-8" weight="duotone" />
          </div>
          <CardTitle className="text-2xl text-stone-100">
            Something went wrong
          </CardTitle>
          <CardDescription className="text-stone-400">
            An unexpected error occurred.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Error Details */}
          <div className="rounded-lg border border-stone-800 bg-stone-950 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-semibold text-stone-400 text-xs uppercase tracking-wide">
                Error Details
              </span>
            </div>
            <code className="block break-words font-mono text-destructive text-sm">
              {error.message || "Unknown error"}
            </code>
            {error.digest && (
              <div className="mt-2 text-stone-500 text-xs">
                Error ID: {error.digest}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button onClick={reset} className="flex-1 gap-2" size="lg">
              <ArrowCounterClockwiseIcon className="h-5 w-5" weight="bold" />
              Try Again
            </Button>
            <Button
              onClick={() => router.push("/")}
              variant="outline"
              className="flex-1"
              size="lg"
            >
              Go to Home
            </Button>
          </div>

          {/* Help Text */}
          <div className="text-center text-sm text-stone-500">
            If this problem persists, try restarting the application.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
