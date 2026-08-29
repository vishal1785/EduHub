#!/usr/bin/env python3
"""
Local dev server for Learn Splash.

    python serve.py            # http://localhost:8000
    python serve.py 8080       # a different port

Use this rather than `python -m http.server`.

`http.server` sends a Last-Modified header but no Cache-Control, which lets
the browser apply "heuristic freshness" and reuse files without asking the
server whether they changed. On an app made of plain ES modules that is
genuinely painful: you edit css/style.css or js/ui.js, reload, and get the
copy from ten minutes ago - or worse, a mix of old and new files, where a
module missing an export that another one imports stops the whole app from
loading. This server sends `Cache-Control: no-store` on everything, so what
you see is always what is on disk.

It also prints your machine's LAN address, which is how to open the app on a
phone on the same Wi-Fi. Note that the offline service worker is deliberately
skipped on localhost but does register over the LAN address, so that is also
the way to test offline/installable behaviour.
"""
import http.server
import os
import socket
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # The whole point of this server: never let the browser reuse a file
        # without checking with us first.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One tidy line per request, without the date noise.
        sys.stdout.write("  %s\n" % (fmt % args))


def lan_address():
    """Best guess at this machine's address on the local network."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))  # no packets are sent; just picks a route
        addr = s.getsockname()[0]
        s.close()
        return addr
    except Exception:
        return None


def main():
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Usage: python serve.py [port]")
            return 1

    try:
        httpd = http.server.ThreadingHTTPServer(("0.0.0.0", port), Handler)
    except OSError as err:
        print("Could not start on port %d: %s" % (port, err))
        print("Try another port, e.g.  python serve.py %d" % (port + 1))
        return 1

    lan = lan_address()
    print("")
    print("  Learn Splash - dev server (caching disabled)")
    print("  ------------------------------------------------")
    print("  On this computer:  http://localhost:%d" % port)
    if lan:
        print("  On your phone:     http://%s:%d" % (lan, port))
        print("                     (same Wi-Fi; this address also registers")
        print("                      the offline worker, localhost does not)")
    print("")
    print("  Ctrl+C to stop.")
    print("")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
