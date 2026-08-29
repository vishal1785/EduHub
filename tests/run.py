#!/usr/bin/env python3
"""
Run the whole test suite.

The project has no build step and no Node runtime, so the tests run in a real
browser against the real ES modules. This script starts a local server, drives
headless Chrome (or Edge) through every suite, and prints the results.

    python tests/run.py

Exit code is 0 if everything passed, 1 otherwise.

A static pre-flight runs first (cross-module calls, service-worker precache
list), then three browser suites:

  tests/verify.html   unit-level checks of the question bank, the generators
                      (every generated answer is independently recomputed) and
                      the quiz engine.
  tests/storage.html  exercises js/storage.js against real IndexedDB: attempt
                      history, and one resumable quiz per quiz type.
  tests/smoke.html    drives the actual app in an iframe: every screen renders,
                      a full quiz can be played through to its result and
                      review screens.

The storage and smoke suites need the completion barrier below. Headless Chrome dumps the
DOM at the load event, which lands long before the app has finished reading
IndexedDB, so the page holds its own load event open (via a trailing
<script src="/__block">) until it has posted its results to /__done.
"""
import http.server
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BROWSERS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]


def find_browser():
    for path in BROWSERS:
        if os.path.exists(path):
            return path
    for name in ("google-chrome", "chromium", "chrome", "msedge"):
        found = shutil.which(name)
        if found:
            return found
    return None


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Server:
    """Static file server with the /__block and /__done completion barrier."""

    def __init__(self, port):
        self.port = port
        self.done = threading.Event()
        self.payload = None
        outer = self

        class Handler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *a, **kw):
                super().__init__(*a, directory=REPO, **kw)

            def log_message(self, *a):
                pass

            def end_headers(self):
                self.send_header("Cache-Control", "no-store, must-revalidate")
                super().end_headers()

            def do_GET(self):
                if self.path.split("?")[0] == "/__block":
                    outer.done.wait(timeout=180)
                    body = b"/* released */"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/javascript")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                return super().do_GET()

            def do_POST(self):
                if self.path.split("?")[0] != "/__done":
                    self.send_error(404)
                    return
                length = int(self.headers.get("Content-Length", 0))
                outer.payload = self.rfile.read(length).decode("utf-8")
                self.send_response(204)
                self.end_headers()
                outer.done.set()

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)

    def start(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def reset(self):
        """Re-arm the barrier so the next page can use it."""
        self.done = threading.Event()
        self.payload = None

    def stop(self):
        self.httpd.shutdown()


NEWLINE = chr(10)


def strip_html(text):
    return re.sub(r"<[^>]+>", "", text).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")


def run_page(browser, url, profile):
    """Load a page in headless Chrome and return its dumped DOM."""
    proc = subprocess.run(
        [
            browser,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--disk-cache-size=1",
            "--virtual-time-budget=120000",
            "--user-data-dir=" + profile,
            "--dump-dom",
            url,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=300,
    )
    return proc.stdout or ""


def module_exports(path):
    """Property names on a module's `export const <name> = { ... };` object."""
    src = io.open(path, encoding="utf-8").read()
    m = re.search(r"export const \w+ = \{(.*?)\n\};", src, re.S)
    if not m:
        return None
    names = set()
    for line in m.group(1).split(NEWLINE):
        line = line.strip().rstrip(",")
        if not line or line.startswith("//"):
            continue
        names.add(line.split(":")[0].strip())
    return names


def preflight():
    """
    Static checks that need no browser.

    These exist because of a real failure: js/app.js called
    storage.getActiveQuizzes() while a stale service worker was still serving
    an old js/storage.js, and the app died with "is not a function". The
    cross-module check below catches the same shape of mistake in the source,
    and the precache check catches a new module being left out of the service
    worker's file list - which is what let the two versions drift apart.
    """
    problems = []

    # 1. Every foo.bar(...) call must exist on foo's exported object.
    modules = {
        "storage": "js/storage.js",
        "quizEngine": "js/quiz.js",
        "progressEngine": "js/progress.js",
    }
    exports = {}
    for alias, rel in modules.items():
        names = module_exports(os.path.join(REPO, rel))
        if names is None:
            problems.append("could not read the export object of %s" % rel)
        else:
            exports[alias] = names

    for root, dirs, files in os.walk(os.path.join(REPO, "js")):
        for f in sorted(files):
            if not f.endswith(".js"):
                continue
            src = io.open(os.path.join(root, f), encoding="utf-8").read()
            for alias, names in exports.items():
                for used in sorted(set(re.findall(r"\b%s\.(\w+)\s*\(" % alias, src))):
                    if used not in names:
                        problems.append("js/%s calls %s.%s(), which %s does not export"
                                        % (f, alias, used, modules[alias]))

    # 2. Every named import must actually be exported by the module it comes
    #    from. `import { promptDialog } from "./ui.js"` is a runtime error only
    #    when the page loads, so catching it here is much cheaper.
    for root, dirs, files in os.walk(os.path.join(REPO, "js")):
        for f in sorted(files):
            if not f.endswith(".js"):
                continue
            src = io.open(os.path.join(root, f), encoding="utf-8").read()
            for names, target in re.findall(r"import\s*\{([^}]*)\}\s*from\s*[\"']\./([\w.]+)[\"']", src):
                target_path = os.path.join(root, target)
                if not os.path.exists(target_path):
                    problems.append("js/%s imports from ./%s, which does not exist" % (f, target))
                    continue
                target_src = io.open(target_path, encoding="utf-8").read()
                exported = set(re.findall(r"export\s+(?:async\s+)?function\s+(\w+)", target_src))
                exported |= set(re.findall(r"export\s+const\s+(\w+)", target_src))
                for name in names.split(","):
                    name = name.strip().split(" as ")[0].strip()
                    if name and name not in exported:
                        problems.append("js/%s imports { %s } from ./%s, which does not export it"
                                        % (f, name, target))

    # 3. The boot watchdog must survive. It is the only thing that can report a
    #    failure to LINK the module graph - at that point none of the app's own
    #    JavaScript has run - so losing it turns any future module mismatch back
    #    into a permanent "Loading your practice app..." with no way out.
    index = io.open(os.path.join(REPO, "index.html"), encoding="utf-8").read()
    app_src = io.open(os.path.join(REPO, "js", "app.js"), encoding="utf-8").read()
    if "__APP_READY" not in index:
        problems.append("index.html has lost its boot watchdog (no __APP_READY check)")
    if "boot-recover" not in index:
        problems.append("index.html's boot watchdog no longer offers a recovery button")
    if 'type="module"' in index and index.index("__APP_READY") > index.index('type="module"'):
        problems.append("the boot watchdog must be registered before the module script")
    if "window.__APP_READY = true" not in app_src:
        problems.append("js/app.js never sets __APP_READY, so the watchdog would fire on a healthy boot")

    # 4. The stylesheet's ?v= must track CACHE_NAME. They are two halves of one
    #    idea - "this is a new generation of assets" - and when they drift a
    #    browser can pair new markup with an old stylesheet, which renders the
    #    app unstyled. That happened once and is easy to miss by hand.
    sw_src = io.open(os.path.join(REPO, "service-worker.js"), encoding="utf-8").read()
    cache_m = re.search(r'CACHE_NAME\s*=\s*"[^"]*?v(\d+)"', sw_src)
    css_m = re.search(r'style\.css\?v=(\d+)', index)
    if not cache_m:
        problems.append("could not read the cache generation from service-worker.js")
    elif not css_m:
        problems.append("index.html does not request css/style.css with a ?v= generation")
    elif cache_m.group(1) != css_m.group(1):
        problems.append("stylesheet ?v=%s does not match the service worker cache v%s"
                        % (css_m.group(1), cache_m.group(1)))

    # 5. The service worker must precache every app file, and nothing missing.
    sw = io.open(os.path.join(REPO, "service-worker.js"), encoding="utf-8").read()
    listed = set(re.findall(r'"\./([^"]*)"', sw))
    on_disk = set()
    for sub_dir in ("js", "css", "data"):
        for f in sorted(os.listdir(os.path.join(REPO, sub_dir))):
            if f.endswith((".js", ".css", ".json")):
                on_disk.add("%s/%s" % (sub_dir, f))
    on_disk.update({"index.html", "manifest.json"})

    for missing in sorted(on_disk - listed):
        problems.append("service-worker.js does not precache %s" % missing)
    for ghost in sorted(listed - on_disk):
        if ghost and not os.path.exists(os.path.join(REPO, ghost)):
            problems.append("service-worker.js precaches %s, which does not exist" % ghost)

    print(NEWLINE + "=" * 62)
    print("pre-flight (static checks)")
    print("=" * 62)
    if problems:
        for problem in problems:
            print("  FAIL " + problem)
        print(NEWLINE + "%d problem(s)" % len(problems))
        return 1
    print("  PASS every cross-module call resolves to an exported function")
    print("  PASS every named import resolves to a real export")
    print("  PASS the boot watchdog is present and wired to the app")
    print("  PASS the stylesheet ?v= matches the service worker cache generation")
    print("  PASS the service worker precaches every app file")
    print(NEWLINE + "RESULT: PASS")
    return 0


def main():
    browser = find_browser()
    if not browser:
        print("No Chrome/Chromium/Edge found. Install one, or open these files in a browser:")
        print("  tests/verify.html, tests/storage.html, tests/smoke.html")
        print("  (the last two need tests/run.py's server for their completion barrier)")
        return 1
    print("browser: %s" % browser)

    port = free_port()
    server = Server(port)
    server.start()
    tmp = tempfile.mkdtemp(prefix="c7-tests-")
    failed = preflight()

    try:
        # --- unit suite ------------------------------------------------
        print("\n" + "=" * 62)
        print("tests/verify.html")
        print("=" * 62)
        dom = run_page(browser, "http://127.0.0.1:%d/tests/verify.html" % port, os.path.join(tmp, "p1"))
        m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
        out = strip_html(m.group(1)) if m else "(no output — the page did not finish)"
        print(out)
        if "RESULT: PASS" not in out:
            failed += 1

        # --- suites that report through the completion barrier ----------
        for i, page in enumerate(("tests/storage.html", "tests/smoke.html")):
            server.reset()
            print(NEWLINE + "=" * 62)
            print(page)
            print("=" * 62)
            run_page(browser, "http://127.0.0.1:%d/%s" % (port, page), os.path.join(tmp, "p%d" % (i + 2)))
            out = strip_html(server.payload or "(no output - the page did not report back)")
            print(out)
            if "RESULT: PASS" not in out:
                failed += 1
    finally:
        server.done.set()
        time.sleep(0.5)
        server.stop()
        shutil.rmtree(tmp, ignore_errors=True)

    print("\n" + ("ALL SUITES PASSED" if failed == 0 else "%d SUITE(S) FAILED" % failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
