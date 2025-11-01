"use client";

import {
  DotsThreeVertical,
  FileText,
  PencilSimple,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { EditFileDialog } from "@/components/edit-file-dialog";
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
import { useUpdateStructuredFileMetadata } from "@/hooks/use-markdown-queries";
import type { StructuredMarkdownFile } from "@/ipc/markdown-reader";
import { cn } from "@/lib/utils";

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

  const handleCardClick = () => {
    // Navigate to edit page
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

  const handleUpdate = async (description: string) => {
    try {
      await updateMetadata({ filePath: file.filePath, description });
      toast.success("File updated successfully");
    } catch (error) {
      console.error("Failed to update file:", error);
      toast.error("Failed to update file");
      throw error;
    }
  };

  // Get a preview of the content (first 150 characters)
  const preview = file.content
    ? file.content.slice(0, 150).replace(/\n/g, " ").trim()
    : "No content yet...";

  // Get file name without extension for display
  const displayName = file.fileName.replace(/\.md$/, "");

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <Card
            className={cn(
              "group relative cursor-pointer transition-all hover:border-primary/50 hover:shadow-md",
              "flex h-[200px] flex-col",
            )}
            onClick={handleCardClick}
          >
            <CardHeader className="flex-shrink-0">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText className="size-5 flex-shrink-0 text-muted-foreground" />
                  <CardTitle className="truncate text-base">
                    {displayName}
                  </CardTitle>
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
              <p className="line-clamp-3 text-muted-foreground text-sm">
                {preview}
              </p>
              <div className="mt-2 text-muted-foreground text-xs">
                Modified: {file.modifiedAt.toLocaleDateString()}
              </div>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={handleCardClick}>
            <FileText className="mr-2 size-4" />
            Open
          </ContextMenuItem>
          <ContextMenuItem onClick={() => setEditDialogOpen(true)}>
            <PencilSimple className="mr-2 size-4" />
            Edit
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => setDeleteDialogOpen(true)}
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
