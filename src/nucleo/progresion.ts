/**
 * Motor de progresion de talles a partir de la TABLA DE MEDIDAS.
 *
 * Como funciona, en criollo:
 *
 *  - La pieza tiene un EJE VERTICAL que no se mueve (normalmente el centro
 *    delantero o el doblez) y un BORDE DE REFERENCIA donde se aplica todo el
 *    crecimiento (normalmente el costado).
 *  - Tambien tiene un EJE HORIZONTAL que no se mueve (normalmente la cintura).
 *  - Encima de eso se marcan LINEAS DE CRECIMIENTO: "a la altura del busto la
 *    pieza crece un cuarto de lo que crece el contorno de busto en la tabla".
 *
 * Con eso se arma un campo de deformacion: cada punto se corre en horizontal
 * segun la altura a la que esta y que tan lejos este del eje, y en vertical
 * segun que tan lejos este del eje horizontal. Entre linea y linea se
 * interpola en forma lineal, que es exactamente lo que se hace a mano.
 */

import { nuevoId } from './ids';
import type { Contorno, Pieza, Proyecto, Punto, ReglaAncho, ReglaLargo } from './tipos';

export function talleBase(proyecto: Proyecto) {
  return proyecto.talles.find((t) => t.id === proyecto.talleBaseId) ?? proyecto.talles[0];
}

/** Cuantos saltos de talle hay entre el talle base y el pedido (puede ser negativo). */
export function escalones(proyecto: Proyecto, talleId: string): number {
  const iBase = proyecto.talles.findIndex((t) => t.id === proyecto.talleBaseId);
  const i = proyecto.talles.findIndex((t) => t.id === talleId);
  if (iBase < 0 || i < 0) return 0;
  return i - iBase;
}

/** Cuanto crece (en mm) la regla al pasar del talle base al talle pedido. */
export function deltaDeRegla(
  regla: ReglaAncho | ReglaLargo,
  proyecto: Proyecto,
  talleId: string,
): number {
  if (regla.origen === 'manual') {
    return (regla.mmPorTalle ?? 0) * escalones(proyecto, talleId);
  }
  if (!regla.medidaId) return 0;
  const base = talleBase(proyecto);
  const destino = proyecto.talles.find((t) => t.id === talleId);
  if (!base || !destino) return 0;
  const vBase = base.valores[regla.medidaId];
  const vDestino = destino.valores[regla.medidaId];
  if (vBase === undefined || vDestino === undefined) return 0;
  return (vDestino - vBase) * (regla.fraccion ?? 1);
}

interface ControlY {
  y: number;
  v: number;
}

/** Interpolacion lineal entre controles, con extrapolacion plana en las puntas. */
function interpolar(controles: ControlY[], y: number): number {
  if (controles.length === 0) return 0;
  if (controles.length === 1) return controles[0].v;
  if (y <= controles[0].y) return controles[0].v;
  const ultimo = controles[controles.length - 1];
  if (y >= ultimo.y) return ultimo.v;
  for (let i = 1; i < controles.length; i++) {
    const a = controles[i - 1];
    const b = controles[i];
    if (y <= b.y) {
      const t = b.y - a.y < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
      return a.v + (b.v - a.v) * t;
    }
  }
  return ultimo.v;
}

export interface Deformacion {
  ejeX: number;
  bordeX: number;
  ejeY: number;
  anchos: ControlY[];
  largos: ControlY[];
  /** true si no hay nada que deformar (el talle base, o una pieza sin reglas). */
  identidad: boolean;
}

export function construirDeformacion(pieza: Pieza, proyecto: Proyecto, talleId: string): Deformacion {
  const pr = pieza.progresion;

  const anchos: ControlY[] = pr.anchos
    .map((r) => ({ y: r.y, v: deltaDeRegla(r, proyecto, talleId) }))
    .sort((a, b) => a.y - b.y);

  // El eje horizontal es un control implicito con desplazamiento cero: es el
  // punto de la pieza que se queda quieto.
  const largos: ControlY[] = pr.largos
    .map((r) => {
      const d = deltaDeRegla(r, proyecto, talleId);
      const signo = r.y > pr.ejeY ? 1 : r.y < pr.ejeY ? -1 : 0;
      return { y: r.y, v: d * signo };
    })
    .concat([{ y: pr.ejeY, v: 0 }])
    .sort((a, b) => a.y - b.y);

  const identidad =
    anchos.every((c) => Math.abs(c.v) < 1e-9) && largos.every((c) => Math.abs(c.v) < 1e-9);

  return { ejeX: pr.ejeX, bordeX: pr.bordeX, ejeY: pr.ejeY, anchos, largos, identidad };
}

