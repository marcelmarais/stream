"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function BrowseRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const pathParam = searchParams.get("path");

    if (!pathParam) {
      router.push("/");
      return;
    }

    const encodedPath = pathParam;
    router.push(`/browse/timeline?path=${encodedPath}`);
  }, [searchParams, router]);

  return null;
}

export default function BrowsePage() {
  return (
    <Suspense fallback={null}>
      <BrowseRedirect />
    </Suspense>
  );
}
