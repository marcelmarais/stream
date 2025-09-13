use tauri::{TitleBarStyle, WebviewUrl, WebviewWindowBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct MarkdownFileMetadata {
    pub file_path: String,
    pub file_name: String,
    pub created_at: u64, // Unix timestamp in milliseconds
    pub modified_at: u64, // Unix timestamp in milliseconds
    pub size: u64,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn read_markdown_files_content(file_paths: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    use std::collections::HashMap;
    
    let mut results = HashMap::new();
    
    for file_path in file_paths {
        match std::fs::read_to_string(&file_path) {
            Ok(content) => {
                results.insert(file_path, content);
            }
            Err(e) => {
                eprintln!("Error reading file {}: {}", file_path, e);
                // Continue with other files, don't fail the entire operation
            }
        }
    }
    
    Ok(results)
}

#[tauri::command]
async fn read_markdown_files_metadata(directory_path: String, max_file_size: Option<u64>) -> Result<Vec<MarkdownFileMetadata>, String> {
    let max_size = max_file_size.unwrap_or(10 * 1024 * 1024); // 10MB default
    let mut files = Vec::new();
    
    fn visit_dir(dir: &Path, files: &mut Vec<MarkdownFileMetadata>, max_size: u64) -> Result<(), Box<dyn std::error::Error>> {
        if !dir.is_dir() {
            return Ok(());
        }
        
        let entries = fs::read_dir(dir)?;
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_dir() {
                // Recursively visit subdirectories
                visit_dir(&path, files, max_size)?;
            } else if path.is_file() {
                // Check if it's a markdown file
                if let Some(extension) = path.extension() {
                    if extension.to_string_lossy().to_lowercase() == "md" {
                        // Get file metadata
                        if let Ok(metadata) = entry.metadata() {
                            let size = metadata.len();
                            
                            // Filter by file size
                            if size <= max_size {
                                let file_name = path.file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("unknown")
                                    .to_string();
                                
                                let file_path = path.to_string_lossy().to_string();
                                
                                // Convert system time to unix timestamp in milliseconds
                                let created_at = metadata.created()
                                    .or_else(|_| metadata.modified())
                                    .unwrap_or_else(|_| std::time::SystemTime::now())
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;
                                
                                let modified_at = metadata.modified()
                                    .unwrap_or_else(|_| std::time::SystemTime::now())
                                    .duration_since(std::time::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64;
                                
                                files.push(MarkdownFileMetadata {
                                    file_path,
                                    file_name,
                                    created_at,
                                    modified_at,
                                    size,
                                });
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
    
    // Sort by creation date (newest first)
    files.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    
    Ok(files)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let win_builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("")
                .inner_size(800.0, 600.0);

            // set transparent title bar only when building for macOS
            #[cfg(target_os = "macos")]
            let win_builder = win_builder.title_bar_style(TitleBarStyle::Transparent);

            let window = win_builder.build().unwrap();

            // set black background only when building for macOS
            #[cfg(target_os = "macos")]
            {
                use objc2::runtime::AnyObject;
                use objc2_app_kit::NSColor;

                let ns_window = window.ns_window().unwrap();
                unsafe {
                    let bg_color = NSColor::blackColor();
                    let window_obj: *mut AnyObject = ns_window as *mut AnyObject;
                    let _: () = objc2::msg_send![window_obj, setBackgroundColor: &*bg_color];
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, read_markdown_files_metadata, read_markdown_files_content])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
