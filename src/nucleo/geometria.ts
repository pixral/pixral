/** Geometria pura: vectores, curvas bezier, muestreo, simplificacion. Todo en mm. */

import type { Contorno, Nodo, Punto } from './tipos';

export const suma = (a: Punto, b: Punto): Punto => ({ x: a.x + b.x, y: a.y + b.y });
export const resta = (a: Punto, b: Punto): Punto => ({ x: a.x - b.x, y: a.y - b.y });
export const escalar = (a: Punto, k: number): Punto => ({ x: a.x * k, y: a.y * k });
export const largo = (a: Punto): number => Math.hypot(a.x, a.y);
export const distancia = (a: Punto, b: Punto): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalizar(a: Punto): Punto {
  const l = largo(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Rota 90 grados en sentido horario (en pantalla, con y hacia abajo). */
export const perpendicular = (a: Punto): Punto => ({ x: -a.y, y: a.x });

export function rotar(p: Punto, angulo: number, centro: Punto = { x: 0, y: 0 }): Punto {
  const c = Math.cos(angulo);
  const s = Math.sin(angulo);
  const dx = p.x - centro.x;
  const dy = p.y - centro.y;
  return { x: centro.x + dx * c - dy * s, y: centro.y + dx * s + dy * c };
}

export interface Caja {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export function cajaDePuntos(pts: Punto[]): Caja {
  if (pts.length === 0) return { x: 0, y: 0, ancho: 0, alto: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, ancho: maxX - minX, alto: maxY - minY };
}

export function unirCajas(a: Caja | null, b: Caja): Caja {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    ancho: Math.max(a.x + a.ancho, b.x + b.ancho) - x,
    alto: Math.max(a.y + a.alto, b.y + b.alto) - y,
  };
}

export function expandirCaja(c: Caja, m: number): Caja {
  return { x: c.x - m, y: c.y - m, ancho: c.ancho + 2 * m, alto: c.alto + 2 * m };
}

// ---------------------------------------------------------------------------
// Curvas bezier cubicas
// ---------------------------------------------------------------------------

export function bezier(p0: Punto, p1: Punto, p2: Punto, p3: Punto, t: number): Punto {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** Controles del segmento que va del nodo `a` al nodo `b`. */
export function controles(a: Nodo, b: Nodo): [Punto, Punto, Punto, Punto] {
  return [a.p, suma(a.p, a.sal), suma(b.p, b.ent), b.p];
}

export function esRecta(a: Nodo, b: Nodo): boolean {
  return (
    Math.abs(a.sal.x) < 1e-9 &&
    Math.abs(a.sal.y) < 1e-9 &&
    Math.abs(b.ent.x) < 1e-9 &&
    Math.abs(b.ent.y) < 1e-9
  );
}

/** Cantidad de tramos con la que conviene muestrear un segmento, segun su tamano. */
function pasosPara(a: Nodo, b: Nodo, toleranciaMm: number): number {
  if (esRecta(a, b)) return 1;
  const [p0, p1, p2, p3] = controles(a, b);
  const aprox = distancia(p0, p1) + distancia(p1, p2) + distancia(p2, p3);
  return Math.max(4, Math.min(120, Math.ceil(aprox / Math.max(0.2, toleranciaMm))));
}

/** Pares consecutivos de nodos que forman los segmentos del contorno. */
export function segmentos(c: Contorno): Array<[Nodo, Nodo]> {
  const res: Array<[Nodo, Nodo]> = [];
  const n = c.nodos.length;
  if (n < 2) return res;
  const ultimo = c.cerrado ? n : n - 1;
  for (let i = 0; i < ultimo; i++) res.push([c.nodos[i], c.nodos[(i + 1) % n]]);
  return res;
}

/** Convierte el contorno (con curvas) en una polilinea densa de puntos. */
export function muestrear(c: Contorno, toleranciaMm = 0.4): Punto[] {
  const pts: Punto[] = [];
  const segs = segmentos(c);
  if (segs.length === 0) return c.nodos.map((n) => ({ ...n.p }));
  for (const [a, b] of segs) {
    const pasos = pasosPara(a, b, toleranciaMm);
    const [p0, p1, p2, p3] = controles(a, b);
    for (let i = 0; i < pasos; i++) pts.push(bezier(p0, p1, p2, p3, i / pasos));
  }
  if (!c.cerrado) pts.push({ ...c.nodos[c.nodos.length - 1].p });
  return pts;
}

/** Largo de un segmento del contorno, en mm (lo que mide la costura ahi). */
export function largoSegmento(a: Nodo, b: Nodo): number {
  if (esRecta(a, b)) return distancia(a.p, b.p);
  const [p0, p1, p2, p3] = controles(a, b);
  const pasos = 48;
  let total = 0;
  let prev = p0;
  for (let i = 1; i <= pasos; i++) {
    const q = bezier(p0, p1, p2, p3, i / pasos);
    total += distancia(prev, q);
    prev = q;
  }
  return total;
}

export function perimetro(c: Contorno): number {
  return segmentos(c).reduce((acc, [a, b]) => acc + largoSegmento(a, b), 0);
}

export function longitudPolilinea(pts: Punto[], cerrada: boolean): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distancia(pts[i - 1], pts[i]);
  if (cerrada && pts.length > 1) total += distancia(pts[pts.length - 1], pts[0]);
  return total;
}

/** Area con signo. Positiva si los puntos van en sentido horario (y hacia abajo). */
export function areaConSigno(pts: Punto[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export const area = (pts: Punto[]): number => Math.abs(areaConSigno(pts));

// ---------------------------------------------------------------------------
// Distancias y proyecciones
// ---------------------------------------------------------------------------

export function puntoMasCercanoEnSegmento(p: Punto, a: Punto, b: Punto): { punto: Punto; t: number } {
  const ab = resta(b, a);
  const den = ab.x * ab.x + ab.y * ab.y;
  if (den < 1e-12) return { punto: { ...a }, t: 0 };
  let t = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / den;
  t = Math.max(0, Math.min(1, t));
  return { punto: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
}

export function distanciaASegmento(p: Punto, a: Punto, b: Punto): number {
  return distancia(p, puntoMasCercanoEnSegmento(p, a, b).punto);
}

export function distanciaAPolilinea(p: Punto, pts: Punto[], cerrada: boolean): number {
  let min = Infinity;
  const n = pts.length;
  const hasta = cerrada ? n : n - 1;
  for (let i = 0; i < hasta; i++) {
    const d = distanciaASegmento(p, pts[i], pts[(i + 1) % n]);
    if (d < min) min = d;
  }
  return min;
}

/** Interseccion de dos rectas infinitas. null si son paralelas. */
export function interseccionRectas(a1: Punto, a2: Punto, b1: Punto, b2: Punto): Punto | null {
  const d1 = resta(a2, a1);
  const d2 = resta(b2, b1);
  const den = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((b1.x - a1.x) * d2.y - (b1.y - a1.y) * d2.x) / den;
  return { x: a1.x + d1.x * t, y: a1.y + d1.y * t };
}

export function puntoDentroDePoligono(p: Punto, poli: Punto[]): boolean {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const a = poli[i];
    const b = poli[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      dentro = !dentro;
    }
  }
  return dentro;
}

// ---------------------------------------------------------------------------
// Simplificacion (Ramer-Douglas-Peucker)
// ---------------------------------------------------------------------------

export function simplificar(pts: Punto[], tolerancia: number): Punto[] {
  if (pts.length <= 2) return pts.slice();
  const marcados = new Uint8Array(pts.length);
  marcados[0] = 1;
  marcados[pts.length - 1] = 1;
  const pila: Array<[number, number]> = [[0, pts.length - 1]];
  while (pila.length > 0) {
    const [ini, fin] = pila.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = ini + 1; i < fin; i++) {
      const d = distanciaASegmento(pts[i], pts[ini], pts[fin]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerancia && idx > 0) {
      marcados[idx] = 1;
      pila.push([ini, idx], [idx, fin]);
    }
  }
  return pts.filter((_, i) => marcados[i] === 1);
}

/** Saca puntos consecutivos que estan practicamente encima. */
export function quitarRepetidos(pts: Punto[], minimo = 0.05): Punto[] {
  const res: Punto[] = [];
  for (const p of pts) {
    if (res.length === 0 || distancia(res[res.length - 1], p) > minimo) res.push(p);
  }
  return res;
}

/**
 * Reparte los puntos de una polilinea a intervalos regulares.
 * Sirve para comparar dos costuras que tienen que coincidir.
 */
export function remuestrearUniforme(pts: Punto[], cantidad: number, cerrada: boolean): Punto[] {
  const total = longitudPolilinea(pts, cerrada);
  if (total < 1e-9 || pts.length < 2) return pts.slice();
  const paso = total / cantidad;
  const res: Punto[] = [pts[0]];
  let acumulado = 0;
  let objetivo = paso;
  const n = pts.length;
  const hasta = cerrada ? n : n - 1;
  for (let i = 0; i < hasta && res.length < cantidad; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const d = distancia(a, b);
    while (acumulado + d >= objetivo && res.length < cantidad) {
      const t = (objetivo - acumulado) / d;
      res.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      objetivo += paso;
    }
    acumulado += d;
  }
  return res;
}
