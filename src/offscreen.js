// Offscreen document: runs the ML pipeline in the background, survives navigation.

import { pipeline, env } from '@xenova/transformers';
import { UMAP } from 'umap-js';
import { DBSCAN } from 'density-clustering';

// Use extension-bundled ONNX runtime wasm files.
const wasmBase = chrome.runtime.getURL('lib/');
env.backends.onnx.wasm.wasmPaths = wasmBase;
env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);

let extractor = null;

async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
  }
  return extractor;
}

function sendProgress(id, stage, current, total) {
  chrome.runtime.sendMessage({ type: 'progress', id, stage, current, total });
}

function sendResult(id, snapshot) {
  chrome.runtime.sendMessage({ type: 'result', id, snapshot });
}

function sendError(id, message) {
  chrome.runtime.sendMessage({ type: 'error', id, message });
}

function estimateEpsilon(coords, k) {
  const sampleSize = Math.min(100, coords.length);
  let totalDist = 0;
  let count = 0;
  for (let i = 0; i < sampleSize; i++) {
    const dists = [];
    for (let j = 0; j < coords.length; j++) {
      if (i === j) continue;
      const dx = coords[i][0] - coords[j][0];
      const dy = coords[i][1] - coords[j][1];
      const dz = coords[i][2] - coords[j][2];
      dists.push(Math.sqrt(dx*dx + dy*dy + dz*dz));
    }
    dists.sort((a, b) => a - b);
    totalDist += dists[k - 1] || 0;
    count++;
  }
  return count > 0 ? totalDist / count : 1.0;
}

function computeColors(coords) {
  const palette = [
    0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6,
    0xec4899, 0x06b6d4, 0x84cc16, 0xf97316, 0x6366f1,
  ];

  // Try DBSCAN
  const minPoints = Math.min(3, Math.max(2, coords.length - 1));
  const baseEpsilon = estimateEpsilon(coords, minPoints);
  const dbscan = new DBSCAN();

  for (let factor = 0.5; factor <= 3.0; factor += 0.25) {
    const eps = baseEpsilon * factor;
    const result = dbscan.run(coords, eps, minPoints);
    const assigned = new Set();
    result.forEach(c => c.forEach(idx => assigned.add(idx)));
    const noiseRatio = 1 - assigned.size / coords.length;

    if (result.length >= 2 && noiseRatio < 0.5) {
      const clusterLabels = new Array(coords.length).fill(-1);
      result.forEach((c, ci) => c.forEach(idx => { clusterLabels[idx] = ci; }));
      const colors = clusterLabels.map(c => c >= 0 ? palette[c % palette.length] : 0x6b7280);
      return { colors, clusterLabels };
    }
  }

  // Position-based coloring: map x→R, y→G, z→B
  const xs = coords.map(p => p[0]);
  const ys = coords.map(p => p[1]);
  const zs = coords.map(p => p[2]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const colors = coords.map(p => {
    const r = (p[0] - minX) / (maxX - minX || 1);
    const g = (p[1] - minY) / (maxY - minY || 1);
    const b = (p[2] - minZ) / (maxZ - minZ || 1);
    return ((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255)) >>> 0;
  });

  return { colors, clusterLabels: null };
}

const positiveWords = ['good','great','excellent','amazing','love','best','wonderful','fantastic','beautiful','happy','helpful','thanks','agree','correct','interesting','support','awesome','nice','glad','perfect','brilliant','outstanding','superb','impressive','delightful','pleasant','welcome','lovely','fun','enjoy'];
const negativeWords = ['bad','terrible','awful','hate','worst','horrible','ugly','sad','angry','wrong','stupid','disagree','useless','disgusting','nasty','toxic','abuse','horrific','pathetic','hateful','awful','dreadful','appalling','atrocious','disgusting','repulsive','vile','contemptible'];

function computeSentiment(text) {
  const words = (text || '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  let score = 0;
  let count = 0;
  for (const w of words) {
    if (positiveWords.includes(w)) { score += 1; count++; }
    else if (negativeWords.includes(w)) { score -= 1; count++; }
  }
  return count > 0 ? score / count : 0;
}

const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','that','this','these','those','it','its','i','me','my','we','our','you','your','he','him','his','she','her','they','them','their','what','which','who','whom','about','up','down','like','also','get','got','make','made','take','took','see','seen','know','known','think','thought','want','wanted','come','came','go','went','gone','give','gave','use','used','find','found','tell','told','ask','asked','seem','try','leave','call']);

function extractTopics(points, clusterLabels) {
  const clusters = {};
  for (let i = 0; i < points.length; i++) {
    if (points[i].is_post) continue;
    let cl = clusterLabels?.[i];
    if (cl === undefined || cl === null || cl < 0) cl = 0;
    if (!clusters[cl]) clusters[cl] = [];
    const text = (points[i].text || '').toLowerCase();
    const words = text.split(/\W+/).filter(w => w.length > 2 && !stopWords.has(w));
    clusters[cl].push(...words);
  }
  const topics = [];
  for (const [cid, words] of Object.entries(clusters)) {
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    topics[Number(cid)] = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
  }
  return topics;
}

async function processJob({ id, items, url, chunkSize = 20 }) {
  try {
    sendProgress(id, 'model', 0, 1);
    const model = await getExtractor();
    sendProgress(id, 'model', 1, 1);

    const texts = items.map(i => i.text);
    const embeddings = [];
    const total = texts.length;

    // Embed in chunks so the UI can show progress.
    for (let i = 0; i < total; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const output = await model(chunk, { pooling: 'mean', normalize: true });
      const flat = Array.from(output.data);
      const dim = output.dims[output.dims.length - 1] || 384;
      for (let j = 0; j < chunk.length; j++) {
        embeddings.push(flat.slice(j * dim, (j + 1) * dim));
      }
      sendProgress(id, 'embed', Math.min(i + chunk.length, total), total);
    }

    sendProgress(id, 'project', 0, 1);
    const nNeighbors = Math.min(15, Math.max(2, embeddings.length - 1));
    const umap = new UMAP({ nComponents: 3, nNeighbors, minDist: 0.1, spread: 1.0 });
    const coords = umap.fit(embeddings);
    sendProgress(id, 'project', 1, 1);

    sendProgress(id, 'cluster', 0, 1);
    const { colors, clusterLabels } = computeColors(coords);
    sendProgress(id, 'cluster', 1, 1);

    const points = items.map((item, i) => ({
      ...item,
      x: coords[i][0],
      y: coords[i][1],
      z: coords[i][2],
      cluster: clusterLabels ? (clusterLabels[i] ?? -1) : -1,
      color: colors[i],
      sentiment: computeSentiment(item.text),
    }));

    const topics = extractTopics(items, clusterLabels);

    const snapshot = {
      point_count: points.length,
      source: 'reddit',
      post_url: url,
      points,
      topics,
    };

    sendResult(id, snapshot);
  } catch (err) {
    sendError(id, err.message || String(err));
  }
}

chrome.runtime.onMessage.addListener((request) => {
  if (request?.type === 'process') {
    processJob(request);
  }
  return false;
});

// Keep the offscreen document alive while processing.
setInterval(() => {
  chrome.runtime.sendMessage({ type: 'offscreen-ping' });
}, 20000);
