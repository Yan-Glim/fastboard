// 函数图像窗口:可新增多个窗口,每个窗口可输入多个表达式,绘制曲线和 XY 轴
// 表达式求值用安全替换后的 Function,支持 x 与常见数学函数

const PALETTE = [
  '#ff4f4f', '#4f8cff', '#4fff4f', '#ffdd4f',
  '#ff4fd8', '#4fffff', '#ffaa4f', '#c84fff',
  '#4fffb0', '#ff6b6b', '#5d8aa8', '#50c878',
];

function evalExpr(expr) {
  if (!expr.trim()) return null;
  let s = expr.toLowerCase();
  s = s.replace(/\^/g, '**');
  s = s.replace(/\bpi\b/g, 'Math.PI');
  s = s.replace(/\be\b/g, 'Math.E');
  s = s.replace(/\bsin\b/g, 'Math.sin');
  s = s.replace(/\bcos\b/g, 'Math.cos');
  s = s.replace(/\btan\b/g, 'Math.tan');
  s = s.replace(/\basin\b/g, 'Math.asin');
  s = s.replace(/\bacos\b/g, 'Math.acos');
  s = s.replace(/\batan\b/g, 'Math.atan');
  s = s.replace(/\bsqrt\b/g, 'Math.sqrt');
  s = s.replace(/\babs\b/g, 'Math.abs');
  s = s.replace(/\blog\b/g, 'Math.log10');
  s = s.replace(/\bln\b/g, 'Math.log');
  s = s.replace(/\bfloor\b/g, 'Math.floor');
  s = s.replace(/\bceil\b/g, 'Math.ceil');
  s = s.replace(/\bround\b/g, 'Math.round');
  s = s.replace(/\bmin\b/g, 'Math.min');
  s = s.replace(/\bmax\b/g, 'Math.max');
  try {
    return new Function('x', 'return ' + s);
  } catch (e) {
    return null;
  }
}

function nextColor(used) {
  for (const c of PALETTE) {
    if (!used.has(c)) return c;
  }
  return PALETTE[used.size % PALETTE.length];
}

