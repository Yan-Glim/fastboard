// 主入口:全窗口 Three.js 黑板 —— 正交固定视角,粉笔层纹理 + 3D 物体 + 覆盖层手柄
import * as THREE from 'three';
import { initChalk } from './chalk.js';
import { initSolids } from './solids.js';
import { initFunctions } from './functions.js';
import { initAI } from './ai.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const BG = 0x14181c;

// ---------- 渲染器 / 场景 / 正交相机 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setClearColor(BG);
$('gl').appendChild(renderer.domElement);

const scene = new THREE.Scene();
let W = 1, H = 1;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
camera.position.z = 10;

scene.add(new THREE.HemisphereLight(0xffffff, 0x28303c, 1.1));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 5);
scene.add(dirLight);

// ---------- 统一历史栈 ----------
const undoStack = [], redoStack = [];
function pushHistory(a) {
  undoStack.push(a);
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
  syncHistory();
}
function undo() {
  const a = undoStack.pop();
  if (a) { a.undo(); redoStack.push(a); }
  syncHistory();
}
function redo() {
  const a = redoStack.pop();
  if (a) { a.redo(); undoStack.push(a); }
  syncHistory();
}
function syncHistory() {
  $('btnUndo').disabled = !undoStack.length;
  $('btnRedo').disabled = !redoStack.length;
}

// ---------- 粉笔层(离屏 canvas -> 纹理) ----------
const chalkCanvas = document.createElement('canvas');
const chalkTex = new THREE.CanvasTexture(chalkCanvas);
const chalkPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  // depthWrite 必须关闭:粉笔层只是背景,不能在深度缓冲里挡住身后的 3D 虚线棱
  new THREE.MeshBasicMaterial({ map: chalkTex, transparent: true, depthWrite: false })
);
chalkPlane.position.z = -1;
scene.add(chalkPlane);

const chalk = initChalk(chalkCanvas, {
  onChange: () => { chalkTex.needsUpdate = true; },
  pushHistory,
});

// ---------- 3D 物体层 ----------
const solids = initSolids(scene, camera, { pushHistory });

// ---------- 函数图像窗口层 ----------
const funcs = initFunctions(stage, {});

// ---------- AI 框选识别层 ----------
let toastTimer;
function toast(msg, isErr = false) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 5000);
}
const ai = initAI({
  chalkCanvas,
  addExpression: expr => funcs.addExpression(expr),
  // 识别为 2D 图形:在框选区域原位创建对应粉笔画
  addShape2D: (kind, r) => chalk.addShape(kind, r.x, r.y, r.x + r.w, r.y + r.h),
  // 识别为 3D 图形:在框选中心创建对应立体,尺寸跟随框选大小
  addShape3D: (kind, r) => solids.addSolid(kind, r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h)),
  onStatus: toast,
});

// ---------- 覆盖层(手柄 / 坐标轴) ----------
const overlay = $('overlay');
const octx = overlay.getContext('2d');

function resize() {
  W = stage.clientWidth;
  H = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  renderer.setSize(W, H);
  camera.left = -W / 2; camera.right = W / 2;
  camera.top = H / 2; camera.bottom = -H / 2;
  camera.updateProjectionMatrix();
  overlay.width = Math.round(W * dpr);
  overlay.height = Math.round(H * dpr);
  octx.setTransform(dpr, 0, 0, dpr, 0, 0);
  chalk.resize(W, H, dpr);
  chalkPlane.scale.set(W, H, 1);
  solids.resize(W, H);
}
window.addEventListener('resize', resize);
// 顶栏换行/3D面板弹出等布局变化也会改变画布区高度,但窗口不触发 resize,
// 不重算会让渲染内容纵向压缩、点击位置和图形错位 —— 监听画布区尺寸变化
new ResizeObserver(() => resize()).observe(stage);

// ---------- 工具切换 ----------
let tool = 'pen';
const toolBtns = [...document.querySelectorAll('#topbar [data-tool]')];
const menuBtns = [...document.querySelectorAll('#topbar [data-menu]')];
function closeMenus() {
  document.querySelectorAll('#topbar .flyout').forEach(f => f.hidden = true);
}
menuBtns.forEach(b => b.addEventListener('click', e => {
  e.stopPropagation();
  const f = document.getElementById(b.dataset.menu);
  const wasHidden = f.hidden;
  closeMenus();
  f.hidden = !wasHidden;
}));
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.menu')) closeMenus();
});
function setTool(t) {
  tool = t;
  toolBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  // 分类按钮:高亮包含当前工具的菜单,并把标签换成最近使用的图形
  menuBtns.forEach(b => {
    const items = [...document.getElementById(b.dataset.menu).querySelectorAll('[data-tool]')];
    const active = items.find(i => i.dataset.tool === t);
    b.classList.toggle('active', !!active);
    if (active) b.textContent = active.textContent.trim() + ' ▾';
  });
  $('solidPanel').hidden = t !== 'solid';
  if (t !== 'ai') ai.cancel();
  if (t === 'solid') {
    renderer.domElement.style.cursor = 'default';
  } else if (t === 'ai') {
    solids.deselect();
    solids.cancelCut();
    renderer.domElement.style.cursor = 'crosshair';
  } else {
    chalk.setTool(t);
    solids.deselect();
    solids.cancelCut();
    renderer.domElement.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }
  closeMenus();
}
toolBtns.forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

