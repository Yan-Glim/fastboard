// 3D 多面体层:固定视角黑板,标准斜二测投影(剪切矩阵:x 水平、z 竖直、y 斜 45° 减半)
// 只渲染棱线:朝向观察者的棱实线,背面被遮的棱虚线,颜色/粗细跟随画笔
import * as THREE from 'three';
import { LineSegments2 } from '../vendor/LineSegments2.js';
import { LineSegmentsGeometry } from '../vendor/LineSegmentsGeometry.js';
import { LineMaterial } from '../vendor/LineMaterial.js';

const GEO = {
  cube:    () => new THREE.BoxGeometry(1, 1, 1),
  tetra:   () => new THREE.TetrahedronGeometry(0.85),
  octa:    () => new THREE.OctahedronGeometry(0.9),
  dodeca:  () => new THREE.DodecahedronGeometry(0.75),
  icosa:   () => new THREE.IcosahedronGeometry(0.85),
  prism:   () => new THREE.CylinderGeometry(0.7, 0.7, 1.1, 3, 1),
  pyramid: () => new THREE.ConeGeometry(0.8, 1.1, 4, 1),
  pentaprism:   () => new THREE.CylinderGeometry(0.7, 0.7, 1.1, 5, 1),
  hexaprism:    () => new THREE.CylinderGeometry(0.7, 0.7, 1.1, 6, 1),
  tripyramid:   () => new THREE.ConeGeometry(0.8, 1.1, 3, 1),
  pentapyramid: () => new THREE.ConeGeometry(0.8, 1.1, 5, 1),
  cylinder: () => new THREE.CylinderGeometry(0.6, 0.6, 1.1, 32, 1),
  cone:     () => new THREE.ConeGeometry(0.7, 1.1, 32, 1),
  frustum:  () => new THREE.CylinderGeometry(0.45, 0.7, 1.0, 32, 1),
  sphere:   () => new THREE.SphereGeometry(0.7, 32, 20),
};

// 线框形体的手工棱线(自动二面角检测对光滑曲面无效):
// 返回 [{a:[x,y,z], b:[x,y,z], n:[x,y,z]|null}] —— n 为线段中点处曲面法线(局部),
// 用于逐段判断正/背面;n=null 表示轮廓母线,始终实线.
function wireframeEdges(kind) {
  const segs = [];
  const seg = (a, b, n) => segs.push({ a, b, n });
  if (kind === 'sphere') {
    const R = 0.7, N = 48;
    const norm = p => {
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] / l, p[1] / l, p[2] / l];
    };
    // 纬线(每 30°)
    for (const phi of [-60, -30, 0, 30, 60]) {
      const ph = phi * Math.PI / 180;
      const r = R * Math.cos(ph), y = R * Math.sin(ph);
      for (let i = 0; i < N; i++) {
        const a0 = i / N * 2 * Math.PI, a1 = (i + 1) / N * 2 * Math.PI;
        const p = [r * Math.cos(a0), y, r * Math.sin(a0)];
        const q = [r * Math.cos(a1), y, r * Math.sin(a1)];
        seg(p, q, norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
      }
    }
    // 经线(每 30°,过两极的整圆)
    for (const lam of [0, 30, 60, 90, 120, 150]) {
      const la = lam * Math.PI / 180;
      const dx = Math.cos(la), dz = Math.sin(la);
      for (let i = 0; i < N; i++) {
        const t0 = i / N * 2 * Math.PI, t1 = (i + 1) / N * 2 * Math.PI;
        const p = [R * Math.cos(t0) * dx, R * Math.sin(t0), R * Math.cos(t0) * dz];
        const q = [R * Math.cos(t1) * dx, R * Math.sin(t1), R * Math.cos(t1) * dz];
        seg(p, q, norm([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]));
      }
    }
  } else if (kind === 'cylinder') {
    // 两条轮廓母线
    seg([0.6, -0.55, 0], [0.6, 0.55, 0], null);
    seg([-0.6, -0.55, 0], [-0.6, 0.55, 0], null);
  } else if (kind === 'cone') {
    seg([0, 0.55, 0], [0.7, -0.55, 0], null);
    seg([0, 0.55, 0], [-0.7, -0.55, 0], null);
  } else if (kind === 'frustum') {
    seg([0.45, 0.5, 0], [0.7, -0.5, 0], null);
    seg([-0.45, 0.5, 0], [-0.7, -0.5, 0], null);
  } else {
    return null;
  }
  return segs;
}

const EDGE_SEL = '#7fb2ff';
const SOLID_SIZE = 90;
const HANDLE_PX = 6;
const PICK_PX = 12;

// 斜二测剪切(行主序):几何局部 x→水平右, y(几何体的竖直轴)→竖直上, z→右上 45° 减半并退深
const OBL = 0.5 * Math.SQRT1_2;   // 0.5·cos45° ≈ 0.3536
const SHEAR = new THREE.Matrix4().set(
  1, 0, OBL, 0,
  0, 1, OBL, 0,
  0, 0, -0.85, 0,
  0, 0, 0, 1
);
const tmpM = new THREE.Matrix4();

// 手动合成矩阵:世界矩阵 = 斜二测剪切 × TRS(matrixAutoUpdate 关闭)
function syncMatrix(s) {
  tmpM.compose(s.position, s.quaternion, s.scale);
  s.matrix.multiplyMatrices(SHEAR, tmpM);
  s.updateMatrixWorld(true);   // 立即生效,保证同一帧内的拾取/投影拿到新矩阵
}

