// Minimal Win32 bindings: find/focus the PoE window and send keystrokes to it.
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(void* hWnd)');
const IsWindow = user32.func('int __stdcall IsWindow(void* hWnd)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* buf, int max)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* buf, int max)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
const MapVirtualKeyW = user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t mapType)');

const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vk)');

const KEYUP = 0x0002;
const VK = { LBUTTON: 0x01, RETURN: 0x0d, SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, ESCAPE: 0x1b, A: 0x41, V: 0x56 };

// Returns { down, pressed } where pressed = went down since the previous call.
function keyState(vk) {
  const s = GetAsyncKeyState(vk);
  return { down: (s & 0x8000) !== 0, pressed: (s & 1) !== 0 };
}

function readString(fn, hwnd) {
  const buf = new Uint16Array(256);
  const n = fn(hwnd, buf, 256);
  return String.fromCharCode(...buf.subarray(0, n));
}

function foregroundWindow() {
  return GetForegroundWindow();
}

function isPoeWindow(hwnd) {
  if (!hwnd) return false;
  const cls = readString(GetClassNameW, hwnd);
  if (cls === 'POEWindowClass') return true;
  return /^Path of Exile( 2)?$/.test(readString(GetWindowTextW, hwnd));
}

function focusWindow(hwnd) {
  if (hwnd && IsWindow(hwnd)) SetForegroundWindow(hwnd);
}

function key(vk, up) {
  keybd_event(vk, MapVirtualKeyW(vk, 0), up ? KEYUP : 0, 0);
}

function tap(vk, ...mods) {
  for (const m of mods) key(m, false);
  key(vk, false);
  key(vk, true);
  for (const m of mods.reverse()) key(m, true);
}

const release = (vk) => key(vk, true);

module.exports = { foregroundWindow, isPoeWindow, focusWindow, tap, release, keyState, VK };
