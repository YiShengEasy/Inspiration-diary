import React, { useEffect, useRef, useMemo } from 'react';

type EffectType = 'rain' | 'leaves' | 'stars' | 'snow';

export default function WeatherBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const effect = useMemo<EffectType>(() => {
    // Determine random effect for this mount
    const types: EffectType[] = ['rain', 'leaves', 'stars', 'snow'];
    return types[Math.floor(Math.random() * types.length)];
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    let animationFrameId: number;
    let particles: any[] = [];
    
    const initParticles = (w: number, h: number) => {
      particles = [];
      if (effect === 'rain') {
        for (let i = 0; i < 40; i++) {
          particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            length: 10 + Math.random() * 20,
            speed: 4 + Math.random() * 5,
            opacity: 0.1 + Math.random() * 0.2
          });
        }
      } else if (effect === 'leaves') {
        for (let i = 0; i < 15; i++) {
          particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: 4 + Math.random() * 5,
            speedY: 0.5 + Math.random() * 0.8,
            speedX: -0.2 + Math.random() * 0.5,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.02,
            opacity: 0.3 + Math.random() * 0.4
          });
        }
      } else if (effect === 'snow') {
        for (let i = 0; i < 50; i++) {
          particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            size: 1 + Math.random() * 2.5,
            speedY: 0.2 + Math.random() * 0.8,
            speedX: -0.2 + Math.random() * 0.5,
            opacity: 0.3 + Math.random() * 0.5
          });
        }
      } else if (effect === 'stars') {
        for (let i = 0; i < 3; i++) {
          particles.push({
            x: Math.random() * w,
            y: Math.random() * h,
            length: 60 + Math.random() * 80,
            speed: 6 + Math.random() * 4,
            delay: Math.random() * 200,
            active: Math.random() > 0.5
          });
        }
      }
    };
    
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      initParticles(rect.width, rect.height);
    };

    window.addEventListener('resize', resize);
    resize();

    const render = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      
      // Use logical coordinates due to context scale
      const w = canvas.width / (Math.min(window.devicePixelRatio || 1, 2));
      const h = canvas.height / (Math.min(window.devicePixelRatio || 1, 2));
      
      ctx.clearRect(0, 0, w, h);
      
      const isDark = document.documentElement.classList.contains('dark');
      
      if (effect === 'rain') {
        ctx.lineCap = 'round';
        particles.forEach(p => {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.speed * 0.1, p.y + p.length);
          ctx.lineWidth = 1;
          ctx.strokeStyle = (isDark ? 'rgba(150, 180, 220, ' : 'rgba(80, 120, 180, ') + p.opacity + ')';
          ctx.stroke();
          
          p.y += p.speed;
          p.x -= p.speed * 0.1; 
          
          if (p.y > h) {
            p.y = -p.length;
            p.x = Math.random() * w + 50;
          }
        });
      } else if (effect === 'snow') {
        particles.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = (isDark ? 'rgba(255, 255, 255, ' : 'rgba(150, 160, 180, ') + p.opacity + ')';
          ctx.fill();
          
          p.y += p.speedY;
          p.x += Math.sin(p.y * 0.01) * 0.5 + p.speedX;
          
          if (p.y > h + 10) {
            p.y = -10;
            p.x = Math.random() * w;
          }
        });
      } else if (effect === 'leaves') {
        particles.forEach(p => {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          
          ctx.fillStyle = isDark ? `rgba(200, 80, 40, ${p.opacity})` : `rgba(220, 100, 50, ${p.opacity})`;
          
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.bezierCurveTo(p.size, -p.size, p.size, p.size, 0, p.size);
          ctx.bezierCurveTo(-p.size, p.size, -p.size, -p.size, 0, -p.size);
          ctx.fill();
          ctx.restore();
          
          p.y += p.speedY;
          p.x += p.speedX + Math.sin(p.y * 0.02) * 1;
          p.angle += p.spin;
          
          if (p.y > h + p.size) {
            p.y = -p.size;
            p.x = Math.random() * w;
          }
        });
      } else if (effect === 'stars') {
        particles.forEach(p => {
          if (!p.active) {
            if (p.delay > 0) {
              p.delay--;
            } else {
              p.active = true;
              p.x = Math.random() * w * 1.5;
              p.y = -Math.random() * (h / 2);
            }
          } else {
            const grad = ctx.createLinearGradient(p.x, p.y, p.x + p.length, p.y - p.length);
            grad.addColorStop(0, isDark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(100, 150, 255, 0.6)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.length, p.y - p.length);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            p.x -= p.speed;
            p.y += p.speed;
            
            if (p.x < -p.length || p.y > h + p.length) {
              p.active = false;
              p.delay = Math.random() * 400 + 100;
            }
          }
        });
      }
      
      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [effect]);

  return (
    <canvas 
      ref={canvasRef} 
      className="absolute inset-0 pointer-events-none rounded-2xl z-0"
      style={{ opacity: 0.6 }}
    />
  );
}
