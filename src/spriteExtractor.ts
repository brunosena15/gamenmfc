export interface KickerRig {
  width: number;
  height: number;
  upperBody: HTMLCanvasElement;
  leftLeg: HTMLCanvasElement;
  rightLeg: HTMLCanvasElement;
  /** Coordenada Y (no espaço do sprite back) onde as pernas articulam no quadril */
  hipY: number;
  /** Coordenada Y onde começa o recorte vertical das pernas */
  legTopY: number;
  /** Coordenada X do pivô da perna esquerda no espaço do sprite back */
  leftHipX: number;
  /** Coordenada X do pivô da perna direita no espaço do sprite back */
  rightHipX: number;
  /** Divisão horizontal central entre perna esquerda e direita */
  midX: number;
}

export interface GoalkeeperRig {
  width: number;
  height: number;
  body: HTMLCanvasElement;
  centerX: number;
  leftShoulderX: number;
  rightShoulderX: number;
  shoulderY: number;
}

export interface CharacterSprites {
  front: HTMLCanvasElement;
  back: HTMLCanvasElement;
  avatar: HTMLCanvasElement;
  kickerRig: KickerRig;
  goalkeeperRig?: GoalkeeperRig;
}

const spriteCache = new Map<string, Promise<CharacterSprites>>();

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = src;
  });
}

function colorDistSq(
  r1: number,
  g1: number,
  b1: number,
  r2: number,
  g2: number,
  b2: number
): number {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}

interface ComponentBox {
  id: number;
  count: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sumX: number;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function extractAvatar(front: HTMLCanvasElement): HTMLCanvasElement {
  const size = 96;
  const avatar = createCanvas(size, size);
  const ctx = avatar.getContext('2d');
  if (!ctx) return avatar;

  // Enquadra cabeça e parte superior do tronco
  const cropW = front.width;
  const cropH = Math.min(front.height, front.width * 0.92);
  const scale = Math.max(size / cropW, size / cropH) * 1.1;
  const drawW = front.width * scale;
  const drawH = front.height * scale;
  const dx = (size - drawW) * 0.5;
  const dy = size * 0.04;

  ctx.drawImage(front, dx, dy, drawW, drawH);
  return avatar;
}

function buildKickerRig(back: HTMLCanvasElement): KickerRig {
  const w = back.width;
  const h = back.height;
  const midX = Math.round(w * 0.5);

  const bCtx = back.getContext('2d', { willReadFrequently: true });
  let crotchY = Math.round(h * 0.69);

  if (bCtx) {
    const imgData = bCtx.getImageData(0, 0, w, h).data;
    const xStart = Math.max(0, Math.floor(w * 0.48));
    const xEnd = Math.min(w - 1, Math.ceil(w * 0.52));
    const bandWidth = Math.max(1, xEnd - xStart + 1);

    // Sobe da base entre as pernas até encontrar o fundo do calção
    for (let y = Math.floor(h * 0.9); y >= Math.floor(h * 0.54); y--) {
      let opaque = 0;
      for (let x = xStart; x <= xEnd; x++) {
        if (imgData[(y * w + x) * 4 + 3] > 120) opaque++;
      }
      if (opaque >= bandWidth * 0.55) {
        crotchY = y;
        break;
      }
    }
  }

  const upperCutY = Math.min(h, crotchY + Math.round(h * 0.032));
  const legTopY = Math.max(0, crotchY - Math.round(h * 0.025));
  const legH = Math.max(1, h - legTopY);

  // Calcula faixa X real de cada perna abaixo da barra do calção (evita capturar pontas de dedos/luvas)
  let leftMinX = Math.round(w * 0.14);
  let leftMaxX = midX;
  let rightMinX = midX;
  let rightMaxX = Math.round(w * 0.86);
  let leftHipX = Math.round(w * 0.35);
  let rightHipX = Math.round(w * 0.65);

  if (bCtx) {
    const imgData = bCtx.getImageData(0, 0, w, h).data;
    let lMin = w;
    let lMax = 0;
    let rMin = w;
    let rMax = 0;
    let lSum = 0;
    let lCnt = 0;
    let rSum = 0;
    let rCnt = 0;

    const thighStart = Math.min(h - 1, upperCutY + 2);
    const thighEnd = Math.min(h - 1, upperCutY + Math.round(h * 0.12));

    for (let y = thighStart; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (imgData[(y * w + x) * 4 + 3] <= 120) continue;
        if (x < midX) {
          if (x < lMin) lMin = x;
          if (x > lMax) lMax = x;
          if (y <= thighEnd) {
            lSum += x;
            lCnt++;
          }
        } else {
          if (x < rMin) rMin = x;
          if (x > rMax) rMax = x;
          if (y <= thighEnd) {
            rSum += x;
            rCnt++;
          }
        }
      }
    }

    if (lMin <= lMax) {
      leftMinX = Math.max(0, lMin - 6);
      leftMaxX = Math.min(midX, lMax + 4);
    }
    if (rMin <= rMax) {
      rightMinX = Math.max(midX, rMin - 4);
      rightMaxX = Math.min(w, rMax + 6);
    }
    if (lCnt > 0) leftHipX = Math.round(lSum / lCnt);
    if (rCnt > 0) rightHipX = Math.round(rSum / rCnt);
  }

