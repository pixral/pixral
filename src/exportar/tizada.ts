/**
 * Tizada (o marcada): como se acomodan las piezas sobre la tela para cortar.
 *
 * Lo que importa de todo esto es el numero de arriba: cuantos metros de tela
 * hay que comprar. Lo demas es el dibujo de como ubicarlas.
 *
 * Reglas que se respetan:
 *
 *  - Las piezas solo se pueden girar 180 grados, nunca 90: la linea de hilo
 *    tiene que quedar paralela al orillo o la prenda queda torcida.
 *  - Con la tela doblada al medio, cada pieza sale de a dos (se corta sobre
 *    las dos capas), y las que van al lomo se apoyan sobre el doblez.
 *  - Con la tela abierta, las piezas que van de a pares se cortan una y su
 *    espejo, y las que van al lomo se despliegan enteras.
 */

import { lineaDeCorte } from '../nucleo/costura';
import { acomodar, type Forma } from '../nucleo/encimado';
import { area, cajaDePuntos, muestrear, unirCajas, type Caja } from '../nucleo/geometria';
import { piezaEnTalle } from '../nucleo/progresion';
import type { Pieza, Proyecto, Punto } from '../nucleo/tipos';
import {
  cajaDeTrazos,
  mapearTrazos,
  trazosDePieza,
  type Trazo,
} from './dibujo';

export interface OpcionesTizada {
  /** Ancho del rollo de tela, en mm. */
  anchoTelaMm: number;
  /** true = tela doblada al medio (lo habitual para coser en casa). */
  doblada: boolean;
  separacionMm: number;
  margenMm: number;
  /** talleId -> cuantas prendas de ese talle se van a cortar. */
  prendasPorTalle: Record<string, number>;
  incluirCostura: boolean;
  /** Permitir dar vuelta las piezas 180 grados para que encastren mejor. */
  girar180: boolean;
}

export interface PiezaEnTizada {
  etiqueta: string;
  trazos: Trazo[];
  caja: Caja;
  alDoblez: boolean;
}

export interface ResultadoTizada {
  piezas: PiezaEnTizada[];
  anchoTelaMm: number;
  /** Ancho realmente utilizable: la mitad si la tela va doblada. */
  anchoUtilMm: number;
  doblada: boolean;
  largoMm: number;
  /** Proporcion del rectangulo de tela que ocupan las piezas, de 0 a 1. */
  aprovechamiento: number;
  /** Nombres de las piezas que no entran a lo ancho de la tela. */
  sinLugar: string[];
  total: number;
}

export function opcionesTizadaPorDefecto(proyecto: Proyecto): OpcionesTizada {
  return {
    anchoTelaMm: 1400,
    doblada: true,
    separacionMm: 10,
    margenMm: 10,
    prendasPorTalle: { [proyecto.talleBaseId]: 1 },
    incluirCostura: true,
    girar180: true,
  };
}

const espejarEn = (eje: number) => (p: Punto) => ({ x: 2 * eje - p.x, y: p.y });
const negarX = (p: Punto) => ({ x: -p.x, y: p.y });

/** Contorno por donde se corta: el margen de costura si lo hay, si no el trazo. */
function contornoDeCorte(pieza: Pieza, incluirCostura: boolean): Punto[] {
  if (incluirCostura && pieza.costuraMm !== 0) {
    const corte = lineaDeCorte(pieza);
    if (corte && corte.length > 2) return corte;
  }
  return muestrear(pieza.contorno, 2);
}

/**
 * De que lado queda el doblez en una pieza que se corta al lomo.
 * Se usa el eje fijo de la progresion, que en una pieza al lomo es justamente
 * el centro de la prenda.
 */
function doblezALaIzquierda(pieza: Pieza, caja: Caja): boolean {
  const eje = pieza.progresion.ejeX;
  return Math.abs(eje - caja.x) <= Math.abs(eje - (caja.x + caja.ancho));
}

interface Instancia {
  id: string;
  etiqueta: string;
  trazos: Trazo[];
  poligonos: Punto[][];
  alDoblez: boolean;
}

