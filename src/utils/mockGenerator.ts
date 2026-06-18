/**
 * Helper to generate beautiful, themed mock design inspiration images
 * on a canvas element and export as an authentic compressed Base64 Data URL.
 */
export function generateMockImage(styleType: string): string {
  if (typeof document === "undefined") return "";
  
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  // 1. Draw solid background
  switch (styleType) {
    case "wabi-sabi":
      // Earthy sand, clay tones
      ctx.fillStyle = "#EAE3D2";
      ctx.fillRect(0, 0, 400, 400);
      
      // Abstract textured soil/clay background arches
      ctx.fillStyle = "#D6CDA4";
      ctx.beginPath();
      ctx.arc(200, 260, 110, 0, Math.PI, true);
      ctx.fill();

      // Organic clay vase silhouette
      ctx.fillStyle = "#7C9971";
      ctx.beginPath();
      ctx.ellipse(200, 240, 40, 60, 0, 0, 2 * Math.PI);
      ctx.fill();
      
      // Vase neck & top rim
      ctx.fillStyle = "#607E55";
      ctx.fillRect(180, 170, 40, 15);
      ctx.beginPath();
      ctx.ellipse(200, 170, 20, 6, 0, 0, 2 * Math.PI);
      ctx.fill();

      // Get botanical branch sticking out from the vase
      ctx.strokeStyle = "#3A4F39";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(200, 170);
      ctx.quadraticCurveTo(240, 110, 220, 60);
      ctx.stroke();

      // Branches & minimalist dry leaves
      ctx.fillStyle = "#3A4F39";
      ctx.beginPath();
      ctx.ellipse(220, 60, 8, 15, Math.PI / 4, 0, 2 * Math.PI);
      ctx.ellipse(235, 90, 6, 12, -Math.PI / 6, 0, 2 * Math.PI);
      ctx.ellipse(210, 125, 5, 10, Math.PI / 5, 0, 2 * Math.PI);
      ctx.fill();
      break;

    case "cyberpunk":
      // Deep cyber space background
      const cyberGrad = ctx.createLinearGradient(0, 0, 400, 400);
      cyberGrad.addColorStop(0, "#0B001A");
      cyberGrad.addColorStop(1, "#1E043B");
      ctx.fillStyle = cyberGrad;
      ctx.fillRect(0, 0, 400, 400);

      const horizonY = 220;

      // Glowing sunset
      const sunsetGrad = ctx.createRadialGradient(200, horizonY - 10, 5, 200, horizonY - 10, 110);
      sunsetGrad.addColorStop(0, "#FFFF00");
      sunsetGrad.addColorStop(0.35, "#FF007F");
      sunsetGrad.addColorStop(1, "transparent");
      ctx.fillStyle = sunsetGrad;
      ctx.beginPath();
      ctx.arc(200, horizonY, 100, 0, Math.PI, true);
      ctx.fill();

      // Laser perspective floor lines
      ctx.strokeStyle = "#FF007F";
      ctx.lineWidth = 2;
      for (let x = -100; x <= 500; x += 40) {
        ctx.beginPath();
        ctx.moveTo(200, horizonY);
        ctx.lineTo(x, 400);
        ctx.stroke();
      }
      for (let y = horizonY; y <= 400; y += 22) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(400, y);
        ctx.stroke();
      }

      // Retro horizontal scanline cuts
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (let y = 0; y < 400; y += 5) {
        ctx.fillRect(0, y, 400, 2);
      }
      break;

    case "bauhaus":
      // Retro light beige cream base
      ctx.fillStyle = "#FAF5E9";
      ctx.fillRect(0, 0, 400, 400);

      // Huge geometric primary shapes intersecting
      // 1. Blue square
      ctx.fillStyle = "#1E40AF";
      ctx.fillRect(60, 120, 170, 170);

      // 2. Bright Bauhaus Red Circle
      ctx.fillStyle = "#DC2626";
      ctx.beginPath();
      ctx.arc(260, 230, 90, 0, 2 * Math.PI);
      ctx.fill();

      // 3. Bright Bauhaus Yellow Triangle
      ctx.fillStyle = "#FBBF24";
      ctx.beginPath();
      ctx.moveTo(200, 45);
      ctx.lineTo(110, 200);
      ctx.lineTo(290, 200);
      ctx.closePath();
      ctx.fill();

      // Black thick grid lines
      ctx.strokeStyle = "#171717";
      ctx.lineWidth = 11;
      ctx.beginPath();
      ctx.moveTo(35, 280);
      ctx.lineTo(365, 280);
      ctx.stroke();

      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(110, 35);
      ctx.lineTo(110, 365);
      ctx.stroke();
      break;

    case "morandi":
      // Sophisticated relaxed Morandi tones
      ctx.fillStyle = "#E4DCCF";
      ctx.fillRect(0, 0, 400, 400);

      // Background decorative clay circles
      ctx.fillStyle = "#BAC7A7";
      ctx.beginPath();
      ctx.arc(140, 200, 85, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = "#D3B59B";
      ctx.fillRect(190, 140, 130, 180);

      // Teapot/pitcher minimalist outline
      ctx.fillStyle = "#7D9D9C";
      ctx.beginPath();
      ctx.ellipse(220, 230, 35, 45, Math.PI / 12, 0, 2 * Math.PI);
      ctx.fill();

      ctx.strokeStyle = "#576F6EAD";
      ctx.lineWidth = 3.5;
      // Steaming curves
      ctx.beginPath();
      ctx.moveTo(210, 175);
      ctx.quadraticCurveTo(205, 160, 215, 150);
      ctx.moveTo(225, 175);
      ctx.quadraticCurveTo(220, 160, 230, 150);
      ctx.stroke();
      break;

    case "memphis":
      // Vibrant yellow-green & pink candy base
      ctx.fillStyle = "#D1FAE5";
      ctx.fillRect(0, 0, 400, 400);

      // Polkadot speckle arrays
      ctx.fillStyle = "#10B9812A";
      for (let i = 0; i < 9; i++) {
        for (let j = 0; j < 9; j++) {
          ctx.beginPath();
          ctx.arc(i * 45 + 20, j * 45 + 20, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      // Wavy squiggle line
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(50, 100);
      ctx.bezierCurveTo(110, 140, 130, 40, 190, 100);
      ctx.bezierCurveTo(250, 160, 270, 60, 350, 120);
      ctx.stroke();

      // Bold pastel purple giant triangle
      ctx.fillStyle = "#C084FC";
      ctx.beginPath();
      ctx.moveTo(70, 290);
      ctx.lineTo(190, 150);
      ctx.lineTo(250, 320);
      ctx.closePath();
      ctx.fill();

      // Giant neon blue circle
      ctx.fillStyle = "#3B82F6";
      ctx.beginPath();
      ctx.arc(280, 270, 50, 0, 2 * Math.PI);
      ctx.fill();

      // Black outlined frame
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 6;
      ctx.strokeRect(120, 170, 70, 70);
      break;

    case "mid-century":
    default:
      // Dark woodgrain charcoal retro cozy cabin vibes
      ctx.fillStyle = "#331616";
      ctx.fillRect(0, 0, 400, 400);

      // Hot sunset orange multi concentric gradient sun disk
      ctx.fillStyle = "#E07A5F";
      ctx.beginPath();
      ctx.arc(200, 190, 110, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = "#F4F1DE";
      ctx.beginPath();
      ctx.arc(200, 190, 85, 0, 2 * Math.PI);
      ctx.fill();

      ctx.fillStyle = "#3D405B";
      ctx.beginPath();
      ctx.arc(200, 190, 60, 0, 2 * Math.PI);
      ctx.fill();

      // Eames-chair inspired organic silhouette overlay
      ctx.fillStyle = "#F4F1DE";
      ctx.beginPath();
      ctx.ellipse(200, 200, 24, 28, Math.PI / 2, 0, 2 * Math.PI);
      ctx.fill();
      
      // Chair legs
      ctx.strokeStyle = "#F4F1DE";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(185, 215);
      ctx.lineTo(165, 255);
      ctx.moveTo(215, 215);
      ctx.lineTo(235, 255);
      ctx.stroke();
      break;
  }

  // Draw draft margin lines layout
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(12, 12, 376, 376);
  ctx.strokeRect(24, 24, 352, 352);

  // Technical design grid markers
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(198, 6, 4, 4);
  ctx.fillRect(198, 390, 4, 4);
  ctx.fillRect(6, 198, 4, 4);
  ctx.fillRect(390, 198, 4, 4);

  return canvas.toDataURL("image/jpeg", 0.82);
}
