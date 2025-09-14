"use client";

import { useState } from "react";
import FileReaderScreen from "../components/FileReaderScreen";

import FolderSelectionScreen from "../components/FolderSelectionScreen";

export default function Home() {
  const [currentScreen, setCurrentScreen] = useState<
    "folder-selection" | "file-reader"
  >("folder-selection");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string>("");

  const handleFolderConfirmed = (folderPath: string) => {
    setSelectedFolderPath(folderPath);
    setCurrentScreen("file-reader");
  };

  const handleBackToFolderSelection = () => {
    setCurrentScreen("folder-selection");
  };

  return (
    <div className="min-h-screen w-screen">
      {currentScreen === "folder-selection" && (
        <FolderSelectionScreen onFolderConfirmed={handleFolderConfirmed} />
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
