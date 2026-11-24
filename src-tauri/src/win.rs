// Minimal Win32: is PoE in front, where is the cursor, and show/hide the overlay
// without stealing focus. HWNDs are passed around as isize so they can cross threads.
use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
use windows_sys::Win32::UI::WindowsAndMessaging::*;

fn h(hwnd: isize) -> HWND {
    hwnd as HWND
}

pub fn foreground() -> isize {
    unsafe { GetForegroundWindow() as isize }
}

fn read(hwnd: isize, class: bool) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe {
        if class {
            GetClassNameW(h(hwnd), buf.as_mut_ptr(), 256)
        } else {
            GetWindowTextW(h(hwnd), buf.as_mut_ptr(), 256)
        }
    };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

pub fn is_poe(hwnd: isize) -> bool {
    if hwnd == 0 {
        return false;
    }
    if read(hwnd, true) == "POEWindowClass" {
        return true;
    }
    matches!(read(hwnd, false).as_str(), "Path of Exile" | "Path of Exile 2")
}

pub fn cursor_inside(hwnd: isize) -> bool {
    unsafe {
        let mut p = POINT { x: 0, y: 0 };
        let mut r = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetCursorPos(&mut p) == 0 || GetWindowRect(h(hwnd), &mut r) == 0 {
            return false;
        }
        p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
    }
}

/// Show without activating (so PoE keeps keyboard focus) and re-assert topmost.
pub fn set_visible(hwnd: isize, visible: bool) {
    unsafe {
        if visible {
            ShowWindow(h(hwnd), SW_SHOWNOACTIVATE);
            SetWindowPos(h(hwnd), HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        } else {
            ShowWindow(h(hwnd), SW_HIDE);
        }
    }
}
