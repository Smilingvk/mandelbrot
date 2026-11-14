let wasm = null;
let newestRenderId = 0;
let activeEquation = null;

async function loadRustRenderer() {
  if (wasm) return wasm;
  const url = new URL('./target/wasm32-unknown-unknown/release/mandelbrot_lab.wasm', self.location.href);
  let result;
  try {
    result = await WebAssembly.instantiateStreaming(fetch(url), {});
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Rust renderer not built. Run the WASM build command in the README.');
    result = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  }
  wasm = result.instance.exports;
  return wasm;
}

function withRustString(exports, value, callback) {
  const encoded = new TextEncoder().encode(value);
  const pointer = exports.memory_alloc(encoded.length);
  new Uint8Array(exports.memory.buffer, pointer, encoded.length).set(encoded);
  try {
    return callback(pointer, encoded.length);
  } finally {
    exports.memory_free(pointer, encoded.length);
  }
}

self.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'validate') {
    validateEquation(message);
    return;
  }
  if (message.type === 'set-root-color') {
    if (wasm) wasm.set_root_color(message.index, message.rgb);
    return;
  }
  if (message.type === 'render') {
    newestRenderId = message.id;
    render(message);
  }
});

async function validateEquation(message) {
  try {
    const exports = await loadRustRenderer();
    const status = withRustString(exports, message.equation, (pointer, length) => exports.validate_equation(pointer, length));
    self.postMessage({ type: 'validated', requestId: message.requestId, ok: status === 0 });
  } catch (error) {
    self.postMessage({ type: 'validation-error', requestId: message.requestId, error: error.message });
  }
}

async function render(message) {
  const { id, width, height, centerX, centerY, span, iterations, colorScale, palette, mode, equation } = message;
  try {
    const exports = await loadRustRenderer();
    if (id !== newestRenderId) return;
    if (mode === 'newton') {
      if (activeEquation !== equation) {
        const status = withRustString(exports, equation, (pointer, length) => exports.set_equation(pointer, length));
        if (status !== 0) throw new Error('Could not parse this equation. Check its syntax and supported functions.');
        activeEquation = equation;
        const colors = Array.from({ length: exports.root_count() }, (_, index) => `#${exports.root_color(index).toString(16).padStart(6, '0')}`);
        self.postMessage({ type: 'roots', id, equation, colors });
      }
    }
    const rowsPerTile = 12;
    const paletteId = ({ aurora: 0, ember: 1, ocean: 2, mono: 3 })[palette] ?? 0;
    const modeId = mode === 'newton' ? 1 : 0;
    for (let firstRow = 0; firstRow < height; firstRow += rowsPerTile) {
      if (id !== newestRenderId) return;
      const rowCount = Math.min(rowsPerTile, height - firstRow);
      const byteLength = width * rowCount * 4;
      const outputPointer = exports.memory_alloc(byteLength);
      const status = exports.render_tile(
        width, height, firstRow, rowCount,
        centerX, centerY, span, iterations, colorScale,
        paletteId, modeId, outputPointer, byteLength,
      );
      if (status !== 0) {
        exports.memory_free(outputPointer, byteLength);
        throw new Error(`Rust renderer failed (${status}).`);
      }
      const pixels = new Uint8ClampedArray(exports.memory.buffer, outputPointer, byteLength).slice();
      exports.memory_free(outputPointer, byteLength);
      self.postMessage({ type: 'tile', id, width, firstRow, rowCount, pixels }, [pixels.buffer]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (id === newestRenderId) self.postMessage({ type: 'done', id });
  } catch (error) {
    if (id === newestRenderId) self.postMessage({ type: 'render-error', id, error: error.message });
  }
}
