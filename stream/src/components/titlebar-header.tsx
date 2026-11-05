"use client";

import { ArrowLeft } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { HeaderActions, SearchButton } from "@/components/markdown-file-card";

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
  return (
    <div
      data-tauri-drag-region
      className="drag fixed inset-x-0 top-0 z-40 flex h-9 items-center gap-4 bg-background px-3 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-6 after:bg-linear-to-b after:from-background after:to-transparent"
    >
      <div
        data-tauri-drag-region
        className="drag flex w-[clamp(6rem,24vw,10rem)] shrink-0 items-center gap-2 pl-18"
      >
        {onBack && (
          <button
            type="button"
            className="no-drag flex h-6 items-center gap-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" />
            {backLabel || "Back"}
          </button>
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
