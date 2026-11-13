(() => {
  const canvas = document.getElementById('fractal');
  const wrap = document.getElementById('canvasWrap');
  const ctx = canvas.getContext('2d', { alpha: false });
  const iterationsInput = document.getElementById('iterations');
  const colorInput = document.getElementById('colorScale');
  const presets = {
    classic: { x: -0.5, y: 0, span: 2.5 },
    seahorse: { x: -0.748, y: 0.102, span: 0.105 },
    spiral: { x: -0.1011, y: 0.9563, span: 0.012 }
  };
  const palettes = {
    aurora: [[15, 31, 77], [76, 72, 171], [185, 93, 190], [245, 137, 163], [245, 215, 133], [45, 174, 176]],
    ember: [[37, 19, 47], [115, 36, 68], [211, 72, 69], [248, 148, 76], [250, 220, 130]],
    ocean: [[7, 24, 48], [13, 83, 119], [16, 160, 166], [114, 222, 185], [224, 247, 214]],
    mono: [[13, 15, 21], [66, 71, 83], [145, 149, 158], [247, 245, 233]]
  };
  const state = { mode: 'mandelbrot', x: -0.5, y: 0, span: 2.5, iterations: 180, colorScale: 12, palette: 'aurora', equation: 'z^3 - 1', equationTree: null, renderId: 0, dragging: false, dragMoved: false, lastPointer: null, zoom: 1 };
  let resizeTimer;

  const fmt = (number) => number.toFixed(6).replace('-', '−');
  function updateReadouts() {
    document.getElementById('centerReadout').textContent = `${fmt(state.x)}, ${fmt(state.y)}i`;
    document.getElementById('zoomReadout').textContent = `${state.zoom >= 100 ? state.zoom.toFixed(0) : state.zoom.toFixed(1)}×`;
  }
  function resizeCanvas() {
    const rect = wrap.getBoundingClientRect();
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
  function isKnownInterior(x, y) {
    const shifted = x - 0.25;
    const q = shifted * shifted + y * y;
    return q * (q + shifted) <= 0.25 * y * y || (x + 1) * (x + 1) + y * y <= 0.0625;
  }
  function colorAt(value) {
    const stops = palettes[state.palette];
    const phase = ((value / state.colorScale) % 1 + 1) % 1;
    const scaled = phase * (stops.length - 1);
    const index = Math.floor(scaled);
    const mix = scaled - index;
    const a = stops[index];
    const b = stops[Math.min(index + 1, stops.length - 1)];
    return [
      Math.round(a[0] + (b[0] - a[0]) * mix),
      Math.round(a[1] + (b[1] - a[1]) * mix),
      Math.round(a[2] + (b[2] - a[2]) * mix)
    ];
  }
  function tokenize(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      if (/\s/.test(source[index])) { index++; continue; }
      const rest = source.slice(index);
      const number = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      if (number) { tokens.push({ type: 'number', value: Number(number[0]) }); index += number[0].length; continue; }
      const identifier = rest.match(/^[a-zA-Z]+/);
      if (identifier) { tokens.push({ type: 'name', value: identifier[0].toLowerCase() }); index += identifier[0].length; continue; }
      const char = source[index];
      if ('+-*/^()'.includes(char)) { tokens.push({ type: char, value: char }); index++; continue; }
      throw new Error(`Unexpected character “${char}”.`);
    }
    tokens.push({ type: 'eof' });
    return tokens;
  }
  function parseEquation(source) {
    const tokens = tokenize(source);
    let cursor = 0;
    const peek = () => tokens[cursor];
    const take = (type) => {
      if (peek().type !== type) throw new Error(`Expected “${type}”.`);
      return tokens[cursor++];
    };
    function primary() {
      const token = peek();
      if (token.type === 'number') { cursor++; return { type: 'constant', value: token.value }; }
      if (token.type === '(') { cursor++; const node = expression(); take(')'); return node; }
      if (token.type === 'name') {
        cursor++;
        if (token.value === 'z' || token.value === 'i' || token.value === 'pi' || token.value === 'e') return { type: 'symbol', value: token.value };
        if (['sin', 'cos', 'exp', 'log', 'sqrt'].includes(token.value)) {
          take('(');
          const argument = expression();
          take(')');
          return { type: 'function', value: token.value, argument };
        }
        throw new Error(`Unknown name “${token.value}”.`);
      }
      throw new Error('Expected a number, z, function, or parenthesized expression.');
    }
    function power() {
      let node = primary();
      if (peek().type === '^') { cursor++; node = { type: 'binary', value: '^', left: node, right: unary() }; }
      return node;
    }
    function unary() {
      if (peek().type === '+' || peek().type === '-') {
        const op = tokens[cursor++].type;
        return { type: 'unary', value: op, argument: unary() };
      }
      return power();
    }
    function term() {
      let node = unary();
      while (peek().type === '*' || peek().type === '/') {
        const op = tokens[cursor++].type;
        node = { type: 'binary', value: op, left: node, right: unary() };
      }
      return node;
    }
    function expression() {
      let node = term();
      while (peek().type === '+' || peek().type === '-') {
        const op = tokens[cursor++].type;
        node = { type: 'binary', value: op, left: node, right: term() };
      }
      return node;
    }
    const tree = expression();
    if (peek().type !== 'eof') throw new Error('There is extra text after the equation.');
    if (!source.trim() || !JSON.stringify(tree).includes('"z"')) throw new Error('The function must include z.');
    return tree;
  }
  const c = (re = 0, im = 0) => ({ re, im });
  const cAdd = (a, b) => c(a.re + b.re, a.im + b.im);
  const cSub = (a, b) => c(a.re - b.re, a.im - b.im);
  const cMul = (a, b) => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  function cIntegerPower(base, exponent) {
    let result = c(1), factor = base, count = Math.abs(exponent);
    while (count > 0) {
      if (count % 2 === 1) result = cMul(result, factor);
      factor = cMul(factor, factor);
      count = Math.floor(count / 2);
    }
    return exponent < 0 ? cDiv(c(1), result) : result;
  }
  const cDiv = (a, b) => {
    const d = b.re * b.re + b.im * b.im;
    return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  };
  const cExp = (a) => { const m = Math.exp(a.re); return c(m * Math.cos(a.im), m * Math.sin(a.im)); };
  const cLog = (a) => c(Math.log(Math.hypot(a.re, a.im)), Math.atan2(a.im, a.re));
  const cSqrt = (a) => { const root = Math.sqrt(Math.hypot(a.re, a.im)); const angle = Math.atan2(a.im, a.re) / 2; return c(root * Math.cos(angle), root * Math.sin(angle)); };
  const cSin = (a) => c(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
  const cCos = (a) => c(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
  function evaluate(tree, z) {
    switch (tree.type) {
      case 'constant': return { v: c(tree.value), d: c() };
      case 'symbol':
        if (tree.value === 'z') return { v: z, d: c(1) };
        if (tree.value === 'i') return { v: c(0, 1), d: c() };
        if (tree.value === 'pi') return { v: c(Math.PI), d: c() };
        return { v: c(Math.E), d: c() };
      case 'unary': {
        const a = evaluate(tree.argument, z);
        return tree.value === '-' ? { v: c(-a.v.re, -a.v.im), d: c(-a.d.re, -a.d.im) } : a;
      }
      case 'function': {
        const a = evaluate(tree.argument, z);
        let v, slope;
        if (tree.value === 'sin') { v = cSin(a.v); slope = cCos(a.v); }
        else if (tree.value === 'cos') { v = cCos(a.v); slope = c(-cSin(a.v).re, -cSin(a.v).im); }
        else if (tree.value === 'exp') { v = cExp(a.v); slope = v; }
        else if (tree.value === 'log') { v = cLog(a.v); slope = cDiv(c(1), a.v); }
        else { v = cSqrt(a.v); slope = cDiv(c(1), cMul(c(2), v)); }
        return { v, d: cMul(slope, a.d) };
      }
      case 'binary': {
        const a = evaluate(tree.left, z), b = evaluate(tree.right, z);
        if (tree.value === '+') return { v: cAdd(a.v, b.v), d: cAdd(a.d, b.d) };
        if (tree.value === '-') return { v: cSub(a.v, b.v), d: cSub(a.d, b.d) };
        if (tree.value === '*') return { v: cMul(a.v, b.v), d: cAdd(cMul(a.d, b.v), cMul(a.v, b.d)) };
        if (tree.value === '/') return { v: cDiv(a.v, b.v), d: cDiv(cSub(cMul(a.d, b.v), cMul(a.v, b.d)), cMul(b.v, b.v)) };
        if (b.v.im === 0 && b.d.re === 0 && b.d.im === 0 && Number.isInteger(b.v.re) && Math.abs(b.v.re) < 10000) {
          const exponent = b.v.re;
          const v = cIntegerPower(a.v, exponent);
          const d = exponent === 0 ? c() : cMul(c(exponent), cMul(cIntegerPower(a.v, exponent - 1), a.d));
          return { v, d };
        }
        const v = cExp(cMul(b.v, cLog(a.v)));
        const d = cMul(v, cAdd(cMul(b.d, cLog(a.v)), cDiv(cMul(b.v, a.d), a.v)));
        return { v, d };
      }
    }
  }
  function newtonPixel(z, tree, maxIterations) {
    let point = z;
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const result = evaluate(tree, point);
      const magnitude = Math.hypot(result.v.re, result.v.im);
      if (!Number.isFinite(magnitude) || !Number.isFinite(result.d.re) || !Number.isFinite(result.d.im)) return null;
      if (magnitude < 1e-5) return { root: point, iteration };
      const derivativeSize = result.d.re * result.d.re + result.d.im * result.d.im;
      if (derivativeSize < 1e-20) return null;
      point = cSub(point, cDiv(result.v, result.d));
      if (!Number.isFinite(point.re) || !Number.isFinite(point.im) || Math.hypot(point.re, point.im) > 1e8) return null;
    }
    return null;
  }
  function newtonColor(sample) {
    if (!sample) return [7, 9, 15];
    const angle = Math.atan2(sample.root.im, sample.root.re);
    const stops = palettes[state.palette];
    const phase = ((angle / (2 * Math.PI) + 0.5) % 1 + 1) % 1;
    const scaled = phase * stops.length;
    const index = Math.floor(scaled);
    const mix = scaled - index;
    const a = stops[index % stops.length];
    const b = stops[(index + 1) % stops.length];
    const stripe = (sample.iteration % state.colorScale) / state.colorScale;
    const brightness = Math.min(1, 0.48 + 0.52 * (1 - Math.exp(-sample.iteration / 12)) + (stripe > 0.88 ? 0.1 : 0));
    return [0, 1, 2].map((channel) => Math.round((a[channel] + (b[channel] - a[channel]) * mix) * brightness));
  }
  function render() {
    if (!canvas.width || !canvas.height) return;
    if (state.mode === 'newton' && !state.equationTree) return;
    const id = ++state.renderId;
    const width = canvas.width;
    const height = canvas.height;
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const unit = state.span / height;
    const firstX = state.x - width * unit / 2;
    const firstY = state.y + height * unit / 2;
    const maxIterations = state.iterations;
    let row = 0;
    const started = performance.now();
    const loading = document.getElementById('loading');
    const label = document.getElementById('renderState');
    loading.classList.add('visible');
    label.textContent = 'CALCULATING';

    function drawRows() {
      if (id !== state.renderId) return;
      const rowLimit = Math.min(row + 3, height);
      for (; row < rowLimit; row++) {
        const ci = firstY - (row + 0.5) * unit;
        for (let column = 0; column < width; column++) {
          const cr = firstX + (column + 0.5) * unit;
          const offset = (row * width + column) * 4;
          if (state.mode === 'newton') {
            const sample = newtonPixel(c(cr, ci), state.equationTree, maxIterations);
            const [r, g, b] = newtonColor(sample);
            data[offset] = r; data[offset + 1] = g; data[offset + 2] = b;
          } else if (isKnownInterior(cr, ci)) {
            data[offset] = 7; data[offset + 1] = 9; data[offset + 2] = 15;
          } else {
            let zr = 0, zi = 0, magnitude = 0, n = 0;
            while (n < maxIterations && magnitude <= 4) {
              const nextR = zr * zr - zi * zi + cr;
              zi = 2 * zr * zi + ci;
              zr = nextR;
              magnitude = zr * zr + zi * zi;
              n++;
            }
            if (magnitude > 4) {
              const smooth = n + 1 - Math.log(Math.log(Math.sqrt(magnitude))) / Math.LN2;
              const [r, g, b] = colorAt(Math.max(0, smooth));
              data[offset] = r; data[offset + 1] = g; data[offset + 2] = b;
            } else {
              data[offset] = 7; data[offset + 1] = 9; data[offset + 2] = 15;
            }
          }
          data[offset + 3] = 255;
        }
      }
      if (row < height) {
        requestAnimationFrame(drawRows);
      } else {
        ctx.putImageData(image, 0, 0);
        loading.classList.remove('visible');
        label.textContent = `READY · ${(performance.now() - started) / 1000 < 1 ? '<1' : ((performance.now() - started) / 1000).toFixed(1)} S`;
      }
    }
    requestAnimationFrame(drawRows);
    updateReadouts();
  }
  function zoomAt(clientX, clientY, factor) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) / rect.width;
    const py = (clientY - rect.top) / rect.height;
    const unit = state.span / wrap.getBoundingClientRect().height;
    const anchorX = state.x + (px - 0.5) * rect.width * unit;
    const anchorY = state.y + (0.5 - py) * rect.height * unit;
    state.span = Math.max(1e-10, Math.min(5, state.span / factor));
    const nextUnit = state.span / rect.height;
    state.x = anchorX - (px - 0.5) * rect.width * nextUnit;
    state.y = anchorY + (py - 0.5) * rect.height * nextUnit;
    state.zoom *= factor;
    render();
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    document.getElementById('equationSection').hidden = mode !== 'newton';
    document.getElementById('presetSection').hidden = mode === 'newton';
    document.getElementById('modeNote').innerHTML = mode === 'newton' ? `z<sub>n+1</sub> = z<sub>n</sub> − f(z<sub>n</sub>)/f′(z<sub>n</sub>)` : `z<sub>n+1</sub> = z<sub>n</sub><sup>2</sup> + c`;
    document.getElementById('presetHeading').textContent = mode === 'newton' ? 'STARTING POINTS' : 'STARTING POINTS';
    document.getElementById('aboutEyebrow').textContent = mode === 'newton' ? 'FOLLOW THE ROOTS' : 'THE RULE IS SIMPLE';
    document.getElementById('aboutEquation').innerHTML = mode === 'newton' ? `z<sub>n+1</sub> = z<sub>n</sub> − f(z<sub>n</sub>)/f′(z<sub>n</sub>)` : `z<sub>n+1</sub> = z<sub>n</sub><sup>2</sup> + c`;
    document.getElementById('aboutEquationCopy').textContent = mode === 'newton'
      ? 'Start from a point in the complex plane and repeat Newton’s method. Color shows which root each starting point approaches, and how quickly it gets there.'
      : 'Repeat this operation again and again. Color reveals which points escape to infinity and which remain in the set.';
    document.getElementById('aboutDescription').textContent = mode === 'newton'
      ? 'Newton fractals map the fate of each starting point as an equation is solved iteratively. Different colors reveal the roots it converges to; the intricate borders mark places where tiny changes can lead to a different answer.'
      : 'The Mandelbrot set asks what happens when a mathematical sequence repeats. Change one point, start again, and another boundary appears: intricate, surprising, always new.';
    document.getElementById('detailLabel').textContent = mode === 'newton' ? 'Maximum iterations' : 'Iteration depth';
    document.getElementById('colorLabel').textContent = mode === 'newton' ? 'Basin banding' : 'Color rhythm';
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
  function applyEquation(source) {
    const error = document.getElementById('equationError');
    try {
      const tree = parseEquation(source);
      evaluate(tree, c(0.37, 0.29));
      state.equation = source;
      state.equationTree = tree;
      error.textContent = '';
      document.getElementById('equationInput').value = source;
      render();
      return true;
    } catch (reason) {
      error.textContent = reason.message || 'Could not read this equation.';
      return false;
    }
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
    applyEquation(equationSelect.value);
  });
  document.getElementById('applyEquation').addEventListener('click', () => {
    if (applyEquation(equationInput.value)) {
      const match = [...equationSelect.options].find((option) => option.value === equationInput.value);
      equationSelect.value = match ? match.value : 'custom';
      equationInput.blur();
    }
  });
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
    state.zoom = state.mode === 'newton' ? 1 : 2.5 / state.span;
    document.getElementById('canvasHint').classList.add('hidden');
    render();
  }));
  document.getElementById('resetView').addEventListener('click', () => {
    if (state.mode === 'newton') Object.assign(state, { x: 0, y: 0, span: 4, zoom: 1 });
    else Object.assign(state, presets.classic, { zoom: 1 });
    document.querySelector('.preset.active')?.classList.remove('active');
    document.querySelector('[data-preset="classic"]').classList.add('active');
    render();
  });
  document.getElementById('exportImage').addEventListener('click', () => {
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
    state.dragging = true;
    state.dragMoved = false;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) state.dragMoved = true;
    const unit = state.span / wrap.getBoundingClientRect().height;
    state.x -= dx * unit;
    state.y += dy * unit;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    if (state.dragMoved) render();
  });
  canvas.addEventListener('pointerup', (event) => {
    state.dragging = false;
    if (state.dragMoved) return;
    zoomAt(event.clientX, event.clientY, 2);
    document.getElementById('canvasHint').classList.add('hidden');
  });
  canvas.addEventListener('pointercancel', () => { state.dragging = false; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.35 : 1 / 1.35);
    document.getElementById('canvasHint').classList.add('hidden');
  }, { passive: false });
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 120);
  });
  state.equationTree = parseEquation(state.equation);
  resizeCanvas();
})();
