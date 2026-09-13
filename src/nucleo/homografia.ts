/**
 * Correccion de perspectiva ("enderezar la foto").
 *
 * Sacar una foto de un molde apoyado en el piso siempre sale con perspectiva:
 * el lado de arriba mide menos que el de abajo. Marcando las 4 esquinas de un
 * rectangulo de medida conocida (una hoja A4, un cuadrado dibujado con la
 * regla, la mesa) se calcula la homografia que devuelve la foto a plano.
 */

import { distancia } from './geometria';
import type { Punto } from './tipos';

export type Esquinas = [Punto, Punto, Punto, Punto];

/**
 * Homografia que lleva los puntos `origen` a los puntos `destino`.
 * Devuelve 9 numeros (matriz 3x3 por filas, con h8 = 1).
 */
export function calcularHomografia(origen: Esquinas, destino: Esquinas): number[] {
  // Sistema de 8 ecuaciones con 8 incognitas, resuelto por eliminacion de Gauss.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = origen[i];
    const { x: u, y: v } = destino[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }

  for (let col = 0; col < 8; col++) {
    let mejor = col;
    for (let f = col + 1; f < 8; f++) {
      if (Math.abs(A[f][col]) > Math.abs(A[mejor][col])) mejor = f;
    }
    if (Math.abs(A[mejor][col]) < 1e-12) throw new Error('Las 4 esquinas no forman un cuadrilatero valido');
    [A[col], A[mejor]] = [A[mejor], A[col]];
    const pivote = A[col][col];
    for (let c = col; c < 9; c++) A[col][c] /= pivote;
    for (let f = 0; f < 8; f++) {
      if (f === col) continue;
      const factor = A[f][col];
      if (factor === 0) continue;
      for (let c = col; c < 9; c++) A[f][c] -= factor * A[col][c];
    }
  }

  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

export function aplicarHomografia(h: number[], p: Punto): Punto {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  const k = Math.abs(d) < 1e-12 ? 1e-12 : d;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / k,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / k,
  };
}

/** Ordena 4 puntos sueltos como arriba-izq, arriba-der, abajo-der, abajo-izq. */
export function ordenarEsquinas(pts: Punto[]): Esquinas {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const ordenados = pts
    .slice()
    .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  // El primero tiene que ser el de arriba a la izquierda.
  let inicio = 0;
  let mejor = Infinity;
  ordenados.forEach((p, i) => {
    const d = (p.x - cx) + (p.y - cy);
    if (d < mejor) {
      mejor = d;
      inicio = i;
    }
  });
  const rot = ordenados.slice(inicio).concat(ordenados.slice(0, inicio));
  return [rot[0], rot[1], rot[2], rot[3]];
}

export interface ResultadoRectificado {
  lienzo: HTMLCanvasElement;
  /** Medida real, en mm, de la imagen enderezada completa. */
  anchoMm: number;
  altoMm: number;
  /**
   * Posicion de la esquina superior izquierda de la imagen enderezada,
   * medida en mm desde la primera esquina que marco la persona.
   * Suele ser negativa: la foto se extiende para arriba y para la izquierda.
   */
  offsetMm: Punto;
}

/** Puntos del borde de la imagen, para saber hasta donde llega una vez enderezada. */
function puntosDelBorde(ancho: number, alto: number, porLado = 24): Punto[] {
  const pts: Punto[] = [];
  for (let i = 0; i <= porLado; i++) {
    const t = i / porLado;
    pts.push({ x: t * ancho, y: 0 });
    pts.push({ x: t * ancho, y: alto });
    pts.push({ x: 0, y: t * alto });
    pts.push({ x: ancho, y: t * alto });
  }
  return pts;
}

/**
 * Endereza la foto ENTERA.
 *
 * `esquinas` estan en pixeles de la imagen original y corresponden a un
 * rectangulo que en la realidad mide anchoMm x altoMm. Ese rectangulo sirve
 * para saber como esta inclinada la foto y cuanto mide cada cosa, pero el
 * resultado incluye toda la imagen: asi se puede usar una hoja A4 apoyada al
 * lado del molde como referencia sin perder el molde.
 */