function armarInstancias(proyecto: Proyecto, op: OpcionesTizada): Instancia[] {
  const instancias: Instancia[] = [];
  const opDibujo = {
    incluirCostura: op.incluirCostura,
    incluirInternas: true,
    incluirHilo: true,
    incluirEtiquetas: false,
  };

  for (const talle of proyecto.talles) {
    const prendas = Math.max(0, Math.round(op.prendasPorTalle[talle.id] ?? 0));
    if (prendas === 0) continue;

    for (const pieza of proyecto.piezas) {
      if (!pieza.incluirEnExport || pieza.contorno.nodos.length < 3) continue;
      const progresada = piezaEnTalle(pieza, proyecto, talle.id);
      let trazos = trazosDePieza(progresada, opDibujo, talle.nombre);
      let corte = contornoDeCorte(progresada, op.incluirCostura);
      const caja = cajaDePuntos(corte);
      const etiqueta = `${pieza.nombre} - ${talle.nombre}`;

      if (op.doblada) {
        if (pieza.alLomo) {
          // El doblez tiene que quedar a la izquierda, contra el borde de la tela.
          if (!doblezALaIzquierda(progresada, caja)) {
            trazos = mapearTrazos(trazos, negarX);
            corte = corte.map(negarX);
          }
          for (let i = 0; i < prendas; i++) {
            instancias.push({ id: `${pieza.id}:${talle.id}:${i}`, etiqueta, trazos, poligonos: [corte], alDoblez: true });
          }
        } else {
          // Con la tela doblada cada corte da dos piezas.
          const veces = Math.ceil(pieza.cantidad / 2) * prendas;
          for (let i = 0; i < veces; i++) {
            instancias.push({ id: `${pieza.id}:${talle.id}:${i}`, etiqueta, trazos, poligonos: [corte], alDoblez: false });
          }
        }
        continue;
      }

      // Tela abierta.
      if (pieza.alLomo) {
        // Se despliega: la pieza entera es el trazo mas su espejo.
        const eje = progresada.progresion.ejeX;
        const espejo = espejarEn(eje);
        const trazosEnteros = [...trazos, ...mapearTrazos(trazos, espejo)];
        const poligonos = [corte, corte.map(espejo)];
        for (let i = 0; i < pieza.cantidad * prendas; i++) {
          instancias.push({ id: `${pieza.id}:${talle.id}:${i}`, etiqueta, trazos: trazosEnteros, poligonos, alDoblez: false });
        }
      } else {
        const veces = pieza.cantidad * prendas;
        for (let i = 0; i < veces; i++) {
          // Las piezas que van de a pares se cortan una y su espejo.
          const espejada = pieza.cantidad > 1 && i % 2 === 1;
          instancias.push({
            id: `${pieza.id}:${talle.id}:${i}`,
            etiqueta,
            trazos: espejada ? mapearTrazos(trazos, negarX) : trazos,
            poligonos: [espejada ? corte.map(negarX) : corte],
            alDoblez: false,
          });
        }
      }
    }
  }
  return instancias;
}

export function armarTizada(proyecto: Proyecto, op: OpcionesTizada): ResultadoTizada {
  const anchoUtil = op.doblada ? op.anchoTelaMm / 2 : op.anchoTelaMm;
  const instancias = armarInstancias(proyecto, op);
  const porId = new Map(instancias.map((i) => [i.id, i]));

  const formas: Forma[] = instancias.map((i) => ({
    id: i.id,
    poligonos: i.poligonos,
    alDoblez: i.alDoblez,
    giros: op.girar180 && !i.alDoblez ? [0, 180] : [0],
  }));

  const r = acomodar(formas, {
    anchoMm: anchoUtil,
    separacionMm: op.separacionMm,
    margenMm: op.margenMm,
    celdaMm: 4,
  });

  const piezas: PiezaEnTizada[] = [];
  let areaUsada = 0;
  for (const u of r.ubicaciones) {
    const inst = porId.get(u.id);
    if (!inst) continue;
    const mover = (p: Punto): Punto =>
      u.giro === 180 ? { x: -p.x + u.dx, y: -p.y + u.dy } : { x: p.x + u.dx, y: p.y + u.dy };
    const trazos = mapearTrazos(inst.trazos, mover);
    let caja: Caja | null = null;
    for (const poli of inst.poligonos) {
      const movido = poli.map(mover);
      areaUsada += area(movido);
      caja = unirCajas(caja, cajaDePuntos(movido));
    }
    piezas.push({
      etiqueta: inst.etiqueta,
      trazos,
      caja: caja ?? cajaDeTrazos(trazos),
      alDoblez: inst.alDoblez,
    });
  }

  const superficie = anchoUtil * r.largoMm;
  return {
    piezas,
    anchoTelaMm: op.anchoTelaMm,
    anchoUtilMm: anchoUtil,
    doblada: op.doblada,
    largoMm: r.largoMm,
    aprovechamiento: superficie > 0 ? areaUsada / superficie : 0,
    sinLugar: [...new Set(r.sinLugar.map((id) => porId.get(id)?.etiqueta ?? id))],
    total: instancias.length,
  };
}

/** Cuantas prendas se van a cortar, en texto: "Talle 42 x1, Talle 44 x2". */
export function resumenPrendas(proyecto: Proyecto, op: OpcionesTizada): string {
  const partes = proyecto.talles
    .filter((t) => (op.prendasPorTalle[t.id] ?? 0) > 0)
    .map((t) => `Talle ${t.nombre} x${op.prendasPorTalle[t.id]}`);
  return partes.join(', ') || 'ningun talle elegido';
}
