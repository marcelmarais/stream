mod ipc;
mod search;

pub use ipc::{FetchResult, GitCommit, MarkdownFileMetadata, RepoCommits};

use crate::ipc::agents::{list_running_agents, open_agent_chat};
use crate::ipc::git::{fetch_repos, get_git_commits_for_repos};
use crate::ipc::github::get_pull_requests;
use crate::ipc::location::detect_location;
use crate::ipc::markdown::{
    read_markdown_files_content, read_markdown_files_metadata, set_file_location_metadata,
};
use crate::ipc::repos::discover_git_repos;

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
            get_pull_requests,
            discover_git_repos,
            list_running_agents,
            open_agent_chat,
            detect_location,
            set_file_location_metadata,
            search::search_markdown_files,
            search::rebuild_search_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
