"use client";

import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Header } from "@/components/markdown-file-card";

interface TitlebarHeaderProps {
  isLoadingMetadata: boolean;
  showSearch: boolean;
  setShowSearch: (show: boolean) => void;
  handleScrollToDate: (date: Date) => void;
  folderPath: string;
}

export function TitlebarHeader({
  isLoadingMetadata,
  showSearch,
  setShowSearch,
  handleScrollToDate,
  folderPath,
}: TitlebarHeaderProps) {
  const appWindow = getCurrentWindow();

  const { data: isFocused } = useQuery<boolean>({
    queryKey: ["isFocused"],
    queryFn: async () => {
      return await appWindow.isFocused();
    },
  });

  const titlebarClasses = [
    "backdrop-blur",
    "bg-background/60",
    "border-b",
    "border-border/50",
    "drag",
    "fixed",
    "h-10",
    "inset-x-0",
    "supports-[backdrop-filter]:bg-background/40",
    "top-0",
    "z-60",
  ].join(" ");

  return (
    <div data-tauri-drag-region className={titlebarClasses}>
      <div className="flex h-full w-full items-center justify-between px-4">
        {!isLoadingMetadata && (
          <div className="flex flex-shrink-0 items-center gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Close window"
                className="h-2.5 w-2.5 rounded-full bg-red-500"
                onClick={() => appWindow.close()}
              />
              <button
                type="button"
                aria-label="Minimize window"
                className="h-2.5 w-2.5 rounded-full bg-yellow-500"
                onClick={() => appWindow.minimize()}
              />
              <button
                type="button"
                aria-label="Maximize window"
                className="h-2.5 w-2.5 rounded-full bg-green-500"
                onClick={() => appWindow.toggleMaximize()}
              />
            </div>
          </div>
        )}

        {/* Center drag region */}
        <div data-tauri-drag-region className="drag h-full flex-1" />

        <div className="flex items-center justify-end">
          <Header
            onScrollToDate={handleScrollToDate}
            folderPath={folderPath}
            showSearch={showSearch}
            setShowSearch={setShowSearch}
          />
        </div>
      </div>
    </div>
  );
}
