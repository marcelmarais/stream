"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useUserStore } from "@/stores/user-store";

function BrowseRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewMode = useUserStore((state) => state.viewMode);

  useEffect(() => {
    const pathParam = searchParams.get("path");

    if (!pathParam) {
      router.push("/");
      return;
    }

    // Redirect to the appropriate view based on user preference
    const encodedPath = pathParam; // Already encoded from URL
    router.push(`/browse/${viewMode}?path=${encodedPath}`);
  }, [searchParams, router, viewMode]);

  return null; // This component only redirects
}

export default function BrowsePage() {
  return (
    <Suspense fallback={null}>
      <BrowseRedirect />
    </Suspense>
  );
}
