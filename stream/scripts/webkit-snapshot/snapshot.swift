// Snapshots a page in a real WKWebView, the engine Stream ships on, without
// screen recording permission or focus. Run it through
// scripts/webkit-snapshot.sh, which compiles it; see AGENTS.md for the workflow.
//
//   snapshot --url URL --out PNG [--width 900] [--height 600]
//            [--stub FILE]... [--run JS_OR_FILE] [--wait SECONDS] [--visible]
//
// --stub    Scripts injected at document start, in order (tauri-stub.js first).
// --run     JavaScript run after the page settles, as the body of an async
//           function: `await` works and `return` sends a value back, printed
//           as JSON. Pass a file path or inline code.
// --wait    Seconds to let the page load and hydrate before --run (default 6;
//           the first hit of a route also compiles it).
// --visible Shows the window at 1% opacity, so requestAnimationFrame and
//           timers run at full speed (tooltips, popovers, animations).
//
// Console errors and warnings are printed after the run, and the process
// exits non-zero if the snapshot fails or times out.

import AppKit
import WebKit

struct Options {
  var url: URL?
  var out: String?
  var width = 900.0
  var height = 600.0
  var stubs: [String] = []
  var run = ""
  var wait = 6.0
  var visible = false
}

func usage(_ message: String) -> Never {
  FileHandle.standardError.write("snapshot: \(message)\n".data(using: .utf8)!)
  exit(64)
}

func readOptions() -> Options {
  var options = Options()
  var args = CommandLine.arguments.dropFirst().makeIterator()
  while let flag = args.next() {
    func value() -> String {
      guard let next = args.next() else { usage("\(flag) needs a value") }
      return next
    }
    func number() -> Double {
      guard let number = Double(value()) else { usage("\(flag) needs a number") }
      return number
    }
    switch flag {
    case "--url": options.url = URL(string: value())
    case "--out": options.out = value()
    case "--width": options.width = number()
    case "--height": options.height = number()
    case "--stub": options.stubs.append(value())
    case "--run":
      let code = value()
      options.run = (try? String(contentsOfFile: code, encoding: .utf8)) ?? code
    case "--wait": options.wait = number()
    case "--visible": options.visible = true
    default: usage("unknown option \(flag)")
    }
  }
  if options.url == nil || options.out == nil { usage("--url and --out are required") }
  return options
}

/// WebKit only updates :hover and :focus in the key window. Claiming to be key
/// takes no focus from the user.
class KeyWindow: NSWindow {
  override var isKeyWindow: Bool { true }
  override var canBecomeKey: Bool { true }
}

class ConsoleLog: NSObject, WKScriptMessageHandler {
  var lines: [String] = []
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    lines.append("\(message.body)")
  }
}

let options = readOptions()
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)

let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let console = ConsoleLog()
config.userContentController.add(console, name: "console")
let consoleHook = """
  for (const level of ["error", "warn"]) {
    const original = console[level];
    console[level] = (...args) => {
      try {
        const text = args.map((a) => a instanceof Error ? a.stack || a.message
          : typeof a === "string" ? a : JSON.stringify(a)).join(" ");
        window.webkit.messageHandlers.console.postMessage(`${level}: ${text}`);
      } catch {}
      original.apply(console, args);
    };
  }
  window.addEventListener("error", (e) =>
    window.webkit.messageHandlers.console.postMessage(`uncaught: ${e.message}`));
  """
config.userContentController.addUserScript(
  WKUserScript(source: consoleHook, injectionTime: .atDocumentStart, forMainFrameOnly: true))
for path in options.stubs {
  guard let source = try? String(contentsOfFile: path, encoding: .utf8) else {
    usage("can't read stub \(path)")
  }
  config.userContentController.addUserScript(
    WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
}
// A hidden page never advances CSS transitions, so they'd freeze at frame 0
let noTransitions = """
  document.documentElement.appendChild(Object.assign(document.createElement("style"),
    { textContent: "*, *::before, *::after { transition: none !important; }" }));
  """
config.userContentController.addUserScript(
  WKUserScript(source: noTransitions, injectionTime: .atDocumentEnd, forMainFrameOnly: true))

let frame = NSRect(x: 0, y: 0, width: options.width, height: options.height)
let window = KeyWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
let web = WKWebView(frame: frame, configuration: config)
window.contentView = web
if options.visible {
  window.alphaValue = 0.01
  window.orderFrontRegardless()
}
NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: window)
web.load(URLRequest(url: options.url!))

func finish() {
  web.takeSnapshot(with: nil) { image, error in
    for line in console.lines { print("console \(line)") }
    guard let image, let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:])
    else {
      print("snapshot failed: \(String(describing: error))")
      exit(1)
    }
    do {
      try png.write(to: URL(fileURLWithPath: options.out!))
    } catch {
      print("couldn't write \(options.out!): \(error)")
      exit(1)
    }
    print("wrote \(options.out!)")
    exit(0)
  }
}

DispatchQueue.main.asyncAfter(deadline: .now() + options.wait) {
  let body = options.run.isEmpty ? "return null" : options.run
  let wrapped = "const result = await (async () => { \(body) })(); return JSON.stringify(result ?? null);"
  web.callAsyncJavaScript(wrapped, arguments: [:], in: nil, in: .page) { result in
    switch result {
    case .success(let value): print("result \(value)")
    case .failure(let error): print("run failed: \(error)")
    }
    // Let React commit whatever the run changed
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { finish() }
  }
}
DispatchQueue.main.asyncAfter(deadline: .now() + options.wait + 60) {
  print("timed out")
  exit(2)
}
app.run()
