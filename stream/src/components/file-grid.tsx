"use client";

import { Plus } from "@phosphor-icons/react";
import { useState } from "react";
import { CreateFileDialog } from "@/components/create-file-dialog";
import { StructuredFileCard } from "@/components/structured-file-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StructuredMarkdownFile } from "@/ipc/markdown-reader";

interface FileGridProps {
  files: StructuredMarkdownFile[];
  folderPath: string;
  onCreateFile: (
    fileName: string,
    description: string,
    refreshInterval: string,
  ) => Promise<void>;
  onDeleteFile: (filePath: string) => void;
  isCreating?: boolean;
}

export function FileGrid({
  files,
  folderPath,
  onCreateFile,
  onDeleteFile,
  isCreating = false,
}: FileGridProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <h2 className="font-semibold text-lg">Structured Files</h2>
          <p className="text-muted-foreground text-sm">
            {files.length} {files.length === 1 ? "file" : "files"}
          </p>
        </div>
        <Button
          onClick={() => setCreateDialogOpen(true)}
          size="sm"
          disabled={isCreating}
        >
          <Plus className="size-4" weight="bold" />
          New File
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {files.length === 0 ? (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md text-center">
              <h3 className="mb-2 font-semibold text-foreground text-lg">
                No files yet
              </h3>
              <p className="mb-4 text-muted-foreground text-sm">
                Create your first structured markdown file to get started.
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="size-4" weight="bold" />
                Create File
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {files.map((file) => (
              <StructuredFileCard
                key={file.filePath}
                file={file}
                folderPath={folderPath}
                onDelete={onDeleteFile}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      <CreateFileDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateFile={onCreateFile}
        isCreating={isCreating}
      />
    </div>
  );
}
