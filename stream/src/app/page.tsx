"use client";

import { useState } from "react";
import FolderSelectionScreen from "@/components/views/folder-selection";
import FileReaderScreen from "@/components/views/main";

export default function Home() {
  const [currentScreen, setCurrentScreen] = useState<
    "folder-selection" | "file-reader"
  >("folder-selection");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>("");
  const [allowAutoNavigate, setAllowAutoNavigate] = useState<boolean>(true);

  const handleFolderConfirmed = (folderPath: string) => {
    setSelectedFolderPath(folderPath);
    setCurrentScreen("file-reader");
    setAllowAutoNavigate(true); // Re-enable auto-navigate for next time
  };

  const handleBackToFolderSelection = () => {
    setCurrentScreen("folder-selection");
    setAllowAutoNavigate(false); // Disable auto-navigate when user goes back
  };

  return (
    <div className="min-h-screen w-screen">
      {currentScreen === "folder-selection" && (
        <FolderSelectionScreen
          onFolderConfirmed={handleFolderConfirmed}
          autoNavigate={allowAutoNavigate}
        />
      )}

      {currentScreen === "file-reader" && (
        <FileReaderScreen
          folderPath={selectedFolderPath}
          onBack={handleBackToFolderSelection}
        />
      )}
    </div>
  );
}
