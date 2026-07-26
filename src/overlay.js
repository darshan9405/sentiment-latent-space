// Three.js overlay for the 3D visualization.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const palette = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6,
  0xec4899, 0x06b6d4, 0x84cc16, 0xf97316, 0x6366f1,
];

const ui = {
  loading: document.getElementById('loading-overlay'),
  subtitle: document.getElementById('subtitle'),
  statusText: document.getElementById('status-text'),
  tooltip: document.getElementById('tooltip'),
  closeBtn: document.getElementById('close-btn'),
  searchInput: document.getElementById('search-input'),
  clusterTopics: document.getElementById('cluster-topics'),
};

let scene, camera, renderer, controls, raycaster, mouse;
let pointsMesh = null;
let pointsData = [];
let topicsData = null;
let searchTerm = '';
let hoveredPoint = null;

function init() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050505);

  camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
  camera.position.set(0, 0, 18);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.autoRotate = false;
  controls.enablePan = true;
  controls.minDistance = 1;
  controls.maxDistance = 80;

  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.25;
  mouse = new THREE.Vector2();

  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('mousemove', onMouseMove);
  renderer.domElement.addEventListener('click', onClick);
  ui.closeBtn.addEventListener('click', () => {
    parent.postMessage({ type: 'close-overlay' }, '*');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') parent.postMessage({ type: 'close-overlay' }, '*');
  });

  ui.searchInput.addEventListener('input', () => {
    searchTerm = ui.searchInput.value.trim().toLowerCase();
    renderPoints();
  });

  animate();
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

function clusterColor(cluster) {
  if (cluster === -1 || cluster === undefined) return 0x6b7280;
  return palette[cluster % palette.length];
}

function pointColor(p) {
  if (p.color !== undefined) return p.color;
  return clusterColor(p.cluster);
}

function pointSize(p) {
  if (p.is_post) return 0.2;
  if (!p.comment_score) return 0.1;
  const maxScore = Math.max(1, ...pointsData.filter(q => !q.is_post).map(q => q.comment_score || 0));
  const t = (p.comment_score || 0) / maxScore;
  return 0.06 + t * 0.25;
}

function clearScene() {
  if (pointsMesh) { scene.remove(pointsMesh); pointsMesh.geometry.dispose(); pointsMesh.material.dispose(); pointsMesh = null; }
}

function sentimentColor(s) {
  if (s === undefined || s === null) return null;
  const t = Math.max(-1, Math.min(1, s));
  const r = t < 0 ? Math.round(255 * (1 + t)) : 255;
  const g = t > 0 ? Math.round(255 * (1 - t)) : 255;
  const b = Math.round(255 * (1 - Math.abs(t)));
  return (r << 16) | (g << 8) | b;
}

function textMatches(p, term) {
  if (!term) return true;
  const haystack = ((p.text || '') + ' ' + (p.title || '')).toLowerCase();
  return haystack.includes(term);
}

