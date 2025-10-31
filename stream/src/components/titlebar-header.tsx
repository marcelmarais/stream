"use client";

import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Header } from "@/components/markdown-file-card";

interface TitlebarProps {
  actions?: ReactNode;
  isLoading: boolean;
}

interface TitlebarHeaderProps {
  isLoading: boolean;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
  handleScrollToDate: (date: Date) => void;
  folderPath: string;
}

export function Titlebar({ actions, isLoading }: TitlebarProps) {
  const [appWindow, setAppWindow] = useState<Window | null>(null);

  useEffect(() => {
    // Only initialize the window reference in the browser
    if (typeof window !== "undefined") {
      setAppWindow(getCurrentWindow());
    }
  }, []);

  const titlebarClasses = [
    "backdrop-blur",
    "bg-background/60",
    actions && "border-b",
    "border-border/50",
    "drag",
    "fixed",
    "h-10",
    "inset-x-0",
    "supports-[backdrop-filter]:bg-background/40",
    "top-0",
    "z-60",
  ].join(" ");

  const handleClose = () => appWindow?.close();
  const handleMinimize = () => appWindow?.minimize();
  const handleMaximize = () => appWindow?.toggleMaximize();

  return (
    <div data-tauri-drag-region className={titlebarClasses}>
      <div className="flex h-full w-full items-center justify-between px-4">
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Close window"
              className="h-2.5 w-2.5 rounded-full bg-red-500"
              onClick={handleClose}
            />
            <button
              type="button"
              aria-label="Minimize window"
              className="h-2.5 w-2.5 rounded-full bg-yellow-500"
              onClick={handleMinimize}
            />
            <button
              type="button"
              aria-label="Maximize window"
              className="h-2.5 w-2.5 rounded-full bg-green-500"
              onClick={handleMaximize}
            />
          </div>
        </div>

        {/* Center drag region */}
        <div data-tauri-drag-region className="drag h-full flex-1" />

        {actions && !isLoading && (
          <div className="flex items-center justify-end">{actions}</div>
        )}
      </div>
    </div>
  );
}

export function TitlebarHeader({
  showSearch,
  setShowSearch,
  handleScrollToDate,
  folderPath,
  isLoading,
}: TitlebarHeaderProps) {
  const actions = (
    <Header
      onScrollToDate={handleScrollToDate}
      folderPath={folderPath}
      showSearch={showSearch}
      setShowSearch={setShowSearch}
    />
  );

  return <Titlebar actions={actions} isLoading={isLoading} />;
}
