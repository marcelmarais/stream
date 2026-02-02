"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Footer } from "@/components/footer";
import { MarkdownEditor } from "@/components/markdown-editor";
import { TitlebarHeader } from "@/components/titlebar-header";
import { Separator } from "@/components/ui/separator";
import { useConnectedRepos } from "@/hooks/use-git-queries";
import { useSearchShortcut } from "@/hooks/use-keyboard-shortcut";
import { useFileContentManager } from "@/hooks/use-markdown-queries";
import { useRefreshStore } from "@/stores/refresh-store";

function EditPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [folderPath, setFolderPath] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const pathParam = searchParams.get("path");
    const fileParam = searchParams.get("file");

    if (!pathParam || !fileParam) {
      router.push("/");
      return;
    }

    const decodedPath = decodeURIComponent(pathParam);
    const decodedFile = decodeURIComponent(fileParam);

    setFolderPath(decodedPath);
    setFileName(decodedFile);
    setIsLoading(false);
  }, [searchParams, router]);

  if (isLoading || !folderPath || !fileName) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return <EditPageView folderPath={folderPath} fileName={fileName} />;
}

export default function EditPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <EditPageContent />
    </Suspense>
  );
}

interface EditPageViewProps {
  folderPath: string;
  fileName: string;
}

function EditPageView({ folderPath, fileName }: EditPageViewProps) {
  useConnectedRepos(folderPath);
  const router = useRouter();
  const [showSearch, setShowSearch] = useState(false);

  useSearchShortcut(showSearch, setShowSearch);

  // Build the full file path
  const structuredDir = folderPath.endsWith("/")
    ? `${folderPath}structured`
    : `${folderPath}/structured`;
  const filePath = `${structuredDir}/${fileName}`;

  // Check if file is being refreshed
  const getRefreshingFile = useRefreshStore((state) => state.getRefreshingFile);
  const isRefreshing = !!getRefreshingFile(filePath);

  // Use file content manager
  const {
    content,
    isLoading,
    updateContentOptimistically,
    saveContentDebounced,
    saveContentImmediate,
  } = useFileContentManager(filePath);

  const handleContentChange = (newContent: string) => {
    updateContentOptimistically(newContent);
    saveContentDebounced(newContent);
  };

  const handleSave = async () => {
    try {
      await saveContentImmediate(content);
      toast.success("File saved");
    } catch (error) {
      console.error("Failed to save file:", error);
      toast.error("Failed to save file");
    }
  };

  const handleBack = () => {
    const encodedPath = encodeURIComponent(folderPath);
    router.push(`/browse/structured?path=${encodedPath}`);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p className="text-muted-foreground text-sm">Loading file...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <TitlebarHeader
        isLoading={isLoading}
        showSearch={showSearch}
        setShowSearch={setShowSearch}
        folderPath={folderPath}
        onBack={handleBack}
        backLabel="Back to files"
      />

      <div className="mx-auto mt-12 flex min-h-0 w-full max-w-4xl flex-1 flex-col px-6">
        <div className="my-4">
          <h1 className="mb-3 truncate font-bold text-3xl tracking-tigh">
            {fileName}
          </h1>
          <Separator />
        </div>

        {/* Editor */}
        <div className="mb-8 min-h-0 flex-1 overflow-auto">
          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            onSave={handleSave}
            autoFocus={true}
            isEditable={!isRefreshing}
          />
        </div>
      </div>

      <Footer folderPath={folderPath} />
    </>
  );
}