function renderPoints() {
  clearScene();
  if (!pointsData.length) return;

  const matches = searchTerm ? pointsData.filter(p => textMatches(p, searchTerm)) : null;

  const buildMesh = (indices, size, opacity, colorOverride) => {
    if (!indices.length) return null;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(indices.length * 3);
    const col = new Float32Array(indices.length * 3);
    const sizes = new Float32Array(indices.length);
    const c = new THREE.Color();
    for (let i = 0; i < indices.length; i++) {
      const p = pointsData[indices[i]];
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      sizes[i] = colorOverride === undefined ? pointSize(p) : size;
      c.setHex(colorOverride !== undefined ? colorOverride : (p.is_post ? 0xffd700 : pointColor(p)));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Points(g, mat);
    mesh.userData.indices = indices;
    return mesh;
  };

  if (matches) {
    const matchIndices = [];
    const nonMatchIndices = [];
    pointsData.forEach((p, i) => {
      if (textMatches(p, searchTerm)) matchIndices.push(i);
      else nonMatchIndices.push(i);
    });
    const m1 = buildMesh(matchIndices, 0.28, 1.0);
    if (m1) scene.add(m1);
    const m2 = buildMesh(nonMatchIndices, 0.06, 0.12, 0x6b7280);
    if (m2) scene.add(m2);
    pointsMesh = m1 || m2;
    ui.statusText.textContent = `${matchIndices.length} match${matchIndices.length !== 1 ? 'es' : ''} for "${searchTerm}"`;
  } else {
    const allIndices = pointsData.map((_, i) => i);
    pointsMesh = buildMesh(allIndices, 0.15, 0.9);
    if (pointsMesh) scene.add(pointsMesh);
    const clusterCount = new Set(pointsData.filter(p => p.cluster >= 0).map(p => p.cluster)).size;
    ui.statusText.textContent = `${pointsData.length} points${clusterCount >= 2 ? ` \u2022 ${clusterCount} clusters` : ''}`;
  }

  const ambient = new THREE.AmbientLight(0x404060);
  scene.add(ambient);
}

function renderTopics(topics) {
  const container = ui.clusterTopics;
  if (!topics || !topics.length) { container.style.display = 'none'; return; }

  const existing = container.querySelectorAll('.topic-item');
  existing.forEach(el => el.remove());

  let count = 0;
  topics.forEach((words, cid) => {
    if (!words || !words.length) return;
    count++;
    const item = document.createElement('div');
    item.className = 'topic-item';
    item.innerHTML = `
      <span class="topic-dot" style="background:#${palette[cid % palette.length].toString(16).padStart(6, '0')};"></span>
      <span><strong>Cluster ${cid}:</strong> <span class="topic-words">${escapeHtml(words.join(', '))}</span></span>
    `;
    container.appendChild(item);
  });

  container.style.display = count > 0 ? 'block' : 'none';
}

function renderSnapshot(snapshot) {
  pointsData = snapshot.points || [];
  topicsData = snapshot.topics || null;
  if (pointsData.length === 0) return;

  ui.loading.classList.add('hidden');
  ui.subtitle.textContent = `${snapshot.point_count} comments + post in 3D semantic space`;
  searchTerm = '';
  if (ui.searchInput) ui.searchInput.value = '';
  renderPoints();
  renderTopics(topicsData);

  const postPoint = pointsData.find(p => p.is_post === true);
  if (postPoint) {
    const target = new THREE.Vector3(postPoint.x, postPoint.y, postPoint.z);
    controls.target.copy(target);
    camera.position.set(target.x, target.y, target.z + 14);
    controls.update();
  }
}

function updateTooltip(clientX, clientY) {
  if (!pointsMesh) return;

  raycaster.setFromCamera(mouse, camera);
  const validMeshes = [];
  scene.children.forEach(child => {
    if (child.isPoints) validMeshes.push(child);
  });
  if (!validMeshes.length) return;

  const intersects = raycaster.intersectObjects(validMeshes);
  if (intersects.length > 0) {
    const hit = intersects[0];
    const meshIndices = hit.object.userData.indices;
    const point = meshIndices ? pointsData[meshIndices[hit.index]] : pointsData[hit.index];
    if (!point) return;

    hoveredPoint = point;
    ui.tooltip.style.display = 'block';
    ui.tooltip.style.left = `${clientX + 14}px`;
    ui.tooltip.style.top = `${clientY + 14}px`;

    const isPost = point.is_post === true;
    let meta = '';
    if (point.author) meta += `by ${escapeHtml(point.author)}`;
    if (!isPost && point.comment_score !== undefined) {
      meta += `${meta ? ' \u2022 ' : ''}${point.comment_score} points`;
    }
    if (point.cluster >= 0) meta += `${meta ? ' \u2022 ' : ''}cluster ${point.cluster}`;
    if (point.sentiment !== undefined) {
      const label = point.sentiment > 0.2 ? 'positive' : point.sentiment < -0.2 ? 'negative' : 'neutral';
      meta += `${meta ? ' \u2022 ' : ''}${label}`;
    }

    const body = isPost
      ? (point.text || point.title || '')
      : (point.text || '');

    ui.tooltip.innerHTML = `
      <span class="tt-label ${isPost ? 'post' : 'comment'}">${isPost ? 'Post' : 'Comment'}</span>
      <h3>${escapeHtml(point.title || 'Untitled')}</h3>
      ${meta ? `<div class="tt-meta">${meta}</div>` : ''}
      ${body ? `<div class="tt-body">${escapeHtml(body)}</div>` : ''}
      <a class="tt-url" href="${escapeHtml(point.url)}" target="_blank">${escapeHtml(point.url)}</a>
    `;
    return;
  }

  hoveredPoint = null;
  ui.tooltip.style.display = 'none';
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

window.addEventListener('message', (event) => {
  if (event.data?.type === 'snapshot') {
    renderSnapshot(event.data.snapshot);
  }
});

init();
