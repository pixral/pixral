/**
 * Representacion intermedia de lo que se va a imprimir.
 *
 * Las piezas se convierten una sola vez a esta estructura y despues cada
 * formato (PDF, SVG, DXF) sabe como escribirla. Asi los tres exportadores
 * dibujan exactamente lo mismo.
 */

import { lineaDeCorte, marcasDePiquete } from '../nucleo/costura';
import { bezier, cajaDePuntos, controles, esRecta, unirCajas, type Caja } from '../nucleo/geometria';
import { piezaEnTalle } from '../nucleo/progresion';
import { segmentos } from '../nucleo/geometria';
import type { Contorno, Pieza, Proyecto, Punto } from '../nucleo/tipos';

export type Cmd =
  | { t: 'M'; x: number; y: number }
  | { t: 'L'; x: number; y: number }
  | { t: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { t: 'Z' };

export type EstiloTrazo =
  | 'contorno'
  | 'costura'
  | 'pinza'
  | 'doblez'
  | 'referencia'
  | 'interna'
  | 'hilo'
  | 'piquete';

export interface Trazo {
  cmds: Cmd[];
  estilo: EstiloTrazo;
  /** Nombre del talle, cuando el trazo forma parte de un nido de talles. */
  talle?: string;
}

export interface Etiqueta {
  x: number;
  y: number;
  texto: string;
  tamanoMm: number;
  negrita?: boolean;
}

export interface Dibujo {
  id: string;
  nombre: string;
  trazos: Trazo[];
  etiquetas: Etiqueta[];
  caja: Caja;
}

export function cmdsDeContorno(c: Contorno): Cmd[] {
  if (c.nodos.length === 0) return [];
  const cmds: Cmd[] = [{ t: 'M', x: c.nodos[0].p.x, y: c.nodos[0].p.y }];
  const segs = segmentos(c);
  segs.forEach(([a, b], i) => {
    if (esRecta(a, b)) {
      // En un contorno cerrado, el ultimo tramo recto ya lo dibuja el cierre.
      if (!(c.cerrado && i === segs.length - 1)) cmds.push({ t: 'L', x: b.p.x, y: b.p.y });
    } else {
      const [, p1, p2, p3] = controles(a, b);
      cmds.push({ t: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p3.x, y: p3.y });
    }
  });
  if (c.cerrado) cmds.push({ t: 'Z' });
  return cmds;
}

export function cmdsDePolilinea(pts: Punto[], cerrado: boolean): Cmd[] {
  if (pts.length === 0) return [];
  const cmds: Cmd[] = [{ t: 'M', x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) cmds.push({ t: 'L', x: pts[i].x, y: pts[i].y });
  if (cerrado) cmds.push({ t: 'Z' });
  return cmds;
}

/** Pasa los comandos a puntos sueltos (para calcular cajas y para el DXF). */
export function aplanar(cmds: Cmd[], pasos = 16): Punto[] {
  const pts: Punto[] = [];
  let actual: Punto = { x: 0, y: 0 };
  let inicio: Punto = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c.t === 'M') {
      actual = { x: c.x, y: c.y };
      inicio = actual;
      pts.push(actual);
    } else if (c.t === 'L') {
      actual = { x: c.x, y: c.y };
      pts.push(actual);
    } else if (c.t === 'C') {
      const p0 = actual;
      for (let i = 1; i <= pasos; i++) {
        pts.push(bezier(p0, { x: c.x1, y: c.y1 }, { x: c.x2, y: c.y2 }, { x: c.x, y: c.y }, i / pasos));
      }
      actual = { x: c.x, y: c.y };
    } else {
      pts.push(inicio);
      actual = inicio;
    }
  }
  return pts;
}

function cajaDeTrazos(trazos: Trazo[]): Caja {
  let caja: Caja | null = null;
  for (const t of trazos) {
    const pts = aplanar(t.cmds, 8);
    if (pts.length > 0) caja = unirCajas(caja, cajaDePuntos(pts));
  }
  return caja ?? { x: 0, y: 0, ancho: 0, alto: 0 };
}