  // Corpo superior (cabeça + tronco + braços + calção)
  const upperBody = createCanvas(w, upperCutY);
  const uCtx = upperBody.getContext('2d');
  if (uCtx) {
    uCtx.drawImage(back, 0, 0, w, upperCutY, 0, 0, w, upperCutY);
  }

  // Perna esquerda (desenhada atrás do calção, com recorte limpo apenas na largura da perna)
  const leftLeg = createCanvas(midX, legH);
  const lCtx = leftLeg.getContext('2d');
  if (lCtx) {
    const lx = leftMinX;
    const lw = Math.max(1, leftMaxX - leftMinX);
    lCtx.drawImage(back, lx, legTopY, lw, legH, lx, 0, lw, legH);
  }

  // Perna direita
  const rightLegW = Math.max(1, w - midX);
  const rightLeg = createCanvas(rightLegW, legH);
  const rCtx = rightLeg.getContext('2d');
  if (rCtx) {
    const rx = rightMinX;
    const rw = Math.max(1, rightMaxX - rightMinX);
    rCtx.drawImage(back, rx, legTopY, rw, legH, rx - midX, 0, rw, legH);
  }

  return {
    width: w,
    height: h,
    upperBody,
    leftLeg,
    rightLeg,
    hipY: crotchY,
    legTopY,
    leftHipX,
    rightHipX,
    midX,
  };
}

