// AI 框选识别:拖动框选黑板区域,截图发给服务端 VL 模型做结构化识别,
// 按类型分发:公式 -> 函数窗口;2D 图形 -> 创建对应粉笔画;3D 图形 -> 创建对应立体

// API 地址:默认同源相对路径(前后端一起部署);
// 前后端分开部署时在 api-config.js 里设置 window.BLACKBOARD_API_BASE,如 'https://api.example.com'
const API_BASE = (window.BLACKBOARD_API_BASE || '').replace(/\/+$/, '');

export function initAI({ chalkCanvas, addExpression, addShape2D, addShape3D, onStatus }) {
  let start = null, cur = null;

  function down(x, y) {
    start = { x, y };
    cur = { x, y };
  }

  function move(x, y) {
    if (start) cur = { x, y };
  }

  function cancel() {
    start = cur = null;
  }

  function up() {
    if (!start || !cur) { cancel(); return; }
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
    const w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    cancel();
    if (w < 8 || h < 8) return;
    capture(x, y, w, h);
  }

  function drawOverlay(ctx) {
    if (!start || !cur) return;
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
    const w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    ctx.save();
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(79,140,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  async function capture(x, y, w, h) {
    // chalkCanvas 按 dpr 放大存储,截取时坐标同步换算;底色填充为黑板色,避免透明底影响识别
    const dpr = window.devicePixelRatio || 1;
    const tmp = document.createElement('canvas');
    tmp.width = Math.round(w * dpr);
    tmp.height = Math.round(h * dpr);
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#14181c';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(
      chalkCanvas,
      Math.round(x * dpr), Math.round(y * dpr), tmp.width, tmp.height,
      0, 0, tmp.width, tmp.height
    );

    onStatus('AI 识别中…');
    try {
      const resp = await fetch(API_BASE + '/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: tmp.toDataURL('image/png') }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || ('HTTP ' + resp.status));
      const type = (data.type || 'none').trim();
      const rect = { x, y, w, h };
      if (type === 'formula' && (data.expression || '').trim()) {
        const expr = data.expression.trim();
        addExpression(expr);
        onStatus('已识别公式: ' + expr);
      } else if (type === 'shape2d' && data.shape) {
        if (addShape2D?.(data.shape.trim(), rect)) {
          onStatus('已创建 2D 图形: ' + data.shape);
        } else {
          onStatus('不支持的 2D 图形类型: ' + data.shape, true);
        }
      } else if (type === 'shape3d' && data.shape) {
        if (addShape3D?.(data.shape.trim(), rect)) {
          onStatus('已创建 3D 图形: ' + data.shape);
        } else {
          onStatus('不支持的 3D 图形类型: ' + data.shape, true);
        }
      } else {
        onStatus('未识别到公式或图形');
      }
    } catch (err) {
      onStatus('识别失败: ' + err.message, true);
    }
  }

  return { down, move, up, cancel, drawOverlay };
}