export interface OpcionesDibujo {
  incluirCostura: boolean;
  incluirInternas: boolean;
  incluirHilo: boolean;
  incluirEtiquetas: boolean;
}

const ESTILO_INTERNA: Record<string, EstiloTrazo> = {
  pinza: 'pinza',
  doblez: 'doblez',
  referencia: 'referencia',
  interna: 'interna',
};

function trazosDePieza(pieza: Pieza, op: OpcionesDibujo, talle?: string): Trazo[] {
  const trazos: Trazo[] = [];
  if (op.incluirCostura && pieza.costuraMm !== 0) {
    const corte = lineaDeCorte(pieza);
    if (corte && corte.length > 2) {
      trazos.push({ cmds: cmdsDePolilinea(corte, pieza.contorno.cerrado), estilo: 'costura', talle });
    }
  }
  trazos.push({ cmds: cmdsDeContorno(pieza.contorno), estilo: 'contorno', talle });
  if (op.incluirInternas) {
    for (const l of pieza.internas) {
      trazos.push({ cmds: cmdsDeContorno(l.contorno), estilo: ESTILO_INTERNA[l.tipo] ?? 'interna', talle });
    }
  }
  for (const m of marcasDePiquete(pieza)) {
    trazos.push({ cmds: [{ t: 'M', x: m.a.x, y: m.a.y }, { t: 'L', x: m.b.x, y: m.b.y }], estilo: 'piquete', talle });
  }
  if (op.incluirHilo && pieza.hilo) {
    trazos.push({ cmds: flechaDoble(pieza.hilo.a, pieza.hilo.b), estilo: 'hilo', talle });
  }
  return trazos;
}

/** Linea de hilo: una recta con punta de flecha en los dos extremos. */
function flechaDoble(a: Punto, b: Punto, largoPunta = 6, aberturaPunta = 2.2): Cmd[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const px = -uy;
  const py = ux;
  const punta = (p: Punto, sx: number, sy: number): Cmd[] => [
    { t: 'M', x: p.x + sx * largoPunta + px * aberturaPunta, y: p.y + sy * largoPunta + py * aberturaPunta },
    { t: 'L', x: p.x, y: p.y },
    { t: 'L', x: p.x + sx * largoPunta - px * aberturaPunta, y: p.y + sy * largoPunta - py * aberturaPunta },
  ];
  return [
    { t: 'M', x: a.x, y: a.y },
    { t: 'L', x: b.x, y: b.y },
    ...punta(a, ux, uy),
    ...punta(b, -ux, -uy),
  ];
}

function etiquetasDePieza(pieza: Pieza, caja: Caja, titulo: string, extra: string[]): Etiqueta[] {
  const x = caja.x + 6;
  let y = caja.y + 10;
  const etiquetas: Etiqueta[] = [{ x, y, texto: titulo, tamanoMm: 5, negrita: true }];
  for (const linea of extra) {
    y += 5;
    etiquetas.push({ x, y, texto: linea, tamanoMm: 3.5 });
  }
  if (pieza.alLomo) {
    y += 5;
    etiquetas.push({ x, y, texto: 'CORTAR AL LOMO (sobre el doblez)', tamanoMm: 3.5 });
  }
  return etiquetas;
}

/** Dibujo de una pieza en un talle. */
export function dibujoDePieza(
  pieza: Pieza,
  proyecto: Proyecto,
  talleId: string,
  op: OpcionesDibujo,
): Dibujo {
  const talle = proyecto.talles.find((t) => t.id === talleId);
  const progresada = piezaEnTalle(pieza, proyecto, talleId);
  const trazos = trazosDePieza(progresada, op, talle?.nombre);
  const caja = cajaDeTrazos(trazos);
  const extra = [
    `Talle ${talle?.nombre ?? '-'}`,
    `Cortar ${pieza.cantidad} ${pieza.cantidad === 1 ? 'vez' : 'veces'} - ${pieza.material}`,
    op.incluirCostura && pieza.costuraMm > 0
      ? `Costura incluida: ${(pieza.costuraMm / 10).toFixed(1)} cm`
      : 'SIN margen de costura',
  ];
  return {
    id: `${pieza.id}:${talleId}`,
    nombre: `${pieza.nombre} - Talle ${talle?.nombre ?? ''}`.trim(),
    trazos,
    etiquetas: op.incluirEtiquetas ? etiquetasDePieza(pieza, caja, pieza.nombre, extra) : [],
    caja,
  };
}

