/**
 * Margen de costura.
 *
 * Calcula la linea paralela por FUERA del contorno de la pieza. Soporta un
 * margen distinto por segmento (por ejemplo 1 cm en los costados y 3 cm en
 * el ruedo), porque asi se trabaja de verdad en el taller.
 */

import {
  bezier,
  controles,
  distanciaAPolilinea,
  esRecta,
  areaConSigno,
  distancia,
  interseccionRectas,
  normalizar,
  quitarRepetidos,
  resta,
  segmentos,
} from './geometria';
import type { Contorno, Pieza, Punto } from './tipos';

/** Normal que apunta hacia AFUERA, asumiendo contorno con area positiva. */
function normalExterior(dir: Punto): Punto {
  return { x: dir.y, y: -dir.x };
}

export interface PuntoMuestreado {
  p: Punto;
  /** Indice del segmento del contorno del que salio este punto. */
  seg: number;
}

/** Muestrea el contorno recordando de que segmento vino cada punto. */
export function muestrearConSegmento(c: Contorno, toleranciaMm = 0.4): PuntoMuestreado[] {
  const res: PuntoMuestreado[] = [];
  const segs = segmentos(c);
  segs.forEach(([a, b], i) => {
    const recta = esRecta(a, b);
    const [p0, p1, p2, p3] = controles(a, b);
    const aprox = distancia(p0, p1) + distancia(p1, p2) + distancia(p2, p3);
    const pasos = recta ? 1 : Math.max(4, Math.min(120, Math.ceil(aprox / toleranciaMm)));
    for (let k = 0; k < pasos; k++) res.push({ p: bezier(p0, p1, p2, p3, k / pasos), seg: i });
  });
  if (!c.cerrado && c.nodos.length > 0) {
    res.push({ p: { ...c.nodos[c.nodos.length - 1].p }, seg: segs.length - 1 });
  }
  return res;
}

/** El margen que corresponde al segmento `i` de la pieza. */
export function margenDeSegmento(pieza: Pieza, i: number): number {
  const nodo = pieza.contorno.nodos[i];
  if (!nodo) return pieza.costuraMm;
  const propio = pieza.costuraPorNodo[nodo.id];
  return propio === undefined ? pieza.costuraMm : propio;
}

/**
 * Desplaza una polilinea hacia afuera una distancia que puede variar por tramo.
 * `dists[i]` es la distancia del tramo que va de pts[i] a pts[i+1].
 */
export function desplazarPolilinea(pts: Punto[], dists: number[], cerrada: boolean): Punto[] {
  const n = pts.length;
  if (n < 2) return pts.slice();

  // Direccion y normal de cada tramo.
  const dirs: Punto[] = [];
  const nrms: Punto[] = [];
  const cant = cerrada ? n : n - 1;
  for (let i = 0; i < cant; i++) {
    const d = normalizar(resta(pts[(i + 1) % n], pts[i]));
    dirs.push(d);
    nrms.push(normalExterior(d));
  }

  const salida: Punto[] = [];
  const objetivo: number[] = [];
  for (let i = 0; i < n; i++) {
    const iAnt = cerrada ? (i - 1 + cant) % cant : Math.max(0, i - 1);
    const iSig = cerrada ? i % cant : Math.min(cant - 1, i);
    const tieneAnt = cerrada || i > 0;
    const tieneSig = cerrada || i < n - 1;

    if (!tieneAnt) {
      salida.push({ x: pts[i].x + nrms[iSig].x * dists[iSig], y: pts[i].y + nrms[iSig].y * dists[iSig] });
      objetivo.push(dists[iSig]);
      continue;
    }
    if (!tieneSig) {
      salida.push({ x: pts[i].x + nrms[iAnt].x * dists[iAnt], y: pts[i].y + nrms[iAnt].y * dists[iAnt] });
      objetivo.push(dists[iAnt]);
      continue;
    }

    const dA = dists[iAnt];
    const dB = dists[iSig];
    const a1 = { x: pts[i].x + nrms[iAnt].x * dA, y: pts[i].y + nrms[iAnt].y * dA };
    const a2 = { x: a1.x + dirs[iAnt].x, y: a1.y + dirs[iAnt].y };
    const b1 = { x: pts[i].x + nrms[iSig].x * dB, y: pts[i].y + nrms[iSig].y * dB };
    const b2 = { x: b1.x + dirs[iSig].x, y: b1.y + dirs[iSig].y };

    const cruce = interseccionRectas(a1, a2, b1, b2);
    const maxSalto = Math.max(dA, dB) * 4 + 1;
    if (cruce && distancia(cruce, pts[i]) < maxSalto) {
      salida.push(cruce);
      objetivo.push(Math.min(dA, dB));
    } else {
      // Esquina muy filosa: en vez de una punta enorme, redondeamos con dos puntos.
      salida.push(a1, b1);
      objetivo.push(dA, dB);
    }
  }

  // Los tramos concavos generan bucles invertidos: se detectan porque el punto
  // desplazado queda mas cerca del contorno original de lo que deberia.
  const limpio: Punto[] = [];
  for (let i = 0; i < salida.length; i++) {
    const d = distanciaAPolilinea(salida[i], pts, cerrada);
    if (d >= objetivo[i] * 0.9 - 1e-6) limpio.push(salida[i]);
  }
  return quitarRepetidos(limpio.length >= 3 ? limpio : salida, 0.05);
}

/** Contorno de corte de la pieza (contorno + margen de costura), como polilinea. */
export function lineaDeCorte(pieza: Pieza, toleranciaMm = 0.4): Punto[] | null {
  const c = pieza.contorno;
  if (c.nodos.length < 2) return null;
  const muestras = muestrearConSegmento(c, toleranciaMm);
  if (muestras.length < 3) return null;

  let pts = muestras.map((m) => m.p);
  let segIdx = muestras.map((m) => m.seg);

  // El calculo asume area positiva; si viene al reves, damos vuelta el orden.
  if (c.cerrado && areaConSigno(pts) < 0) {
    pts = pts.slice().reverse();
    segIdx = segIdx.slice().reverse();
  }

  const cant = c.cerrado ? pts.length : pts.length - 1;
  const dists: number[] = [];
  for (let i = 0; i < cant; i++) dists.push(margenDeSegmento(pieza, segIdx[i]));

  if (dists.every((d) => Math.abs(d) < 1e-9)) return null;
  return desplazarPolilinea(pts, dists, c.cerrado);
}

/**
 * Marca de piquete: una rayita perpendicular al contorno que cruza el margen
 * de costura, para poder hacerla con la tijera sin romper la pieza.
 */
export function marcasDePiquete(pieza: Pieza): Array<{ a: Punto; b: Punto }> {
  const marcas: Array<{ a: Punto; b: Punto }> = [];
  const nodos = pieza.contorno.nodos;
  const n = nodos.length;
  nodos.forEach((nodo, i) => {
    if (!nodo.piquete) return;
    const ant = nodos[(i - 1 + n) % n];
    const sig = nodos[(i + 1) % n];
    const dir = normalizar(resta(sig.p, ant.p));
    const nrm = normalExterior(dir);
    const margen = margenDeSegmento(pieza, i);
    const afuera = Math.max(margen, 5);
    marcas.push({
      a: { x: nodo.p.x - nrm.x * 4, y: nodo.p.y - nrm.y * 4 },
      b: { x: nodo.p.x + nrm.x * afuera, y: nodo.p.y + nrm.y * afuera },
    });
  });
  return marcas;
}
