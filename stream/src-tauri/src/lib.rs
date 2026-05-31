mod ipc;
mod search;

use tauri::{Manager, WindowEvent};

#[cfg(target_os = "macos")]
use objc::runtime::Object;
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

pub use ipc::{FetchResult, GitCommit, MarkdownFileMetadata, RepoCommits};

use crate::ipc::git::{fetch_repos, get_git_commits_for_repos};
use crate::ipc::markdown::{
    read_markdown_files_content, read_markdown_files_metadata, set_file_location_metadata,
};

#[cfg(target_os = "macos")]
fn setup_macos_window(window: &tauri::Window) -> Result<(), Box<dyn std::error::Error>> {
    unsafe {
        let ns_window = window.ns_window()? as *mut Object;

        if !ns_window.is_null() {
            // Set corner radius using Objective-C messaging
            let _: () = msg_send![ns_window, setHasShadow: true];

            // Get the content view
            let content_view: *mut Object = msg_send![ns_window, contentView];
            if !content_view.is_null() {
                let _: () = msg_send![content_view, setWantsLayer: true];

                // Get the layer
                let layer: *mut Object = msg_send![content_view, layer];
                if !layer.is_null() {
                    let _: () = msg_send![layer, setCornerRadius: 8.0f64];
                    let _: () = msg_send![layer, setMasksToBounds: true];
                }
            }
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_markdown_files_metadata,
            read_markdown_files_content,
            get_git_commits_for_repos,
            fetch_repos,
            set_file_location_metadata,
            search::search_markdown_files,
            search::rebuild_search_index
        ])
        .on_window_event(|window, event| match event {
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                #[cfg(target_os = "macos")]
                if let Err(e) = setup_macos_window(window) {
                    eprintln!("Failed to setup macOS window: {}", e);
                }
            }
            _ => {}
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                if let Some(webview_window) = app.get_webview_window("main") {
                    let window = webview_window.as_ref().window();
                    if let Err(e) = setup_macos_window(&window) {
                        eprintln!("Failed to setup macOS window: {}", e);
                    }
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
