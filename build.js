const fs = require('fs');
const path = require('path');
const { rollup } = require('rollup');
const resolve = require('@rollup/plugin-node-resolve').default;
const commonjs = require('@rollup/plugin-commonjs').default;
const terser = require('@rollup/plugin-terser').default;

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'extension');

function copy(src, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir, filter = () => true) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath, filter);
    } else if (filter(entry)) {
      copy(srcPath, destPath);
    }
  }
}

async function bundle(inputFile, outputFile) {
  const bundle = await rollup({
    input: inputFile,
    plugins: [
      resolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      terser({ compress: { drop_console: true } }),
    ],
  });
  await bundle.write({
    file: outputFile,
    format: 'iife',
    sourcemap: false,
  });
  await bundle.close();
}

async function main() {
  // Clean and create output dir
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  // Bundle JS
  await bundle(path.join(SRC, 'content.js'), path.join(OUT, 'content.js'));
  await bundle(path.join(SRC, 'background.js'), path.join(OUT, 'background.js'));
  await bundle(path.join(SRC, 'offscreen.js'), path.join(OUT, 'offscreen.js'));
  await bundle(path.join(SRC, 'overlay.js'), path.join(OUT, 'overlay.js'));

  // Patch protobuf.js eval used by onnxruntime-web (safe in browser; returns null)
  const offscreenPath = path.join(OUT, 'offscreen.js');
  let offscreenSrc = fs.readFileSync(offscreenPath, 'utf8');

  // 1. protobuf.js `inquire` -> no-op
  const inquireStart = 'function inquire(moduleName){';
  let idx = offscreenSrc.indexOf(inquireStart);
  if (idx !== -1) {
    let depth = 1, i = idx + inquireStart.length;
    while (i < offscreenSrc.length && depth > 0) {
      if (offscreenSrc[i] === '{') depth++;
      else if (offscreenSrc[i] === '}') depth--;
      i++;
    }
    offscreenSrc = offscreenSrc.slice(0, idx) + 'function inquire(moduleName){return null}' + offscreenSrc.slice(i);
  }

  // 2. Node.js worker `importScripts` eval -> no-op
  offscreenSrc = offscreenSrc.replace(/importScripts:function\(e\)\{[^}]*\(0,eval\)[^}]*\}/g, 'importScripts:function(e){return null}');

  // 3. global detection `new Function("return this")()` -> safe globalThis fallback
  offscreenSrc = offscreenSrc.replace(
    /new Function\("return this"\)\(\)/g,
    '(typeof globalThis!=="undefined"?globalThis:typeof window!=="undefined"?window:this)'
  );

  fs.writeFileSync(offscreenPath, offscreenSrc);

  // Copy HTML and CSS
  copy(path.join(SRC, 'offscreen.html'), path.join(OUT, 'offscreen.html'));
  copy(path.join(SRC, 'overlay.html'), path.join(OUT, 'overlay.html'));
  copy(path.join(SRC, 'overlay.css'), path.join(OUT, 'overlay.css'));

  // Copy manifest
  copy(path.join(SRC, 'manifest.json'), path.join(OUT, 'manifest.json'));

  // Copy icons
  copyDir(path.join(SRC, 'icons'), path.join(OUT, 'icons'));

  // Copy ONNX runtime wasm files
  const onnxDir = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
  if (fs.existsSync(onnxDir)) {
    const wasmOut = path.join(OUT, 'lib');
    fs.mkdirSync(wasmOut, { recursive: true });
    for (const file of fs.readdirSync(onnxDir)) {
      if (file.endsWith('.wasm')) {
        copy(path.join(onnxDir, file), path.join(wasmOut, file));
      }
    }
  } else {
    console.warn('onnxruntime-web wasm files not found; model inference may fail offline');
  }

  console.log('Built extension to:', OUT);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
