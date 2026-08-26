function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

export class PerformanceDiagnostics {
  constructor(renderer) {
    this.renderer = renderer;
    this.panel = document.getElementById('diagnostics-panel');
    this.output = document.getElementById('diagnostics-output');
    this.samples = [];
    this.longTasks = [];
    this.contextLosses = 0;
    this.visible = false;

    try {
      this.longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks.push({ at: performance.now(), duration: entry.duration });
        }
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch { /* Long Tasks API is optional. */ }

    renderer.domElement.addEventListener('webglcontextlost', () => {
      this.contextLosses += 1;
    });

    document.getElementById('diagnostics-close')?.addEventListener('click', () => this.hide());
    document.getElementById('diagnostics-copy')?.addEventListener('click', async () => {
      const report = this.buildReport();
      try {
        await navigator.clipboard.writeText(report);
        document.getElementById('diagnostics-copy').textContent = 'COPIED ✓';
      } catch {
        window.prompt('Copy this diagnostics report:', report);
      }
    });
  }

  recordFrame(frameTime) {
    if (!Number.isFinite(frameTime) || frameTime <= 0) return;
    this.samples.push(frameTime * 1000);
    if (this.samples.length > 600) this.samples.shift();
    const cutoff = performance.now() - 15000;
    this.longTasks = this.longTasks.filter((task) => task.at >= cutoff);
    if (this.visible) this.refreshTimer ||= setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, 500);
  }

  getGpuInfo() {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webgl: this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1',
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  }

  buildReport() {
    const gpu = this.getGpuInfo();
    const buffer = {
      x: this.renderer.domElement.width,
      y: this.renderer.domElement.height,
    };
    const frameP50 = percentile(this.samples, 0.5);
    const frameP99 = percentile(this.samples, 0.99);
    const avg = this.samples.reduce((sum, value) => sum + value, 0) / Math.max(1, this.samples.length);
    const recentLongTasks = this.longTasks.filter((task) => performance.now() - task.at < 10000);
    const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(gpu.renderer);
    const integrated = /intel|iris|uhd/i.test(`${gpu.vendor} ${gpu.renderer}`);
    const suggestions = [];
    if (software) suggestions.push('CRITICAL: Software rendering detected. Enable browser hardware acceleration and restart the browser.');
    else if (integrated) suggestions.push('Browser appears to be using Intel integrated graphics. Assign Chrome/Edge to High performance in Windows Graphics settings.');
    if (buffer.x * buffer.y > 9000000) suggestions.push('Very large render buffer detected. Test at 1920×1080 to confirm a display fill-rate bottleneck.');
    if (recentLongTasks.length) suggestions.push('Main-thread long tasks detected. Close heavy tabs/extensions and retest in an Incognito window.');
    if (!suggestions.length) suggestions.push('GPU selection looks normal. Send this report so scene/render costs can be compared precisely.');

    return [
      'ATLAS DRIVE PERFORMANCE REPORT',
      `URL: ${location.href}`,
      `Browser: ${navigator.userAgent}`,
      `GPU: ${gpu.renderer}`,
      `GPU vendor: ${gpu.vendor}`,
      `API: ${gpu.webgl} · Max texture ${gpu.maxTexture}`,
      `Viewport: ${innerWidth}×${innerHeight} CSS · DPR ${devicePixelRatio}`,
      `Render buffer: ${buffer.x}×${buffer.y} (${(buffer.x * buffer.y / 1000000).toFixed(2)} MP)`,
      `CPU threads: ${navigator.hardwareConcurrency || 'unknown'} · Device memory: ${navigator.deviceMemory || 'unknown'} GB`,
      `Frames: avg ${avg.toFixed(1)} ms (${avg ? (1000 / avg).toFixed(0) : 0} FPS) · median ${frameP50.toFixed(1)} ms · 1% low ${frameP99.toFixed(1)} ms`,
      `Long tasks (last 10s): ${recentLongTasks.length}${recentLongTasks.length ? ` · worst ${Math.max(...recentLongTasks.map((task) => task.duration)).toFixed(0)} ms` : ''}`,
      `WebGL context losses: ${this.contextLosses}`,
      `Renderer: ${this.renderer.info.render.calls} calls · ${this.renderer.info.render.triangles} triangles`,
      `GPU memory objects: ${this.renderer.info.memory.textures} textures · ${this.renderer.info.memory.geometries} geometries`,
      '',
      ...suggestions.map((suggestion) => `ACTION: ${suggestion}`),
    ].join('\n');
  }

  refresh() {
    if (this.output) this.output.textContent = this.buildReport();
  }

  show() {
    this.visible = true;
    this.panel.style.display = 'flex';
    this.refresh();
  }

  hide() {
    this.visible = false;
    this.panel.style.display = 'none';
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }
}