export function rectificar(
  imagen: HTMLImageElement | HTMLCanvasElement,
  esquinas: Esquinas,
  anchoMm: number,
  altoMm: number,
  ladoMaximoPx = 2400,
): ResultadoRectificado {
  // Homografia de la foto al plano real, medido en milimetros.
  const aPlano = calcularHomografia(esquinas, [
    { x: 0, y: 0 },
    { x: anchoMm, y: 0 },
    { x: anchoMm, y: altoMm },
    { x: 0, y: altoMm },
  ]);
  const aFoto = calcularHomografia(
    [
      { x: 0, y: 0 },
      { x: anchoMm, y: 0 },
      { x: anchoMm, y: altoMm },
      { x: 0, y: altoMm },
    ],
    esquinas,
  );

  // Hasta donde llega la foto una vez enderezada. Los puntos que caen detras
  // del horizonte se descartan, y el resto se recorta a un limite sensato para
  // que una foto muy inclinada no genere una imagen gigante.
  let minX = 0;
  let minY = 0;
  let maxX = anchoMm;
  let maxY = altoMm;
  for (const p of puntosDelBorde(imagen.width, imagen.height)) {
    const den = aPlano[6] * p.x + aPlano[7] * p.y + aPlano[8];
    if (den <= 1e-9) continue;
    const q = aplicarHomografia(aPlano, p);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    minX = Math.min(minX, q.x);
    minY = Math.min(minY, q.y);
    maxX = Math.max(maxX, q.x);
    maxY = Math.max(maxY, q.y);
  }
  minX = Math.max(minX, -4 * anchoMm);
  minY = Math.max(minY, -4 * altoMm);
  maxX = Math.min(maxX, 5 * anchoMm);
  maxY = Math.min(maxY, 5 * altoMm);

  const totalMm = { ancho: maxX - minX, alto: maxY - minY };

  // Resolucion: la necesaria para no perder detalle del rectangulo marcado.
  const anchoFuente = (distancia(esquinas[0], esquinas[1]) + distancia(esquinas[3], esquinas[2])) / 2;
  const altoFuente = (distancia(esquinas[0], esquinas[3]) + distancia(esquinas[1], esquinas[2])) / 2;
  let pxPorMm = Math.max(anchoFuente / anchoMm, altoFuente / altoMm, 0.5);
  let ancho = Math.round(totalMm.ancho * pxPorMm);
  let alto = Math.round(totalMm.alto * pxPorMm);
  const lado = Math.max(ancho, alto);
  if (lado > ladoMaximoPx) {
    const k = ladoMaximoPx / lado;
    ancho = Math.max(1, Math.round(ancho * k));
    alto = Math.max(1, Math.round(alto * k));
    pxPorMm *= k;
  }

  const fuente = document.createElement('canvas');
  fuente.width = imagen.width;
  fuente.height = imagen.height;
  const ctxFuente = fuente.getContext('2d', { willReadFrequently: true })!;
  ctxFuente.drawImage(imagen, 0, 0);
  const datosFuente = ctxFuente.getImageData(0, 0, fuente.width, fuente.height);

  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d')!;
  const salida = ctx.createImageData(ancho, alto);

  const sw = datosFuente.width;
  const sh = datosFuente.height;
  const sd = datosFuente.data;
  const od = salida.data;

  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const plano = { x: minX + (x + 0.5) / pxPorMm, y: minY + (y + 0.5) / pxPorMm };
      const s = aplicarHomografia(aFoto, plano);
      const i = (y * ancho + x) * 4;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || s.x < 0 || s.y < 0 || s.x >= sw - 1 || s.y >= sh - 1) {
        od[i] = 255;
        od[i + 1] = 255;
        od[i + 2] = 255;
        od[i + 3] = 255;
        continue;
      }
      // Interpolacion bilineal para que no salga dentado.
      const x0 = Math.floor(s.x);
      const y0 = Math.floor(s.y);
      const fx = s.x - x0;
      const fy = s.y - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const arriba = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const abajo = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        od[i + c] = arriba * (1 - fy) + abajo * fy;
      }
      od[i + 3] = 255;
    }
  }

  ctx.putImageData(salida, 0, 0);
  return { lienzo, anchoMm: totalMm.ancho, altoMm: totalMm.alto, offsetMm: { x: minX, y: minY } };
}