function processCharacterSheet(img: HTMLImageElement): CharacterSprites {
  // Normaliza altura para processamento ultrarrápido em mobile
  const maxDim = 560;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const work = createCanvas(w, h);
  const wCtx = work.getContext('2d', { willReadFrequently: true });
  if (!wCtx) {
    const fallback = createCanvas(w, h);
    fallback.getContext('2d')?.drawImage(img, 0, 0, w, h);
    return {
      front: fallback,
      back: fallback,
      avatar: extractAvatar(fallback),
      kickerRig: buildKickerRig(fallback),
    };
  }

  wCtx.drawImage(img, 0, 0, w, h);
  const imageData = wCtx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const total = w * h;

  // 1. Amostra cor de fundo nos 4 cantos
  const sampleCoords: Array<[number, number]> = [
    [2, 2],
    [w - 3, 2],
    [2, h - 3],
    [w - 3, h - 3],
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const [sx, sy] of sampleCoords) {
    const idx = (sy * w + sx) * 4;
    bgR += data[idx];
    bgG += data[idx + 1];
    bgB += data[idx + 2];
  }
  bgR /= sampleCoords.length;
  bgG /= sampleCoords.length;
  bgB /= sampleCoords.length;

  // 2. Flood-fill a partir de todas as bordas para remover o fundo externo
  const isBg = new Uint8Array(total);
  const queue = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  const borderTolSq = 40 * 40;

  const trySeed = (x: number, y: number) => {
    const p = y * w + x;
    if (isBg[p]) return;
    const i = p * 4;
    if (colorDistSq(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB) <= borderTolSq) {
      isBg[p] = 1;
      queue[qTail++] = p;
    }
  };

  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  while (qHead < qTail) {
    const p = queue[qHead++];
    const x = p % w;
    const y = (p - x) / w;

    if (x > 0) trySeed(x - 1, y);
    if (x + 1 < w) trySeed(x + 1, y);
    if (y > 0) trySeed(x, y - 1);
    if (y + 1 < h) trySeed(x, y + 1);
  }

  // 3. Remove "buracos" internos fechados que têm a cor exata do fundo (ex: braço na cintura)
  const holeVisited = new Uint8Array(total);
  const holeTolSq = 24 * 24;
  const holeMeanTolSq = 16 * 16;

  for (let p = 0; p < total; p++) {
    if (isBg[p] || holeVisited[p]) continue;
    const idx = p * 4;
    if (colorDistSq(data[idx], data[idx + 1], data[idx + 2], bgR, bgG, bgB) > holeTolSq) {
      continue;
    }

    // BFS do possível buraco interno
    let hHead = 0;
    let hTail = 0;
    queue[hTail++] = p;
    holeVisited[p] = 1;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;

    while (hHead < hTail) {
      const cur = queue[hHead++];
      const ci = cur * 4;
      sumR += data[ci];
      sumG += data[ci + 1];
      sumB += data[ci + 2];

      const cx = cur % w;
      const cy = (cur - cx) / w;
      const neighbors = [
        cx > 0 ? cur - 1 : -1,
        cx + 1 < w ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy + 1 < h ? cur + w : -1,
      ];
      for (const np of neighbors) {
        if (np < 0 || isBg[np] || holeVisited[np]) continue;
        const ni = np * 4;
        if (colorDistSq(data[ni], data[ni + 1], data[ni + 2], bgR, bgG, bgB) <= holeTolSq) {
          holeVisited[np] = 1;
          queue[hTail++] = np;
        }
      }
    }

    if (hTail >= 45) {
      const mr = sumR / hTail;
      const mg = sumG / hTail;
      const mb = sumB / hTail;
      if (colorDistSq(mr, mg, mb, bgR, bgG, bgB) <= holeMeanTolSq) {
        for (let k = 0; k < hTail; k++) {
          isBg[queue[k]] = 1;
        }
      }
    }
  }

  // Aplica transparência no fundo e suaviza 1px de franja da borda
  const fringeTolSq = 56 * 56;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (isBg[p]) {
      data[i + 3] = 0;
    } else {
      const x = p % w;
      const y = (p - x) / w;
      const touchesBg =
        (x > 0 && isBg[p - 1]) ||
        (x + 1 < w && isBg[p + 1]) ||
        (y > 0 && isBg[p - w]) ||
        (y + 1 < h && isBg[p + w]);
      if (touchesBg) {
        const dSq = colorDistSq(data[i], data[i + 1], data[i + 2], bgR, bgG, bgB);
        if (dSq < fringeTolSq) {
          const factor = Math.sqrt(dSq) / 56;
          data[i + 3] = Math.round(255 * Math.min(1, factor * factor));
        }
      }
    }
  }

  // 4. Encontra componentes conectados opacos para separar Frente (esq) e Costas (dir)
  // e descartar automaticamente o texto no topo ou artefatos nas bordas
  const labels = new Int32Array(total);
  const components: ComponentBox[] = [];
  let nextLabel = 1;

  for (let p = 0; p < total; p++) {
    if (isBg[p] || labels[p] !== 0) continue;

    const label = nextLabel++;
    let cHead = 0;
    let cTail = 0;
    queue[cTail++] = p;
    labels[p] = label;

    const sx = p % w;
    const sy = (p - sx) / w;
    let minX = sx;
    let maxX = sx;
    let minY = sy;
    let maxY = sy;
    let sumX = 0;

    while (cHead < cTail) {
      const cur = queue[cHead++];
      const cx = cur % w;
      const cy = (cur - cx) / w;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      sumX += cx;

      const neighbors = [
        cx > 0 ? cur - 1 : -1,
        cx + 1 < w ? cur + 1 : -1,
        cy > 0 ? cur - w : -1,
        cy + 1 < h ? cur + w : -1,
      ];
      for (const np of neighbors) {
        if (np >= 0 && !isBg[np] && labels[np] === 0) {
          labels[np] = label;
          queue[cTail++] = np;
        }
      }
    }

    components.push({
      id: label,
      count: cTail,
      minX,
      maxX,
      minY,
      maxY,
      sumX,
    });
  }

  components.sort((a, b) => b.count - a.count);

  const renderComponent = (comp: ComponentBox): HTMLCanvasElement => {
    const pad = 4;
    const x0 = Math.max(0, comp.minX - pad);
    const y0 = Math.max(0, comp.minY - pad);
    const x1 = Math.min(w - 1, comp.maxX + pad);
    const y1 = Math.min(h - 1, comp.maxY + pad);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;

    const out = createCanvas(cw, ch);
    const oCtx = out.getContext('2d');
    if (!oCtx) return out;

    const outImg = oCtx.createImageData(cw, ch);
    const od = outImg.data;
    const targetId = comp.id;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x;
        if (labels[p] === targetId) {
          const si = p * 4;
          const di = ((y - y0) * cw + (x - x0)) * 4;
          od[di] = data[si];
          od[di + 1] = data[si + 1];
          od[di + 2] = data[si + 2];
          od[di + 3] = data[si + 3];
        }
      }
    }

    oCtx.putImageData(outImg, 0, 0);
    return out;
  };

  let front: HTMLCanvasElement;
  let back: HTMLCanvasElement;

  const first = components[0];
  const second = components[1];

  if (first && second && second.count > first.count * 0.25) {
    const firstCx = first.sumX / first.count;
    const secondCx = second.sumX / second.count;
    const leftComp = firstCx <= secondCx ? first : second;
    const rightComp = firstCx <= secondCx ? second : first;
    front = renderComponent(leftComp);
    back = renderComponent(rightComp);
  } else if (first) {
    front = renderComponent(first);
    back = front;
  } else {
    wCtx.putImageData(imageData, 0, 0);
    front = work;
    back = work;
  }

  return {
    front,
    back,
    avatar: extractAvatar(front),
    kickerRig: buildKickerRig(back),
  };
}

