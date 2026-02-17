use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

pub struct StorageState {
    data_dir: Mutex<PathBuf>,
}

impl StorageState {
    pub fn new(default_dir: PathBuf) -> Self {
        Self {
            data_dir: Mutex::new(default_dir),
        }
    }

    pub fn get_dir(&self) -> PathBuf {
        self.data_dir.lock().unwrap().clone()
    }

    pub fn set_dir(&self, dir: PathBuf) {
        *self.data_dir.lock().unwrap() = dir;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub path: String,
    pub filename: String,
    pub original_file: String,
    pub timestamp: String,
    pub tag: String,
    pub size: u64,
}

/// Check if a directory exists and is writable by creating and removing a temp file.
fn is_dir_writable(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let test_file = path.join(".dartforge_write_test");
    match fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

/// List all data files (*.json, excluding backups dir) in a directory.
fn list_data_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension().is_some_and(|ext| ext == "json")
                && p.file_name().is_some_and(|name| name != "local-config.json")
        })
        .collect()
}

#[tauri::command]
pub fn resolve_data_dir(
    candidates: Vec<String>,
    state: tauri::State<'_, StorageState>,
    app: tauri::AppHandle,
) -> String {
    for candidate in &candidates {
        let path = PathBuf::from(candidate);
        if is_dir_writable(&path) {
            state.set_dir(path.clone());
            log::info!("Resolved data dir to configured path: {}", path.display());
            return path.to_string_lossy().to_string();
        }
    }

    // Fall back to default app data dir
    let default_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let _ = fs::create_dir_all(&default_dir);
    state.set_dir(default_dir.clone());
    log::info!(
        "No configured paths valid, using default: {}",
        default_dir.display()
    );
    default_dir.to_string_lossy().to_string()
}

#[tauri::command]
pub fn get_active_data_dir(state: tauri::State<'_, StorageState>) -> String {
    state.get_dir().to_string_lossy().to_string()
}

#[tauri::command]
pub fn read_data_file(
    filename: String,
    state: tauri::State<'_, StorageState>,
) -> Option<serde_json::Value> {
    let path = state.get_dir().join(&filename);
    let contents = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&contents).ok()
}

#[tauri::command]
pub fn write_data_file(
    filename: String,
    data: serde_json::Value,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    let dir = state.get_dir();
    let _ = fs::create_dir_all(&dir);
    let path = dir.join(&filename);

    // Atomic write: write to temp file then rename
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json.as_bytes()).map_err(|e| format!("Failed to write {filename}: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename {filename}: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn copy_data_to_dir(
    target_dir: String,
    state: tauri::State<'_, StorageState>,
) -> Result<Vec<String>, String> {
    let source = state.get_dir();
    let target = PathBuf::from(&target_dir);

    if !target.is_dir() {
        return Err(format!("Target directory does not exist: {target_dir}"));
    }

    let files = list_data_files(&source);
    let mut copied = Vec::new();

    for file in &files {
        let file_name = file
            .file_name()
            .ok_or_else(|| "Invalid filename".to_string())?;
        let dest = target.join(file_name);
        fs::copy(file, &dest)
            .map_err(|e| format!("Failed to copy {}: {}", file_name.to_string_lossy(), e))?;
        copied.push(file_name.to_string_lossy().to_string());
    }

    Ok(copied)
}

#[tauri::command]
pub fn check_dir_valid(path: String) -> bool {
    is_dir_writable(Path::new(&path))
}

#[tauri::command]
pub fn create_backup(
    tag: String,
    state: tauri::State<'_, StorageState>,
) -> Result<Vec<String>, String> {
    let data_dir = state.get_dir();
    let backup_dir = data_dir.join("backups");
    let _ = fs::create_dir_all(&backup_dir);

    let files = list_data_files(&data_dir);
    if files.is_empty() {
        return Ok(vec![]);
    }

    let now = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let mut backed_up = Vec::new();

    for file in &files {
        let stem = file.file_stem().unwrap_or_default().to_string_lossy();
        let backup_name = format!("{stem}_{now}.{tag}.json");
        let dest = backup_dir.join(&backup_name);
        fs::copy(file, &dest)
            .map_err(|e| format!("Failed to backup {stem}: {e}"))?;
        backed_up.push(backup_name);
    }

    Ok(backed_up)
}

#[tauri::command]
pub fn list_backups(state: tauri::State<'_, StorageState>) -> Vec<BackupEntry> {
    let backup_dir = state.get_dir().join("backups");
    let Ok(entries) = fs::read_dir(&backup_dir) else {
        return vec![];
    };

    let mut backups: Vec<BackupEntry> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().is_file()
                && e.path().extension().is_some_and(|ext| ext == "json")
        })
        .filter_map(|e| {
            let path = e.path();
            let filename = path.file_name()?.to_string_lossy().to_string();
            let size = e.metadata().ok()?.len();

            // Parse filename: {original}_{timestamp}.{tag}.json
            // e.g., "skills-bob_2026-02-16T14-30-00.session-start.json"
            let without_ext = filename.strip_suffix(".json")?;
            let (rest, tag) = without_ext.rsplit_once('.')?;
            let (original_file, timestamp) = rest.rsplit_once('_')?;
            let original_file = format!("{original_file}.json");
            let timestamp = timestamp.to_string();
            let tag = tag.to_string();

            Some(BackupEntry {
                path: path.to_string_lossy().to_string(),
                filename,
                original_file,
                timestamp,
                tag,
                size,
            })
        })
        .collect();

    // Sort newest first
    backups.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    backups
}

#[tauri::command]
pub fn restore_backup(
    backup_path: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    let backup = PathBuf::from(&backup_path);
    if !backup.is_file() {
        return Err(format!("Backup file not found: {backup_path}"));
    }

    // Parse the backup filename to find the original file
    let filename = backup
        .file_name()
        .ok_or("Invalid backup path")?
        .to_string_lossy();
    let without_ext = filename
        .strip_suffix(".json")
        .ok_or("Invalid backup filename")?;
    let (rest, _tag) = without_ext
        .rsplit_once('.')
        .ok_or("Invalid backup filename format")?;
    let (original_stem, _timestamp) = rest
        .rsplit_once('_')
        .ok_or("Invalid backup filename format")?;
    let original_filename = format!("{original_stem}.json");

    // Create a pre-restore backup first
    create_backup("pre-restore".to_string(), state.clone())?;

    // Overwrite the original file with backup contents
    let dest = state.get_dir().join(&original_filename);
    fs::copy(&backup, &dest)
        .map_err(|e| format!("Failed to restore {original_filename}: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn prune_backups(keep: usize, state: tauri::State<'_, StorageState>) -> Result<usize, String> {
    let backup_dir = state.get_dir().join("backups");
    let Ok(entries) = fs::read_dir(&backup_dir) else {
        return Ok(0);
    };

    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "json"))
        .collect();

    if files.len() <= keep {
        return Ok(0);
    }

    // Sort newest first by filename (timestamps are in the name)
    files.sort_by(|a, b| {
        b.file_name()
            .unwrap_or_default()
            .cmp(a.file_name().unwrap_or_default())
    });

    let mut deleted = 0;
    for file in files.iter().skip(keep) {
        if fs::remove_file(file).is_ok() {
            deleted += 1;
        }
    }

    Ok(deleted)
}
