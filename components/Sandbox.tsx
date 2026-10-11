'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { World, QUAKE_DURATION, FLOOD_DURATION, ERUPT_DURATION } from '@/sim/world';
import { Renderer } from '@/sim/render';
import { generateCity, stampBuilding } from '@/sim/structures';
import { ELEMENT_GROUPS, ELEMENT_NAMES, SAND, WIND } from '@/sim/elements';

const GRID_W = 320;
const GRID_H = 200;
const CANVAS_SCALE = 4;

type Tool = 'paint' | 'erase' | 'building' | 'vent';

interface Hud {
  fps: number;
  particles: number;
  projectiles: number;
  quake: number;
  flood: number;
  erupt: number;
}

const ELEMENT_COLORS: Record<number, string> = {};
for (const g of ELEMENT_GROUPS) for (const it of g.items) ELEMENT_COLORS[it.id] = it.color;

export default function Sandbox() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  if (!worldRef.current) worldRef.current = new World(GRID_W, GRID_H);

  const [element, setElement] = useState(SAND);
  const [tool, setTool] = useState<Tool>('paint');
  const [brush, setBrush] = useState(4);
  const [paused, setPaused] = useState(false);
  const [eraseFilter, setEraseFilter] = useState(-1);
  const [rain, setRain] = useState(false);
  const [wind, setWind] = useState(false);
  const [windStrength, setWindStrength] = useState(0.6);
  const [heatwave, setHeatwave] = useState(false);
  const [hud, setHud] = useState<Hud>({ fps: 0, particles: 0, projectiles: 0, quake: 0, flood: 0, erupt: 0 });

  const settings = useRef({ element, tool, brush, paused, eraseFilter, step: false });
  settings.current = { ...settings.current, element, tool, brush, paused, eraseFilter };

  const ptr = useRef({ down: false, erase: false, x: 0, y: 0, lx: 0, ly: 0, inside: false, dirX: 1, dirY: 0 });

  // sync environment toggles into the engine
  useEffect(() => {
    const w = worldRef.current!;
    w.rain = rain;
    w.windOn = wind;
    w.windStrength = windStrength;
    w.heatwave = heatwave;
  }, [rain, wind, windStrength, heatwave]);

  // main loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const world = worldRef.current!;
    const renderer = new Renderer(canvas, GRID_W, GRID_H);
    if (world.frame === 0 && world.rigidCount === 0) {
      generateCity(world);
      world.step();
    }
    let raf = 0;
    let last = performance.now();
    let fpsAcc = 0;
    let fpsFrames = 0;
    let fps = 60;
    let hudTimer = 0;

    const apply = (x: number, y: number) => {
      const s = settings.current;
      const p = ptr.current;
      const gx = Math.floor(x);
      const gy = Math.floor(y);
      if (p.erase || s.tool === 'erase') world.erase(gx, gy, s.brush, p.erase ? -1 : s.eraseFilter);
      else if (s.element === WIND) world.blow(gx, gy, s.brush, p.dirX, p.dirY);
      else world.paint(gx, gy, s.brush, s.element);
    };

    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      fpsAcc += dt;
      fpsFrames++;
      if (fpsAcc >= 500) {
        fps = (fpsFrames * 1000) / fpsAcc;
        fpsAcc = 0;
        fpsFrames = 0;
      }

      const s = settings.current;
      const p = ptr.current;
      if (p.down) {
        const dx = p.x - p.lx;
        const dy = p.y - p.ly;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.4) {
          p.dirX = dx / dist;
          p.dirY = dy / dist;
        }
        const steps = Math.max(1, Math.ceil(dist / Math.max(1, s.brush * 0.5)));
        for (let k = 1; k <= steps; k++) apply(p.lx + (dx * k) / steps, p.ly + (dy * k) / steps);
        p.lx = p.x;
        p.ly = p.y;
      }

      if (!s.paused || s.step) {
        world.step();
        s.step = false;
      }

      const showBrush = p.inside && (s.tool === 'paint' || s.tool === 'erase');
      const particles = renderer.render(world, {
        brushX: Math.floor(p.x),
        brushY: Math.floor(p.y),
        brushR: s.brush,
        showBrush,
        brushColor: s.tool === 'erase' ? '#ff4d8d' : '#5ef2ff',
      });

      hudTimer += dt;
      if (hudTimer > 250) {
        hudTimer = 0;
        setHud({
          fps: Math.round(fps),
          particles,
          projectiles: world.projectiles.length,
          quake: world.quakeTimer,
          flood: world.floodTimer,
          erupt: world.eruptTimer,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPaused((v) => !v);
      } else if (e.key === 'e' || e.key === 'E') setTool((t) => (t === 'erase' ? 'paint' : 'erase'));
      else if (e.key === '[') setBrush((b) => Math.max(1, b - 1));
      else if (e.key === ']') setBrush((b) => Math.min(20, b + 1));
      else if (e.key === '.') settings.current.step = true;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toGrid = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(GRID_W - 0.01, ((e.clientX - r.left) / r.width) * GRID_W)),
      y: Math.max(0, Math.min(GRID_H - 0.01, ((e.clientY - r.top) / r.height) * GRID_H)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const world = worldRef.current!;
    const { x, y } = toGrid(e);
    const p = ptr.current;
    p.x = p.lx = x;
    p.y = p.ly = y;
    p.inside = true;
    const gx = Math.floor(x);
    const gy = Math.floor(y);
    if (tool === 'building' && e.button === 0) {
      stampBuilding(world, gx, gy);
      return;
    }
    if (tool === 'vent' && e.button === 0) {
      world.setVent(gx, gy);
      setTool('paint');
      return;
    }
    if (tool === 'erase' && e.shiftKey && e.button === 0) {
      world.eraseStructure(gx, gy);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    p.down = true;
    p.erase = e.button === 2;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toGrid(e);
    ptr.current.x = x;
    ptr.current.y = y;
    ptr.current.inside = true;
  };

  const endStroke = () => {
    ptr.current.down = false;
    ptr.current.erase = false;
  };

  const selectElement = useCallback((id: number) => {
    setElement(id);
    setTool('paint');
  }, []);

  const world = worldRef.current!;
  const weatherList = [rain && 'Rain', wind && `Wind ${windStrength >= 0 ? '→' : '←'}`, heatwave && 'Heatwave'].filter(
    Boolean,
  ) as string[];
  const disasters = [
    hud.quake > 0 && `Earthquake ${(hud.quake / 60).toFixed(1)}s`,
    hud.flood > 0 && `Flood ${(hud.flood / 60).toFixed(1)}s`,
    hud.erupt > 0 && `Eruption ${(hud.erupt / 60).toFixed(1)}s`,
  ].filter(Boolean) as string[];
  const activeLabel =
    tool === 'erase'
      ? eraseFilter < 0
        ? 'Eraser'
        : `Eraser (${ELEMENT_NAMES[eraseFilter]})`
      : tool === 'building'
        ? 'Building stamp'
        : tool === 'vent'
          ? 'Place vent'
          : ELEMENT_NAMES[element];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <h1>
              PARTICLE<span>//</span>LAB
            </h1>
            <p>Cellular automata &amp; rigid-body sandbox</p>
          </div>
        </div>
        <div className="credit">
          Made by <span>Autumn-Rose Attrill</span>
        </div>
        <div className="top-actions">
          <button className={`btn play ${paused ? 'is-paused' : ''}`} onClick={() => setPaused((v) => !v)}>
            {paused ? '▶ Play' : '❚❚ Pause'}
          </button>
          <button className="btn" disabled={!paused} onClick={() => (settings.current.step = true)} title="Step one frame (.)">
            Step
          </button>
          <button className="btn danger" onClick={() => world.clear()}>
            Clear
          </button>
        </div>
      </header>

      <div className="main">
        <aside className="panel left">
          {ELEMENT_GROUPS.map((g) => (
            <section key={g.title} className="group">
              <h2>{g.title}</h2>
              <div className="elements">
                {g.items.map((it) => (
                  <button
                    key={it.id}
                    className={`el ${tool === 'paint' && element === it.id ? 'active' : ''}`}
                    style={{ '--c': it.color } as React.CSSProperties}
                    onClick={() => selectElement(it.id)}
                  >
                    <span className="swatch" />
                    {it.name}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        <section className="stage">
          <div className={`frame ${hud.quake > 0 ? 'quaking' : ''}`}>
            <canvas
              ref={canvasRef}
              width={GRID_W * CANVAS_SCALE}
              height={GRID_H * CANVAS_SCALE}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={() => (ptr.current.inside = false)}
              onContextMenu={(e) => e.preventDefault()}
            />
            <div className="hud">
              <div>
                <b>FPS</b>
                <span className={hud.fps < 45 ? 'warn' : ''}>{hud.fps}</span>
              </div>
              <div>
                <b>Brush</b>
                <span style={{ color: tool === 'paint' ? ELEMENT_COLORS[element] : undefined }}>{activeLabel}</span>
              </div>
              <div>
                <b>Particles</b>
                <span>
                  {hud.particles.toLocaleString()}
                  {hud.projectiles > 0 && <em> +{hud.projectiles} airborne</em>}
                </span>
              </div>
              <div>
                <b>Weather</b>
                <span>{weatherList.length ? weatherList.join(' · ') : 'Clear'}</span>
              </div>
              <div>
                <b>Status</b>
                <span className={disasters.length ? 'alert' : ''}>{disasters.length ? disasters.join(' · ') : 'Calm'}</span>
              </div>
            </div>
            {paused && <div className="paused-badge">PAUSED</div>}
          </div>
          <p className="hint">
            Drag to draw · Right-drag to erase · Shift+click with Eraser removes a whole structure · Space pause ·
            [ ] brush size · E eraser · Wall is anchored, other solids fall when unsupported
          </p>
        </section>

        <aside className="panel right">
          <section className="group">
            <h2>Tools</h2>
            <label className="slider">
              <span>
                Brush size <b>{brush}px</b>
              </span>
              <input type="range" min={1} max={20} value={brush} onChange={(e) => setBrush(+e.target.value)} />
            </label>
            <div className="row">
              <button className={`btn ${tool === 'erase' ? 'on' : ''}`} onClick={() => setTool(tool === 'erase' ? 'paint' : 'erase')}>
                ⌫ Eraser
              </button>
              <select value={eraseFilter} onChange={(e) => setEraseFilter(+e.target.value)} title="Erase only this element">
                <option value={-1}>All elements</option>
                {Object.entries(ELEMENT_NAMES)
                  .filter(([id]) => +id !== WIND)
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      Only {name}
                    </option>
                  ))}
              </select>
            </div>
          </section>

          <section className="group">
            <h2>Weather</h2>
            <Toggle label="Rain" icon="☂" on={rain} onChange={setRain} />
            <Toggle label="Wind" icon="≋" on={wind} onChange={setWind} />
            {wind && (
              <label className="slider">
                <span>
                  Direction &amp; force <b>{windStrength > 0 ? '→' : windStrength < 0 ? '←' : '·'} {Math.abs(windStrength).toFixed(1)}</b>
                </span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.1}
                  value={windStrength}
                  onChange={(e) => setWindStrength(+e.target.value)}
                />
              </label>
            )}
            <Toggle label="Heatwave" icon="☀" on={heatwave} onChange={setHeatwave} />
          </section>

          <section className="group">
            <h2>Natural Disasters</h2>
            <Disaster label="Earthquake" icon="〰" remaining={hud.quake} total={QUAKE_DURATION} onClick={() => world.triggerQuake()} />
            <Disaster label="Flood" icon="🌊" remaining={hud.flood} total={FLOOD_DURATION} onClick={() => world.triggerFlood()} />
            <Disaster
              label="Volcanic Eruption"
              icon="🌋"
              remaining={hud.erupt}
              total={ERUPT_DURATION}
              onClick={() => world.triggerEruption()}
            />
            <button className={`btn small ${tool === 'vent' ? 'on' : ''}`} onClick={() => setTool(tool === 'vent' ? 'paint' : 'vent')}>
              {tool === 'vent' ? 'Click canvas to set vent…' : '◬ Designate volcano peak'}
            </button>
          </section>

          <section className="group">
            <h2>Cities</h2>
            <button className="btn wide" onClick={() => generateCity(world)}>
              ▦ Generate city block
            </button>
            <button
              className={`btn wide ${tool === 'building' ? 'on' : ''}`}
              onClick={() => setTool(tool === 'building' ? 'paint' : 'building')}
            >
              ▥ Stamp building {tool === 'building' && '(click canvas)'}
            </button>
            <p className="note">
              Generator pulses power along wires. Floods short-circuit the grid, quakes snap poles, and live wire ends spark.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Toggle({ label, icon, on, onChange }: { label: string; icon: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} aria-pressed={on}>
      <span className="ico">{icon}</span>
      {label}
      <span className="switch" />
    </button>
  );
}

function Disaster({
  label,
  icon,
  remaining,
  total,
  onClick,
}: {
  label: string;
  icon: string;
  remaining: number;
  total: number;
  onClick: () => void;
}) {
  const active = remaining > 0;
  return (
    <button className={`disaster ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="ico">{icon}</span>
      {label}
      {active && <span className="bar" style={{ width: `${(remaining / total) * 100}%` }} />}
    </button>
  );
}
