// Minimal Win32 bindings: is the Path of Exile window in front?
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* buf, int max)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* buf, int max)');

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
  if (readString(GetClassNameW, hwnd) === 'POEWindowClass') return true;
  return /^Path of Exile( 2)?$/.test(readString(GetWindowTextW, hwnd));
}

module.exports = { foregroundWindow, isPoeWindow };
