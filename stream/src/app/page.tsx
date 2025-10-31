"use client";

import { useSearchParams } from "next/navigation";
import { FolderSelectionScreen } from "@/components/views/folder-selection";

export default function Home() {
  const searchParams = useSearchParams();
  // Disable auto-navigate if coming back from browse page
  const autoNavigate = searchParams.get("back") !== "true";

  return (
    <div className="min-h-screen w-screen">
      <FolderSelectionScreen autoNavigate={autoNavigate} />
    </div>
  );
}
