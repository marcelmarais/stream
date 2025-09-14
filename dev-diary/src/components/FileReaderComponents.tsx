import type { GitCommit } from "../utils/gitReader";
import type { MarkdownFileMetadata } from "../utils/markdownReader";
import CommitOverlay from "./CommitOverlay";

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
  isEditing: boolean;
  editingContent: string;
  filePath: string;
  onEditFile: (filePath: string, content: string) => void;
  onContentChange: (filePath: string, content: string) => void;
}

export function ContentEditor({
  content,
  isLoading,
  isEditing,
  editingContent,
  filePath,
  onEditFile,
  onContentChange,
}: ContentEditorProps) {
  return (
    <div className="h-auto">
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="text-center">
            <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
            <div className="text-muted-foreground text-sm">
              Loading content...
            </div>
          </div>
        </div>
      ) : content ? (
        isEditing ? (
          <textarea
            value={editingContent}
            onChange={(e) => onContentChange(filePath, e.target.value)}
            className="h-80 w-full resize-none bg-background text-left text-foreground focus:outline-none"
            placeholder="Enter your markdown content..."
          />
        ) : (
          <button
            type="button"
            onClick={() => onEditFile(filePath, content)}
            className="cursor-text"
          >
            <div className="w-full whitespace-pre-wrap text-left">
              {content}
            </div>
          </button>
        )
      ) : (
        <div className="text-muted-foreground text-sm italic">
          Content not available
        </div>
      )}
    </div>
  );
}

interface FileCardProps {
  file: MarkdownFileMetadata;
  content?: string;
  isLoading: boolean;
  isEditing: boolean;
  editingContent: string;
  saveError?: string;
  commits: GitCommit[];
  onEditFile: (filePath: string, content: string) => void;
  onContentChange: (filePath: string, content: string) => void;
}

export function FileCard({
  file,
  content,
  isLoading,
  isEditing,
  editingContent,
  saveError,
  commits,
  onEditFile,
  onContentChange,
}: FileCardProps) {
  return (
    <div className="mb-6 p-6">
      <ContentEditor
        content={content}
        isLoading={isLoading}
        isEditing={isEditing}
        editingContent={editingContent}
        filePath={file.filePath}
        onEditFile={onEditFile}
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
    </div>
  );
}
