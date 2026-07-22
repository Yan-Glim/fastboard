"""黑板应用服务器:静态文件 + /api/recognize VL 公式识别接口。

用法:
    cp config.example.yml config.yml   # 填写 VL 模型配置(只需一次)
    python server.py [端口]            # 默认端口 8000
然后浏览器打开 http://localhost:8000

说明:
    - 页面通过 POST /api/recognize 调用识别,api_key 只存在服务端 config.yml
    - config.yml 禁止通过 HTTP 访问,且已加入 .gitignore
    - 解析 config.yml 优先使用 PyYAML,未安装时使用内置简易解析(仅支持扁平 key: value)
"""
import json
import re
import sys
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

PROMPT = (
    "判断图片中手绘内容的类型,只输出一个 JSON 对象,不要输出任何其他文字:\n"
    '- 若是数学公式/函数: {"type":"formula","expression":"以 x 为自变量的表达式,'
    '如 x^2、sin(x)、2*x+1"}\n'
    '- 若是 2D 平面几何图形: {"type":"shape2d","shape":"<kind>"}\n'
    '- 若是 3D 立体图形: {"type":"shape3d","shape":"<kind>"}\n'
    '- 若无法识别: {"type":"none"}\n'
    "2D kind 只能是: line, arrow, rect, ellipse, triangle, rtriangle(直角三角形), "
    "isotriangle(等腰三角形), parallelogram(平行四边形), trapezoid(梯形), "
    "rhombus(菱形), star(五角星), cross(十字形), polygon(正多边形), "
    "semicircle(半圆), sector(扇形), arc(圆弧), ring(圆环)\n"
    "3D kind 只能是: cube(立方体), tetra(四面体), octa(八面体), dodeca(十二面体), "
    "icosa(二十面体), prism(三棱柱), pentaprism(五棱柱), hexaprism(六棱柱), "
    "tripyramid(三棱锥), pyramid(四棱锥), pentapyramid(五棱锥), "
    "cylinder(圆柱), cone(圆锥), frustum(圆台), sphere(球)"
)

MAX_BODY = 20 * 1024 * 1024  # 20MB,防止超大请求


def load_config():
    path = Path(__file__).with_name("config.yml")
    if not path.exists():
        raise RuntimeError("缺少 config.yml,请复制 config.example.yml 并填写 VL 模型配置")
    text = path.read_text(encoding="utf-8")
    try:
        import yaml
        cfg = yaml.safe_load(text) or {}
    except ImportError:
        cfg = {}
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            k, v = line.split(":", 1)
            cfg[k.strip()] = _parse_value(v.strip())
    for key in ("base_url", "api_key", "model"):
        if not cfg.get(key):
            raise RuntimeError(f"config.yml 缺少配置项: {key}")
    return cfg


def _parse_value(v):
    """简易 YAML 标量解析:支持引号包裹和行内 # 注释。"""
    if v[:1] in ('"', "'"):
        end = v.find(v[0], 1)
        return v[1:end] if end > 0 else v[1:]
    return v.split(" #", 1)[0].strip()


def recognize(image_data_url):
    """调用 OpenAI 兼容的 VL 接口,返回结构化识别结果 dict。

    优先带 response_format 请求 JSON 模式;若接口不支持(HTTP 400)则去掉重试。
    返回 {"type": ..., "expression": ..., "shape": ...}。
    """
    cfg = load_config()
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg["api_key"],
    }

    def call(with_json_mode):
        payload = {
            "model": cfg["model"],
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            }],
            "max_tokens": 300,
        }
        if with_json_mode:
            payload["response_format"] = {"type": "json_object"}
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"].strip()

    try:
        content = call(True)
    except urllib.error.HTTPError as e:
        if e.code != 400:
            raise
        content = call(False)
    return parse_result(content)


def parse_result(content):
    """解析模型输出为结构化结果,兼容非 JSON 的兜底输出。"""
    try:
        obj = json.loads(content)
    except ValueError:
        # 模型未严格输出 JSON 时,截取第一个 {...} 片段再试
        m = re.search(r"\{.*\}", content, re.S)
        if m:
            try:
                obj = json.loads(m.group(0))
            except ValueError:
                obj = None
        else:
            obj = None
    if isinstance(obj, dict) and obj.get("type"):
        return {
            "type": str(obj.get("type", "none")),
            "expression": str(obj.get("expression", "") or ""),
            "shape": str(obj.get("shape", "") or ""),
        }
    # 兜底:模型只输出了表达式文本(旧行为),按公式处理
    text = content.strip().strip('"')
    if text:
        return {"type": "formula", "expression": text, "shape": ""}
    return {"type": "none", "expression": "", "shape": ""}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 禁止缓存,方便开发调试
        self.send_header("Cache-Control", "no-store")
        # 放开 CORS:允许前端单独部署到其他源后跨域调用 /api/recognize
        # (api_key 只在服务端,响应内容不含敏感信息)
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def do_OPTIONS(self):
        # 跨域预检请求:直接放行
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默日志

    def _blocked(self):
        # 禁止通过 HTTP 访问敏感文件,防止 api_key / 仓库内容泄漏
        p = self.path.split("?", 1)[0]
        return p.endswith("config.yml") or p.startswith("/.git")

    def do_GET(self):
        if self._blocked():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self._blocked():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        if self.path.split("?", 1)[0] != "/api/recognize":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("请求体大小无效")
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            image = body.get("image", "")
            if not image.startswith("data:image/"):
                raise ValueError("无效的图像数据")
            self._json(200, recognize(image))
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"黑板应用已启动: http://localhost:{port}")
    print("按 Ctrl+C 停止服务")
    try:
        # ThreadingHTTPServer:识别请求耗时几秒,多线程避免阻塞静态文件加载
        ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