export function getCharacterSprites(imageUrl: string): Promise<CharacterSprites> {
  const existing = spriteCache.get(imageUrl);
  if (existing) return existing;

  const promise = loadImage(imageUrl).then((img) => processCharacterSheet(img));
  spriteCache.set(imageUrl, promise);
  return promise;
}

function buildGoalkeeperRig(front: HTMLCanvasElement): GoalkeeperRig {
  const w = front.width;
  const h = front.height;

  const body = createCanvas(w, h);
  const ctx = body.getContext('2d');
  if (ctx) {
    ctx.drawImage(front, 0, 0);

    // 1. Remove braço esquerdo (lado esquerdo da tela) e braço direito (mão na cintura)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';

    // Polígono do braço esquerdo estendido para baixo + pontinha da luva junto à coxa
    ctx.beginPath();
    ctx.moveTo(0, h * 0.2);
    ctx.lineTo(w * 0.255, h * 0.215);
    ctx.lineTo(w * 0.23, h * 0.34);
    ctx.lineTo(w * 0.22, h * 0.465);
    ctx.lineTo(w * 0.17, h * 0.515);
    ctx.lineTo(w * 0.115, h * 0.545);
    ctx.lineTo(w * 0.095, h * 0.595);
    ctx.lineTo(0, h * 0.605);
    ctx.closePath();
    ctx.fill();

    // Polígono do braço direito dobrado (cotovelo saindo para fora)
    ctx.beginPath();
    ctx.moveTo(w * 0.665, h * 0.215);
    ctx.lineTo(w, h * 0.2);
    ctx.lineTo(w, h * 0.56);
    ctx.lineTo(w * 0.615, h * 0.54);
    ctx.lineTo(w * 0.625, h * 0.43);
    ctx.lineTo(w * 0.65, h * 0.33);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 2. Repinta a pequena área da cintura direita onde a luva estava apoiada sobre a camisa amarela
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(w * 0.44, h * 0.41);
    ctx.lineTo(w * 0.632, h * 0.395);
    ctx.quadraticCurveTo(w * 0.625, h * 0.46, w * 0.612, h * 0.52);
    ctx.quadraticCurveTo(w * 0.53, h * 0.535, w * 0.44, h * 0.522);
    ctx.closePath();

    const shirtGrad = ctx.createLinearGradient(w * 0.44, h * 0.4, w * 0.63, h * 0.52);
    shirtGrad.addColorStop(0, '#fff000');
    shirtGrad.addColorStop(0.68, '#f5d400');
    shirtGrad.addColorStop(1, '#d8aa00');
    ctx.fillStyle = shirtGrad;
    ctx.fill();

    // Linha inferior da barra da camisa + contorno lateral direito combinando com o traço da arte
    ctx.strokeStyle = '#18181b';
    ctx.lineWidth = Math.max(1.8, w * 0.009);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w * 0.632, h * 0.395);
    ctx.quadraticCurveTo(w * 0.625, h * 0.46, w * 0.612, h * 0.52);
    ctx.quadraticCurveTo(w * 0.53, h * 0.535, w * 0.44, h * 0.522);
    ctx.stroke();

    // Pequeno detalhe lateral preto sob a axila (mesmo design da camisa do goleiro)
    ctx.fillStyle = '#23262e';
    ctx.beginPath();
    ctx.moveTo(w * 0.636, h * 0.36);
    ctx.lineTo(w * 0.59, h * 0.4);
    ctx.lineTo(w * 0.628, h * 0.445);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  return {
    width: w,
    height: h,
    body,
    centerX: w * 0.435,
    leftShoulderX: w * 0.245,
    rightShoulderX: w * 0.645,
    shoulderY: h * 0.245,
  };
}

export function getGoalkeeperSprites(imageUrl: string): Promise<CharacterSprites> {
  return getCharacterSprites(imageUrl).then((sprites) => {
    if (!sprites.goalkeeperRig) {
      sprites.goalkeeperRig = buildGoalkeeperRig(sprites.front);
    }
    return sprites;
  });
}
