import type { GitCommit } from "../utils/gitReader";
import type { MarkdownFileMetadata } from "../utils/markdownReader";
import CommitOverlay from "./CommitOverlay";
import MarkdownEditor from "./MarkdownEditor";
import { Separator } from "./ui/separator";

interface DateHeaderProps {
  displayDate: string;
}

export function DateHeader({ displayDate }: DateHeaderProps) {
  return (
    <div className="mx-6 mt-8 mb-4 first:mt-0">
      <h3 className="font-semibold text-3xl">{displayDate}</h3>
    </div>
  );
}

interface FileNameProps {
  fileName: string;
  saveError?: string;
}

export function FileName({ fileName, saveError }: FileNameProps) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="font-base text-muted-foreground text-sm">{fileName}</h4>
      </div>
      {saveError && (
        <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/10 p-2 text-destructive text-sm">
          {saveError}
        </div>
      )}
    </div>
  );
}

interface ContentEditorProps {
  content?: string;
  isLoading: boolean;
  filePath: string;
  onContentChange: (filePath: string, content: string) => void;
}

export function ContentEditor({
  content,
  isLoading,
  filePath,
  onContentChange,
}: ContentEditorProps) {
  return (
    <div>
      {isLoading ? (
        <div className="flex items-center justify-center pt-4 pb-8">
          <div className="text-center">
            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <div className="text-muted-foreground text-sm">
              Loading content...
            </div>
          </div>
        </div>
      ) : (
        <MarkdownEditor
          value={content || ""}
          onChange={(value) => onContentChange(filePath, value)}
          placeholder="Enter your markdown content..."
        />
      )}
    </div>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  content?: string;
  isLoading: boolean;
  saveError?: string;
  commits: GitCommit[];
  onContentChange: (filePath: string, content: string) => void;
}

export function FileCard({
  file,
  content,
  isLoading,
  saveError,
  commits,
  onContentChange,
}: FileCardProps) {
  return (
    <div className="mb-6 p-6">
      <ContentEditor
        content={content}
        isLoading={isLoading}
        filePath={file.filePath}
        onContentChange={onContentChange}
      />
      <FileName fileName={file.fileName} saveError={saveError} />
      {/* Git Commits Overlay */}
      {commits.length > 0 && (
        <div className="mt-4">
          <CommitOverlay
            commits={commits}
            date={file.createdAt}
            className="w-full"
          />
        </div>
      )}
      <Separator className="mt-12" />
    </div>
  );
}
