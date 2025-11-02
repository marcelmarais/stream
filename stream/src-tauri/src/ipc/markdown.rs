use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::LazyLock;

use chrono::NaiveDate;
use regex::Regex;
use serde::{Deserialize, Serialize};
use xattr;

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64,
    pub modified_at: u64,
    pub size: u64,
    pub country: Option<String>,
    pub city: Option<String>,
    pub date_from_filename: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StructuredMarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64,
    pub modified_at: u64,
    pub size: u64,
    pub country: Option<String>,
    pub city: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StructuredMarkdownFile {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64,
    pub modified_at: u64,
    pub size: u64,
    pub country: Option<String>,
    pub city: Option<String>,
    pub description: Option<String>,
    pub content: String,
    pub refresh_interval: Option<String>,
    pub last_refreshed_at: Option<u64>,
}

static DATE_FILENAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\.md$").expect("Failed to compile date filename regex")
});

const XATTR_COUNTRY_KEY: &str = "user.location.country";
const XATTR_CITY_KEY: &str = "user.location.city";
const XATTR_DESCRIPTION_KEY: &str = "user.file.description";
const XATTR_REFRESH_INTERVAL_KEY: &str = "user.refresh.interval";
const XATTR_LAST_REFRESHED_KEY: &str = "user.refresh.last_refreshed";

#[derive(Debug, Clone, PartialEq)]
enum RefreshInterval {
    Minutely,
    Hourly,
    Daily,
    Weekly,
    None,
}

impl RefreshInterval {
    fn from_string(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "minutely" => Some(RefreshInterval::Minutely),
            "hourly" => Some(RefreshInterval::Hourly),
            "daily" => Some(RefreshInterval::Daily),
            "weekly" => Some(RefreshInterval::Weekly),
            "none" => Some(RefreshInterval::None),
            _ => None,
        }
    }

    fn to_string(&self) -> String {
        match self {
            RefreshInterval::Minutely => "minutely".to_string(),
            RefreshInterval::Hourly => "hourly".to_string(),
            RefreshInterval::Daily => "daily".to_string(),
            RefreshInterval::Weekly => "weekly".to_string(),
            RefreshInterval::None => "none".to_string(),
        }
    }

    fn duration_ms(&self) -> Option<u64> {
        match self {
            RefreshInterval::Minutely => Some(60 * 1000),
            RefreshInterval::Hourly => Some(60 * 60 * 1000),
            RefreshInterval::Daily => Some(24 * 60 * 60 * 1000),
            RefreshInterval::Weekly => Some(7 * 24 * 60 * 60 * 1000),
            RefreshInterval::None => None,
        }
    }
}

fn read_location_xattrs(file_path: &Path) -> (Option<String>, Option<String>) {
    let country = xattr::get(file_path, XATTR_COUNTRY_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok());

    let city = xattr::get(file_path, XATTR_CITY_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok());

    (country, city)
}

