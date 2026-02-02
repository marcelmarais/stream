"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { HeaderActions, SearchButton } from "@/components/markdown-file-card";
import { Button } from "@/components/ui/button";

interface TitlebarProps {
  actions?: ReactNode;
  centerContent?: ReactNode;
  isLoading: boolean;
  onBack?: () => void;
  backLabel?: string;
}

interface TitlebarHeaderProps {
  isLoading: boolean;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
  handleScrollToDate?: (date: Date) => void;
  folderPath: string;
  onBack?: () => void;
  backLabel?: string;
}

export function Titlebar({
  actions,
  centerContent,
  isLoading,
  onBack,
  backLabel,
}: TitlebarProps) {
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
    "drag",
    "fixed",
    "h-14",
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
      <div className="flex h-full w-full items-center px-4 pt-1">
        {/* Left section - traffic lights and back button */}
        <div className="flex w-[200px] flex-shrink-0 items-center gap-2">
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
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              className="no-drag text-xs"
              onClick={onBack}
              title={backLabel || "Back"}
            >
              <ArrowLeft className="h-4 w-4" weight="bold" />
            </Button>
          )}
        </div>

        {/* Center section - search bar */}
        <div className="flex flex-1 items-center justify-center">
          {centerContent && !isLoading && centerContent}
        </div>

        {/* Right section - action buttons */}
        <div className="flex w-[200px] flex-shrink-0 items-center justify-end">
          {actions && !isLoading && actions}
        </div>
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
  onBack,
  backLabel,
}: TitlebarHeaderProps) {
  const centerContent = (
    <SearchButton showSearch={showSearch} setShowSearch={setShowSearch} />
  );

  const actions = handleScrollToDate ? (
    <HeaderActions
      onScrollToDate={handleScrollToDate}
      folderPath={folderPath}
    />
  ) : null;

  return (
    <Titlebar
      actions={actions}
      centerContent={centerContent}
      isLoading={isLoading}
      onBack={onBack}
      backLabel={backLabel}
    />
  );
}
