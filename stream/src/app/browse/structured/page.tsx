"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileGrid } from "@/components/file-grid";
import { Footer } from "@/components/footer";
import { SearchBar } from "@/components/search-bar";
import { TitlebarHeader } from "@/components/titlebar-header";
import { useConnectedRepos } from "@/hooks/use-git-queries";
import { useSearchShortcut } from "@/hooks/use-keyboard-shortcut";
import {
  useCreateStructuredFile,
  useDeleteStructuredFile,
  useStructuredMarkdownFiles,
} from "@/hooks/use-markdown-queries";

function StructuredPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [folderPath, setFolderPath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const pathParam = searchParams.get("path");

    if (!pathParam) {
      router.push("/");
      return;
    }

    const decodedPath = decodeURIComponent(pathParam);
    setFolderPath(decodedPath);
    setIsLoading(false);
  }, [searchParams, router]);

  if (isLoading || !folderPath) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <StructuredPageView folderPath={folderPath} />;
}

export default function StructuredPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <StructuredPageContent />
    </Suspense>
  );
}

interface StructuredPageViewProps {
  folderPath: string;
}

function StructuredPageView({ folderPath }: StructuredPageViewProps) {
  useConnectedRepos(folderPath);
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);

  useSearchShortcut(showSearch, setShowSearch);

  // Fetch all structured markdown files (metadata + content)
  const {
    data: files = [],
    isLoading,
    error,
  } = useStructuredMarkdownFiles(folderPath);

  const { mutateAsync: createFile, isPending: isCreating } =
    useCreateStructuredFile();
  const { mutate: deleteFile } = useDeleteStructuredFile(folderPath);

  const handleScrollToDate = () => {
    // Not applicable for structured view
  };

  const handleFileSelectFromSearch = () => {
    setShowSearch(false);
  };

  const handleCreateFile = async (fileName: string, description: string) => {
    try {
      await createFile({ folderPath, fileName, description });
      // Navigate to edit page for the new file
      const encodedPath = encodeURIComponent(folderPath);
      const encodedFile = encodeURIComponent(fileName);
      router.push(
        `/browse/structured/edit?path=${encodedPath}&file=${encodedFile}`,
      );
    } catch (error) {
      console.error("Failed to create file:", error);
      throw error; // Let the dialog handle the error
    }
  };

  const handleDeleteFile = (filePath: string) => {
    try {
      deleteFile(filePath);
      toast.success("File deleted successfully");
    } catch (error) {
      console.error("Failed to delete file:", error);
      toast.error("Failed to delete file");
    }
  };

  if (error) {
    return (
      <>
        <TitlebarHeader
          isLoading={false}
          showSearch={showSearch}
          setShowSearch={setShowSearch}
          handleScrollToDate={handleScrollToDate}
          folderPath={folderPath}
        />
        <div className="flex h-full flex-col items-center justify-center p-6">
          <div className="text-center">
            <h2 className="mb-2 font-semibold text-2xl text-destructive">
              Error Loading Files
            </h2>
            <p className="text-muted-foreground text-sm">
              {error instanceof Error
                ? error.message
                : "An unexpected error occurred"}
            </p>
          </div>
        </div>
        <Footer folderPath={folderPath} />
      </>
    );
  }

  return (
    <>
      <TitlebarHeader
        isLoading={isLoading}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        handleScrollToDate={handleScrollToDate}
        folderPath={folderPath}
      />

      <div className="mt-12 flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center p-6">
            <div className="text-center">
              <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
              <p className="text-muted-foreground text-sm">Loading files...</p>
            </div>
          </div>
        ) : (
          <FileGrid
            files={files}
            folderPath={folderPath}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            isCreating={isCreating}
          />
        )}
      </div>

      <Footer folderPath={folderPath} />

      <SearchBar
        open={showSearch}
        onOpenChange={setShowSearch}
        folderPath={folderPath}
        onFileSelect={handleFileSelectFromSearch}
      />
    </>
  );
}
