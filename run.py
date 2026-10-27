"""啟動面試練習工具：python run.py（加 --port 8800 換埠號，--no-browser 不自動開瀏覽器）。"""
import argparse
import webbrowser

from app.server import serve

p = argparse.ArgumentParser()
p.add_argument("--port", type=int, default=8765)
p.add_argument("--no-browser", action="store_true")
args = p.parse_args()

try:
    httpd = serve(args.port)
except OSError:
    raise SystemExit(f"埠號 {args.port} 已經被其他程式使用。請改用其他埠號，例如：python run.py --port 8800")
url = f"http://127.0.0.1:{args.port}/"
print(f"面試練習工具已啟動：{url}\n要結束時，回到這個視窗按 Ctrl+C。")
if not args.no_browser:
    webbrowser.open(url)
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\n已結束。")