export function deformarPunto(p: Punto, d: Deformacion): Punto {
  if (d.identidad) return { ...p };
  const span = d.bordeX - d.ejeX;
  const reparto = Math.abs(span) < 1e-6 ? 0 : (p.x - d.ejeX) / span;
  return {
    x: p.x + interpolar(d.anchos, p.y) * reparto,
    y: p.y + interpolar(d.largos, p.y),
  };
}

function deformarContorno(c: Contorno, d: Deformacion): Contorno {
  return {
    cerrado: c.cerrado,
    nodos: c.nodos.map((n) => {
      if (n.fijo) return { ...n, p: { ...n.p }, ent: { ...n.ent }, sal: { ...n.sal } };
      const p = deformarPunto(n.p, d);
      // Las manijas se deforman como puntos absolutos y despues se vuelven a
      // guardar relativas, asi la curva acompana la deformacion.
      const ent = deformarPunto({ x: n.p.x + n.ent.x, y: n.p.y + n.ent.y }, d);
      const sal = deformarPunto({ x: n.p.x + n.sal.x, y: n.p.y + n.sal.y }, d);
      return {
        ...n,
        p,
        ent: { x: ent.x - p.x, y: ent.y - p.y },
        sal: { x: sal.x - p.x, y: sal.y - p.y },
      };
    }),
  };
}

/** Devuelve la pieza ya progresada al talle pedido. No toca la pieza original. */
export function piezaEnTalle(pieza: Pieza, proyecto: Proyecto, talleId: string): Pieza {
  const d = construirDeformacion(pieza, proyecto, talleId);
  if (d.identidad) return pieza;
  return {
    ...pieza,
    contorno: deformarContorno(pieza.contorno, d),
    internas: pieza.internas.map((l) => ({ ...l, contorno: deformarContorno(l.contorno, d) })),
    hilo: pieza.hilo
      ? { a: deformarPunto(pieza.hilo.a, d), b: deformarPunto(pieza.hilo.b, d) }
      : undefined,
    foto: undefined,
  };
}

/** Todas las piezas del proyecto progresadas a un talle. */
export function piezasEnTalle(proyecto: Proyecto, talleId: string): Pieza[] {
  return proyecto.piezas.map((p) => piezaEnTalle(p, proyecto, talleId));
}

// ---------------------------------------------------------------------------
// Ayudas para armar reglas
// ---------------------------------------------------------------------------

export function nuevaReglaAncho(parcial: Partial<ReglaAncho> = {}): ReglaAncho {
  return {
    id: nuevoId('ra'),
    nombre: 'Linea de crecimiento',
    y: 0,
    origen: 'medida',
    fraccion: 0.25,
    mmPorTalle: 0,
    ...parcial,
  };
}

export function nuevaReglaLargo(parcial: Partial<ReglaLargo> = {}): ReglaLargo {
  return {
    id: nuevoId('rl'),
    nombre: 'Linea de largo',
    y: 0,
    origen: 'medida',
    fraccion: 1,
    mmPorTalle: 0,
    ...parcial,
  };
}

/**
 * Tabla de cuanto crece cada regla en cada talle. Se muestra en el panel de
 * progresion para que se pueda controlar a ojo antes de exportar.
 */
export interface FilaResumen {
  reglaId: string;
  nombre: string;
  eje: 'ancho' | 'largo';
  porTalle: Array<{ talleId: string; talle: string; mm: number }>;
}

export function resumenProgresion(pieza: Pieza, proyecto: Proyecto): FilaResumen[] {
  const filas: FilaResumen[] = [];
  const armar = (r: ReglaAncho | ReglaLargo, eje: 'ancho' | 'largo'): FilaResumen => ({
    reglaId: r.id,
    nombre: r.nombre,
    eje,
    porTalle: proyecto.talles.map((t) => ({
      talleId: t.id,
      talle: t.nombre,
      mm: deltaDeRegla(r, proyecto, t.id),
    })),
  });
  for (const r of pieza.progresion.anchos) filas.push(armar(r, 'ancho'));
  for (const r of pieza.progresion.largos) filas.push(armar(r, 'largo'));
  return filas;
}
