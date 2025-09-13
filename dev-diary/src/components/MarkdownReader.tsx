"use client";

import { load } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useState } from "react";
import {
  createDateRange,
  type DateRange,
  filterMarkdownFilesByDateRange,
  type MarkdownFile,
  type MarkdownFileMetadata,
  readAllMarkdownFilesMetadata,
  readMarkdownFilesContent,
} from "../utils/markdownReader";
import FolderPicker from "./FolderPicker";

const STORAGE_KEY = "dev-diary-last-selected-folder";
const STORE_FILE = "settings.json";

export function MarkdownReader() {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
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
  const [selectedFile, setSelectedFile] = useState<MarkdownFile | null>(null);

  useEffect(() => {
    const loadPersistedFolder = async () => {

      try {
        const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
        const savedFolder = await store.get<string>(STORAGE_KEY);
        if (savedFolder) {
          setSelectedFolder(savedFolder);
          // Just read metadata, don't auto-apply date filter
          setIsLoadingMetadata(true);
          setError(null);

          const metadata = await readAllMarkdownFilesMetadata(savedFolder, {
            maxFileSize: 5 * 1024 * 1024,
          });

          setAllFilesMetadata(metadata);

          if (metadata.length === 0) {
            setError("No markdown files found in the selected folder");
          }
          setIsLoadingMetadata(false);
        }
        console.log("Loaded saved folder from Tauri Store:", savedFolder);
      } catch (error) {
        console.warn("Failed to load saved folder from Tauri Store:", error);
        setError(`Failed to load saved folder: ${error}`);
        setIsLoadingMetadata(false);
      }
    };

    loadPersistedFolder();
  }, []);

  // Auto-apply date filter when metadata or date range changes
  useEffect(() => {
    if (allFilesMetadata.length > 0) {
      handleDateRangeFilterAndRead(allFilesMetadata, dateRange);
    }
  }, [allFilesMetadata, dateRange, handleDateRangeFilterAndRead]);

  const handleFolderSelected = async (folderPath: string | null) => {
    setSelectedFolder(folderPath);
    setAllFilesMetadata([]);
    setMarkdownFiles([]);
    setSelectedFile(null);
    setError(null);

    // Persist the selected folder to Tauri Store
    try {
      const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
      if (folderPath) {
        await store.set(STORAGE_KEY, folderPath);
      } else {
        await store.delete(STORAGE_KEY);
      }
    } catch (error) {
      console.warn("Failed to save folder to Tauri Store:", error);
    }

    // Read all metadata when folder is selected
    if (folderPath) {
      try {
        setIsLoadingMetadata(true);
        setError(null);

        const metadata = await readAllMarkdownFilesMetadata(folderPath, {
          maxFileSize: 5 * 1024 * 1024,
        });

        setAllFilesMetadata(metadata);

        if (metadata.length === 0) {
          setError("No markdown files found in the selected folder");
        }

        setIsLoadingMetadata(false);
      } catch (err) {
        setError(`Error reading folder metadata: ${err}`);
        setIsLoadingMetadata(false);
      }
    }
  };

  const handleDateRangeFilterAndRead = useCallback(
    async (metadata: MarkdownFileMetadata[], newDateRange: DateRange) => {
      setIsLoadingContent(true);
      setError(null);
      setMarkdownFiles([]);
      setSelectedFile(null);

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
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h2 className="mb-4 font-bold text-2xl text-gray-800">
          Markdown File Reader
        </h2>

        {/* Folder Picker */}
        <div className="mb-6">
          <div className="mb-2 block font-medium text-gray-700 text-sm">
            Select Directory
          </div>
          <FolderPicker
            onFolderSelected={handleFolderSelected}
            value={selectedFolder}
            buttonText="Choose Directory"
            placeholder="No directory selected"
            className="w-full"
          />
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
                htmlFor="start-date"
                className="mb-1 block font-medium text-gray-600 text-xs"
              >
                Start Date
              </label>
              <input
                id="start-date"
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
                htmlFor="end-date"
                className="mb-1 block font-medium text-gray-600 text-xs"
              >
                End Date
              </label>
              <input
                id="end-date"
                type="date"
                value={dateRange.endDate.toISOString().split("T")[0]}
                onChange={(e) => handleCustomDateChange("end", e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Status Display */}
        {(isLoadingMetadata || isLoadingContent) && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-700">
            {isLoadingMetadata && "Reading folder metadata..."}
            {isLoadingContent && "Loading file content..."}
          </div>
        )}

        {allFilesMetadata.length > 0 &&
          !isLoadingMetadata &&
          !isLoadingContent && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3 text-green-700">
              Found {allFilesMetadata.length} markdown files in folder.
              {markdownFiles.length > 0 &&
                ` Showing ${markdownFiles.length} files in selected date range.`}
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
        <div className="rounded-lg bg-white p-6 shadow-md">
          <h3 className="mb-4 font-semibold text-gray-800 text-lg">
            Found {markdownFiles.length} Markdown Files
          </h3>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* File List */}
            <div>
              <h4 className="mb-3 font-medium text-gray-700">Files:</h4>
              <div className="max-h-96 space-y-2 overflow-y-auto">
                {markdownFiles.map((file) => (
                  <button
                    key={file.filePath}
                    type="button"
                    className={`w-full cursor-pointer rounded-md border p-3 text-left transition-colors ${
                      selectedFile?.filePath === file.filePath
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setSelectedFile(file)}
                  >
                    <div className="font-medium text-gray-800 text-sm">
                      {file.fileName}
                    </div>
                    <div className="mt-1 text-gray-500 text-xs">
                      Created: {file.createdAt.toLocaleDateString()} at{" "}
                      {file.createdAt.toLocaleTimeString()}
                    </div>
                    <div className="text-gray-500 text-xs">
                      Size: {(file.size / 1024).toFixed(1)}KB
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* File Content Preview */}
            <div>
              {selectedFile ? (
                <>
                  <h4 className="mb-3 font-medium text-gray-700">
                    Content Preview: {selectedFile.fileName}
                  </h4>
                  <div className="max-h-96 overflow-y-auto rounded-md border bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap font-mono text-gray-800 text-sm">
                      {selectedFile.content.length > 2000
                        ? `${selectedFile.content.substring(0, 2000)}...\n\n[Content truncated - ${selectedFile.content.length} total characters]`
                        : selectedFile.content}
                    </pre>
                  </div>
                  <div className="mt-2 text-gray-500 text-xs">
                    Full path: {selectedFile.filePath}
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  Click on a file to preview its content
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MarkdownReader;
