use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;

const BACKFILL_BYTES: u64 = 256 * 1024;
const POLL: Duration = Duration::from_millis(200);

fn read_range(path: &PathBuf, start: u64, end: u64) -> std::io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(start))?;
    let mut buf = Vec::with_capacity((end - start) as usize);
    f.take(end - start).read_to_end(&mut buf)?;
    Ok(buf)
}

fn split_lines(bytes: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(bytes)
        .split('\n')
        .map(|l| l.trim_end_matches('\r').to_string())
        .filter(|l| !l.is_empty())
        .collect()
}

/// Follows a growing log file by polling its size (file watching is unreliable on
/// Windows for files another process keeps open). Runs until `alive()` turns false.
pub fn spawn<A, F>(path: PathBuf, alive: A, on_lines: F)
where
    A: Fn() -> bool + Send + 'static,
    F: Fn(Vec<String>, bool) + Send + 'static,
{
    thread::spawn(move || {
        let size = |p: &PathBuf| std::fs::metadata(p).map(|m| m.len());
        let mut offset = 0u64;
        if let Ok(sz) = size(&path) {
            let start = sz.saturating_sub(BACKFILL_BYTES);
            if let Ok(bytes) = read_range(&path, start, sz) {
                let mut slice = &bytes[..];
                if start > 0 {
                    // the first line is probably cut in half
                    if let Some(i) = slice.iter().position(|&b| b == b'\n') {
                        slice = &slice[i + 1..];
                    }
                }
                offset = start + bytes.len() as u64;
                on_lines(split_lines(slice), true);
            }
        }
        let mut partial: Vec<u8> = Vec::new();
        while alive() {
            thread::sleep(POLL);
            let Ok(sz) = size(&path) else { continue };
            if sz < offset {
                offset = 0; // log was truncated
                partial.clear();
            }
            if sz == offset {
                continue;
            }
            let Ok(bytes) = read_range(&path, offset, sz) else { continue };
            offset += bytes.len() as u64;
            partial.extend_from_slice(&bytes);
            // keep the incomplete trailing line as bytes, so UTF-8 is never split
            if let Some(i) = partial.iter().rposition(|&b| b == b'\n') {
                let complete: Vec<u8> = partial.drain(..=i).collect();
                let lines = split_lines(&complete);
                if !lines.is_empty() && alive() {
                    on_lines(lines, false);
                }
            }
        }
    });
}
