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

static DATE_FILENAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{4})-(\d{2})-(\d{2})\.md$").expect("Failed to compile date filename regex")
});

const XATTR_COUNTRY_KEY: &str = "user.location.country";
const XATTR_CITY_KEY: &str = "user.location.city";

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

fn write_location_xattrs(
    file_path: &Path,
    country: &str,
    city: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    xattr::set(file_path, XATTR_COUNTRY_KEY, country.as_bytes())?;
    xattr::set(file_path, XATTR_CITY_KEY, city.as_bytes())?;
    Ok(())
}

fn parse_date_from_filename(file_name: &str) -> Option<u64> {
    let caps = DATE_FILENAME_REGEX.captures(file_name)?;

    let year: i32 = caps.get(1)?.as_str().parse().ok()?;
    let month: u32 = caps.get(2)?.as_str().parse().ok()?;
    let day: u32 = caps.get(3)?.as_str().parse().ok()?;

    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let datetime = date.and_hms_opt(0, 0, 0)?.and_utc();

    Some(datetime.timestamp_millis() as u64)
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