/** Dibujo de una pieza con todos los talles superpuestos (el "nido de talles"). */
export function dibujoNido(
  pieza: Pieza,
  proyecto: Proyecto,
  talleIds: string[],
  op: OpcionesDibujo,
): Dibujo {
  const trazos: Trazo[] = [];
  for (const talleId of talleIds) {
    const talle = proyecto.talles.find((t) => t.id === talleId);
    const progresada = piezaEnTalle(pieza, proyecto, talleId);
    trazos.push(...trazosDePieza(progresada, op, talle?.nombre));
  }
  const caja = cajaDeTrazos(trazos);
  const nombres = talleIds
    .map((id) => proyecto.talles.find((t) => t.id === id)?.nombre ?? '')
    .filter(Boolean);
  const extra = [
    `Talles: ${nombres.join(' - ')}`,
    `Cortar ${pieza.cantidad} ${pieza.cantidad === 1 ? 'vez' : 'veces'} - ${pieza.material}`,
    op.incluirCostura && pieza.costuraMm > 0
      ? `Costura incluida: ${(pieza.costuraMm / 10).toFixed(1)} cm`
      : 'SIN margen de costura',
  ];
  return {
    id: `${pieza.id}:nido`,
    nombre: `${pieza.nombre} (nido de talles)`,
    trazos,
    etiquetas: op.incluirEtiquetas ? etiquetasDePieza(pieza, caja, pieza.nombre, extra) : [],
    caja,
  };
}

// ---------------------------------------------------------------------------
// Distribucion en la lamina
// ---------------------------------------------------------------------------

export interface Colocado {
  dibujo: Dibujo;
  dx: number;
  dy: number;
}

export interface Lamina {
  colocados: Colocado[];
  ancho: number;
  alto: number;
}

/**
 * Acomoda las piezas en filas, de izquierda a derecha, como si se fueran
 * apoyando sobre la mesa. No es un encimado profesional, pero alcanza para
 * imprimir sin desperdiciar hojas.
 */
export function distribuir(dibujos: Dibujo[], anchoMaximoMm: number, separacionMm = 12): Lamina {
  const ordenados = dibujos
    .filter((d) => d.caja.ancho > 0 || d.caja.alto > 0)
    .slice()
    .sort((a, b) => b.caja.alto - a.caja.alto);

  const colocados: Colocado[] = [];
  let x = 0;
  let y = 0;
  let altoFila = 0;
  let anchoUsado = 0;

  for (const d of ordenados) {
    if (x > 0 && x + d.caja.ancho > anchoMaximoMm) {
      x = 0;
      y += altoFila + separacionMm;
      altoFila = 0;
    }
    colocados.push({ dibujo: d, dx: x - d.caja.x, dy: y - d.caja.y });
    x += d.caja.ancho + separacionMm;
    anchoUsado = Math.max(anchoUsado, x - separacionMm);
    altoFila = Math.max(altoFila, d.caja.alto);
  }

  return { colocados, ancho: Math.max(anchoUsado, 1), alto: Math.max(y + altoFila, 1) };
}

export function desplazarCmds(cmds: Cmd[], dx: number, dy: number): Cmd[] {
  return cmds.map((c) => {
    if (c.t === 'Z') return c;
    if (c.t === 'C') {
      return { t: 'C', x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy, x: c.x + dx, y: c.y + dy };
    }
    return { t: c.t, x: c.x + dx, y: c.y + dy };
  });
}
