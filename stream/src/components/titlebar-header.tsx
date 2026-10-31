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

  const handleClose = () => appWindow?.close();
  const handleMinimize = () => appWindow?.minimize();
  const handleMaximize = () => appWindow?.toggleMaximize();

  return (
    <div
      data-tauri-drag-region
      className="drag fixed inset-x-0 top-0 z-40 flex h-9 items-center gap-4 border-b bg-background px-3"
    >
      <div
        data-tauri-drag-region
        className="drag flex w-[clamp(6rem,24vw,10rem)] shrink-0 items-center gap-2"
      >
        <div className="group flex items-center gap-[7px]">
          <button
            type="button"
            aria-label="Close window"
            className="no-drag size-[9px] rounded-[2px] bg-rail group-hover:bg-red-500"
            onClick={handleClose}
          />
          <button
            type="button"
            aria-label="Minimize window"
            className="no-drag size-[9px] rounded-[2px] bg-rail group-hover:bg-yellow-500"
            onClick={handleMinimize}
          />
          <button
            type="button"
            aria-label="Maximize window"
            className="no-drag size-[9px] rounded-[2px] bg-rail group-hover:bg-green-500"
            onClick={handleMaximize}
          />
        </div>
        {onBack && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="no-drag"
            onClick={onBack}
            title={backLabel || "Back"}
          >
            <ArrowLeft />
          </Button>
        )}
      </div>

      <div
        data-tauri-drag-region
        className="drag flex min-w-0 flex-1 items-center justify-center"
      >
        {centerContent && !isLoading && centerContent}
      </div>

      <div
        data-tauri-drag-region
        className="drag flex w-[clamp(6rem,24vw,10rem)] shrink-0 items-center justify-end"
      >
        {actions && !isLoading && actions}
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
