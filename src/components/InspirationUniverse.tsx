import React, { useEffect, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Navigation } from 'lucide-react';
import { ImageCard } from '../types';

interface InspirationUniverseProps {
  isOpen: boolean;
  onClose: () => void;
  cards: ImageCard[];
}

type ParticleType = 'user' | 'tag' | 'dust' | 'image';

interface Particle {
  id: string;
  type: ParticleType;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  label: string;
  images: string[];
  color: string;
  baseAlpha: number;
  glowSize: number;
  links: string[];
}

const MOCK_TAGS = ['复古胶片', '极简主义', '光影捕手', '霓虹', '建筑', '自然', '日落', '黑白', '街头', '质感'];

export default function InspirationUniverse({ isOpen, onClose, cards }: InspirationUniverseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const cameraRef = useRef({ rx: 0.1, ry: 0, z: 1200 });
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });
  const projectedNodesRef = useRef<{id: string, sx: number, sy: number, radius: number}[]>([]);
  
  const [hoveredParticle, setHoveredParticle] = useState<Particle | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const particleData = useMemo(() => {
    const items: Particle[] = [];
    const termMap = new Map<string, string[]>();
    const SPREAD = 2000;
    
    // Process real cards
    const imageMap = new Map<string, string>();
    cards.forEach(card => {
      if (!imageMap.has(card.imageUrl)) {
          imageMap.set(card.imageUrl, card.imageUrl);
      }
      card.terms.forEach(term => {
        if (!termMap.has(term)) termMap.set(term, []);
        termMap.get(term)!.push(card.imageUrl);
      });
    });

    // Create Image particles
    imageMap.forEach((url) => {
        items.push({
            id: `img-${url}`,
            type: 'image',
            label: '', // No name for images
            images: [url],
            x: (Math.random() - 0.5) * SPREAD,
            y: (Math.random() - 0.5) * SPREAD,
            z: (Math.random() - 0.5) * SPREAD,
            vx: (Math.random() - 0.5) * 1.0,
            vy: (Math.random() - 0.5) * 1.0,
            vz: (Math.random() - 0.5) * 1.0,
            radius: Math.random() * 2 + 2, // Even smaller
            color: '14, 165, 233', // Softer sky blue/cyan
            baseAlpha: 0.6,
            glowSize: 10,
            links: [],
        });
    });

    const extraTagsCount = Math.max(0, 20 - termMap.size);
    for(let i=0; i<extraTagsCount; i++) {
        const randomTerm = MOCK_TAGS[Math.floor(Math.random() * MOCK_TAGS.length)];
        if (!termMap.has(randomTerm)) {
            termMap.set(randomTerm, []);
        }
    }

    const tagIds: string[] = [];

    termMap.forEach((images, term) => {
      const uniqueImages = Array.from(new Set(images));
      const id = `tag-${term}`;
      tagIds.push(id);
      
      const weight = uniqueImages.length;
      items.push({
        id,
        type: 'tag',
        label: term,
        images: uniqueImages,
        x: (Math.random() - 0.5) * SPREAD,
        y: (Math.random() - 0.5) * SPREAD,
        z: (Math.random() - 0.5) * SPREAD,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        vz: (Math.random() - 0.5) * 1.5,
        radius: Math.min(Math.max(weight * 3, 6), 20),
        color: '244, 114, 182', // Softer pink
        baseAlpha: weight > 0 ? 0.6 : 0.3,
        glowSize: weight > 0 ? 15 : 5,
        links: uniqueImages.map(url => `img-${url}`),
      });
    });

    const activeTags = tagIds.filter(id => {
        const t = items.find(i => i.id === id);
        return t && t.images.length > 0;
    });

    items.push({
      id: 'user-me',
      type: 'user',
      label: '你',
      images: [],
      x: (Math.random() - 0.5) * SPREAD * 0.5,
      y: (Math.random() - 0.5) * SPREAD * 0.5,
      z: (Math.random() - 0.5) * SPREAD * 0.5,
      vx: (Math.random() - 0.5) * 1,
      vy: (Math.random() - 0.5) * 1,
      vz: (Math.random() - 0.5) * 1,
      radius: 10,
      color: '251, 191, 36', // Muted Gold
      baseAlpha: 0.8,
      glowSize: 20,
      links: activeTags,
    });

    const mockUserNames = ['Traveler_09', 'Lumina', 'Echoes', 'Nova', 'Cielo', 'Orion', 'Lyra', 'Aether'];
    mockUserNames.forEach((name, idx) => {
        const shuffledTags = [...tagIds].sort(() => 0.5 - Math.random());
        const myLinks = shuffledTags.slice(0, Math.floor(Math.random() * 5) + 2);

        items.push({
            id: `user-${idx}`,
            type: 'user',
            label: name,
            images: [],
            x: (Math.random() - 0.5) * SPREAD,
            y: (Math.random() - 0.5) * SPREAD,
            z: (Math.random() - 0.5) * SPREAD,
            vx: (Math.random() - 0.5) * 1.2,
            vy: (Math.random() - 0.5) * 1.2,
            vz: (Math.random() - 0.5) * 1.2,
            radius: Math.random() * 3 + 4,
            color: '167, 139, 250', // Softer Purple
            baseAlpha: 0.5,
            glowSize: 10,
            links: myLinks,
        });
    });

    for(let i=0; i<300; i++) { // More dust for starry effect
        items.push({
            id: `dust-${i}`,
            type: 'dust',
            label: "",
            images: [],
            x: (Math.random() - 0.5) * SPREAD,
            y: (Math.random() - 0.5) * SPREAD,
            z: (Math.random() - 0.5) * SPREAD,
            vx: (Math.random() - 0.5) * 0.1,
            vy: (Math.random() - 0.5) * 0.1,
            vz: (Math.random() - 0.5) * 0.1,
            radius: Math.random() * 1.5 + 0.1,
            color: '255, 255, 255',
            baseAlpha: Math.random() * 0.3 + 0.05,
            glowSize: Math.random() * 2,
            links: [],
        });
    }

    return items;
  }, [cards]);

  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };
    window.addEventListener('resize', handleResize);
    setTimeout(handleResize, 50);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;

    const handleWheel = (e: WheelEvent) => {
        e.preventDefault();
        cameraRef.current.z += e.deltaY * 1.5;
        if (cameraRef.current.z < 250) cameraRef.current.z = 250;
        if (cameraRef.current.z > 4000) cameraRef.current.z = 4000;
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    const render = () => {
      time += 0.01;
      const camera = cameraRef.current;
      
      if (!isDraggingRef.current) {
          camera.ry -= 0.0005;
      }

      ctx.fillStyle = 'rgba(7, 7, 7, 0.4)'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const fl = 800; 
      const SPREAD = 2000;
      const LIMIT = SPREAD / 2 + 500;

      const projected = particleData.map(p => {
          p.vx *= 0.99; p.vy *= 0.99; p.vz *= 0.99;
          
          if (p.type === 'dust') {
              p.x += Math.sin(time + p.id.length) * 0.2;
              p.y += Math.cos(time + p.id.length) * 0.2;
              p.z += Math.sin(time * 0.5 + p.id.length) * 0.2;
          }

          p.x += p.vx;
          p.y += p.vy;
          p.z += p.vz;

          if (p.x < -LIMIT) p.x += LIMIT * 2;
          if (p.x > LIMIT) p.x -= LIMIT * 2;
          if (p.y < -LIMIT) p.y += LIMIT * 2;
          if (p.y > LIMIT) p.y -= LIMIT * 2;
          if (p.z < -LIMIT) p.z += LIMIT * 2;
          if (p.z > LIMIT) p.z -= LIMIT * 2;

          const cosX = Math.cos(camera.rx);
          const sinX = Math.sin(camera.rx);
          let y1 = p.y * cosX - p.z * sinX;
          let z1 = p.z * cosX + p.y * sinX;

          const cosY = Math.cos(camera.ry);
          const sinY = Math.sin(camera.ry);
          let x2 = p.x * cosY + z1 * sinY;
          let z2 = z1 * cosY - p.x * sinY;

          const z3 = z2 + camera.z;
          const scale = z3 > 0 ? fl / z3 : 0;
          const sx = cx + x2 * scale;
          const sy = cy + y1 * scale;

          return { p, sx, sy, z3, scale };
      });

      const visible = projected.filter(item => item.z3 > 10);
      visible.sort((a, b) => b.z3 - a.z3); 

      projectedNodesRef.current = visible.map(v => ({
          id: v.p.id,
          sx: v.sx,
          sy: v.sy,
          radius: v.p.radius * v.scale
      }));

      const posMap = new Map<string, typeof visible[0]>();
      visible.forEach(v => posMap.set(v.p.id, v));

      ctx.lineWidth = 0.5;
      visible.forEach(v => {
          const p = v.p;
          if (p.links.length > 0) {
              p.links.forEach(linkId => {
                  const target = posMap.get(linkId);
                  if (target) {
                      const targetP = target.p;
                      const dist3D = Math.hypot(p.x - targetP.x, p.y - targetP.y, p.z - targetP.z);
                      if (dist3D > 200) {
                          const dx = targetP.x - p.x;
                          const dy = targetP.y - p.y;
                          const dz = targetP.z - p.z;
                          const force = 0.000005;
                          p.vx += dx * force;
                          p.vy += dy * force;
                          p.vz += dz * force;
                          targetP.vx -= dx * force;
                          targetP.vy -= dy * force;
                          targetP.vz -= dz * force;
                      }

                      const distScreen = Math.hypot(v.sx - target.sx, v.sy - target.sy);
                      if (distScreen < Math.max(800 * v.scale, 200)) { 
                          ctx.beginPath();
                          ctx.moveTo(v.sx, v.sy);
                          ctx.lineTo(target.sx, target.sy);
                          
                          const depthAlpha = Math.min(1, 1500 / v.z3);
                          const distAlpha = Math.max(0, 1 - distScreen / (800 * v.scale));
                          const alpha = 0.25 * distAlpha * depthAlpha * (Math.sin(time * 2 + p.x) * 0.2 + 0.8);
                          
                          const grad = ctx.createLinearGradient(v.sx, v.sy, target.sx, target.sy);
                          grad.addColorStop(0, `rgba(${p.color}, ${alpha})`);
                          grad.addColorStop(1, `rgba(${targetP.color}, ${alpha * 0.3})`);
                          ctx.strokeStyle = grad;
                          ctx.stroke();
                      }
                  }
              });
          }
      });

      visible.forEach(v => {
          const {p, sx, sy, scale, z3} = v;
          const r = Math.max(0.2, p.radius * scale);
          
          ctx.beginPath();
          const pulse = p.type !== 'dust' ? Math.sin(time * 3 + p.x) * (0.5 * scale) : 0;
          ctx.arc(sx, sy, Math.max(0.1, r + pulse), 0, Math.PI * 2);
          
          let depthAlpha = p.baseAlpha * Math.min(1, 1500 / z3);
          if (z3 > 3000) {
              depthAlpha *= Math.max(0, 1 - (z3 - 3000) / 1000); 
          }

          const isHovered = hoveredParticle?.id === p.id;
          if (isHovered && p.type !== 'dust') {
              ctx.fillStyle = `rgba(255, 255, 255, 1)`;
              ctx.shadowBlur = p.glowSize * 2 * scale;
              ctx.shadowColor = `rgba(${p.color}, 0.8)`;
          } else if (p.glowSize > 0) {
              ctx.shadowBlur = p.glowSize * scale * 0.5;
              ctx.shadowColor = `rgba(${p.color}, ${depthAlpha})`;
              const coreColor = p.type === 'tag' ? `rgba(255, 230, 255, ${depthAlpha})` 
                              : p.type === 'image' ? `rgba(220, 245, 255, ${depthAlpha})`
                              : p.type === 'user' ? `rgba(255, 250, 230, ${depthAlpha})`
                              : `rgba(${p.color}, ${depthAlpha})`;
              ctx.fillStyle = coreColor;
          } else {
              ctx.shadowBlur = 0;
              ctx.fillStyle = `rgba(${p.color}, ${depthAlpha})`;
          }
          
          ctx.fill();
          ctx.shadowBlur = 0;

          if (p.type !== 'dust' && p.type !== 'image') {
              const labelScale = scale * 1.5;
              if (labelScale > 0.4 || isHovered) {
                  const fontSize = Math.max(9, isHovered ? 14 : 10 * labelScale);
                  const labelOpacity = isHovered ? 1 : Math.min(0.7, (labelScale - 0.4) * 2) * depthAlpha;
                  ctx.font = `${isHovered ? 'bold' : 'normal'} ${fontSize}px "JetBrains Mono", sans-serif`;
                  ctx.fillStyle = `rgba(255, 255, 255, ${labelOpacity})`;
                  ctx.textAlign = 'center';
                  ctx.fillText(p.label, sx, sy - r - (8 * scale));
              }
          }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
        cancelAnimationFrame(animationFrameId);
        canvas.removeEventListener('wheel', handleWheel);
    };
  }, [isOpen, particleData, hoveredParticle]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDraggingRef.current = true;
      setIsDragging(true);
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
      isDraggingRef.current = false;
      setIsDragging(false);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDraggingRef.current) {
        const dx = e.clientX - lastMouseRef.current.x;
        const dy = e.clientY - lastMouseRef.current.y;
        cameraRef.current.ry += dx * 0.005; 
        cameraRef.current.rx -= dy * 0.005; 
        lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }

    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    setMousePos({ x: e.clientX, y: e.clientY });

    let found: Particle | null = null;
    const nodes = projectedNodesRef.current;
    
    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        const p = particleData.find(item => item.id === node.id);
        if (!p || p.type === 'dust') continue;

        const hitRadius = Math.max(node.radius, 12); 
        const dist = Math.hypot(node.sx - sx, node.sy - sy);
        if (dist < hitRadius + 5) {
            found = p;
            break;
        }
    }
    
    setHoveredParticle(found);
  };

  const handleMouseOut = () => {
    setHoveredParticle(null);
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#070707] overflow-hidden"
          ref={containerRef}
        >
          <button
            onClick={onClose}
            className="absolute top-6 right-6 z-50 p-2.5 rounded-full bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer backdrop-blur-md border border-white/10"
          >
            <X size={20} />
          </button>
          
          <div className="absolute top-8 left-8 z-40 pointer-events-none select-none">
            <h2 className="text-2xl font-serif text-amber-200 italic font-semibold tracking-wide flex items-center gap-2">
              <Sparkles size={20} className="text-amber-400" />
              灵感宇宙
            </h2>
            <p className="text-stone-400 text-xs font-mono mt-2 opacity-80 decoration-stone-500">
              探寻光影、不同维度的连接与共鸣<br/>
              <span className="text-amber-400 text-[10px]">&bull; 金色流星代表「你」</span>
              <span className="text-purple-400 text-[10px] ml-3">&bull; 紫色流星代表「访客」</span><br/>
              <span className="text-pink-400 text-[10px]">&bull; 柔粉星团代表「记忆标签」</span>
              <span className="text-sky-400 text-[10px] ml-3">&bull; 天蓝光点代表「照片」</span><br/>
              <span className="text-stone-500 text-[10px] mt-1 inline-flex items-center gap-1">
                <Navigation size={10} className="rotate-45" />
                滚动缩放，拖拽游览星空
              </span>
            </p>
          </div>

          <canvas
            ref={canvasRef}
            className={`block w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseOut}
          />

          {hoveredParticle && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              key={hoveredParticle.id}
              className="absolute pointer-events-none bg-stone-900/90 backdrop-blur-md border border-amber-900/40 rounded-xl p-3 shadow-2xl z-50 transform -translate-x-1/2 mt-6"
              style={{
                left: mousePos.x,
                top: mousePos.y,
                clipPath: 'inset(-20px -20px -20px -20px)',
              }}
            >
              <div className="text-white font-bold text-sm mb-2 text-center border-b border-white/10 pb-1.5 flex items-center justify-center gap-2">
                {hoveredParticle.type === 'tag' ? (
                  <>
                    <span className="text-amber-400"># {hoveredParticle.label}</span>
                    <span className="text-stone-400 text-[10px] font-normal tracking-wide">({hoveredParticle.images.length} 瞬光影)</span>
                  </>
                ) : hoveredParticle.type === 'image' ? (
                    <span className="text-sky-400 shrink-0 break-all w-full leading-tight text-[11px] font-mono select-none" style={{ wordBreak: 'break-all' }}>
                        &#128247; 记忆碎片
                    </span>
                ) : (
                  <>
                    <span className="text-sky-300">@ {hoveredParticle.label}</span>
                    <span className="text-stone-400 text-[10px] font-normal tracking-wide">({hoveredParticle.links.length} 个共鸣)</span>
                  </>
                )}
              </div>
              
              {(hoveredParticle.type === 'tag' || hoveredParticle.type === 'image') && hoveredParticle.images.length > 0 && (
                <div className="flex gap-2 flex-wrap max-w-[210px] justify-center mt-1">
                  {hoveredParticle.images.slice(0, 4).map((img, idx) => (
                    <div key={idx} className={hoveredParticle.type === 'image' ? "w-28 h-28 rounded-lg overflow-hidden border border-stone-700 bg-stone-800 shadow-inner" : "w-12 h-12 rounded-lg overflow-hidden border border-stone-700 bg-stone-800 shadow-inner"}>
                      <img src={img} className="w-full h-full object-cover opacity-90" alt="" />
                    </div>
                  ))}
                  {hoveredParticle.type === 'tag' && hoveredParticle.images.length > 4 && (
                    <div className="w-12 h-12 rounded-lg border border-stone-700 bg-stone-800/60 flex items-center justify-center text-xs text-stone-500 font-mono shadow-inner">
                      +{hoveredParticle.images.length - 4}
                    </div>
                  )}
                </div>
              )}
              
              {hoveredParticle.type === 'tag' && hoveredParticle.images.length === 0 && (
                 <div className="text-xs text-stone-500 py-1 font-mono text-center">
                   暂无影像坐标...
                 </div>
              )}

              {hoveredParticle.type === 'user' && (
                 <div className="flex gap-1.5 flex-wrap max-w-[200px] justify-center mt-1">
                    {hoveredParticle.links.slice(0, 5).map((l, i) => {
                        const t = l.replace('tag-', '');
                        return (
                            <span key={i} className="text-[10px] font-mono text-amber-200/80 bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-500/20">
                                {t}
                            </span>
                        );
                    })}
                    {hoveredParticle.links.length > 5 && (
                        <span className="text-[10px] font-mono text-stone-500 px-1 py-0.5">...</span>
                    )}
                 </div>
              )}
            </motion.div>
          )}

        </motion.div>
      )}
    </AnimatePresence>
  );
}
