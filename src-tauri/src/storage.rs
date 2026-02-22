use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use base64::Engine as _;
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
        self.data_dir.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn set_dir(&self, dir: PathBuf) {
        *self.data_dir.lock().unwrap_or_else(|e| e.into_inner()) = dir;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupEntry {
    pub path: String,
    pub filename: String,
    pub timestamp: String,
    pub tag: String,
    pub size: u64,
    pub files: Vec<String>,
}

/// Validate that a filename is safe (no path traversal or directory separators).
fn validate_filename(filename: &str) -> Result<(), String> {
    if filename.contains("..")
        || filename.contains('/')
        || filename.contains('\\')
        || filename.contains('\0')
        || filename.is_empty()
    {
        return Err(format!("Invalid filename: {filename}"));
    }
    Ok(())
}

/// Sanitize a backup tag to only allow safe filename characters.
fn sanitize_tag(tag: &str) -> String {
    tag.chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect()
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

/// List all data files (*.json + *.txt, excluding backups dir) in a directory.
fn list_data_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && p.extension()
                    .is_some_and(|ext| ext == "json" || ext == "txt")
                && p.file_name()
                    .is_some_and(|name| name != "local-config.json")
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
    let default_dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!("Failed to get app data dir: {e}");
            return String::new();
        }
    };
    if let Err(e) = fs::create_dir_all(&default_dir) {
        log::warn!("Failed to create default data dir {}: {e}", default_dir.display());
    }
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
    validate_filename(&filename).ok()?;
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
    validate_filename(&filename)?;
    let dir = state.get_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    let path = dir.join(&filename);

    // Atomic write: write to temp file then rename
    let tmp_path = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, json.as_bytes()).map_err(|e| format!("Failed to write {filename}: {e}"))?;
    fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to rename {filename}: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn read_text_file(
    filename: String,
    state: tauri::State<'_, StorageState>,
) -> Option<String> {
    validate_filename(&filename).ok()?;
    let path = state.get_dir().join(&filename);
    fs::read_to_string(&path).ok()
}

#[tauri::command]
pub fn write_text_file(
    filename: String,
    content: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    validate_filename(&filename)?;
    let dir = state.get_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
    let path = dir.join(&filename);

    // Atomic write: write to temp file then rename
    let tmp_path = path.with_extension("txt.tmp");
    fs::write(&tmp_path, content.as_bytes())
        .map_err(|e| format!("Failed to write {filename}: {e}"))?;
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

/// Parse a backup zip filename: backup_{timestamp}.{tag}.zip
fn parse_backup_filename(filename: &str) -> Option<(String, String)> {
    let without_ext = filename.strip_suffix(".zip")?;
    let without_prefix = without_ext.strip_prefix("backup_")?;
    let (timestamp, tag) = without_prefix.rsplit_once('.')?;
    Some((timestamp.to_string(), tag.to_string()))
}

#[tauri::command]
pub fn create_backup(
    tag: String,
    state: tauri::State<'_, StorageState>,
) -> Result<String, String> {
    let tag = sanitize_tag(&tag);
    if tag.is_empty() {
        return Err("Backup tag must contain at least one alphanumeric character".to_string());
    }
    let data_dir = state.get_dir();
    let backup_dir = data_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create backup dir: {e}"))?;

    let files = list_data_files(&data_dir);
    if files.is_empty() {
        return Ok(String::new());
    }

    let now = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let zip_name = format!("backup_{now}.{tag}.zip");
    let zip_path = backup_dir.join(&zip_name);
    let tmp_path = zip_path.with_extension("zip.tmp");

    let zip_file = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create backup zip: {e}"))?;
    let mut zip_writer = zip::ZipWriter::new(zip_file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for file in &files {
        let name = file
            .file_name()
            .ok_or("Invalid filename")?
            .to_string_lossy();
        let contents = fs::read(file)
            .map_err(|e| format!("Failed to read {name}: {e}"))?;
        zip_writer
            .start_file(name.as_ref(), options)
            .map_err(|e| format!("Failed to add {name} to zip: {e}"))?;
        zip_writer
            .write_all(&contents)
            .map_err(|e| format!("Failed to write {name} to zip: {e}"))?;
    }

    zip_writer
        .finish()
        .map_err(|e| format!("Failed to finalize zip: {e}"))?;

    fs::rename(&tmp_path, &zip_path)
        .map_err(|e| format!("Failed to rename backup zip: {e}"))?;

    Ok(zip_name)
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
                && e.path()
                    .extension()
                    .is_some_and(|ext| ext == "zip")
        })
        .filter_map(|e| {
            let path = e.path();
            let filename = path.file_name()?.to_string_lossy().to_string();
            let size = e.metadata().ok()?.len();
            let (timestamp, tag) = parse_backup_filename(&filename)?;

            // Read file list from zip
            let zip_file = fs::File::open(&path).ok()?;
            let archive = zip::ZipArchive::new(zip_file).ok()?;
            let files: Vec<String> = (0..archive.len())
                .filter_map(|i| {
                    archive
                        .name_for_index(i)
                        .map(|name| name.to_string())
                })
                .collect();

            Some(BackupEntry {
                path: path.to_string_lossy().to_string(),
                filename,
                timestamp,
                tag,
                size,
                files,
            })
        })
        .collect();

    // Sort newest first by timestamp
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

    // Ensure the backup path is under our backups directory
    let backup_dir = state.get_dir().join("backups");
    let canonical_backup = backup
        .canonicalize()
        .map_err(|e| format!("Invalid backup path: {e}"))?;
    let canonical_dir = backup_dir
        .canonicalize()
        .map_err(|e| format!("Backup dir error: {e}"))?;
    if !canonical_backup.starts_with(&canonical_dir) {
        return Err("Backup path is outside the backups directory".to_string());
    }

    // Create a pre-restore backup first
    create_backup("pre-restore".to_string(), state.clone())?;

    // Extract zip contents to data dir
    let data_dir = state.get_dir();
    let zip_file =
        fs::File::open(&backup).map_err(|e| format!("Failed to open backup: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|e| format!("Invalid backup zip: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;
        let name = entry.name().to_string();

        // Safety: only extract files with safe names
        validate_filename(&name)?;

        let dest = data_dir.join(&name);
        let mut contents = Vec::new();
        entry
            .read_to_end(&mut contents)
            .map_err(|e| format!("Failed to read {name} from zip: {e}"))?;
        fs::write(&dest, &contents)
            .map_err(|e| format!("Failed to restore {name}: {e}"))?;
    }

    Ok(())
}

#[tauri::command]
pub fn append_to_log(
    subdir: String,
    filename: String,
    content: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    validate_filename(&filename)?;
    // Validate subdir: only allow simple directory names
    if subdir.contains("..") || subdir.contains('/') || subdir.contains('\\') || subdir.contains('\0') || subdir.is_empty() {
        return Err(format!("Invalid subdirectory: {subdir}"));
    }

    let dir = state.get_dir().join(&subdir);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create log dir: {e}"))?;
    let path = dir.join(&filename);

    use std::fs::OpenOptions;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open log file: {e}"))?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write to log: {e}"))?;

    Ok(())
}