fn read_description_xattr(file_path: &Path) -> Option<String> {
    xattr::get(file_path, XATTR_DESCRIPTION_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

fn write_description_xattr(
    file_path: &Path,
    description: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    if description.is_empty() {
        let _ = xattr::remove(file_path, XATTR_DESCRIPTION_KEY);
        Ok(())
    } else {
        xattr::set(file_path, XATTR_DESCRIPTION_KEY, description.as_bytes())?;
        Ok(())
    }
}

fn write_location_xattrs(
    file_path: &Path,
    country: &str,
    city: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    xattr::set(file_path, XATTR_COUNTRY_KEY, country.as_bytes())?;
    xattr::set(file_path, XATTR_CITY_KEY, city.as_bytes())?;
    Ok(())
}

fn read_refresh_interval(file_path: &Path) -> Option<RefreshInterval> {
    xattr::get(file_path, XATTR_REFRESH_INTERVAL_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|s| RefreshInterval::from_string(&s))
}

fn write_refresh_interval(
    file_path: &Path,
    interval: &RefreshInterval,
) -> Result<(), Box<dyn std::error::Error>> {
    let interval_str = interval.to_string();
    xattr::set(
        file_path,
        XATTR_REFRESH_INTERVAL_KEY,
        interval_str.as_bytes(),
    )?;
    Ok(())
}

fn read_last_refreshed(file_path: &Path) -> Option<u64> {
    xattr::get(file_path, XATTR_LAST_REFRESHED_KEY)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|s| s.parse::<u64>().ok())
}

fn write_last_refreshed(
    file_path: &Path,
    timestamp_ms: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let timestamp_str = timestamp_ms.to_string();
    xattr::set(
        file_path,
        XATTR_LAST_REFRESHED_KEY,
        timestamp_str.as_bytes(),
    )?;
    Ok(())
}

fn parse_date_from_filename(file_name: &str) -> Option<u64> {
    let caps = DATE_FILENAME_REGEX.captures(file_name)?;

    let year: i32 = caps.get(1)?.as_str().parse().ok()?;
    let month: u32 = caps.get(2)?.as_str().parse().ok()?;
    let day: u32 = caps.get(3)?.as_str().parse().ok()?;

    let date = NaiveDate::from_ymd_opt(year, month, day)?;

    let datetime = date.and_hms_opt(0, 0, 0)?.and_utc();
    let timestamp_ms = datetime.timestamp_millis() as u64;

    Some(timestamp_ms)
}

#[tauri::command]
pub(crate) async fn set_file_location_metadata(
    file_path: String,
    country: String,
    city: String,
) -> Result<(), String> {
    let path = Path::new(&file_path);

    write_location_xattrs(path, &country, &city)
        .map_err(|e| format!("Failed to set location metadata: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn set_file_description(
    file_path: String,
    description: String,
) -> Result<(), String> {
    let path = Path::new(&file_path);

    write_description_xattr(path, &description)
        .map_err(|e| format!("Failed to set file description: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn set_file_refresh_interval(
    file_path: String,
    interval: String,
) -> Result<(), String> {
    let path = Path::new(&file_path);

    let refresh_interval = RefreshInterval::from_string(&interval)
        .ok_or_else(|| format!("Invalid refresh interval: {}", interval))?;

    write_refresh_interval(path, &refresh_interval)
        .map_err(|e| format!("Failed to set refresh interval: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn update_last_refreshed(
    file_path: String,
    timestamp_ms: u64,
) -> Result<(), String> {
    let path = Path::new(&file_path);

    write_last_refreshed(path, timestamp_ms)
        .map_err(|e| format!("Failed to update last refreshed timestamp: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn mark_file_as_refreshed(file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    write_last_refreshed(path, now)
        .map_err(|e| format!("Failed to update last refreshed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_files_needing_refresh(
    directory_path: String,
) -> Result<Vec<String>, String> {
    let structured_dir_path = Path::new(&directory_path).join("structured");

    if !structured_dir_path.exists() {
        return Ok(Vec::new());
    }

    let mut files_needing_refresh = Vec::new();

    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();

        if path.is_file() {
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    if let Some(interval) = read_refresh_interval(&path) {
                        if interval != RefreshInterval::None {
                            let last_refreshed = read_last_refreshed(&path).unwrap_or(0);

                            if let Some(duration_ms) = interval.duration_ms() {
                                let time_since_refresh = now.saturating_sub(last_refreshed);

                                if time_since_refresh >= duration_ms {
                                    files_needing_refresh.push(path.to_string_lossy().to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(files_needing_refresh)
}

#[tauri::command]
pub(crate) async fn read_markdown_files_content(
    file_paths: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let mut results = HashMap::new();

    for file_path in file_paths {
        match std::fs::read_to_string(&file_path) {
            Ok(content) => {
                results.insert(file_path, content);
            }
            Err(e) => {
                eprintln!("Error reading file {}: {}", file_path, e);
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub(crate) async fn read_markdown_files_metadata(
    directory_path: String,
    max_file_size: Option<u64>,
) -> Result<Vec<MarkdownFileMetadata>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024);
    let mut files = Vec::new();

    fn visit_dir(
        dir: &Path,
        files: &mut Vec<MarkdownFileMetadata>,
        max_size: u64,
    ) -> Result<(), Box<dyn std::error::Error>> {
        if !dir.is_dir() {
            return Ok(());
        }

        let entries = fs::read_dir(dir)?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                visit_dir(&path, files, max_size)?;
            } else if path.is_file() {
                if let Some(extension) = path.extension() {
                    if extension.to_string_lossy().to_lowercase() == "md" {
                        let file_name = path
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("unknown")
                            .to_string();

                        if let Some(date_timestamp) = parse_date_from_filename(&file_name) {
                            if let Ok(metadata) = entry.metadata() {
                                let size = metadata.len();

                                if size <= max_size {
                                    let file_path = path.to_string_lossy().to_string();

                                    let created_at = metadata
                                        .created()
                                        .or_else(|_| metadata.modified())
                                        .unwrap_or_else(|_| std::time::SystemTime::now())
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64;

                                    let modified_at = metadata
                                        .modified()
                                        .unwrap_or_else(|_| std::time::SystemTime::now())
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64;

                                    let (country, city) = read_location_xattrs(&path);

                                    files.push(MarkdownFileMetadata {
                                        file_path,
                                        file_name,
                                        created_at,
                                        modified_at,
                                        size,
                                        country,
                                        city,
                                        date_from_filename: date_timestamp,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    let dir_path = Path::new(&directory_path);
    if let Err(e) = visit_dir(dir_path, &mut files, max_size) {
        return Err(format!("Error reading directory: {}", e));
    }

    files.sort_by(|a, b| b.date_from_filename.cmp(&a.date_from_filename));

    Ok(files)
}

#[tauri::command]
pub(crate) async fn read_structured_markdown_files_metadata(
    directory_path: String,
    max_file_size: Option<u64>,
) -> Result<Vec<StructuredMarkdownFileMetadata>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024);
    let mut files = Vec::new();

    let structured_dir_path = Path::new(&directory_path).join("structured");

    if !structured_dir_path.exists() {
        return Ok(files);
    }

    if !structured_dir_path.is_dir() {
        return Err(format!(
            "Path is not a directory: {}",
            structured_dir_path.display()
        ));
    }

    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Error reading structured directory: {}", e)),
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("Error reading directory entry: {}", e);
                continue;
            }
        };

        let path = entry.path();

        if path.is_file() {
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    let file_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    if let Ok(metadata) = entry.metadata() {
                        let size = metadata.len();

                        if size <= max_size {
                            let file_path = path.to_string_lossy().to_string();

                            let created_at = metadata
                                .created()
                                .or_else(|_| metadata.modified())
                                .unwrap_or_else(|_| std::time::SystemTime::now())
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            let modified_at = metadata
                                .modified()
                                .unwrap_or_else(|_| std::time::SystemTime::now())
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            let (country, city) = read_location_xattrs(&path);

                            files.push(StructuredMarkdownFileMetadata {
                                file_path,
                                file_name,
                                created_at,
                                modified_at,
                                size,
                                country,
                                city,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(files)
}

#[tauri::command]
pub(crate) async fn read_structured_markdown_files(
    directory_path: String,
    max_file_size: Option<u64>,
) -> Result<Vec<StructuredMarkdownFile>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024);
    let mut files = Vec::new();

    let structured_dir_path = Path::new(&directory_path).join("structured");

    if !structured_dir_path.exists() {
        return Ok(files);
    }

    if !structured_dir_path.is_dir() {
        return Err(format!(
            "Path is not a directory: {}",
            structured_dir_path.display()
        ));
    }

    let entries = match fs::read_dir(&structured_dir_path) {
        Ok(entries) => entries,
        Err(e) => return Err(format!("Error reading structured directory: {}", e)),
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("Error reading directory entry: {}", e);
                continue;
            }
        };

        let path = entry.path();

        if path.is_file() {
            if let Some(extension) = path.extension() {
                if extension.to_string_lossy().to_lowercase() == "md" {
                    let file_name = path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("unknown")
                        .to_string();

                    if let Ok(metadata) = entry.metadata() {
                        let size = metadata.len();

                        if size <= max_size {
                            let file_path = path.to_string_lossy().to_string();

                            let content = match fs::read_to_string(&path) {
                                Ok(content) => content,
                                Err(e) => {
                                    eprintln!(
                                        "Error reading file content for {}: {}",
                                        file_path, e
                                    );
                                    continue;
                                }
                            };

                            let created_at = metadata
                                .created()
                                .or_else(|_| metadata.modified())
                                .unwrap_or_else(|_| std::time::SystemTime::now())
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            let modified_at = metadata
                                .modified()
                                .unwrap_or_else(|_| std::time::SystemTime::now())
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            let (country, city) = read_location_xattrs(&path);

                            let description = read_description_xattr(&path);

                            let refresh_interval =
                                read_refresh_interval(&path).map(|i| i.to_string());
                            let last_refreshed_at = read_last_refreshed(&path);

                            files.push(StructuredMarkdownFile {
                                file_path,
                                file_name,
                                created_at,
                                modified_at,
                                size,
                                country,
                                city,
                                description,
                                content,
                                refresh_interval,
                                last_refreshed_at,
                            });
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(files)
}