export function initFunctions(container, hooks = {}) {
  let winCount = 0;
  let exprId = 0;
  const wins = [];

  function createWindow(withDefault = true) {
    const win = document.createElement('div');
    win.className = 'func-win';
    win.id = 'func-win-' + (++winCount);
    const off = (winCount - 1) * 30;
    win.style.left = (80 + off) + 'px';
    win.style.top = (80 + off) + 'px';
    win.style.width = '420px';
    win.style.height = '340px';

    const header = document.createElement('div');
    header.className = 'func-header';
    header.innerHTML = '<span class="func-title">函数图像 #' + winCount + '</span>' +
      '<button class="func-add" title="添加表达式">＋</button>' +
      '<button class="func-close" title="关闭">×</button>';

    const body = document.createElement('div');
    body.className = 'func-body';

    const controls = document.createElement('div');
    controls.className = 'func-controls';
    controls.innerHTML =
      '<label>Xmin<input type="number" class="fxmin" step="any" value="-10"></label>' +
      '<label>Xmax<input type="number" class="fxmax" step="any" value="10"></label>' +
      '<label>Ymin<input type="number" class="fymin" step="any" value="-10"></label>' +
      '<label>Ymax<input type="number" class="fymax" step="any" value="10"></label>' +
      '<label class="fauto"><input type="checkbox" checked> 自动Y</label>';
    body.appendChild(controls);

    const canvas = document.createElement('canvas');
    canvas.className = 'func-canvas';

    const list = document.createElement('div');
    list.className = 'func-list';

    body.appendChild(canvas);
    body.appendChild(list);
    win.appendChild(header);
    win.appendChild(body);

    // 缩放手柄
    const resize = document.createElement('div');
    resize.className = 'func-resize';
    win.appendChild(resize);

    container.appendChild(win);

    const state = {
      win,
      canvas,
      ctx: canvas.getContext('2d'),
      list,
      exprs: [],
      xMin: -10, xMax: 10,
      yMin: -10, yMax: 10,
      autoY: true,
    };
    state.addExpr = addExpr;
    wins.push(state);

    function readControls() {
      state.xMin = +controls.querySelector('.fxmin').value || -10;
      state.xMax = +controls.querySelector('.fxmax').value || 10;
      state.autoY = controls.querySelector('input[type="checkbox"]').checked;
      if (!state.autoY) {
        state.yMin = +controls.querySelector('.fymin').value || -10;
        state.yMax = +controls.querySelector('.fymax').value || 10;
      }
      if (state.xMin > state.xMax) [state.xMin, state.xMax] = [state.xMax, state.xMin];
      if (!state.autoY && state.yMin > state.yMax) [state.yMin, state.yMax] = [state.yMax, state.yMin];
    }

    function writeControls() {
      controls.querySelector('.fxmin').value = state.xMin;
      controls.querySelector('.fxmax').value = state.xMax;
      controls.querySelector('.fymin').value = state.yMin;
      controls.querySelector('.fymax').value = state.yMax;
    }

    controls.querySelectorAll('input').forEach(inp =>
      inp.addEventListener('input', () => { readControls(); plot(); }));

    function resizeCanvas() {
      const rect = body.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const h = rect.height - list.offsetHeight - controls.offsetHeight;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(h * dpr);
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      state.w = rect.width;
      state.h = h;
      plot();
    }

    function addExpr(text = '', color = null) {
      const used = new Set(state.exprs.map(e => e.color));
      color = color || nextColor(used);
      const row = document.createElement('div');
      row.className = 'func-row';
      const id = ++exprId;
      row.innerHTML =
        '<input type="color" class="func-color" value="' + color + '">' +
        '<input type="text" class="func-input" placeholder="如 x^2, sin(x), log(x)" value="' + text.replace(/"/g, '&quot;') + '">' +
        '<button class="func-del" title="删除">×</button>';
      const input = row.querySelector('.func-input');
      const colorInput = row.querySelector('.func-color');
      const del = row.querySelector('.func-del');
      const item = { id, row, input, colorInput, fn: null, color };

      function update() {
        item.color = colorInput.value;
        item.fn = evalExpr(input.value);
        plot();
      }
      input.addEventListener('input', update);
      colorInput.addEventListener('input', update);
      del.addEventListener('click', () => {
        state.exprs = state.exprs.filter(e => e !== item);
        row.remove();
        resizeCanvas();
      });

      state.exprs.push(item);
      list.appendChild(row);
      update();
      resizeCanvas();
      input.focus();
      return item;
    }

    function mapX(x) { return (x - state.xMin) / (state.xMax - state.xMin) * state.w; }
    function mapY(y) { return state.h - (y - state.yMin) / (state.yMax - state.yMin) * state.h; }
    function unmapX(px) { return state.xMin + px / state.w * (state.xMax - state.xMin); }

    function computeYRange() {
      if (!state.autoY) return;
      let lo = Infinity, hi = -Infinity, has = false;
      for (const e of state.exprs) {
        if (!e.fn) continue;
        const step = (state.xMax - state.xMin) / Math.max(state.w, 200);
        for (let x = state.xMin; x <= state.xMax; x += step) {
          let y;
          try { y = e.fn(x); } catch (err) { continue; }
          if (!Number.isFinite(y)) continue;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
          has = true;
        }
      }
      if (has) {
        const pad = Math.max((hi - lo) * 0.1, 0.5);
        state.yMin = lo - pad;
        state.yMax = hi + pad;
      } else {
        state.yMin = -10; state.yMax = 10;
      }
      writeControls();
    }

    function plot() {
      if (!state.w || !state.h) return;
      computeYRange();
      const ctx = state.ctx;
      ctx.clearRect(0, 0, state.w, state.h);

      // 网格
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const xStep = niceStep(state.xMax - state.xMin);
      const yStep = niceStep(state.yMax - state.yMin);
      for (let x = Math.ceil(state.xMin / xStep) * xStep; x <= state.xMax; x += xStep) {
        const px = mapX(x);
        ctx.moveTo(px, 0); ctx.lineTo(px, state.h);
      }
      for (let y = Math.ceil(state.yMin / yStep) * yStep; y <= state.yMax; y += yStep) {
        const py = mapY(y);
        ctx.moveTo(0, py); ctx.lineTo(state.w, py);
      }
      ctx.stroke();

      // 坐标轴
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const ox = mapX(0), oy = mapY(0);
      if (ox >= 0 && ox <= state.w) { ctx.moveTo(ox, 0); ctx.lineTo(ox, state.h); }
      if (oy >= 0 && oy <= state.h) { ctx.moveTo(0, oy); ctx.lineTo(state.w, oy); }
      ctx.stroke();

      // 刻度标签
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      for (let x = Math.ceil(state.xMin / xStep) * xStep; x <= state.xMax; x += xStep) {
        if (Math.abs(x) < xStep * 1e-6) continue;
        const px = mapX(x);
        ctx.fillText(fmt(x), px, Math.min(Math.max(oy + 14, 12), state.h - 2));
      }
      ctx.textAlign = 'left';
      for (let y = Math.ceil(state.yMin / yStep) * yStep; y <= state.yMax; y += yStep) {
        if (Math.abs(y) < yStep * 1e-6) continue;
        const py = mapY(y);
        ctx.fillText(fmt(y), Math.max(ox + 6, 6), py + 4);
      }

      // 曲线
      for (const e of state.exprs) {
        if (!e.fn) continue;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let first = true;
        const step = (state.xMax - state.xMin) / Math.max(state.w * 2, 400);
        for (let x = state.xMin; x <= state.xMax; x += step) {
          let y;
          try { y = e.fn(x); } catch (err) { first = true; continue; }
          if (!Number.isFinite(y)) { first = true; continue; }
          const px = mapX(x), py = mapY(y);
          if (first) { ctx.moveTo(px, py); first = false; }
          else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
      }
    }

    // 交互:窗口拖动(标题栏).用 header 捕获指针,坐标统一换算成 stage 内相对位置,
    // 避免顶栏/提示栏导致窗口偏移或跟随异常
    const stageR = () => container.getBoundingClientRect();
    let drag = null, rsz = null;
    header.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const sr = stageR();
      drag = {
        x0: e.clientX - sr.left, y0: e.clientY - sr.top,
        l: win.offsetLeft, t: win.offsetTop,
      };
      header.setPointerCapture(e.pointerId);
      win.style.zIndex = ++topZ;
    });
    header.addEventListener('pointermove', e => {
      if (!drag) return;
      const sr = stageR();
      const dx = (e.clientX - sr.left) - drag.x0;
      const dy = (e.clientY - sr.top) - drag.y0;
      win.style.left = (drag.l + dx) + 'px';
      win.style.top = (drag.t + dy) + 'px';
    });
    header.addEventListener('pointerup', e => {
      drag = null;
      try { header.releasePointerCapture(e.pointerId); } catch {}
    });
    header.addEventListener('pointercancel', () => { drag = null; });

    // 交互:缩放
    resize.addEventListener('pointerdown', e => {
      e.stopPropagation();
      rsz = { x0: e.clientX, y0: e.clientY, w: win.offsetWidth, h: win.offsetHeight };
      resize.setPointerCapture(e.pointerId);
    });
    resize.addEventListener('pointermove', e => {
      if (!rsz) return;
      win.style.width = Math.max(280, rsz.w + e.clientX - rsz.x0) + 'px';
      win.style.height = Math.max(220, rsz.h + e.clientY - rsz.y0) + 'px';
      resizeCanvas();
    });
    resize.addEventListener('pointerup', e => {
      rsz = null;
      try { resize.releasePointerCapture(e.pointerId); } catch {}
    });
    resize.addEventListener('pointercancel', () => { rsz = null; });

    header.querySelector('.func-add').addEventListener('click', () => addExpr());
    header.querySelector('.func-close').addEventListener('click', () => {
      const i = wins.indexOf(state);
      if (i >= 0) wins.splice(i, 1);
      win.remove();
    });

    // 鼠标滚轮缩放 X 范围
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      readControls();
      const k = Math.exp(-e.deltaY * 0.001);
      const rect = canvas.getBoundingClientRect();
      const cx = unmapX(e.clientX - rect.left);
      state.xMin = cx + (state.xMin - cx) * k;
      state.xMax = cx + (state.xMax - cx) * k;
      writeControls();
      plot();
    }, { passive: false });

    win.addEventListener('pointerdown', () => { win.style.zIndex = ++topZ; });

    if (withDefault) addExpr('x^2');
    setTimeout(resizeCanvas, 0);
    return state;
  }

  let topZ = 100;

  // 供外部(如 AI 识别)调用:有窗口则加入最新窗口,否则新建窗口
  function addExpression(text) {
    const st = wins.length ? wins[wins.length - 1] : createWindow(false);
    st.addExpr(text);
    st.win.style.zIndex = ++topZ;
  }

  return {
    createWindow,
    addExpression,
    count() { return winCount; },
  };
}

function niceStep(range) {
  if (range <= 0 || !Number.isFinite(range)) return 1;
  const rough = range / 8;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  let step = 5;
  if (frac <= 1.5) step = 1;
  else if (frac <= 3.5) step = 2;
  else if (frac <= 7.5) step = 5;
  return step * Math.pow(10, exp);
}

function fmt(v) {
  const s = v.toPrecision(3);
  return parseFloat(s).toString();
}
