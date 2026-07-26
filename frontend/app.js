import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const UI = {
  status: document.getElementById('status'),
  loading: document.getElementById('loading'),
  tooltip: document.getElementById('tooltip'),
  country: document.getElementById('country'),
  refresh: document.getElementById('refresh'),
};

let scene, camera, renderer, controls, pointsMesh, raycaster, mouse;
let pointsData = [];
let hoveredPoint = null;

const palette = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6,
  0xec4899, 0x06b6d4, 0x84cc16, 0xf97316, 0x6366f1,
];

function init() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 18);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.4;

  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.15;
  mouse = new THREE.Vector2();

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);

  UI.country.addEventListener('change', () => loadSnapshot(UI.country.value));
  UI.refresh.addEventListener('click', runPipeline);

  animate();
  loadSnapshot('IN');
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function onMouseMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  updateTooltip(event.clientX, event.clientY);
}

function onClick() {
  if (hoveredPoint && hoveredPoint.url) {
    window.open(hoveredPoint.url, '_blank');
  }
}

function setStatus(text) {
  UI.status.textContent = text;
}

function setLoading(show) {
  UI.loading.style.display = show ? 'block' : 'none';
}

async function loadSnapshot(country) {
  setLoading(true);
  setStatus('Fetching snapshot...');
  try {
    const res = await fetch(`/api/snapshot?country=${country}`);
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || res.statusText);
    }
    const snapshot = await res.json();
    renderSnapshot(snapshot);
    const generated = snapshot.generated_at
      ? new Date(snapshot.generated_at).toLocaleString()
      : 'never';
    setStatus(`${snapshot.point_count} points • generated ${generated}`);
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    console.error(err);
  } finally {
    setLoading(false);
  }
}

async function runPipeline() {
  UI.refresh.disabled = true;
  setLoading(true);
  setStatus('Running pipeline. This may take a few minutes...');
  try {
    const res = await fetch('/api/run-pipeline', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Pipeline failed');
    setStatus(`Pipeline complete: ${data.point_count} points at ${new Date(data.generated_at).toLocaleString()}`);
    await loadSnapshot(UI.country.value);
  } catch (err) {
    setStatus(`Pipeline error: ${err.message}`);
    console.error(err);
  } finally {
    UI.refresh.disabled = false;
    setLoading(false);
  }
}

function renderSnapshot(snapshot) {
  pointsData = snapshot.points || [];

  if (pointsMesh) {
    scene.remove(pointsMesh);
    pointsMesh.geometry.dispose();
    pointsMesh.material.dispose();
  }

  if (pointsData.length === 0) {
    setStatus('No points available. Try running the pipeline.');
    return;
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(pointsData.length * 3);
  const colors = new Float32Array(pointsData.length * 3);
  const sizes = new Float32Array(pointsData.length);

  const color = new THREE.Color();
  for (let i = 0; i < pointsData.length; i++) {
    const p = pointsData[i];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    const cluster = p.cluster >= 0 ? p.cluster : palette.length - 1;
    color.setHex(palette[cluster % palette.length]);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 0.18;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    size: 0.18,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
  });

  pointsMesh = new THREE.Points(geometry, material);
  scene.add(pointsMesh);
}

function updateTooltip(clientX, clientY) {
  if (!pointsMesh) return;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(pointsMesh);

  if (intersects.length > 0) {
    const index = intersects[0].index;
    const point = pointsData[index];
    if (point) {
      hoveredPoint = point;
      controls.autoRotate = false;
      UI.tooltip.style.display = 'block';
      UI.tooltip.style.left = `${clientX + 14}px`;
      UI.tooltip.style.top = `${clientY + 14}px`;
      UI.tooltip.innerHTML = `
        <h3>${escapeHtml(point.keyword)}</h3>
        <p><strong>${escapeHtml(point.title || 'Untitled')}</strong></p>
        <p>${escapeHtml(point.summary || 'No summary available.')}</p>
        <a href="${escapeHtml(point.url)}" target="_blank">${escapeHtml(point.url)}</a>
      `;
      return;
    }
  }

  hoveredPoint = null;
  controls.autoRotate = true;
  UI.tooltip.style.display = 'none';
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

init();
