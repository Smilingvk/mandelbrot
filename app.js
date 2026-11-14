(() => {
  const canvas = document.getElementById('fractal');
  const wrap = document.getElementById('canvasWrap');
  const ctx = canvas.getContext('2d', { alpha: false });
  const iterationsInput = document.getElementById('iterations');
  const colorInput = document.getElementById('colorScale');
  const worker = new Worker(new URL('./fractal-worker.js', import.meta.url), { type: 'module' });
  const presets = {
    classic: { x: -0.5, y: 0, span: 2.5 },
    seahorse: { x: -0.748, y: 0.102, span: 0.105 },
    spiral: { x: -0.1011, y: 0.9563, span: 0.012 }
  };
  const state = {
    mode: 'mandelbrot', x: -0.5, y: 0, span: 2.5,
    iterations: 180, colorScale: 12, palette: 'aurora',
    equation: 'z^3 - 1', zoom: 1, renderId: 0,
    dragging: false, dragMoved: false, dragStart: null
  };
  let resizeTimer;
  let validationRequest = 0;
  const pendingEquations = new Map();

  const fmt = (number) => number.toFixed(6).replace('-', '−');
  function updateReadouts() {
    document.getElementById('centerReadout').textContent = `${fmt(state.x)}, ${fmt(state.y)}i`;
    document.getElementById('zoomReadout').textContent = `${state.zoom >= 100 ? state.zoom.toFixed(0) : state.zoom.toFixed(1)}×`;
  }
  function setLoading(loading) {
    document.getElementById('loading').classList.toggle('visible', loading);
    document.getElementById('exportImage').disabled = loading;
  }
  function renderRootColorInputs(colors) {
    const container = document.getElementById('rootColorInputs');
    container.replaceChildren();
    colors.forEach((color, index) => {
      const label = document.createElement('label');
      label.className = 'root-color-control';
      label.textContent = `ROOT ${index + 1}`;
      const input = document.createElement('input');
      input.type = 'color';
      input.value = color;
      input.setAttribute('aria-label', `Color for root ${index + 1}`);
      input.addEventListener('change', () => {
        const rgb = Number.parseInt(input.value.slice(1), 16);
        worker.postMessage({ type: 'set-root-color', index, rgb });
        render();
      });
      label.append(input);
      container.append(label);
    });
  }
  function render() {
    if (!canvas.width || !canvas.height) return;
    state.renderId += 1;
    setLoading(true);
    document.getElementById('renderState').textContent = 'RENDERING IN RUST';
    worker.postMessage({
      type: 'render', id: state.renderId,
      width: canvas.width, height: canvas.height,
      centerX: state.x, centerY: state.y, span: state.span,
      iterations: state.iterations, colorScale: state.colorScale,
      palette: state.palette, mode: state.mode, equation: state.equation
    });
    updateReadouts();
  }
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const maxWidth = 1280;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(Math.min(rect.width * ratio, maxWidth)));
    const height = Math.max(1, Math.round(width / (rect.width / rect.height)));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      document.getElementById('dimensions').textContent = `${width} × ${height} PX`;
      render();
    }
  }

  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'validated' || message.type === 'validation-error') {
      if (message.requestId !== validationRequest) return;
      const source = pendingEquations.get(message.requestId);
      pendingEquations.delete(message.requestId);
      const error = document.getElementById('equationError');
      if (message.type === 'validated' && message.ok) {
        state.equation = source;
        document.getElementById('rootColorInputs').replaceChildren();
        document.getElementById('equationInput').value = source;
        error.textContent = '';
        const match = [...document.getElementById('equationSelect').options].find((option) => option.value === source);
        document.getElementById('equationSelect').value = match ? match.value : 'custom';
        if (state.mode === 'newton') render();
      } else {
        error.textContent = message.type === 'validation-error'
          ? message.error
          : 'Equation not recognized. Check the syntax and supported functions.';
      }
      return;
    }
    if (message.id !== state.renderId) return;
    if (message.type === 'roots') {
      renderRootColorInputs(message.colors);
    } else if (message.type === 'tile') {
      const pixels = message.pixels instanceof Uint8ClampedArray
        ? message.pixels
        : new Uint8ClampedArray(message.pixels);
      const tile = new ImageData(pixels, message.width, message.rowCount);
      ctx.putImageData(tile, 0, message.firstRow);
    } else if (message.type === 'done') {
      setLoading(false);
      document.getElementById('renderState').textContent = 'READY';
    } else if (message.type === 'render-error') {
      setLoading(false);
      document.getElementById('renderState').textContent = 'RENDER ERROR';
      document.getElementById('equationError').textContent = message.error;
    }
  });
  worker.addEventListener('error', (event) => {
    setLoading(false);
    document.getElementById('renderState').textContent = 'RUST MODULE ERROR';
    document.getElementById('equationError').textContent = event.message || 'Could not load the Rust WebAssembly renderer.';
  });

  function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const oldSpan = state.span;
    const anchorX = state.x + (px - 0.5) * oldSpan * (rect.width / rect.height);
    const anchorY = state.y + (0.5 - py) * oldSpan;
    state.span = Math.max(1e-10, Math.min(40, oldSpan / factor));
    const actualFactor = oldSpan / state.span;
    state.x = anchorX - (px - 0.5) * state.span * (rect.width / rect.height);
    state.y = anchorY - (0.5 - py) * state.span;
    state.zoom *= actualFactor;
    render();
  }
  function finishPan(clientX, clientY) {
    if (!state.dragStart || !state.dragMoved) return false;
    const dx = clientX - state.dragStart.x;
    const dy = clientY - state.dragStart.y;
    const rect = canvas.getBoundingClientRect();
    const unitsPerCssPixel = state.span / rect.height;
    state.x -= dx * unitsPerCssPixel;
    state.y += dy * unitsPerCssPixel;
    canvas.style.transform = '';
    state.dragStart = null;
    state.dragging = false;
    render();
    return true;
  }
  function applyEquation(source) {
    const requestId = ++validationRequest;
    pendingEquations.clear();
    pendingEquations.set(requestId, source);
    document.getElementById('equationError').textContent = 'Checking equation…';
    worker.postMessage({ type: 'validate', requestId, equation: source });
  }
  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    document.getElementById('equationSection').hidden = mode !== 'newton';
    document.getElementById('presetSection').hidden = mode === 'newton';
    document.getElementById('modeNote').innerHTML = mode === 'newton'
      ? `z<sub>n+1</sub> = z<sub>n</sub> − f(z<sub>n</sub>)/f′(z<sub>n</sub>)`
      : `z<sub>n+1</sub> = z<sub>n</sub><sup>2</sup> + c`;
    document.getElementById('aboutEyebrow').textContent = mode === 'newton' ? 'FOLLOW THE ROOTS' : 'THE RULE IS SIMPLE';
    document.getElementById('aboutEquation').innerHTML = mode === 'newton'
      ? `z<sub>n+1</sub> = z<sub>n</sub> − f(z<sub>n</sub>)/f′(z<sub>n</sub>)`
      : `z<sub>n+1</sub> = z<sub>n</sub><sup>2</sup> + c`;
    document.getElementById('aboutEquationCopy').textContent = mode === 'newton'
      ? 'Start from a point in the complex plane and repeat Newton’s method. Color shows which root each starting point approaches, and how quickly it gets there.'
      : 'Repeat this operation again and again. Color reveals which points escape to infinity and which remain in the set.';
    document.getElementById('aboutDescription').textContent = mode === 'newton'
      ? 'Newton fractals map the fate of each starting point as an equation is solved iteratively. Different colors reveal the roots it converges to; the intricate borders mark places where tiny changes can lead to a different answer.'
      : 'The Mandelbrot set asks what happens when a mathematical sequence repeats. Change one point, start again, and another boundary appears: intricate, surprising, always new.';
    document.getElementById('detailLabel').textContent = mode === 'newton' ? 'Maximum iterations' : 'Iteration depth';
    document.getElementById('colorLabel').textContent = mode === 'newton' ? 'Basin banding' : 'Color rhythm';
    document.getElementById('colorRange').hidden = mode === 'newton';
    document.getElementById('paletteHeading').textContent = mode === 'newton' ? 'AUTOMATIC ROOT COLORS' : 'CHOOSE A PALETTE';
    document.getElementById('paletteList').hidden = mode === 'newton';
    document.getElementById('rootColorNote').hidden = mode !== 'newton';
    if (mode === 'newton') {
      state.x = 0; state.y = 0; state.span = 4;
      document.getElementById('canvasHint').classList.add('hidden');
    } else {
      Object.assign(state, presets.classic);
      document.getElementById('canvasHint').classList.remove('hidden');
    }
    state.zoom = 1;
    render();
  }

  iterationsInput.addEventListener('input', () => {
    state.iterations = Number(iterationsInput.value);
    document.getElementById('iterationsValue').value = state.iterations;
    document.getElementById('iterationsValue').textContent = state.iterations;
    render();
  });
  colorInput.addEventListener('input', () => {
    state.colorScale = Number(colorInput.value);
    document.getElementById('colorScaleValue').value = `${(state.colorScale / 12).toFixed(1)}×`;
    document.getElementById('colorScaleValue').textContent = `${(state.colorScale / 12).toFixed(1)}×`;
    render();
  });
  document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  const equationSelect = document.getElementById('equationSelect');
  const equationInput = document.getElementById('equationInput');
  equationSelect.addEventListener('change', () => {
    if (equationSelect.value === 'custom') { equationInput.focus(); return; }
    equationInput.value = equationSelect.value;
    applyEquation(equationSelect.value);
  });
  document.getElementById('applyEquation').addEventListener('click', () => applyEquation(equationInput.value));
  equationInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') document.getElementById('applyEquation').click();
  });
  document.querySelectorAll('.palette-swatch').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('.palette-swatch.active')?.classList.remove('active');
    button.classList.add('active');
    state.palette = button.dataset.palette;
    render();
  }));
  document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => {
    document.querySelector('.preset.active')?.classList.remove('active');
    button.classList.add('active');
    Object.assign(state, presets[button.dataset.preset]);
    state.zoom = 2.5 / state.span;
    document.getElementById('canvasHint').classList.add('hidden');
    render();
  }));
  document.getElementById('resetView').addEventListener('click', () => {
    if (state.mode === 'newton') Object.assign(state, { x: 0, y: 0, span: 4, zoom: 1 });
    else Object.assign(state, presets.classic, { zoom: 1 });
    document.querySelector('.preset.active')?.classList.remove('active');
    document.querySelector('[data-preset="classic"]').classList.add('active');
    canvas.style.transform = '';
    render();
  });
  document.getElementById('zoomIn').addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 2);
  });
  document.getElementById('zoomOut').addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.5);
  });
  document.getElementById('exportImage').addEventListener('click', () => {
    if (document.getElementById('exportImage').disabled) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `forma-${state.mode}-${canvas.width}x${canvas.height}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
    }, 'image/png');
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    state.dragging = true;
    state.dragMoved = false;
    state.dragStart = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging || !state.dragStart) return;
    const dx = event.clientX - state.dragStart.x;
    const dy = event.clientY - state.dragStart.y;
    if (Math.hypot(dx, dy) > 5) state.dragMoved = true;
    if (state.dragMoved) canvas.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    const moved = finishPan(event.clientX, event.clientY);
    state.dragging = false;
    if (moved) return;
    state.dragStart = null;
    zoomAt(event.clientX, event.clientY, event.shiftKey ? 0.5 : 2);
    document.getElementById('canvasHint').classList.add('hidden');
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (!finishPan(event.clientX, event.clientY)) canvas.style.transform = '';
    state.dragging = false;
    state.dragStart = null;
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.35 : 1 / 1.35);
    document.getElementById('canvasHint').classList.add('hidden');
  }, { passive: false });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 120);
  });
  resizeCanvas();
})();