/* ── Custom sound files ──────────────────────────────────── */

const MAX_SOUND_SIZE: u64 = 5 * 1024 * 1024; // 5 MB
const ALLOWED_SOUND_EXTENSIONS: &[&str] = &["wav", "mp3", "ogg", "webm"];

fn validate_chime_id(chime_id: &str) -> Result<(), String> {
    if chime_id != "chime1" && chime_id != "chime2" {
        return Err(format!("Invalid chime id: {chime_id}"));
    }
    Ok(())
}

/// Find an existing custom sound file for a chime (any supported extension).
fn find_custom_sound(sounds_dir: &Path, chime_id: &str) -> Option<PathBuf> {
    for ext in ALLOWED_SOUND_EXTENSIONS {
        let path = sounds_dir.join(format!("custom-{chime_id}.{ext}"));
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

#[tauri::command]
pub fn import_sound_file(
    source_path: String,
    chime_id: String,
    state: tauri::State<'_, StorageState>,
) -> Result<String, String> {
    validate_chime_id(&chime_id)?;

    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(format!("File not found: {source_path}"));
    }

    // Validate extension
    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !ALLOWED_SOUND_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "Unsupported audio format: .{ext}. Use wav, mp3, ogg, or webm."
        ));
    }

    // Validate file size
    let metadata = fs::metadata(&source).map_err(|e| format!("Cannot read file: {e}"))?;
    if metadata.len() > MAX_SOUND_SIZE {
        return Err(format!(
            "File too large ({:.1} MB). Maximum is 5 MB.",
            metadata.len() as f64 / (1024.0 * 1024.0)
        ));
    }

    let sounds_dir = state.get_dir().join("sounds");
    fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("Failed to create sounds dir: {e}"))?;

    let dest_name = format!("custom-{chime_id}.{ext}");
    let dest = sounds_dir.join(&dest_name);

    // Atomic write: copy to temp file then rename (before deleting old)
    let tmp_dest = dest.with_extension(format!("{ext}.tmp"));
    fs::copy(&source, &tmp_dest)
        .map_err(|e| format!("Failed to copy sound file: {e}"))?;
    fs::rename(&tmp_dest, &dest)
        .map_err(|e| format!("Failed to finalize sound file: {e}"))?;

    // Remove old custom sound only after new one is safely in place
    // (it may have a different extension, e.g. old .mp3 replaced by new .wav)
    if let Some(existing) = find_custom_sound(&sounds_dir, &chime_id) {
        if existing != dest {
            let _ = fs::remove_file(&existing);
        }
    }

    Ok(dest_name)
}

#[tauri::command]
pub fn get_sound_base64(
    chime_id: String,
    state: tauri::State<'_, StorageState>,
) -> Option<String> {
    validate_chime_id(&chime_id).ok()?;

    let sounds_dir = state.get_dir().join("sounds");
    let path = find_custom_sound(&sounds_dir, &chime_id)?;
    let bytes = fs::read(&path).ok()?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav");
    let mime = match ext {
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "webm" => "audio/webm",
        _ => "audio/wav",
    };

    Some(format!("data:{mime};base64,{b64}"))
}

#[tauri::command]
pub fn remove_custom_sound(
    chime_id: String,
    state: tauri::State<'_, StorageState>,
) -> Result<(), String> {
    validate_chime_id(&chime_id)?;

    let sounds_dir = state.get_dir().join("sounds");
    if let Some(path) = find_custom_sound(&sounds_dir, &chime_id) {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to remove custom sound: {e}"))?;
    }
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
        .filter(|p| p.is_file() && p.extension().is_some_and(|ext| ext == "zip"))
        .collect();

    if files.len() <= keep {
        return Ok(0);
    }

    // Sort newest first by filename (timestamps are embedded)
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
