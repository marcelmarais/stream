"use client";

import {
  ArrowClockwise,
  DotsThreeVertical,
  FileText,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EditFileDialog } from "@/components/edit-file-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useRefreshFile,
  useUpdateStructuredFileMetadata,
  useUpdateStructuredFileRefreshInterval,
} from "@/hooks/use-markdown-queries";
import type { StructuredMarkdownFile } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";
import { useRefreshStore } from "@/stores/refresh-store";

interface StructuredFileCardProps {
  file: StructuredMarkdownFile;
  folderPath: string;
  onDelete: (filePath: string) => void;
}

export function StructuredFileCard({
  file,
  folderPath,
  onDelete,
}: StructuredFileCardProps) {
  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const { mutateAsync: updateMetadata, isPending: isUpdating } =
    useUpdateStructuredFileMetadata(folderPath);
  const { mutateAsync: updateRefreshInterval } =
    useUpdateStructuredFileRefreshInterval(folderPath);
  const { mutateAsync: refreshFile, isPending: isRefreshing } =
    useRefreshFile(folderPath);

  const { startRefreshing, finishRefreshing, getRefreshingFile } =
    useRefreshStore();
  const isCurrentlyRefreshing = !!getRefreshingFile(file.filePath);

  const handleCardClick = () => {
    if (isCurrentlyRefreshing) return;

    const encodedPath = encodeURIComponent(folderPath);
    const encodedFile = encodeURIComponent(file.fileName);
    router.push(
      `/browse/structured/edit?path=${encodedPath}&file=${encodedFile}`,
    );
  };

  const handleDelete = () => {
    onDelete(file.filePath);
    setDeleteDialogOpen(false);
  };

  const handleUpdate = async (description: string, refreshInterval: string) => {
    try {
      await updateMetadata({ filePath: file.filePath, description });
      await updateRefreshInterval({
        filePath: file.filePath,
        interval: refreshInterval,
      });
    } catch (error) {
      console.error("Failed to update file:", error);
      throw error;
    }
  };

  const handleRefreshNow = async () => {
    if (isCurrentlyRefreshing) return;

    try {
      startRefreshing(file.filePath);
      await refreshFile(file.filePath);
      finishRefreshing(file.filePath);
      toast.success("File refreshed successfully");
    } catch (error) {
      console.error("Failed to refresh file:", error);
      finishRefreshing(file.filePath);
      toast.error("Failed to refresh file");
    }
  };

  // Format last refreshed time as relative time
  const formatLastRefreshed = (date: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays === 1) return "yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const displayName = file.fileName.replace(/\.md$/, "");

  // Menu items configuration (used by both context menu and dropdown menu)
  const menuItems: Array<
    | {
        id: string;
        label: string;
        icon: React.ComponentType<{ className?: string }>;
        onClick: () => void;
        disabled: boolean;
        className?: string;
      }
    | { id: "separator" }
  > = [
    {
      id: "open",
      label: "Open",
      icon: FileText,
      onClick: handleCardClick,
      disabled: isCurrentlyRefreshing,
    },
    {
      id: "edit",
      label: "Edit",
      icon: PencilSimple,
      onClick: () => setEditDialogOpen(true),
      disabled: isCurrentlyRefreshing,
    },
    {
      id: "refresh",
      label:
        isCurrentlyRefreshing || isRefreshing ? "Refreshing..." : "Refresh Now",
      icon: ArrowClockwise,
      onClick: handleRefreshNow,
      disabled: isCurrentlyRefreshing || isRefreshing,
    },
    {
      id: "separator",
    },
    {
      id: "delete",
      label: "Delete",
      icon: Trash,
      onClick: () => setDeleteDialogOpen(true),
      disabled: isCurrentlyRefreshing,
      className: "text-destructive focus:text-destructive",
    },
  ];

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card
            className={cn(
              "group relative transition-all",
              "flex h-[280px] w-[220px] flex-col",
              "shadow-sm hover:shadow-lg",
              isCurrentlyRefreshing
                ? "cursor-not-allowed opacity-60"
                : "hover:-translate-y-1 cursor-pointer hover:border-primary/50 hover:shadow-xl",
            )}
            onClick={handleCardClick}
          >
            <div className="absolute top-3 right-3 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="flex-shrink-0 bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                  >
                    <DotsThreeVertical className="size-4" weight="bold" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(e) => e.stopPropagation()}
                >
                  {menuItems.map((item) => {
                    if (item.id === "separator") {
                      return <DropdownMenuSeparator key={item.id} />;
                    }
                    if ("icon" in item) {
                      const Icon = item.icon;
                      return (
                        <DropdownMenuItem
                          key={item.id}
                          onClick={item.onClick}
                          disabled={item.disabled}
                          className={item.className}
                        >
                          <Icon className="mr-2 size-4" />
                          {item.label}
                        </DropdownMenuItem>
                      );
                    }
                    return null;
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <CardHeader>
              <CardTitle className="line-clamp-2 pb-0 text-lg leading-tight">
                {displayName}
              </CardTitle>
            </CardHeader>

            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden text-left">
              {file.description ? (
                <p className="line-clamp-3 text-muted-foreground text-xs">
                  {file.description}
                </p>
              ) : (
                <p className="text-muted-foreground/50 text-xs italic">
                  No description
                </p>
              )}

              <div className="flex-1" />

              <div className="flex flex-col gap-2">
                {isCurrentlyRefreshing ? (
                  <Badge
                    variant="secondary"
                    className="justify-center font-medium text-xs"
                  >
                    <ArrowClockwise className="mr-1.5 size-3 animate-spin" />
                    Refreshing...
                  </Badge>
                ) : (
                  file.refreshInterval &&
                  file.refreshInterval !== "none" && (
                    <Badge
                      variant="secondary"
                      className="justify-center font-medium text-xs"
                    >
                      <ArrowClockwise className="mr-1.5 size-3" />
                      Auto-refresh: {file.refreshInterval}
                    </Badge>
                  )
                )}

                {/* Metadata section */}
                <div className="flex flex-col gap-1.5 border-t pt-2 text-muted-foreground text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground/70">Modified</span>
                    <span className="font-medium">
                      {file.modifiedAt.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  {file.lastRefreshedAt && (
                    <div
                      className="flex items-center justify-between"
                      title={file.lastRefreshedAt.toLocaleString()}
                    >
                      <span className="text-muted-foreground/70">
                        Refreshed
                      </span>
                      <span className="font-medium">
                        {formatLastRefreshed(file.lastRefreshedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menuItems.map((item) => {
            if (item.id === "separator") {
              return <ContextMenuSeparator key={item.id} />;
            }
            if ("icon" in item) {
              const Icon = item.icon;
              return (
                <ContextMenuItem
                  key={item.id}
                  onClick={item.onClick}
                  disabled={item.disabled}
                  className={item.className}
                >
                  <Icon className="mr-2 size-4" />
                  {item.label}
                </ContextMenuItem>
              );
            }
            return null;
          })}
        </ContextMenuContent>
      </ContextMenu>

      <EditFileDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onUpdateFile={handleUpdate}
        currentFileName={file.fileName}
        currentDescription={file.description}
        currentRefreshInterval={file.refreshInterval || "none"}
        isUpdating={isUpdating}
      />

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{displayName}"? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