export function initSolids(scene, camera, hooks = {}) {
  let W = 1, H = 1;
  const solids = [];
  let selected = null;
  let level = 'object';
  let freeRotate = false;    // 旋转按钮:开 = 拖动自由旋转;关 = Shift+拖动 45° 步进
  let rotAxis = 'y';         // 旋转轴:只能绕图形自身的 X/Y/Z 轴(局部空间),不会歪斜
  let cutMode = false;       // 切割模式:在棱上点选切割点
  let cutPoints = [];        // {edge, pos:Vector3(局部)} 每条棱最多保留最新 2 个
  let cutValid = false;      // 当前点集能构成分割平面
  let cutPreview = null, cutPreviewMat = null;   // 闪烁虚线预览
  let drag = null;
  let pickedVert = -1, pickedEdge = -1;
  let eraseBefore = null;

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const worldToScreen = v3 => {
    const p = v3.clone().project(camera);
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  };

  function currentStyle() {
    return {
      color: new THREE.Color(document.getElementById('bColor').value).getHex(),
      width: +document.getElementById('bWidth').value,
    };
  }

  function makeEdgeMaterials(style) {
    // 注意:斜二测剪切矩阵行列式为负,会翻转三角形绕向,
    // 线 quad 会被背面剔除 -> 必须 DoubleSide
    const vis = new LineMaterial({ color: style.color, linewidth: style.width, side: THREE.DoubleSide });
    const hid = new LineMaterial({
      color: style.color, linewidth: style.width,
      dashed: true, dashSize: 0.1, gapSize: 0.07,
      transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      depthWrite: false,
    });
    vis.resolution.set(W, H);
    hid.resolution.set(W, H);
    return { vis, hid };
  }

  // ---------- 几何 ----------
  function buildUnique(geom) {
    const pos = geom.attributes.position;
    const map = new Map(), unique = [], posToUnique = [];
    const key = v => {
      const r = Math.round(v * 1e4) / 1e4;
      return r === 0 ? '0' : String(r);
    };
    for (let i = 0; i < pos.count; i++) {
      const k = key(pos.getX(i)) + ',' + key(pos.getY(i)) + ',' + key(pos.getZ(i));
      if (!map.has(k)) { map.set(k, unique.length); unique.push({ indices: [] }); }
      unique[map.get(k)].indices.push(i);
      posToUnique[i] = map.get(k);
    }
    return { unique, posToUnique };
  }

  const getVert = (s, ui) => {
    const pos = s.userData.mesh.geometry.attributes.position;
    const i = s.userData.unique[ui].indices[0];
    return new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
  };

  const setVert = (s, ui, v) => {
    const pos = s.userData.mesh.geometry.attributes.position;
    for (const i of s.userData.unique[ui].indices) pos.setXYZ(i, v.x, v.y, v.z);
    pos.needsUpdate = true;
  };

  function nearestUnique(s, v) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < s.userData.unique.length; i++) {
      const d = getVert(s, i).distanceToSquared(v);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // 把几何三角形按法线聚类成平面(每个平面记录法线和包含的去重顶点)
  function computeClusters(s) {
    const ud = s.userData;
    const pos = ud.mesh.geometry.attributes.position;
    const idx = ud.mesh.geometry.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
    const cmap = new Map();
    ud.clusters = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(pos, i0);
      vb.fromBufferAttribute(pos, i1);
      vc.fromBufferAttribute(pos, i2);
      n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va)).normalize();
      const key = [n.x, n.y, n.z].map(v => Math.round(Math.abs(v) < 5e-3 ? 0 : v * 100) / 100).join(',');
      let c = cmap.get(key);
      if (!c) { c = { n: n.clone(), verts: new Set() }; cmap.set(key, c); ud.clusters.push(c); }
      c.verts.add(ud.posToUnique[i0]).add(ud.posToUnique[i1]).add(ud.posToUnique[i2]);
    }
  }

  // 重建棱(几何变化时):用三角形邻接+二面角检测,替代 EdgesGeometry.
  // 原因:1) 切割后的几何是没有顶点共享的 triangle soup,EdgesGeometry 会漏边或把内部扇骨当边;
  //      2) 放大后 EdgesGeometry 的数值稳定性变差,导致棱消失.
  // 关键:先用 buildUnique 把几何顶点映射到唯一顶点,再用唯一顶点索引做邻接判定.
  function rebuildEdges(s) {
    const ud = s.userData;
    // 重新建立唯一顶点映射(几何已被修改)
    const { unique, posToUnique } = buildUnique(ud.mesh.geometry);
    ud.unique = unique; ud.posToUnique = posToUnique;

    const geom = ud.mesh.geometry;
    const pos = geom.attributes.position;
    const idx = geom.index;
    const triCount = (idx ? idx.count : pos.count) / 3;

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const normals = [];
    const edges = new Map(); // key "ua,ub" (ua<ub 的唯一顶点索引) -> {tris:[ti,...]}

    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3;
      const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      va.fromBufferAttribute(pos, i0);
      vb.fromBufferAttribute(pos, i1);
      vc.fromBufferAttribute(pos, i2);
      e1.subVectors(vb, va); e2.subVectors(vc, va);
      const n = new THREE.Vector3().crossVectors(e1, e2);
      if (n.lengthSq() < 1e-14) { normals.push(null); continue; }
      normals.push(n.normalize());

      const u0 = posToUnique[i0], u1 = posToUnique[i1], u2 = posToUnique[i2];
      if (u0 === u1 || u1 === u2 || u2 === u0) continue;  // 退化三角
      const addEdge = (a, b) => {
        const u = Math.min(a, b), v = Math.max(a, b);
        const k = u + ',' + v;
        if (!edges.has(k)) edges.set(k, { tris: [] });
        edges.get(k).tris.push(t);
      };
      addEdge(u0, u1); addEdge(u1, u2); addEdge(u2, u0);
    }

    const pairs = [];
    const threshold = Math.cos(THREE.MathUtils.degToRad(15));
    for (const [k, { tris }] of edges) {
      const [ua, ub] = k.split(',').map(Number);
      let isEdge = false;
      if (tris.length === 1) {
        isEdge = true;
      } else if (tris.length === 2) {
        const n1 = normals[tris[0]], n2 = normals[tris[1]];
        if (!n1 || !n2) isEdge = true;
        else if (Math.abs(n1.dot(n2)) < threshold) isEdge = true;
      } else {
        // 多个三角共享一条边(如扇形中心):只有存在非共面邻接才算棱
        for (let i = 0; i < tris.length; i++) {
          const ni = normals[tris[i]];
          if (!ni) { isEdge = true; break; }
          for (let j = i + 1; j < tris.length; j++) {
            const nj = normals[tris[j]];
            if (!nj) { isEdge = true; break; }
            if (Math.abs(ni.dot(nj)) < threshold) { isEdge = true; break; }
          }
          if (isEdge) break;
        }
      }
      if (isEdge) pairs.push([ua, ub]);
    }
    ud.edges = pairs;
    computeClusters(s);
    reclassify(s);
  }

  // 可见性分类(旋转/剪切变化时):棱的任一相邻面朝前 -> 实线,否则虚线
  function reclassify(s) {
    const ud = s.userData;
    s.updateMatrixWorld(true);
    const nm = new THREE.Matrix3().getNormalMatrix(s.matrixWorld);
    const wn = new THREE.Vector3();
    const front = ud.clusters.map(c => wn.copy(c.n).applyMatrix3(nm).normalize().z > 1e-9);
    const visPos = [], hidPos = [];
    for (const [a, b] of ud.edges) {
      let visible = false;
      for (let ci = 0; ci < ud.clusters.length; ci++) {
        if (front[ci] && ud.clusters[ci].verts.has(a) && ud.clusters[ci].verts.has(b)) {
          visible = true; break;
        }
      }
      const va = getVert(s, a), vb = getVert(s, b);
      (visible ? visPos : hidPos).push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
    }
    // 手工线框棱(球经纬线/旋转体母线):逐段按法线分正背,n=null 恒为实线
    for (const e of ud.extraEdges || []) {
      let visible = true;
      if (e.n) {
        wn.set(e.n[0], e.n[1], e.n[2]).applyMatrix3(nm).normalize();
        visible = wn.z > 1e-9;
      }
      (visible ? visPos : hidPos).push(e.a[0], e.a[1], e.a[2], e.b[0], e.b[1], e.b[2]);
    }
    const setGeom = (line, arr, dashed) => {
      const g = new LineSegmentsGeometry();
      g.setPositions(arr);
      line.geometry.dispose();
      line.geometry = g;
      if (dashed) line.computeLineDistances();
    };
    setGeom(ud.edgeVis, visPos, false);
    setGeom(ud.edgeHid, hidPos, true);
  }

  function makeSolid(kind, style, geom, wire) {
    const fresh = !geom;
    geom = geom || GEO[kind]();
    // 面不渲染(透明),仅用于拾取和提供几何数据
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    const mats = makeEdgeMaterials(style);
    const edgeVis = new LineSegments2(new LineSegmentsGeometry(), mats.vis);
    const edgeHid = new LineSegments2(new LineSegmentsGeometry(), mats.hid);
    const g = new THREE.Group();
    g.add(mesh, edgeVis, edgeHid);
    const { unique, posToUnique } = buildUnique(geom);
    g.userData = {
      kind, mesh, edgeVis, edgeHid, mats,
      style: { ...style },
      unique, posToUnique, edges: [], clusters: [], extraEdges: [], wire: false,
    };
    g.scale.setScalar(SOLID_SIZE);
    g.matrixAutoUpdate = false;
    syncMatrix(g);
    rebuildEdges(g);
    // 新建(或快照还原的未被切割的)线框形体:用手工经纬线/母线替代自动棱检测
    if (fresh || wire) decorateWire(g, kind);
    return g;
  }

  function decorateWire(g, kind) {
    const extra = wireframeEdges(kind);
    if (!extra) return;
    const ud = g.userData;
    ud.wire = true;
    ud.extraEdges = extra;
    if (kind === 'sphere') ud.edges = [];   // 球体只画经纬线
    reclassify(g);
  }

  // ---------- 历史(全场景快照) ----------
  function geomFromArray(arr) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
    return g;
  }

  function snapshot() {
    return solids.map(s => ({
      kind: s.userData.kind,
      style: { ...s.userData.style },
      pos: s.position.toArray(),
      quat: s.quaternion.toArray(),
      scale: s.scale.toArray(),
      // 完整三角形顶点(切割后的碎片/顶点编辑都能精确还原)
      geom: Array.from(s.userData.mesh.geometry.attributes.position.array),
      wire: !!s.userData.wire,   // 未被切割过的线框形体(球/圆柱等)还原时重建经纬线
    }));
  }

  function restore(snap) {
    select(null);
    while (solids.length) disposeSolid(solids.pop());
    for (const d of snap) {
      const g = makeSolid(d.kind, d.style, geomFromArray(d.geom), d.wire);
      g.position.fromArray(d.pos);
      g.quaternion.fromArray(d.quat);
      g.scale.fromArray(d.scale);
      syncMatrix(g);
      reclassify(g);
      scene.add(g);
      solids.push(g);
    }
  }

  function histSnapshot(before, after) {
    hooks.pushHistory?.({
      redo() { restore(after); },
      undo() { restore(before); },
    });
  }

  // ---------- 增删 ----------
  // sx/sy:可选屏幕坐标(几何体中心);size:可选目标尺寸(像素,默认 SOLID_SIZE)
  function addSolid(kind, sx, sy, size) {
    if (!GEO[kind]) return false;
    const before = snapshot();
    const g = makeSolid(kind, currentStyle());
    if (sx !== undefined && sy !== undefined) {
      g.position.set(sx - W / 2, H / 2 - sy, 0);
    } else {
      g.position.set((solids.length % 3 - 1) * 60, 40 - Math.floor(solids.length / 3) * 50, 0);
    }
    if (size) g.scale.setScalar(Math.max(size, 30));
    syncMatrix(g);
    rebuildEdges(g);
    scene.add(g);
    solids.push(g);
    select(g);
    histSnapshot(before, snapshot());
    return true;
  }

  function disposeSolid(g) {
    g.userData.mesh.geometry.dispose();
    g.userData.mesh.material.dispose();
    g.userData.edgeVis.geometry.dispose();
    g.userData.edgeHid.geometry.dispose();
    g.userData.mats.vis.dispose();
    g.userData.mats.hid.dispose();
    scene.remove(g);
  }

  function removeSolid(g) {
    if (g === selected) select(null);
    if (cutPreview && cutPreview.parent === g) removePreview();
    solids.splice(solids.indexOf(g), 1);
    disposeSolid(g);
  }

  function deleteSelected() {
    if (!selected) return false;
    const before = snapshot();
    removeSolid(selected);
    histSnapshot(before, snapshot());
    return true;
  }

  function clear() {
    if (!solids.length) return;
    const before = snapshot();
    select(null);
    while (solids.length) disposeSolid(solids.pop());
    histSnapshot(before, snapshot());
  }

  function select(g) {
    if (g !== selected && cutPoints.length) { cutPoints = []; updateCutPreview(); }
    if (selected) {
      selected.userData.mats.vis.color.set(selected.userData.style.color);
    }
    selected = g;
    pickedVert = pickedEdge = -1;
    if (g) g.userData.mats.vis.color.set(EDGE_SEL);
  }

  // ---------- 切割 ----------
  const planeDist = (pl, v) =>
    (v.x - pl.c.x) * pl.n.x + (v.y - pl.c.y) * pl.n.y + (v.z - pl.c.z) * pl.n.z;

  // 由 ≥3 个点拟合平面:取离质心最远叉积的一对向量,抗不共面噪声
  function fitPlane(pts) {
    if (pts.length < 3) return null;
    const c = new THREE.Vector3();
    pts.forEach(p => c.add(p));
    c.multiplyScalar(1 / pts.length);
    let best = null, bl = 1e-10;
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const n = pts[i].clone().sub(c).cross(pts[j].clone().sub(c));
        if (n.length() > bl) { bl = n.length(); best = n; }
      }
    return best ? { c, n: best.normalize() } : null;
  }

  // 平面与所有三角形的交点,去重后在平面内按角度排序 -> 截面多边形.
  // 用三角形而不是棱列表:1) 光滑曲面(球/圆柱)没有可点击的棱也能切;
  // 2) 截面点与 clipPoly 的交点逐位一致,封口扇形与侧面边界完全吻合(水密,轮廓不重复).
  function crossSection(s, pl) {
    const pos = s.userData.mesh.geometry.attributes.position;
    const idx = s.userData.mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const pts = [];
    for (let t = 0; t < count; t += 3) {
      va.fromBufferAttribute(pos, idx ? idx.getX(t) : t);
      vb.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1);
      vc.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2);
      const tri = [va, vb, vc];
      const d = tri.map(v => planeDist(pl, v));
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3], da = d[k], db = d[(k + 1) % 3];
        if (Math.abs(da) < 1e-6) pts.push(a.clone());
        if (da * db < -1e-12) pts.push(new THREE.Vector3().lerpVectors(a, b, da / (da - db)));
      }
    }
    const dedup = [];
    for (const p of pts) if (!dedup.some(q => q.distanceToSquared(p) < 1e-10)) dedup.push(p);
    if (dedup.length < 3) return dedup;
    const ref = Math.abs(pl.n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = new THREE.Vector3().crossVectors(ref, pl.n).normalize();
    const v = new THREE.Vector3().crossVectors(pl.n, u);
    const center = dedup.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / dedup.length);
    return dedup.sort((p, q) =>
      Math.atan2(p.clone().sub(center).dot(v), p.clone().sub(center).dot(u)) -
      Math.atan2(q.clone().sub(center).dot(v), q.clone().sub(center).dot(u)));
  }

  function triList(s) {
    const pos = s.userData.mesh.geometry.attributes.position;
    const idx = s.userData.mesh.geometry.index;
    const count = idx ? idx.count : pos.count;
    const tris = [];
    for (let t = 0; t < count; t += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        tri.push(new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k));
      }
      tris.push(tri);
    }
    return tris;
  }

  // Sutherland–Hodgman:保留 (v-c)·n >= 0 一侧
  function clipPoly(poly, c, n) {
    const out = [];
    const d = v => (v.x - c.x) * n.x + (v.y - c.y) * n.y + (v.z - c.z) * n.z;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = d(a), db = d(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) out.push(new THREE.Vector3().lerpVectors(a, b, da / (da - db)));
    }
    return out;
  }

  // 沿平面把物体裁成两半:两侧三角形 + 截面扇形封口
  // 让所有三角形法线朝外(以几何体质心为参考).切割后的碎片容易出现
  // 截面扇形绕向反了,导致所有面朝里、渲染成全虚线.
  function fixOutwardWinding(geom) {
    const pos = geom.attributes.position;
    const idx = geom.index;
    const count = idx ? idx.count : pos.count;
    const center = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) center.add(new THREE.Vector3().fromBufferAttribute(pos, i));
    center.multiplyScalar(1 / pos.count);

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
    const tc = new THREE.Vector3();
    for (let t = 0; t < count; t += 3) {
      const i0 = idx ? idx.getX(t) : t;
      const i1 = idx ? idx.getX(t + 1) : t + 1;
      const i2 = idx ? idx.getX(t + 2) : t + 2;
      va.fromBufferAttribute(pos, i0); vb.fromBufferAttribute(pos, i1); vc.fromBufferAttribute(pos, i2);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      n.crossVectors(ab, ac);
      tc.addVectors(va, vb).add(vc).multiplyScalar(1 / 3);
      const toCenter = center.clone().sub(tc);
      if (n.dot(toCenter) > 0) {
        // 法线指向质心 = 朝内,交换两个顶点翻转绕向
        if (idx) {
          const tmp = idx.getX(t + 1);
          idx.setX(t + 1, idx.getX(t + 2));
          idx.setX(t + 2, tmp);
        } else {
          // 非索引几何体:完整交换两个顶点的 XYZ
          const x1 = pos.getX(i1), y1 = pos.getY(i1), z1 = pos.getZ(i1);
          pos.setXYZ(i1, pos.getX(i2), pos.getY(i2), pos.getZ(i2));
          pos.setXYZ(i2, x1, y1, z1);
        }
      }
    }
    if (idx) idx.needsUpdate = true; else pos.needsUpdate = true;
  }

  function clipSolid(s, pl, section) {
    const { c, n } = pl;
    const posArr = [], negArr = [];
    const fan = (arr, poly) => {
      for (let i = 1; i < poly.length - 1; i++) arr.push(poly[0], poly[i], poly[i + 1]);
    };
    const nNeg = n.clone().negate();
    for (const tri of triList(s)) {
      fan(posArr, clipPoly(tri, c, n));
      fan(negArr, clipPoly(tri, c, nNeg));
    }
    if (!posArr.length || !negArr.length) return null;
    for (let i = 1; i < section.length - 1; i++) {
      posArr.push(section[0], section[i + 1], section[i]);
      negArr.push(section[0], section[i], section[i + 1]);
    }
    const toGeom = arr => {
      const f = new Float32Array(arr.length * 3);
      arr.forEach((v, i) => { f[i * 3] = v.x; f[i * 3 + 1] = v.y; f[i * 3 + 2] = v.z; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(f, 3));
      return g;
    };
    const gPos = toGeom(posArr), gNeg = toGeom(negArr);
    fixOutwardWinding(gPos);
    fixOutwardWinding(gNeg);
    return [gPos, gNeg];
  }

  function removePreview() {
    if (cutPreview) {
      cutPreview.parent?.remove(cutPreview);
      cutPreview.geometry.dispose();
      cutPreviewMat.dispose();
      cutPreview = null; cutPreviewMat = null;
    }
  }

  function refreshCutBtn() {
    const b = document.getElementById('sCut');
    b.classList.toggle('active', cutMode);
    b.textContent = cutMode && cutValid ? '✂ 执行切割' : '✂ 切割';
  }

  // 点集变化时重算:≥3 点拟合平面,平面两侧都有顶点 = 能分割 -> 闪烁虚线
  function updateCutPreview() {
    cutValid = false;
    if (!cutMode || !selected || cutPoints.length < 3) { removePreview(); refreshCutBtn(); return; }
    const plane = fitPlane(cutPoints.map(p => p.pos));
    if (!plane) { removePreview(); refreshCutBtn(); return; }
    const section = crossSection(selected, plane);
    let hasPos = false, hasNeg = false, hasOnPlane = false;
    for (let i = 0; i < selected.userData.unique.length; i++) {
      const dd = planeDist(plane, getVert(selected, i));
      if (dd > 1e-6) hasPos = true;
      else if (dd < -1e-6) hasNeg = true;
      else hasOnPlane = true;
    }
    cutValid = section.length >= 3 && ((hasPos && hasNeg) || (hasPos && hasOnPlane) || (hasNeg && hasOnPlane));
    if (section.length >= 3 && hasPos && hasNeg) {
      cutValid = true;
      if (!cutPreview) {
        cutPreviewMat = new LineMaterial({
          color: 0xffffff, linewidth: 2, dashed: true, dashSize: 0.08, gapSize: 0.06,
          transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false,
        });
        cutPreviewMat.resolution.set(W, H);
        cutPreview = new LineSegments2(new LineSegmentsGeometry(), cutPreviewMat);
        selected.add(cutPreview);
      }
      const arr = [];
      for (let i = 0; i < section.length; i++) {
        const p = section[i], q = section[(i + 1) % section.length];
        arr.push(p.x, p.y, p.z, q.x, q.y, q.z);
      }
      const g = new LineSegmentsGeometry();
      g.setPositions(arr);
      cutPreview.geometry.dispose();
      cutPreview.geometry = g;
      cutPreview.computeLineDistances();
    } else {
      removePreview();
    }
    refreshCutBtn();
  }

  function setCutMode(on) {
    cutMode = on;
    if (!on) cutPoints = [];
    updateCutPreview();
  }

  function executeCut() {
    if (!cutMode || !cutValid || !selected) return false;
    const s = selected;
    const plane = fitPlane(cutPoints.map(p => p.pos));
    const section = crossSection(s, plane);
    const parts = clipSolid(s, plane, section);
    if (!parts) return false;
    const before = snapshot();
    const idx = solids.indexOf(s);
    const { kind, style } = s.userData;
    const pos = s.position.clone(), quat = s.quaternion.clone(), scl = s.scale.clone();
    select(null);
    removeSolid(s);
    const pieces = parts.map(geom => {
      const g = makeSolid(kind, { ...style }, geom);
      g.position.copy(pos); g.quaternion.copy(quat); g.scale.copy(scl);
      syncMatrix(g);
      reclassify(g);
      scene.add(g);
      return g;
    });
    solids.splice(idx, 0, ...pieces);
    setCutMode(false);
    histSnapshot(before, snapshot());
    return true;
  }

  // 闪烁:透明度脉动 + 虚线流动
  function tick(t) {
    if (cutPreviewMat) {
      cutPreviewMat.opacity = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.008));
      cutPreviewMat.dashOffset = -t * 0.00015;
    }
  }

  // 3D 射线与棱段的最近点:比屏幕投影插值更精确,不受投影变形/视角影响
  function rayEdgeClosest(ray, s) {
    let best = null, bd = Infinity;
    const o = ray.origin, d = ray.direction;
    for (const [ua, ub] of s.userData.edges) {
      const va = getVert(s, ua).applyMatrix4(s.matrixWorld);
      const vb = getVert(s, ub).applyMatrix4(s.matrixWorld);
      const e = vb.clone().sub(va);
      const eo = o.clone().sub(va);
      // 解 min |(o+t*d) - (va+u*e)|^2
      const ed = e.dot(d), ee = e.dot(e), dd = d.dot(d), edo = e.dot(eo), ddo = d.dot(eo);
      const denom = ee * dd - ed * ed;
      if (Math.abs(denom) < 1e-12) continue;
      const t = (edo * ed - ee * ddo) / denom;
      const u = (edo * dd - ddo * ed) / denom;
      if (u < -0.02 || u > 1.02) continue;   // 稍稍超出端点也允许
      const p = o.clone().add(d.clone().multiplyScalar(t));
      const q = va.clone().add(e.clone().multiplyScalar(Math.max(0, Math.min(1, u))));
      const dist = p.distanceToSquared(q);
      if (dist < bd) { bd = dist; best = { edge: [ua, ub], t: Math.max(0, Math.min(1, u)), pointLocal: getVert(s, ua).clone().lerp(getVert(s, ub), Math.max(0, Math.min(1, u))) }; }
    }
    return best;
  }

  // ---------- 橡皮 ----------
  function beginErase() { eraseBefore = snapshot(); }
  function eraseAt(x, y) {
    const body = pickBody(x, y);
    if (body) { removeSolid(body); return true; }
    return false;
  }
  function endErase() {
    if (eraseBefore) {
      const after = snapshot();
      if (JSON.stringify(after) !== JSON.stringify(eraseBefore)) histSnapshot(eraseBefore, after);
    }
    eraseBefore = null;
  }

  // ---------- 样式(颜色/粗细跟随画笔) ----------
  function applyStyle(style) {
    if (!selected) return;
    const before = snapshot();
    const ud = selected.userData;
    ud.style = { ...style };
    ud.mats.vis.dispose();
    ud.mats.hid.dispose();
    ud.mats = makeEdgeMaterials(style);
    ud.edgeVis.material = ud.mats.vis;
    ud.edgeHid.material = ud.mats.hid;
    ud.mats.vis.color.set(EDGE_SEL);
    ud.edgeHid.computeLineDistances();
    histSnapshot(before, snapshot());
  }

  // ---------- 屏幕空间拾取 ----------
  function vertScreen(s, ui) {
    return worldToScreen(getVert(s, ui).applyMatrix4(s.matrixWorld));
  }

  function pickVertexIn(s, x, y) {
    let best = -1, bd = PICK_PX;
    for (let i = 0; i < s.userData.unique.length; i++) {
      const p = vertScreen(s, i);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function pickVertex(x, y) {
    return selected ? pickVertexIn(selected, x, y) : -1;
  }

  function pickEdgeIn(s, x, y) {
    let best = -1, bd = PICK_PX;
    s.userData.edges.forEach(([a, b], i) => {
      const pa = vertScreen(s, a), pb = vertScreen(s, b);
      const dx = pb.x - pa.x, dy = pb.y - pa.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((x - pa.x) * dx + (y - pa.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (pa.x + t * dx), y - (pa.y + t * dy));
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function pickEdge(x, y) {
    return selected ? pickEdgeIn(selected, x, y) : -1;
  }

  function screenAABB(s) {
    s.userData.mesh.geometry.computeBoundingBox();
    const bb = s.userData.mesh.geometry.boundingBox;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cx of [bb.min.x, bb.max.x])
      for (const cy of [bb.min.y, bb.max.y])
        for (const cz of [bb.min.z, bb.max.z]) {
          const p = worldToScreen(new THREE.Vector3(cx, cy, cz).applyMatrix4(s.matrixWorld));
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
    return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  function pickCorner(x, y) {
    if (!selected || level !== 'object') return -1;
    const b = screenAABB(selected);
    const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]];
    for (let i = 0; i < 4; i++) {
      if (Math.hypot(x - corners[i][0], y - corners[i][1]) <= PICK_PX) return i;
    }
    return -1;
  }

  function pickBody(x, y) {
    ndc.set(x / W * 2 - 1, -(y / H * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(solids.map(s => s.userData.mesh));
    if (hits.length) return solids.find(s => s.userData.mesh === hits[0].object);
    // 射线未命中时(切割后的非流形/透明网格在部分驱动上可能拾取失败),
    // 用屏幕包围盒做兜底:点中 AABB 内部即选中
    for (let i = solids.length - 1; i >= 0; i--) {
      const b = screenAABB(solids[i]);
      if (x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY) return solids[i];
    }
    return null;
  }

  // ---------- 指针交互 ----------
  function down(x, y, e) {
    if (cutMode) {
      if (selected) {
        // 点已选点 -> 移除该切割点
        for (let i = 0; i < cutPoints.length; i++) {
          const p = worldToScreen(cutPoints[i].pos.clone().applyMatrix4(selected.matrixWorld));
          if (Math.hypot(x - p.x, y - p.y) <= 10) {
            cutPoints.splice(i, 1);
            updateCutPreview();
            return true;
          }
        }
        // 3D 射线拾取棱,得到精确的局部空间切割点
        ndc.set(x / W * 2 - 1, -(y / H * 2 - 1));
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObject(selected.userData.mesh);
        if (hits.length) {
          // 曲面体(球/圆柱)棱很少:先取射线与表面的交点,
          // 仅当交点紧挨某条棱时才吸附到棱上,否则直接用表面点
          const local = selected.userData.mesh.worldToLocal(hits[0].point.clone());
          const hit = rayEdgeClosest(raycaster.ray, selected);
          if (hit && hit.pointLocal.distanceTo(local) < 0.06) {
            const onEdge = cutPoints.filter(p => p.edge === hit.edge[0] + ',' + hit.edge[1] ||
              p.edge === hit.edge[1] + ',' + hit.edge[0]);
            if (onEdge.length >= 2) cutPoints.splice(cutPoints.indexOf(onEdge[0]), 1);
            cutPoints.push({ edge: hit.edge[0] + ',' + hit.edge[1], pos: hit.pointLocal });
          } else {
            cutPoints.push({ edge: 'surf', pos: local });
          }
          updateCutPreview();
          return true;
        }
      }
      // 点别的物体 = 切换切割目标
      const body = pickBody(x, y);
      if (body && body !== selected) select(body);
      return true;
    }
    if (level !== 'object') {
      // 点/边层级:先点中哪个物体的顶点/边就抓起哪个(射线在角点容易漏检,
      // 所以直接在屏幕空间对所有物体找最近顶点/边,不依赖面拾取)
      const pickFn = level === 'vertex' ? pickVertexIn : pickEdgeIn;
      let idx = selected ? pickFn(selected, x, y) : -1;
      if (idx < 0) {
        for (const s2 of solids) {
          if (s2 === selected) continue;
          const i2 = pickFn(s2, x, y);
          if (i2 >= 0) { select(s2); idx = i2; break; }
        }
      }
      if (idx >= 0) {
        if (level === 'vertex') {
          pickedVert = idx;
          drag = { type: 'verts', targets: [idx], last: { x, y }, before: snapshot() };
        } else {
          pickedEdge = idx;
          drag = { type: 'verts', targets: [...selected.userData.edges[idx]], last: { x, y }, before: snapshot() };
        }
      } else {
        // 没点中顶点/边:点中物体则移动/旋转,点空处取消选中
        const body = pickBody(x, y);
        if (body) {
          if (body !== selected) select(body);
          const type = freeRotate ? 'rotate' : (e.shiftKey ? 'rotateStep' : 'move');
          drag = { type, last: { x, y }, acc: { x: 0, y: 0 }, before: snapshot() };
        } else {
          select(null);
        }
      }
      return true;
    }
    const ci = pickCorner(x, y);
    if (ci >= 0) {
      const b = screenAABB(selected);
      drag = { type: 'scale', center: { x: b.cx, y: b.cy },
               r0: Math.max(Math.hypot(x - b.cx, y - b.cy), 1),
               scale0: selected.scale.x, before: snapshot() };
      return true;
    }
    const body = pickBody(x, y);
    if (body) {
      if (body !== selected) select(body);
      // 旋转模式:拖动自由旋转;否则 Shift+拖动 = 45° 步进旋转,普通拖动 = 移动
      const type = freeRotate ? 'rotate' : (e.shiftKey ? 'rotateStep' : 'move');
      drag = { type, last: { x, y }, acc: { x: 0, y: 0 }, before: snapshot() };
      return true;
    }
    select(null);
    return true;
  }

  // ---------- 旋转(层级决定中心/轴) ----------
  // 对象级:绕自身 X/Y/Z 轴,中心在原点
  // 顶点级:绕选中顶点,轴仍是 X/Y/Z 按钮所选方向
  // 边级:绕选中边所在直线,中心在边中点,忽略 X/Y/Z 按钮
  function getRotPivotAxis() {
    if (level === 'edge' && pickedEdge >= 0) {
      const [a, b] = selected.userData.edges[pickedEdge];
      const va = getVert(selected, a), vb = getVert(selected, b);
      const axis = vb.clone().sub(va).normalize();
      return { pivot: va.clone().add(vb).multiplyScalar(0.5), axis };
    }
    if (level === 'vertex' && pickedVert >= 0) {
      return { pivot: getVert(selected, pickedVert).clone(), axis: AXIS_VEC[rotAxis] };
    }
    return { pivot: new THREE.Vector3(0, 0, 0), axis: AXIS_VEC[rotAxis] };
  }

  function rotateBy(angle) {
    const { pivot, axis } = getRotPivotAxis();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const oldQuat = selected.quaternion.clone();
    const newQuat = oldQuat.clone().multiply(q);   // 绕物体局部轴增量旋转
    // 旋转时保持 pivot 的世界位置不变:新位置 = 旧位置 + 旧朝向*sp - 新朝向*sp
    const sp = pivot.clone().multiplyScalar(selected.scale.x);
    selected.position.add(
      sp.clone().applyQuaternion(oldQuat).sub(sp.clone().applyQuaternion(newQuat)));
    selected.quaternion.copy(newQuat);
    syncMatrix(selected);
    reclassify(selected);
  }

  function move(x, y) {
    if (!drag || !selected) return;
    if (drag.type === 'move') {
      selected.position.x += x - drag.last.x;
      selected.position.y -= y - drag.last.y;
      drag.last = { x, y };
      syncMatrix(selected);
    } else if (drag.type === 'rotate') {
      const dx = x - drag.last.x, dy = y - drag.last.y;
      drag.last = { x, y };
      const angle = (dx - dy) * 0.01;
      if (angle) rotateBy(angle);
    } else if (drag.type === 'rotateStep') {
      // 45° 步进:绕当前层级对应的轴/中心,拖动每累计 40px 转 45°
      drag.acc.x += (x - drag.last.x) - (y - drag.last.y);
      drag.last = { x, y };
      const STEP = 40;
      let rotated = false;
      while (drag.acc.x >= STEP) { rotateBy(Math.PI / 4); drag.acc.x -= STEP; rotated = true; }
      while (drag.acc.x <= -STEP) { rotateBy(-Math.PI / 4); drag.acc.x += STEP; rotated = true; }
      if (rotated) {
        syncMatrix(selected);
        reclassify(selected);
      }
    } else if (drag.type === 'scale') {
      const r = Math.hypot(x - drag.center.x, y - drag.center.y);
      const k = Math.max(r / drag.r0, 0.05);
      selected.scale.setScalar(Math.max(drag.scale0 * k, 5));
      syncMatrix(selected);
    } else if (drag.type === 'verts') {
      const dx = x - drag.last.x, dy = y - drag.last.y;
      drag.last = { x, y };
      const dw = new THREE.Vector3(dx, -dy, 0);
      const m3 = new THREE.Matrix3().setFromMatrix4(selected.matrixWorld).invert();
      const dl = dw.applyMatrix3(m3);
      for (const ui of drag.targets) setVert(selected, ui, getVert(selected, ui).add(dl));
      rebuildEdges(selected);
    }
  }

  function up() {
    if (drag) {
      const after = snapshot();
      if (JSON.stringify(after) !== JSON.stringify(drag.before)) histSnapshot(drag.before, after);
      drag = null;
    }
  }

  // ---------- 滚轮缩放(选中对象) ----------
  let wheelBefore = null, wheelTimer = null;
  function wheel(dy) {
    if (!selected) return false;
    if (!wheelBefore) wheelBefore = snapshot();
    const k = Math.exp(-dy * 0.0012);
    selected.scale.setScalar(Math.max(selected.scale.x * k, 5));
    syncMatrix(selected);
    // 滚轮是连续事件:停止滚动 400ms 后作为一次操作入撤销栈
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const after = snapshot();
      if (JSON.stringify(after) !== JSON.stringify(wheelBefore)) histSnapshot(wheelBefore, after);
      wheelBefore = null;
    }, 400);
    return true;
  }

  // ---------- 覆盖层绘制 ----------
  function drawOverlay(octx) {
    if (!selected) return;
    octx.save();
    if (level === 'object') {
      const b = screenAABB(selected);
      octx.strokeStyle = '#4f8cff';
      octx.lineWidth = 1.5;
      octx.setLineDash([5, 4]);
      octx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      octx.setLineDash([]);
      octx.fillStyle = '#fff';
      for (const [cx, cy] of [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]) {
        octx.beginPath(); octx.rect(cx - 5, cy - 5, 10, 10); octx.fill(); octx.stroke();
      }
    } else {
      for (let i = 0; i < selected.userData.unique.length; i++) {
        const p = vertScreen(selected, i);
        octx.beginPath();
        octx.arc(p.x, p.y, HANDLE_PX, 0, Math.PI * 2);
        octx.fillStyle = i === pickedVert ? '#ff8833' : '#ffcc33';
        octx.fill();
        octx.strokeStyle = '#7a5200';
        octx.lineWidth = 1;
        octx.stroke();
      }
      if (level === 'edge' && pickedEdge >= 0) {
        const [a, b] = selected.userData.edges[pickedEdge];
        const pa = vertScreen(selected, a), pb = vertScreen(selected, b);
        octx.beginPath();
        octx.moveTo(pa.x, pa.y); octx.lineTo(pb.x, pb.y);
        octx.strokeStyle = '#ffaa22';
        octx.lineWidth = 3;
        octx.stroke();
      }
    }
    // 切割点:品红圆点
    if (cutMode) {
      for (const cp of cutPoints) {
        const p = worldToScreen(cp.pos.clone().applyMatrix4(selected.matrixWorld));
        octx.beginPath();
        octx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        octx.fillStyle = '#ff4fd8';
        octx.fill();
        octx.strokeStyle = '#7a0060';
        octx.lineWidth = 1;
        octx.stroke();
      }
    }
    octx.restore();
  }

  // ---------- 工具栏绑定 ----------
  const AXIS_VEC = {
    x: new THREE.Vector3(1, 0, 0),
    y: new THREE.Vector3(0, 1, 0),
    z: new THREE.Vector3(0, 0, 1),
  };
  const $ = id => document.getElementById(id);
  $('sAdd').addEventListener('click', () => addSolid($('sKind').value));
  $('sLevel').addEventListener('click', e => {
    const b = e.target.closest('button[data-level]');
    if (b) setLevel(b.dataset.level);
  });
  $('sRotate').addEventListener('click', () => setFreeRotate(!freeRotate));
  $('sCut').addEventListener('click', () => {
    if (cutMode && cutValid) executeCut();
    else setCutMode(!cutMode);
  });
  $('sAxis').addEventListener('click', e => {
    const b = e.target.closest('button[data-axis]');
    if (b) setRotAxis(b.dataset.axis);
  });

  function setRotAxis(a) {
    rotAxis = a;
    document.querySelectorAll('#sAxis button').forEach(b =>
      b.classList.toggle('active', b.dataset.axis === a));
  }

  function setFreeRotate(on) {
    freeRotate = on;
    $('sRotate').classList.toggle('active', on);
  }

  function setLevel(l) {
    level = l;
    pickedVert = pickedEdge = -1;
    document.querySelectorAll('#sLevel button').forEach(b =>
      b.classList.toggle('active', b.dataset.level === l));
  }

  return {
    down, move, up, drawOverlay, addSolid, deleteSelected, clear, setLevel, applyStyle,
    beginErase, eraseAt, endErase, setFreeRotate, wheel,
    setCutMode, executeCut, tick,
    cancelCut() { setCutMode(false); },
    resize(w, h) {
      W = w; H = h;
      for (const s of solids) {
        s.userData.mats.vis.resolution.set(w, h);
        s.userData.mats.hid.resolution.set(w, h);
      }
      if (cutPreviewMat) cutPreviewMat.resolution.set(w, h);
    },
    deselect() { select(null); },
    hasSelection: () => !!selected,
    hitBody: (x, y) => !!pickBody(x, y),
    _dbg: { solids, getVert, worldToScreen, snapshot, pickBody, setRotAxis,
      get rotAxis() { return rotAxis; }, get drag() { return drag; },
      get selected() { return selected; }, get level() { return level; },
      get pickedVert() { return pickedVert; }, get pickedEdge() { return pickedEdge; },
      get cutPoints() { return cutPoints; }, get cutValid() { return cutValid; },
      get cutMode() { return cutMode; },
      syncMatrix,
      pickVertex },
  };
}
