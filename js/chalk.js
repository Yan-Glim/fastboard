// 粉笔层:手写 / 像素橡皮 / 2D 几何图形 / 选中编辑
// 渲染到离屏 canvas(作为 Three.js 纹理),背景透明 —— 擦除处透出板面底色

const DASH = { solid: [], dash: [14, 8], dot: [2.5, 7] };

export function initChalk(canvas, hooks = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;

  const state = {
    tool: 'pen',
    color: '#f5f5f5',
    lineWidth: 3,
    dash: 'solid',
    fill: false,
    polySides: 5,
    objects: [],     // 笔画 / 图形 / 擦除痕迹(按序渲染)
    selected: -1,
    selVert: -1,     // 选中图形的选中顶点(高亮变色)
  };

  function resize(w, h, dpr) {
    W = w; H = h;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  // ---------- 几何 ----------
  const SHAPE_TOOLS = ['line', 'arrow', 'rect', 'ellipse', 'triangle', 'star', 'polygon',
    'rtriangle', 'isotriangle', 'parallelogram', 'trapezoid', 'rhombus', 'cross', 'blockarrow',
    'semicircle', 'sector', 'arc', 'ring'];
  // 不闭合路径的图形(命中/描边不封口)
  const OPEN_KINDS = new Set(['line', 'arrow', 'arc']);
  // 无固定顶点的图形:不提供逐顶点编辑手柄
  const NO_VERT_KINDS = new Set(['ellipse', 'semicircle', 'sector', 'arc', 'ring']);

  // 圆弧采样(单位盒内上半弧,a∈[0,π])
  const arcPts = n => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = i / n * Math.PI;
      pts.push([Math.cos(a), -Math.sin(a)]);
    }
    return pts;
  };

  function shapePath(kind, sides) {
    switch (kind) {
      case 'line':
      case 'arrow': return [[-1, 0], [1, 0]];   // 局部 x 轴对齐起点->终点,见 newShape
      case 'rect': return [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      case 'triangle': return [[0, -1], [1, 1], [-1, 1]];
      case 'rtriangle': return [[-1, -1], [1, 1], [-1, 1]];
      case 'isotriangle': return [[0, -1], [0.8, 1], [-0.8, 1]];
      case 'parallelogram': return [[-0.6, -1], [1, -1], [0.6, 1], [-1, 1]];
      case 'trapezoid': return [[-0.6, -1], [0.6, -1], [1, 1], [-1, 1]];
      case 'rhombus': return [[0, -1], [0.7, 0], [0, 1], [-0.7, 0]];
      case 'cross': return [[-0.33, -1], [0.33, -1], [0.33, -0.33], [1, -0.33], [1, 0.33], [0.33, 0.33],
        [0.33, 1], [-0.33, 1], [-0.33, 0.33], [-1, 0.33], [-1, -0.33], [-0.33, -0.33]];
      case 'blockarrow': return [[-1, -0.4], [0.2, -0.4], [0.2, -1], [1, 0], [0.2, 1], [0.2, 0.4], [-1, 0.4]];
      case 'semicircle': return arcPts(32);
      case 'arc': return arcPts(32);
      case 'sector': {
        // 圆心在单位盒左下角,半径 2 的四分之一圆弧
        const pts = [[-1, 1]];
        for (let i = 0; i <= 24; i++) {
          const a = i / 24 * Math.PI / 2;
          pts.push([-1 + 2 * Math.cos(a), 1 - 2 * Math.sin(a)]);
        }
        return pts;
      }
      case 'star': {
        const pts = [];
        for (let i = 0; i < 10; i++) {
          const r = i % 2 === 0 ? 1 : 0.45;
          const a = -Math.PI / 2 + i * Math.PI / 5;
          pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return pts;
      }
      case 'polygon': {
        const n = Math.max(3, sides), pts = [];
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 + i * 2 * Math.PI / n;
          pts.push([Math.cos(a), Math.sin(a)]);
        }
        return pts;
      }
      default: return [];
    }
  }

  function newShape(kind, x0, y0, x1, y1) {
    const s = {
      type: 'shape', kind, sides: state.polySides,
      cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
      rotation: 0,
      color: state.color, width: state.lineWidth,
      dash: state.dash, fill: state.fill,
      // 显式顶点(单位盒局部坐标),支持选择模式下逐顶点编辑
      pts: shapePath(kind, state.polySides).map(p => [...p]),
    };
    if (kind === 'line' || kind === 'arrow') {
      // 直线/箭头:严格从按下点到松开点 —— 局部 x 轴对齐拖动方向
      const dx = x1 - x0, dy = y1 - y0;
      s.hw = Math.max(Math.hypot(dx, dy) / 2, 1);
      s.hh = 8;   // 只影响手柄/命中带,路径本身在 v=0 上
      s.rotation = Math.atan2(dy, dx);
    } else {
      s.hw = Math.max(Math.abs(x1 - x0) / 2, 1);
      s.hh = Math.max(Math.abs(y1 - y0) / 2, 1);
    }
    return s;
  }

  function toLocal(s, x, y) {
    const dx = x - s.cx, dy = y - s.cy;
    const c = Math.cos(-s.rotation), sn = Math.sin(-s.rotation);
    return { x: (dx * c - dy * sn) / s.hw, y: (dx * sn + dy * c) / s.hh };
  }

  function toWorld(s, ux, uy) {
    const c = Math.cos(s.rotation), sn = Math.sin(s.rotation);
    const x = ux * s.hw, y = uy * s.hh;
    return { x: s.cx + x * c - y * sn, y: s.cy + x * sn + y * c };
  }

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function hitStroke(o, x, y) {
    const tol = Math.max(o.width / 2, 6) + 4;
    const pts = o.points;
    if (pts.length === 1) return Math.hypot(x - pts[0].x, y - pts[0].y) <= tol;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSeg(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= tol) return true;
    }
    return false;
  }

  function pointInPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = [pts[i].x, pts[i].y], [xj, yj] = [pts[j].x, pts[j].y];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // 命中 = 光标到各边线段的距离在容差内(填充图形内部也算),
  // 不再用外接框 —— 否则点框内空白处也会误选中
  function hitShape(s, x, y) {
    const tol = Math.max(s.width / 2 + 4, 8);
    if (s.kind === 'ellipse' || s.kind === 'ring') {
      const p = toLocal(s, x, y);
      const r = Math.hypot(p.x, p.y);
      const scale = (s.hw + s.hh) / 2;
      if (s.kind === 'ellipse') {
        if (s.fill && r <= 1) return true;
        return Math.abs(1 - r) * scale <= tol;
      }
      // 圆环:命中内/外圆周,填充时命中环带
      const inner = 0.55;
      if (s.fill && r >= inner && r <= 1) return true;
      return Math.abs(1 - r) * scale <= tol || Math.abs(inner - r) * scale <= tol;
    }
    const pts = s.pts.map(([u, v]) => toWorld(s, u, v));
    const closed = !OPEN_KINDS.has(s.kind);
    if (s.fill && closed && pointInPoly(x, y, pts)) return true;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (distToSeg(x, y, a.x, a.y, b.x, b.y) <= tol) return true;
    }
    return false;
  }

  // ---------- 渲染 ----------
  // 路径点变换到屏幕坐标后用恒定线宽描边:
  // 不能用 ctx.scale(hw,hh) 缩放描边 —— 非均匀缩放会把线宽拉伸,导致各边粗细不一
  function drawShape(s) {
    ctx.save();
    ctx.lineWidth = s.width;
    ctx.setLineDash(DASH[s.dash] || []);
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (s.kind === 'ellipse') {
      const N = 64;
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        const p = toWorld(s, Math.cos(a), Math.sin(a));
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
    } else if (s.kind === 'ring') {
      // 圆环:外圆 + 反向内圆,evenodd 填充出环带
      const N = 64, inner = 0.55;
      for (let i = 0; i <= N; i++) {
        const a = i / N * Math.PI * 2;
        const p = toWorld(s, Math.cos(a), Math.sin(a));
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.closePath();
      for (let i = N; i >= 0; i--) {
        const a = i / N * Math.PI * 2;
        const p = toWorld(s, inner * Math.cos(a), inner * Math.sin(a));
        i === N ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      if (s.fill) ctx.fill('evenodd');
      ctx.stroke();
      ctx.restore();
      return;
    } else {
      const pts = s.pts.map(([u, v]) => toWorld(s, u, v));
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (!OPEN_KINDS.has(s.kind)) ctx.closePath();
    }
    if (s.fill && !OPEN_KINDS.has(s.kind)) ctx.fill();
    ctx.stroke();
    if (s.kind === 'arrow') {
      const tip = toWorld(s, ...s.pts[1]), tail = toWorld(s, ...s.pts[0]);
      const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x);
      const len = Math.min(18, Math.hypot(tip.x - tail.x, tip.y - tail.y) * 0.35);
      ctx.setLineDash([]);
      ctx.beginPath();
      // 倒刺在箭头尖端后方张开(cos(ang±2.6) 为负 = 沿线反向)
      for (const off of [2.6, -2.6]) {
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x + len * Math.cos(ang + off), tip.y + len * Math.sin(ang + off));
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStroke(o) {
    const pts = o.points;
    ctx.save();
    if (o.erase) ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = o.erase ? '#000' : o.color;
    ctx.lineWidth = o.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(o.erase ? [] : (DASH[o.dash] || []));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const mx = (pts[i - 1].x + pts[i].x) / 2, my = (pts[i - 1].y + pts[i].y) / 2;
      ctx.quadraticCurveTo(pts[i - 1].x, pts[i - 1].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
    ctx.restore();
  }

  let drawing = null;   // 进行中的笔画/图形

  function render() {
    ctx.clearRect(0, 0, W, H);
    for (const o of state.objects) {
      if (o.type === 'stroke') drawStroke(o);
      else drawShape(o);
    }
    if (drawing) {
      if (drawing.type === 'stroke') drawStroke(drawing);
      else drawShape(newShape(drawing.kind, drawing.x0, drawing.y0, drawing.x1, drawing.y1));
    }
    hooks.onChange?.();
  }

  // 选中手柄画到覆盖层(CSS 像素坐标)
  function drawOverlay(octx) {
    const s = state.objects[state.selected];
    if (!s || s.type !== 'shape') return;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => toWorld(s, u, v));
    octx.save();
    octx.strokeStyle = '#4f8cff';
    octx.lineWidth = 1.5;
    octx.setLineDash([5, 4]);
    octx.beginPath();
    octx.moveTo(corners[0].x, corners[0].y);
    corners.slice(1).forEach(p => octx.lineTo(p.x, p.y));
    octx.closePath();
    octx.stroke();
    octx.setLineDash([]);
    octx.fillStyle = '#fff';
    for (const p of corners) {
      octx.beginPath(); octx.rect(p.x - 5, p.y - 5, 10, 10); octx.fill(); octx.stroke();
    }
    const top = toWorld(s, 0, -1), rot = toWorld(s, 0, -1 - 24 / s.hh);
    octx.beginPath(); octx.moveTo(top.x, top.y); octx.lineTo(rot.x, rot.y); octx.stroke();
    octx.beginPath(); octx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); octx.fill(); octx.stroke();
    // 顶点手柄(无固定顶点的图形跳过):选中的顶点变色高亮
    if (!NO_VERT_KINDS.has(s.kind)) {
      s.pts.forEach(([u, v], i) => {
        const p = toWorld(s, u, v);
        octx.beginPath();
        octx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        octx.fillStyle = i === state.selVert ? '#ff8833' : '#ffcc33';
        octx.fill();
        octx.strokeStyle = '#7a5200';
        octx.lineWidth = 1;
        octx.stroke();
      });
    }
    octx.restore();
  }

  // ---------- 历史操作(闭包,交给全局栈) ----------
  function histAdd(objs) {
    hooks.pushHistory?.({
      redo() { state.objects.push(...objs); state.selected = -1; render(); },
      undo() {
        for (const o of objs) {
          const i = state.objects.indexOf(o);
          if (i >= 0) state.objects.splice(i, 1);
        }
        state.selected = -1; render();
      },
    });
  }

  function histRemove(entries) {
    hooks.pushHistory?.({
      redo() {
        for (const { obj } of entries) {
          const i = state.objects.indexOf(obj);
          if (i >= 0) state.objects.splice(i, 1);
        }
        state.selected = -1; render();
      },
      undo() {
        for (const { obj, index } of [...entries].sort((a, b) => a.index - b.index)) {
          state.objects.splice(Math.min(index, state.objects.length), 0, obj);
        }
        render();
      },
    });
  }

  function histTransform(index, before, after) {
    hooks.pushHistory?.({
      redo() { const o = state.objects[index]; if (o) { Object.assign(o, after); render(); } },
      undo() { const o = state.objects[index]; if (o) { Object.assign(o, before); render(); } },
    });
  }

  // ---------- 指针交互(坐标为 CSS 像素) ----------
  let drag = null;

  // 命中测试(供 main.js 在选择模式下决定事件路由):
  // 'handle' = 选中图形的手柄, 'object' = 某个图形/笔画, null = 空白
  function hitTest(x, y) {
    const sel = state.objects[state.selected];
    if (sel && sel.type === 'shape' && selectionHandle(sel, x, y)) return 'handle';
    for (let i = state.objects.length - 1; i >= 0; i--) {
      const o = state.objects[i];
      if (o.erase) continue;
      if (o.type === 'stroke' ? hitStroke(o, x, y) : hitShape(o, x, y)) return 'object';
    }
    return null;
  }

  function selectionHandle(s, x, y) {
    // 优先顶点手柄:点中顶点 = 拖动该顶点改形
    if (!NO_VERT_KINDS.has(s.kind)) {
      for (let i = 0; i < s.pts.length; i++) {
        const p = toWorld(s, s.pts[i][0], s.pts[i][1]);
        if (Math.hypot(x - p.x, y - p.y) <= 9) return { mode: 'vertex', vi: i };
      }
    }
    const rot = toWorld(s, 0, -1 - 24 / s.hh);
    if (Math.hypot(x - rot.x, y - rot.y) <= 10) return { mode: 'rotate' };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ u, v, ...toWorld(s, u, v) }));
    for (const c of corners) {
      if (Math.abs(x - c.x) <= 8 && Math.abs(y - c.y) <= 8) return { mode: 'scale', u: c.u, v: c.v };
    }
    return null;
  }

  const snapShape = s => ({ cx: s.cx, cy: s.cy, hw: s.hw, hh: s.hh, rotation: s.rotation,
    pts: s.pts ? s.pts.map(p => [...p]) : undefined });

  function down(x, y, e) {
    if (state.tool === 'pen') {
      drawing = { type: 'stroke', color: state.color, width: state.lineWidth, dash: state.dash, points: [{ x, y }] };
    } else if (state.tool === 'eraser') {
      drawing = { type: 'stroke', erase: true, width: state.lineWidth * 4 + 8, points: [{ x, y }] };
    } else if (SHAPE_TOOLS.includes(state.tool)) {
      drawing = { kind: state.tool, x0: x, y0: y, x1: x, y1: y };
    } else if (state.tool === 'select') {
      const sel = state.objects[state.selected];
      if (sel && sel.type === 'shape') {
        const h = selectionHandle(sel, x, y);
        if (h) {
          state.selVert = h.mode === 'vertex' ? h.vi : -1;
          drag = { ...h, index: state.selected, before: snapShape(sel) };
          render();
          return true;
        }
      }
      let found = -1;
      for (let i = state.objects.length - 1; i >= 0; i--) {
        const o = state.objects[i];
        if (o.erase) continue;
        const hit = o.type === 'stroke' ? hitStroke(o, x, y) : hitShape(o, x, y);
        if (hit) { found = i; break; }
      }
      state.selected = found;
      state.selVert = -1;
      if (found >= 0 && state.objects[found].type === 'shape') {
        drag = { mode: 'move', index: found, last: { x, y }, before: snapShape(state.objects[found]) };
      }
      render();
      return true;
    }
    return true;
  }

  function move(x, y) {
    if (drawing) {
      if (drawing.type === 'stroke') drawing.points.push({ x, y });
      else { drawing.x1 = x; drawing.y1 = y; }
      render();
    } else if (drag) {
      const s = state.objects[drag.index];
      if (!s) { drag = null; return; }
      if (drag.mode === 'move') {
        s.cx += x - drag.last.x;
        s.cy += y - drag.last.y;
        drag.last = { x, y };
      } else if (drag.mode === 'scale') {
        const lp = toLocal(s, x, y);
        s.hw = Math.max(Math.abs(lp.x) * s.hw, 5);
        s.hh = Math.max(Math.abs(lp.y) * s.hh, 5);
      } else if (drag.mode === 'rotate') {
        s.rotation = Math.atan2(y - s.cy, x - s.cx) + Math.PI / 2;
      } else if (drag.mode === 'vertex') {
        // 拖动顶点改形:光标换算到图形局部单位坐标,直接写回该顶点
        const lp = toLocal(s, x, y);
        s.pts[drag.vi] = [lp.x, lp.y];
      }
      render();
    }
  }

  function up() {
    if (drawing) {
      if (drawing.type === 'stroke') {
        if (drawing.points.length) {
          state.objects.push(drawing);
          state.selected = -1;
          histAdd([drawing]);
        }
      } else {
        const d = drawing;
        if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) > 4) {
          const s = newShape(d.kind, d.x0, d.y0, d.x1, d.y1);
          state.objects.push(s);
          state.selected = state.objects.length - 1;
          histAdd([s]);
        }
      }
      drawing = null;
      render();
    }
    if (drag) {
      const s = state.objects[drag.index];
      if (s) {
        const after = snapShape(s);
        if (JSON.stringify(after) !== JSON.stringify(drag.before)) {
          histTransform(drag.index, drag.before, after);
        }
      }
      drag = null;
    }
  }

  // ---------- 工具栏绑定 ----------
  const $ = id => document.getElementById(id);
  $('bColor').addEventListener('input', e => state.color = e.target.value);
  $('bWidth').addEventListener('input', e => state.lineWidth = +e.target.value);
  $('bDash').addEventListener('change', e => state.dash = e.target.value);
  $('bFill').addEventListener('change', e => state.fill = e.target.checked);
  $('bSides').addEventListener('input', e => {
    state.polySides = Math.min(20, Math.max(3, +e.target.value || 3));
  });

  function setTool(t) {
    state.tool = t;
    state.selected = -1;
    state.selVert = -1;
    drag = null;
    document.getElementById('bSides').hidden = t !== 'polygon';
    render();
  }

  return {
    down, move, up, render, drawOverlay, setTool, resize,
    canvas, hitTest,
    deselect() { state.selected = -1; state.selVert = -1; render(); },
    _dbg: { state },
    get tool() { return state.tool; },
    // 供外部(AI 识别)按框选区域直接创建图形
    addShape(kind, x0, y0, x1, y1) {
      if (!SHAPE_TOOLS.includes(kind)) return false;
      const s = newShape(kind, x0, y0, x1, y1);
      state.objects.push(s);
      state.selected = state.objects.length - 1;
      histAdd([s]);
      render();
      return true;
    },
    deleteSelected() {
      if (state.selected < 0) return false;
      const obj = state.objects[state.selected];
      const entries = [{ obj, index: state.selected }];
      state.objects.splice(state.selected, 1);
      state.selected = -1;
      render();
      histRemove(entries);
      return true;
    },
    clear() {
      if (!state.objects.length) return;
      const entries = state.objects.map((obj, index) => ({ obj, index }));
      state.objects = [];
      state.selected = -1;
      render();
      histRemove(entries);
    },
  };
}
