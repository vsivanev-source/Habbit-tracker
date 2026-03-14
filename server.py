#!/usr/bin/env python3
import http.server
import os

os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('', 8080), handler)
print(f'Serving at http://localhost:8080')
httpd.serve_forever()