// 添加多面体后自动切到 3D 工具
$('sAdd').addEventListener('click', () => setTool('solid'));

// ---------- 指针路由 ----------
// 注意:画布上方有顶栏,必须把视口坐标换算成画布坐标,否则笔迹偏移
const dom = renderer.domElement;
function toLocal(e) {
  const r = dom.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
dom.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  try { dom.setPointerCapture(e.pointerId); } catch {}
  const p = toLocal(e);
  if (tool === 'solid') {
    solids.down(p.x, p.y, e);
  } else if (tool === 'ai') {
    ai.down(p.x, p.y);
  } else if (tool === 'select') {
    // 选择工具也能框住 3D 多面体:点在多面体上 -> 选中并默认拖动移动;
    // 点在 2D 图形/手柄上 -> 走粉笔层;点空白 -> 两层都取消选中
    const h = chalk.hitTest(p.x, p.y);
    if (h !== 'handle' && solids.hitBody(p.x, p.y)) {
      chalk.deselect();
      if (solids._dbg.level !== 'object') solids.setLevel('object');   // 保证拖动=移动整体
      solids.down(p.x, p.y, e);
    } else {
      solids.deselect();
      chalk.down(p.x, p.y, e);
    }
  } else {
    // 橡皮只擦 2D 粉笔画,不删 3D 多面体(删除用 Delete 键)
    chalk.down(p.x, p.y, e);
  }
});
dom.addEventListener('pointermove', e => {
  const p = toLocal(e);
  if (tool === 'solid') {
    solids.move(p.x, p.y);
  } else if (tool === 'ai') {
    ai.move(p.x, p.y);
  } else {
    // 选择模式下两层都可能持有拖拽,各自无活动拖拽时为空操作
    chalk.move(p.x, p.y);
    if (tool === 'select') solids.move(p.x, p.y);
  }
});
dom.addEventListener('pointerup', () => {
  if (tool === 'solid') {
    solids.up();
  } else if (tool === 'ai') {
    ai.up();
  } else {
    chalk.up();
    if (tool === 'select') solids.up();
  }
});
// 滚轮:3D/选择模式下缩放选中对象
dom.addEventListener('wheel', e => {
  if ((tool === 'solid' || tool === 'select') && solids.wheel(e.deltaY)) e.preventDefault();
}, { passive: false });

// 样式变化时,若正在编辑 3D 图形则同步颜色/粗细到选中物体
function syncSolidStyle() {
  if (tool === 'solid' && solids.hasSelection()) {
    solids.applyStyle({
      color: new THREE.Color($('bColor').value).getHex(),
      width: +$('bWidth').value,
    });
  }
}
$('bColor').addEventListener('input', syncSolidStyle);
$('bWidth').addEventListener('input', syncSolidStyle);

// ---------- 顶栏按钮 ----------
$('btnFunc').addEventListener('click', () => funcs.createWindow());
$('btnUndo').addEventListener('click', undo);
$('btnRedo').addEventListener('click', redo);
$('btnClear').addEventListener('click', () => {
  if (!confirm('确定清空整个黑板?')) return;
  chalk.clear();
  solids.clear();
});

// ---------- 快捷键 ----------
window.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (tool === 'solid') solids.deleteSelected();
    else if (!chalk.deleteSelected() && solids.hasSelection()) solids.deleteSelected();
    return;
  }
  const k = e.key.toLowerCase();
  if (tool === 'solid') {
    if (k === 'enter') solids.executeCut();
    else if (k === 'escape') solids.cancelCut();
    else if (k === '1') solids.setLevel('object');
    else if (k === '2') solids.setLevel('vertex');
    else if (k === '3') solids.setLevel('edge');
  } else {
    const t = { p: 'pen', e: 'eraser', v: 'select', a: 'ai' }[k];
    if (t) setTool(t);
  }
});

// ---------- 主循环 ----------
resize();
setTool('pen');
syncHistory();
renderer.setAnimationLoop(() => {
  octx.clearRect(0, 0, W, H);
  chalk.drawOverlay(octx);
  solids.drawOverlay(octx);
  ai.drawOverlay(octx);
  solids.tick(performance.now());   // 切割虚线闪烁动画
  renderer.render(scene, camera);
});

// 调试/测试钩子
window.__bb = { chalk, solids, camera, renderer };
