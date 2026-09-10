import { useEffect, useRef } from "react";

function toRgb(color) {
  const value = color.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const number = Number.parseInt(normalized, 16);
  return {
    r: (number >> 16) & 255,
    g: (number >> 8) & 255,
    b: number & 255,
  };
}

function rgba(color, alpha) {
  const { r, g, b } = toRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function GradientWaves({
  horizonColor = "#071923",
  waveColor = "#0e7490",
  crestColor = "#67e8f9",
  speed = 0.4,
  amplitude = 2.5,
  waveScale = 0.6,
  waveRatio = 0.9,
  swell = 35,
  turbulence = 20,
  tilt = 1.11,
  zoom = 1,
  height = 5.5,
  fogDepth = 15,
  detail = "medium",
  brightness = 1,
  opacity = 1,
  mouseInteraction = true,
  parallaxStrength = 0.5,
  grain = true,
  grainIntensity = 0.05,
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0.5, y: 0.5 };
    let frameId;
    let width = 0;
    let heightPx = 0;
    let pixelRatio = 1;
    let startTime = performance.now();

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      heightPx = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * pixelRatio;
      canvas.height = heightPx * pixelRatio;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const updatePointer = (event) => {
      if (!mouseInteraction) return;
      pointer.x = event.clientX / window.innerWidth;
      pointer.y = event.clientY / window.innerHeight;
    };

    const draw = (now) => {
      const elapsed = reducedMotion ? 0 : (now - startTime) * 0.001 * speed;
      const detailMultiplier = detail === "high" ? 1.35 : detail === "low" ? 0.7 : 1;
      const parallaxX = mouseInteraction ? (pointer.x - 0.5) * parallaxStrength * 24 : 0;
      const parallaxY = mouseInteraction ? (pointer.y - 0.5) * parallaxStrength * 10 : 0;
      const horizon = Math.max(heightPx * 0.28, heightPx * (0.58 - height * 0.018) + parallaxY);

      context.clearRect(0, 0, width, heightPx);
      const sky = context.createLinearGradient(0, 0, 0, heightPx);
      sky.addColorStop(0, rgba(horizonColor, 0.72 * brightness * opacity));
      sky.addColorStop(Math.min(1, horizon / heightPx), rgba(horizonColor, 0.18 * opacity));
      sky.addColorStop(1, rgba("#050b13", 0.02 * opacity));
      context.fillStyle = sky;
      context.fillRect(0, 0, width, heightPx);

      const layers = Math.round(10 * detailMultiplier);
      for (let layer = layers; layer >= 0; layer -= 1) {
        const depth = layer / layers;
        const baseY = horizon + depth * heightPx * 0.5;
        const layerAmplitude = (10 + swell * 0.35) * (1 - depth * 0.7) * amplitude;
        const frequency = (0.004 + depth * 0.006) * waveScale * zoom;
        const phase = elapsed * (1.2 - depth * 0.5) + layer * 0.8;
        const alpha = (0.055 + (1 - depth) * 0.12) * opacity;

        context.beginPath();
        context.moveTo(0, heightPx);
        for (let x = 0; x <= width; x += 8) {
          const primary = Math.sin(x * frequency + phase) * layerAmplitude;
          const secondary = Math.sin(x * frequency * 2.4 - phase * 1.3) * turbulence * 0.08;
          const y = baseY + primary + secondary + x * (tilt - 1) * 0.018;
          context.lineTo(x, y);
        }
        context.lineTo(width, heightPx);
        context.closePath();
        context.fillStyle = rgba(waveColor, alpha);
        context.fill();

        context.beginPath();
        for (let x = 0; x <= width; x += 8) {
          const y = baseY + Math.sin(x * frequency + phase) * layerAmplitude + Math.sin(x * frequency * 2.4 - phase * 1.3) * turbulence * 0.08;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = rgba(crestColor, (0.02 + (1 - depth) * 0.06) * brightness * opacity);
        context.lineWidth = 1 + (1 - depth) * 0.8;
        context.stroke();
      }

      const fog = context.createLinearGradient(0, horizon - fogDepth * 4, 0, horizon + fogDepth * 8);
      fog.addColorStop(0, rgba(crestColor, 0));
      fog.addColorStop(0.5, rgba(crestColor, 0.08 * opacity));
      fog.addColorStop(1, rgba(crestColor, 0));
      context.fillStyle = fog;
      context.fillRect(0, horizon - fogDepth * 4, width, fogDepth * 12);

      if (grain) {
        context.fillStyle = rgba(crestColor, grainIntensity * 0.25 * opacity);
        for (let index = 0; index < width * heightPx * 0.00012; index += 1) {
          context.fillRect(Math.random() * width, Math.random() * heightPx, 1, 1);
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    window.addEventListener("pointermove", updatePointer, { passive: true });
    frameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("pointermove", updatePointer);
    };
  }, [amplitude, brightness, crestColor, detail, fogDepth, grain, grainIntensity, height, horizonColor, mouseInteraction, opacity, parallaxStrength, speed, swell, tilt, turbulence, waveColor, waveRatio, waveScale, zoom]);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />;
}