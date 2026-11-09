"""Optional local server:  python3 serve.py  ->  http://localhost:8765"""
import functools, http.server, pathlib
root = pathlib.Path(__file__).resolve().parent
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
print("Serving", root, "at http://localhost:8765  (Ctrl+C to stop)")
http.server.ThreadingHTTPServer(("127.0.0.1", 8765), handler).serve_forever()
