"""2D 도면 이미지에서 벽만 뽑아 3D 뷰어 HTML을 만든다.

사용: python extract_walls.py plan.png [--out out.html] [--min-thick N] [--wall-height 2.7]
원리: 어두운 픽셀 → 모폴로지 열림(얇은 선·글자·가구·문 호는 사라지고 두꺼운 벽만 남음)
      → 윤곽선 폴리곤 → Three.js 로 벽 두께 그대로 압출. 벽이 끊긴 자리가 곧 출입구.
"""
import argparse, base64, json, sys
from pathlib import Path
import cv2, numpy as np

def estimate_wall_thickness(binary):
    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    vals = dist[dist > 0]
    if vals.size == 0:
        return 4
    # 벽 픽셀의 상위 분포에서 반두께 추정
    return max(3, int(np.percentile(vals, 97) * 2))

def extract(img_path, min_thick=None, dark=110, simplify=1.5):
    img = cv2.imread(str(img_path))
    if img is None:
        sys.exit(f"이미지를 열 수 없음: {img_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, binary = cv2.threshold(gray, dark, 255, cv2.THRESH_BINARY_INV)
    thick = min_thick or estimate_wall_thickness(binary)
    k = max(3, int(thick * 0.6)) | 1
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (k, k))
    walls = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    # 벽 위의 작은 끊김(선 겹침 등) 메움
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    # 너무 작은 조각 제거
    n, labels, stats, _ = cv2.connectedComponentsWithStats(walls, 8)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < thick * thick * 4:
            walls[labels == i] = 0
    contours, hier = cv2.findContours(walls, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    polys = []
    if hier is not None:
        hier = hier[0]
        for i, c in enumerate(contours):
            if hier[i][3] != -1:
                continue  # 구멍은 부모에 붙임
            outer = cv2.approxPolyDP(c, simplify, True).reshape(-1, 2).tolist()
            if len(outer) < 3:
                continue
            holes = []
            child = hier[i][2]
            while child != -1:
                h = cv2.approxPolyDP(contours[child], simplify, True).reshape(-1, 2).tolist()
                if len(h) >= 3:
                    holes.append(h)
                child = hier[child][0]
            polys.append({"outer": outer, "holes": holes})
    h, w = walls.shape
    return {"width": w, "height": h, "wall_px": thick, "walls": polys}, walls, img

HTML = r"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>Wall Model</title>
<style>
:root{--bg:#f4f2ee;--fg:#222}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:13px system-ui,sans-serif}
#ui{position:fixed;top:12px;left:12px;background:#fffc;padding:8px 12px;border-radius:8px;line-height:1.7}
label{display:block;cursor:pointer}
</style></head><body>
<div id="ui">
  <label><input type="checkbox" id="floor" checked> 원본 도면 바닥에 깔기</label>
  <label>벽 높이 <input type="range" id="h" min="0.3" max="4" step="0.1" value="__WALL_H__"> <span id="hv">__WALL_H__</span> m</label>
  <div>드래그: 회전 · 휠: 확대 · 우클릭: 이동</div>
</div>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const DATA = __DATA__;
const IMG = "__IMG__";
const PX_PER_M = __PX_PER_M__;           // 1m 당 픽셀 수(도면 축척)
const s = 1 / PX_PER_M;
const W = DATA.width * s, H = DATA.height * s;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f2ee);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 5000);
camera.position.set(W*0.5, Math.max(W,H)*0.9, H*1.4);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(W/2, 0, H/2);

scene.add(new THREE.HemisphereLight(0xffffff, 0x888877, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(W, Math.max(W,H)*1.5, H*0.3); sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
const cs = Math.max(W,H);
Object.assign(sun.shadow.camera, {left:-cs, right:cs, top:cs, bottom:-cs, far:cs*5});
scene.add(sun);

// 바닥(원본 도면 텍스처)
const floorGeo = new THREE.PlaneGeometry(W, H);
const floorMat = new THREE.MeshStandardMaterial({color:0xffffff});
if (IMG) { new THREE.TextureLoader().load(IMG, t => { t.colorSpace = THREE.SRGBColorSpace; floorMat.map = t; floorMat.needsUpdate = true; }); }
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI/2; floor.position.set(W/2, -0.001, H/2); floor.receiveShadow = true;
scene.add(floor);
document.getElementById('floor').onchange = e => { floorMat.map = e.target.checked ? floorMat.map : null; floor.visible = e.target.checked; };

// 벽
const wallMat = new THREE.MeshStandardMaterial({color:0xd9d4cc, roughness:0.85});
const edgeMat = new THREE.LineBasicMaterial({color:0x333333});
const wallGroup = new THREE.Group(); scene.add(wallGroup);
function buildWalls(height){
  wallGroup.clear();
  for (const p of DATA.walls){
    const shape = new THREE.Shape(p.outer.map(([x,y]) => new THREE.Vector2(x*s, y*s)));
    for (const h of p.holes) shape.holes.push(new THREE.Path(h.map(([x,y]) => new THREE.Vector2(x*s, y*s))));
    const geo = new THREE.ExtrudeGeometry(shape, {depth:height, bevelEnabled:false});
    geo.rotateX(Math.PI/2); geo.translate(0, height, 0);
    const m = new THREE.Mesh(geo, wallMat); m.castShadow = m.receiveShadow = true;
    wallGroup.add(m);
    wallGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), edgeMat));
  }
}
const hIn = document.getElementById('h'), hv = document.getElementById('hv');
buildWalls(parseFloat(hIn.value));
hIn.oninput = () => { hv.textContent = hIn.value; buildWalls(parseFloat(hIn.value)); };

addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
(function loop(){ controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();
</script></body></html>
"""

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--out", default=None)
    ap.add_argument("--min-thick", type=int, default=None, help="벽 최소 두께(px). 생략 시 자동 추정")
    ap.add_argument("--dark", type=int, default=110, help="이 값보다 어두운 픽셀을 선으로 봄(0~255)")
    ap.add_argument("--wall-height", type=float, default=2.7)
    ap.add_argument("--px-per-m", type=float, default=None, help="1m 당 픽셀 수. 생략 시 벽 두께를 0.2m 로 가정")
    a = ap.parse_args()
    data, mask, img = extract(a.image, a.min_thick, a.dark)
    px_per_m = a.px_per_m or data["wall_px"] / 0.2
    out = Path(a.out or Path(a.image).with_suffix(".html"))
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    img_uri = "data:image/jpeg;base64," + base64.b64encode(buf).decode()
    html = (HTML.replace("__DATA__", json.dumps(data, separators=(",", ":")))
                .replace("__IMG__", img_uri)
                .replace("__PX_PER_M__", f"{px_per_m:.3f}")
                .replace("__WALL_H__", str(a.wall_height)))
    out.write_text(html, encoding="utf-8")
    Path(out).with_suffix(".walls.json").write_text(json.dumps(data), encoding="utf-8")
    cv2.imwrite(str(Path(out).with_suffix(".mask.png")), mask)
    print(f"벽 두께 추정 {data['wall_px']}px, 벽 덩어리 {len(data['walls'])}개, "
          f"구멍 {sum(len(p['holes']) for p in data['walls'])}개 → {out}")

if __name__ == "__main__":
    main()
