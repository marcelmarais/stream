"use client";

import { useCallback, useEffect, useId, useState } from "react";
import {
  createDateRange,
  type DateRange,
  filterMarkdownFilesByDateRange,
  type MarkdownFile,
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContent,
} from "../utils/markdownReader";

interface FileReaderScreenProps {
  folderPath: string;
  onBack: () => void;
}

export function FileReaderScreen({
  folderPath,
  onBack,
}: FileReaderScreenProps) {
  const startDateId = useId();
  const endDateId = useId();

  const [dateRange, setDateRange] = useState<DateRange>(
    createDateRange.lastDays(7),
  );
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [allFilesMetadata, setAllFilesMetadata] = useState<
    MarkdownFileMetadata[]
  >([]);
  const [markdownFiles, setMarkdownFiles] = useState<MarkdownFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleDateRangeFilterAndRead = useCallback(
    async (metadata: MarkdownFileMetadata[], newDateRange: DateRange) => {
      setIsLoadingContent(true);
      setError(null);
      setMarkdownFiles([]);

      try {
        // Filter metadata by date range
        const filteredMetadata = filterMarkdownFilesByDateRange(
          metadata,
          newDateRange,
        );

        if (filteredMetadata.length === 0) {
          setError("No markdown files found in the selected date range");
          setIsLoadingContent(false);
          return;
        }

        // Read content for filtered files
        const filesWithContent =
          await readMarkdownFilesContent(filteredMetadata);
        setMarkdownFiles(filesWithContent);

        if (filesWithContent.length === 0) {
          setError("Failed to read content from any files in the date range");
        }
      } catch (err) {
        setError(`Error reading file content: ${err}`);
      } finally {
        setIsLoadingContent(false);
      }
    },
    [],
  );

  // Read metadata when component mounts
  useEffect(() => {
    const readAllMetadata = async () => {
      setIsLoadingMetadata(true);
      setError(null);

      try {
        const metadata = await readAllMarkdownFilesMetadata(folderPath, {
          maxFileSize: 5 * 1024 * 1024, // 5MB limit
        });

        setAllFilesMetadata(metadata);
      } catch (err) {
        setError(`Error reading folder metadata: ${err}`);
      } finally {
        setIsLoadingMetadata(false);
      }
    };

    readAllMetadata();
  }, [folderPath]);

  const handleDateRangeChange = async (preset: string) => {
    let newDateRange: DateRange;
    switch (preset) {
      case "last7days":
        newDateRange = createDateRange.lastDays(7);
        break;
      case "last30days":
        newDateRange = createDateRange.lastDays(30);
        break;
      case "currentMonth":
        newDateRange = createDateRange.currentMonth();
        break;
      default:
        return;
    }

    setDateRange(newDateRange);

    // If we have metadata, apply the new date range filter and read content
    if (allFilesMetadata.length > 0) {
      await handleDateRangeFilterAndRead(allFilesMetadata, newDateRange);
    }
  };

  const handleCustomDateChange = async (
    field: "start" | "end",
    value: string,
  ) => {
    if (!value) return;

    const newDate = new Date(value);
    let newDateRange: DateRange;

    if (field === "start") {
      newDateRange = createDateRange.custom(newDate, dateRange.endDate);
    } else {
      newDateRange = createDateRange.custom(dateRange.startDate, newDate);
    }

    setDateRange(newDateRange);

    // If we have metadata, apply the new date range filter and read content
    if (allFilesMetadata.length > 0) {
      await handleDateRangeFilterAndRead(allFilesMetadata, newDateRange);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      {/* Show only loading state when metadata is loading */}
      {isLoadingMetadata && (
        <div className="rounded-lg bg-white p-6 shadow-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-bold text-2xl text-gray-800">
              Markdown File Reader
            </h2>
            <button
              type="button"
              onClick={onBack}
              className="rounded-md bg-gray-100 px-4 py-2 text-gray-700 text-sm transition-colors hover:bg-gray-200"
            >
              ← Back to Folder Selection
            </button>
          </div>

          <div className="mb-4 text-gray-600 text-sm">
            Reading from:{" "}
            <code className="rounded bg-gray-100 px-2 py-1">{folderPath}</code>
          </div>

          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600"></div>
              <div className="font-medium text-blue-700 text-lg">
                Reading folder metadata...
              </div>
              <div className="mt-2 text-gray-600 text-sm">
                Please wait while we scan for markdown files
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Show main content only after metadata is loaded */}
      {!isLoadingMetadata && (
        <>
          {/* Header with back button */}
          <div className="rounded-lg bg-white p-6 shadow-md">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-bold text-2xl text-gray-800">
                Markdown File Reader
              </h2>
              <button
                type="button"
                onClick={onBack}
                className="rounded-md bg-gray-100 px-4 py-2 text-gray-700 text-sm transition-colors hover:bg-gray-200"
              >
                ← Back to Folder Selection
              </button>
            </div>

            <div className="mb-4 text-gray-600 text-sm">
              Reading from:{" "}
              <code className="rounded bg-gray-100 px-2 py-1">
                {folderPath}
              </code>
            </div>

            {/* Date Range Selection */}
            <div className="mb-6">
              <div className="mb-2 block font-medium text-gray-700 text-sm">
                Date Range (Creation Date)
              </div>

              {/* Preset buttons */}
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleDateRangeChange("last7days")}
                  className="rounded bg-blue-100 px-3 py-1 text-blue-700 text-sm transition-colors hover:bg-blue-200"
                >
                  Last 7 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleDateRangeChange("last30days")}
                  className="rounded bg-blue-100 px-3 py-1 text-blue-700 text-sm transition-colors hover:bg-blue-200"
                >
                  Last 30 Days
                </button>
                <button
                  type="button"
                  onClick={() => handleDateRangeChange("currentMonth")}
                  className="rounded bg-blue-100 px-3 py-1 text-blue-700 text-sm transition-colors hover:bg-blue-200"
                >
                  Current Month
                </button>
              </div>

              {/* Custom date inputs */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={startDateId}
                    className="mb-1 block font-medium text-gray-600 text-xs"
                  >
                    Start Date
                  </label>
                  <input
                    id={startDateId}
                    type="date"
                    value={dateRange.startDate.toISOString().split("T")[0]}
                    onChange={(e) =>
                      handleCustomDateChange("start", e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor={endDateId}
                    className="mb-1 block font-medium text-gray-600 text-xs"
                  >
                    End Date
                  </label>
                  <input
                    id={endDateId}
                    type="date"
                    value={dateRange.endDate.toISOString().split("T")[0]}
                    onChange={(e) =>
                      handleCustomDateChange("end", e.target.value)
                    }
                    className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Status Display */}
            {isLoadingContent && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-700">
                Loading file content...
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-4 rounded-md border border-red-300 bg-red-100 p-3 text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Results */}
          {markdownFiles.length > 0 && (
            <div className="space-y-6">
              <div className="rounded-lg bg-white p-6 shadow-md">
                <h3 className="mb-4 font-semibold text-gray-800 text-lg">
                  Found {markdownFiles.length} Markdown Files
                </h3>
              </div>

              {/* Display all files */}
              {markdownFiles.map((file) => (
                <div
                  key={file.filePath}
                  className="rounded-lg bg-white p-6 shadow-md"
                >
                  <div className="mb-4 border-gray-200 border-b pb-4">
                    <h4 className="font-medium text-gray-800 text-lg">
                      {file.fileName}
                    </h4>
                    <div className="mt-2 flex flex-wrap gap-4 text-gray-500 text-sm">
                      <span>
                        Created: {file.createdAt.toLocaleDateString()} at{" "}
                        {file.createdAt.toLocaleTimeString()}
                      </span>
                      <span>Size: {(file.size / 1024).toFixed(1)}KB</span>
                    </div>
                    <div className="mt-1 text-gray-400 text-xs">
                      {file.filePath}
                    </div>
                  </div>

                  <div className="max-h-96 overflow-y-auto rounded-md border bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap font-mono text-gray-800 text-sm">
                      {file.content.length > 2000
                        ? `${file.content.substring(0, 2000)}...\n\n[Content truncated - ${file.content.length} total characters]`
                        : file.content}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default FileReaderScreen;
