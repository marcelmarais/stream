"use client";

import {
  ArrowClockwise,
  DotsThreeVertical,
  FileText,
  PencilSimple,
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
    // Prevent refresh if already refreshing
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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card
            className={cn(
              "group relative transition-all",
              "flex h-[200px] flex-col",
              isCurrentlyRefreshing
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:border-primary/50 hover:shadow-md",
            )}
            onClick={handleCardClick}
          >
            <CardHeader className="flex-shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {isCurrentlyRefreshing ? (
                    <ArrowClockwise className="size-5 flex-shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <FileText className="size-5 flex-shrink-0 text-muted-foreground" />
                  )}
                  <CardTitle className="truncate text-base">
                    {displayName}
                  </CardTitle>
                  {isCurrentlyRefreshing ? (
                    <Badge
                      variant="secondary"
                      className="flex-shrink-0 text-xs"
                    >
                      Refreshing...
                    </Badge>
                  ) : (
                    file.refreshInterval &&
                    file.refreshInterval !== "none" && (
                      <Badge
                        variant="secondary"
                        className="flex-shrink-0 text-xs"
                      >
                        <ArrowClockwise className="mr-1 size-3" />
                        {file.refreshInterval.charAt(0).toUpperCase() +
                          file.refreshInterval.slice(1)}
                      </Badge>
                    )
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteDialogOpen(true);
                  }}
                >
                  <DotsThreeVertical className="size-4" weight="bold" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden">
              {file.description && (
                <p className="mb-2 text-muted-foreground text-sm italic">
                  {file.description}
                </p>
              )}
              <div className="mt-2 flex items-center justify-between text-muted-foreground text-xs">
                <span>Modified: {file.modifiedAt.toLocaleDateString()}</span>
                {file.lastRefreshedAt && (
                  <span title={file.lastRefreshedAt.toLocaleString()}>
                    Refreshed: {formatLastRefreshed(file.lastRefreshedAt)}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            onClick={handleCardClick}
            disabled={isCurrentlyRefreshing}
          >
            <FileText className="mr-2 size-4" />
            Open
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => setEditDialogOpen(true)}
            disabled={isCurrentlyRefreshing}
          >
            <PencilSimple className="mr-2 size-4" />
            Edit
          </ContextMenuItem>
          <ContextMenuItem
            onClick={handleRefreshNow}
            disabled={isCurrentlyRefreshing || isRefreshing}
          >
            <ArrowClockwise className="mr-2 size-4" />
            {isCurrentlyRefreshing || isRefreshing
              ? "Refreshing..."
              : "Refresh Now"}
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => setDeleteDialogOpen(true)}
            disabled={isCurrentlyRefreshing}
            className="text-destructive focus:text-destructive"
          >
            Delete
          </ContextMenuItem>
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
