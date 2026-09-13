/**
 * Editor grafico: la mesa de trabajo donde se ve la foto, se traza el molde,
 * se mueven los nodos y se marcan los ejes de progresion.
 *
 * Todo el dibujo se hace en milimetros y se convierte a pixeles con
 * `aPantalla`. La vista guarda escala (px por mm) y desplazamiento.
 */

import { lineaDeCorte, marcasDePiquete } from '../nucleo/costura';
import {
  cajaDePuntos,
  controles,
  distancia,
  esRecta,
  largoSegmento,
  muestrear,
  puntoMasCercanoEnSegmento,
  segmentos,
  unirCajas,
  type Caja,
} from '../nucleo/geometria';
import { rectificar, type Esquinas } from '../nucleo/homografia';
import { cargarImagen, comprimir } from '../nucleo/imagen';
import { piezaEnTalle } from '../nucleo/progresion';
import { nuevaLineaInterna, nuevoNodo, suavizar } from '../nucleo/proyecto';
import type { Contorno, Nodo, Pieza, Punto } from '../nucleo/tipos';
import { pedirTexto, pedirVarios } from './dialogos';
import {
  actualizar,
  avisarMensaje,
  cerrarFusion,
  editar,
  estado,
  piezaActual,
  suscribir,
} from './estado';
import { leerCm, mmACm } from './formato';

const TOL = 9; // tolerancia de click, en pixeles

const COLOR = {
  fondo: '#f4f1ec',
  grillaFina: '#e2ddd4',
  grillaGruesa: '#cfc7b8',
  contorno: '#1d1d1b',
  relleno: 'rgba(196, 132, 74, 0.10)',
  costura: '#b0752f',
  nodo: '#ffffff',
  nodoBorde: '#1d1d1b',
  nodoSel: '#c2410c',
  manija: '#3b82f6',
  hilo: '#0f766e',
  pinza: '#7c3aed',
  doblez: '#0369a1',
  referencia: '#94a3b8',
  interna: '#334155',
  eje: '#dc2626',
  borde: '#2563eb',
  regla: '#059669',
  nido: '#9ca3af',
  herramienta: '#dc2626',
} as const;

type Objetivo =
  | { tipo: 'nodo'; nodoId: string }
  | { tipo: 'manija'; nodoId: string; cual: 'ent' | 'sal' }
  | { tipo: 'internaNodo'; lineaId: string; nodoId: string }
  | { tipo: 'ejeX' }
  | { tipo: 'bordeX' }
  | { tipo: 'ejeY' }
  | { tipo: 'reglaAncho'; id: string }
  | { tipo: 'reglaLargo'; id: string }
  | { tipo: 'hilo'; extremo: 'a' | 'b' }
  | { tipo: 'foto' };

interface Arrastre {
  objetivo: Objetivo | 'vista' | 'marco' | 'herramienta';
  inicioMundo: Punto;
  inicioPantalla: Punto;
  inicioVista: { x: number; y: number };
  /** Posicion del puntero en el paso anterior, para mover por diferencias. */
  previoMundo: Punto;
  actualMundo: Punto;
  movio: boolean;
  /** true cuando se arrastra una manija sin espejar la del otro lado. */
  romperSimetria: boolean;
}

let lienzo: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let contenedor: HTMLElement;
let desuscribir: (() => void) | null = null;

let arrastre: Arrastre | null = null;
let trazoEnCurso: Nodo[] = [];
let cerrandoTrazo = false;
let puntosHerramienta: Punto[] = [];
let medicion: { a: Punto; b: Punto } | null = null;
let cursorMundo: Punto | null = null;
let segmentoResaltado: { indice: number; largo: number } | null = null;
let barraEspacio = false;

const cacheImagenes = new Map<string, HTMLImageElement>();

// ---------------------------------------------------------------------------
// Transformaciones
// ---------------------------------------------------------------------------

function aPantalla(p: Punto): Punto {
  return { x: p.x * estado.vista.escala + estado.vista.x, y: p.y * estado.vista.escala + estado.vista.y };
}

function aMundo(x: number, y: number): Punto {
  return { x: (x - estado.vista.x) / estado.vista.escala, y: (y - estado.vista.y) / estado.vista.escala };
}

function eventoAMundo(e: PointerEvent | MouseEvent | WheelEvent): Punto {
  const r = lienzo.getBoundingClientRect();
  return aMundo(e.clientX - r.left, e.clientY - r.top);
}

function eventoAPantalla(e: PointerEvent | MouseEvent): Punto {
  const r = lienzo.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/** Pieza que se esta mostrando: la base o una progresada a otro talle. */
function piezaMostrada(): { pieza: Pieza | null; editable: boolean } {
  const base = piezaActual();
  if (!base || !estado.proyecto) return { pieza: null, editable: false };
  const talle = estado.talleVista;
  if (!talle || talle === estado.proyecto.talleBaseId) return { pieza: base, editable: true };
  return { pieza: piezaEnTalle(base, estado.proyecto, talle), editable: false };
}

/**
 * Solo se puede editar el talle base: los demas son el resultado de la
 * progresion y cambiarlos a mano perderia la relacion con la tabla.
 */
function puedeEditar(): boolean {
  return piezaMostrada().editable;
}

function conPieza(fn: (pz: Pieza) => void, fusionar?: string): void {
  const id = estado.piezaId;
  if (!id) return;
  editar((p) => {
    const pz = p.piezas.find((x) => x.id === id);
    if (pz) fn(pz);
  }, fusionar ? { fusionar } : {});
}

function imagen(datos: string): HTMLImageElement | null {
  let img = cacheImagenes.get(datos);
  if (!img) {
    img = new Image();
    img.addEventListener('load', () => render());
    img.src = datos;
    cacheImagenes.set(datos, img);
    if (cacheImagenes.size > 8) cacheImagenes.delete(cacheImagenes.keys().next().value as string);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function ajustarTamano(): void {
  const dpr = window.devicePixelRatio || 1;
  const ancho = contenedor.clientWidth;
  const alto = contenedor.clientHeight;
  if (lienzo.width !== Math.round(ancho * dpr) || lienzo.height !== Math.round(alto * dpr)) {
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    lienzo.style.width = `${ancho}px`;
    lienzo.style.height = `${alto}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function dibujarGrilla(ancho: number, alto: number): void {
  if (!estado.mostrarGrilla) return;
  const e = estado.vista.escala;
  const inicio = aMundo(0, 0);
  const fin = aMundo(ancho, alto);

  const trazarLineas = (pasoMm: number, color: string, grosor: number) => {
    if (pasoMm * e < 6) return;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = grosor;
    const x0 = Math.floor(inicio.x / pasoMm) * pasoMm;
    for (let x = x0; x <= fin.x; x += pasoMm) {
      const px = Math.round(aPantalla({ x, y: 0 }).x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, alto);
    }
    const y0 = Math.floor(inicio.y / pasoMm) * pasoMm;
    for (let y = y0; y <= fin.y; y += pasoMm) {
      const py = Math.round(aPantalla({ x: 0, y }).y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(ancho, py);
    }
    ctx.stroke();
  };

  trazarLineas(10, COLOR.grillaFina, 1);
  trazarLineas(100, COLOR.grillaGruesa, 1);
}

function dibujarFoto(pieza: Pieza): void {
  const foto = pieza.foto;
  if (!foto || !foto.visible || !estado.mostrarFoto) return;
  const img = imagen(foto.datos);
  if (!img) return;
  const p0 = aPantalla(foto.offset);
  const ancho = foto.anchoPx * foto.mmPorPx * estado.vista.escala;
  const alto = foto.altoPx * foto.mmPorPx * estado.vista.escala;
  ctx.save();
  ctx.globalAlpha = foto.opacidad;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, p0.x, p0.y, ancho, alto);
  ctx.restore();
}

function camino(c: Contorno): void {
  if (c.nodos.length === 0) return;
  const p0 = aPantalla(c.nodos[0].p);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (const [a, b] of segmentos(c)) {
    if (esRecta(a, b)) {
      const q = aPantalla(b.p);
      ctx.lineTo(q.x, q.y);
    } else {
      const [, c1, c2, p3] = controles(a, b);
      const s1 = aPantalla(c1);
      const s2 = aPantalla(c2);
      const s3 = aPantalla(p3);
      ctx.bezierCurveTo(s1.x, s1.y, s2.x, s2.y, s3.x, s3.y);
    }
  }
  if (c.cerrado) ctx.closePath();
}

function caminoPuntos(pts: Punto[], cerrado: boolean): void {
  if (pts.length === 0) return;
  const p0 = aPantalla(pts[0]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const q = aPantalla(pts[i]);
    ctx.lineTo(q.x, q.y);
  }
  if (cerrado) ctx.closePath();
}

function dibujarPieza(pieza: Pieza, opciones: { fantasma?: boolean; etiqueta?: string } = {}): void {
  const fantasma = opciones.fantasma ?? false;

  if (!fantasma && estado.mostrarCostura && pieza.costuraMm !== 0) {
    const corte = lineaDeCorte(pieza);
    if (corte && corte.length > 2) {
      caminoPuntos(corte, pieza.contorno.cerrado);
      ctx.strokeStyle = COLOR.costura;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (pieza.contorno.nodos.length >= 2) {
    camino(pieza.contorno);
    if (!fantasma && pieza.contorno.cerrado) {
      ctx.fillStyle = COLOR.relleno;
      ctx.fill();
    }
    ctx.strokeStyle = fantasma ? COLOR.nido : COLOR.contorno;
    ctx.lineWidth = fantasma ? 1.2 : 2;
    ctx.stroke();
  }

  for (const linea of pieza.internas) {
    if (linea.contorno.nodos.length < 2) continue;
    camino(linea.contorno);
    ctx.strokeStyle = fantasma
      ? COLOR.nido
      : linea.tipo === 'pinza'
        ? COLOR.pinza
        : linea.tipo === 'doblez'
          ? COLOR.doblez
          : linea.tipo === 'referencia'
            ? COLOR.referencia
            : COLOR.interna;
    ctx.lineWidth = fantasma ? 1 : 1.6;
    ctx.setLineDash(linea.tipo === 'referencia' ? [4, 4] : linea.tipo === 'doblez' ? [12, 4, 3, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const m of marcasDePiquete(pieza)) {
    const a = aPantalla(m.a);
    const b = aPantalla(m.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = fantasma ? COLOR.nido : COLOR.contorno;
    ctx.lineWidth = fantasma ? 1 : 1.8;
    ctx.stroke();
  }

  if (pieza.hilo) {
    const a = aPantalla(pieza.hilo.a);
    const b = aPantalla(pieza.hilo.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = fantasma ? COLOR.nido : COLOR.hilo;
    ctx.lineWidth = fantasma ? 1 : 2;
    ctx.stroke();
    if (!fantasma) {
      dibujarPuntaFlecha(a, b);
      dibujarPuntaFlecha(b, a);
    }
  }

  if (opciones.etiqueta && pieza.contorno.nodos.length > 0) {
    const caja = cajaDePuntos(muestrear(pieza.contorno, 2));
    const p = aPantalla({ x: caja.x + caja.ancho, y: caja.y });
    ctx.fillStyle = COLOR.nido;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(opciones.etiqueta, p.x + 4, p.y);
  }
}

function dibujarPuntaFlecha(punta: Punto, desde: Punto): void {
  const dx = punta.x - desde.x;
  const dy = punta.y - desde.y;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const largo = 10;
  const ancho = 4;
  ctx.beginPath();
  ctx.moveTo(punta.x, punta.y);
  ctx.lineTo(punta.x - ux * largo - uy * ancho, punta.y - uy * largo + ux * ancho);
  ctx.lineTo(punta.x - ux * largo + uy * ancho, punta.y - uy * largo - ux * ancho);
  ctx.closePath();
  ctx.fillStyle = COLOR.hilo;
  ctx.fill();
}

function dibujarNodos(pieza: Pieza): void {
  const sel = new Set(estado.seleccion);

  // Manijas de los nodos seleccionados.
  for (const n of pieza.contorno.nodos) {
    if (!sel.has(n.id)) continue;
    const p = aPantalla(n.p);
    for (const cual of ['ent', 'sal'] as const) {
      const m = n[cual];
      if (Math.abs(m.x) < 1e-9 && Math.abs(m.y) < 1e-9) continue;
      const q = aPantalla({ x: n.p.x + m.x, y: n.p.y + m.y });
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = COLOR.manija;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.manija;
      ctx.fill();
    }
  }

  for (const n of pieza.contorno.nodos) {
    const p = aPantalla(n.p);
    const seleccionado = sel.has(n.id);
    const r = seleccionado ? 5 : 4;
    ctx.beginPath();
    if (n.piquete) {
      ctx.arc(p.x, p.y, r + 1, 0, Math.PI * 2);
    } else {
      ctx.rect(p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.fillStyle = seleccionado ? COLOR.nodoSel : COLOR.nodo;
    ctx.fill();
    ctx.strokeStyle = n.fijo ? COLOR.eje : COLOR.nodoBorde;
    ctx.lineWidth = n.fijo ? 2 : 1.4;
    ctx.stroke();
  }

  for (const linea of pieza.internas) {
    for (const n of linea.contorno.nodos) {
      const p = aPantalla(n.p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = estado.seleccion.includes(n.id) ? COLOR.nodoSel : '#fff';
      ctx.fill();
      ctx.strokeStyle = COLOR.interna;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
}

function dibujarEjes(pieza: Pieza, ancho: number, alto: number): void {
  if (!estado.mostrarEjes) return;
  const pr = pieza.progresion;

  const lineaVertical = (x: number, color: string, etiqueta: string) => {
    const px = Math.round(aPantalla({ x, y: 0 }).x) + 0.5;
    if (px < -50 || px > ancho + 50) return;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, alto);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText(etiqueta, px + 5, 14);
  };

  const lineaHorizontal = (y: number, color: string, etiqueta: string, aLaDerecha = false) => {
    const py = Math.round(aPantalla({ x: 0, y }).y) + 0.5;
    if (py < -50 || py > alto + 50) return;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(ancho, py);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '600 10px system-ui, sans-serif';
    if (aLaDerecha) {
      ctx.textAlign = 'right';
      ctx.fillText(etiqueta, ancho - 14, py - 4);
      ctx.textAlign = 'start';
    } else {
      ctx.fillText(etiqueta, 6, py - 4);
    }
  };

  lineaVertical(pr.ejeX, COLOR.eje, 'eje fijo (no crece)');
  lineaVertical(pr.bordeX, COLOR.borde, 'borde (crece todo)');
  lineaHorizontal(pr.ejeY, COLOR.eje, 'altura fija (no crece)', true);

  for (const r of pr.anchos) lineaHorizontal(r.y, COLOR.regla, `ancho: ${r.nombre}`);
  for (const r of pr.largos) lineaHorizontal(r.y, '#b45309', `largo: ${r.nombre}`);
}

function dibujarNido(): void {
  if (!estado.mostrarNido || !estado.proyecto) return;
  const base = piezaActual();
  if (!base) return;
  for (const t of estado.proyecto.talles) {
    if (t.id === estado.proyecto.talleBaseId) continue;
    dibujarPieza(piezaEnTalle(base, estado.proyecto, t.id), { fantasma: true, etiqueta: t.nombre });
  }
}

function dibujarHerramienta(): void {
  ctx.save();
  ctx.strokeStyle = COLOR.herramienta;
  ctx.fillStyle = COLOR.herramienta;
  ctx.lineWidth = 2;

  if (trazoEnCurso.length > 0) {
    const contorno: Contorno = { nodos: trazoEnCurso, cerrado: false };
    camino(contorno);
    ctx.stroke();
    if (cursorMundo) {
      const ultimo = aPantalla(trazoEnCurso[trazoEnCurso.length - 1].p);
      const c = aPantalla(cursorMundo);
      ctx.beginPath();
      ctx.moveTo(ultimo.x, ultimo.y);
      ctx.lineTo(c.x, c.y);
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    for (const n of trazoEnCurso) {
      const p = aPantalla(n.p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (cerrandoTrazo && trazoEnCurso.length > 2) {
      const p = aPantalla(trazoEnCurso[0].p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (const [i, p] of puntosHerramienta.entries()) {
    const q = aPantalla(p);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText(String(i + 1), q.x + 9, q.y - 6);
  }
  if (puntosHerramienta.length > 1) {
    caminoPuntos(puntosHerramienta, estado.herramienta === 'perspectiva' && puntosHerramienta.length === 4);
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (medicion) {
    const a = aPantalla(medicion.a);
    const b = aPantalla(medicion.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const d = distancia(medicion.a, medicion.b);
    etiquetaFlotante(`${mmACm(d)} cm`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 12);
  }

  if (arrastre?.objetivo === 'marco') {
    const a = aPantalla(arrastre.inicioMundo);
    const b = aPantalla(arrastre.actualMundo);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.nodoSel;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function etiquetaFlotante(texto: string, x: number, y: number): void {
  ctx.save();
  ctx.font = '600 12px system-ui, sans-serif';
  const ancho = ctx.measureText(texto).width + 12;
  ctx.fillStyle = 'rgba(29,29,27,0.88)';
  ctx.beginPath();
  ctx.roundRect(x - ancho / 2, y - 20, ancho, 20, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(texto, x, y - 6);
  ctx.restore();
}

function dibujarEscala(ancho: number, alto: number): void {
  const e = estado.vista.escala;
  const candidatos = [10, 20, 50, 100, 200, 500, 1000];
  const mm = candidatos.find((c) => c * e > 70) ?? 1000;
  const px = mm * e;
  const x = ancho - px - 24;
  const y = alto - 24;
  ctx.save();
  ctx.strokeStyle = '#1d1d1b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - 5);
  ctx.lineTo(x, y);
  ctx.lineTo(x + px, y);
  ctx.lineTo(x + px, y - 5);
  ctx.stroke();
  ctx.fillStyle = '#1d1d1b';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${mm / 10} cm`, x + px / 2, y - 8);
  ctx.restore();
}

function dibujarVacio(ancho: number, alto: number): void {
  ctx.fillStyle = '#8a8578';
  ctx.font = '500 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Crea una pieza para empezar (panel de la izquierda)', ancho / 2, alto / 2);
  ctx.textAlign = 'start';
}

export function render(): void {
  if (!lienzo) return;
  ajustarTamano();
  const ancho = contenedor.clientWidth;
  const alto = contenedor.clientHeight;

  ctx.fillStyle = COLOR.fondo;
  ctx.fillRect(0, 0, ancho, alto);
  dibujarGrilla(ancho, alto);

  const { pieza, editable } = piezaMostrada();
  if (!pieza) {
    dibujarVacio(ancho, alto);
    return;
  }

  dibujarFoto(pieza);
  dibujarNido();
  dibujarPieza(pieza);
  dibujarEjes(pieza, ancho, alto);
  if (editable) dibujarNodos(pieza);
  dibujarHerramienta();

  if (segmentoResaltado && cursorMundo) {
    const p = aPantalla(cursorMundo);
    etiquetaFlotante(`${mmACm(segmentoResaltado.largo)} cm`, p.x, p.y - 6);
  }

  dibujarEscala(ancho, alto);
}

// ---------------------------------------------------------------------------
// Deteccion de lo que hay abajo del cursor
// ---------------------------------------------------------------------------

function cercaEnPantalla(a: Punto, m: Punto): boolean {
  const pa = aPantalla(a);
  const pm = aPantalla(m);
  return Math.hypot(pa.x - pm.x, pa.y - pm.y) <= TOL;
}

function buscarObjetivo(m: Punto): Objetivo | null {
  const pieza = piezaActual();
  if (!pieza) return null;
  const sel = new Set(estado.seleccion);

  for (const n of pieza.contorno.nodos) {
    if (!sel.has(n.id)) continue;
    for (const cual of ['ent', 'sal'] as const) {
      const h = n[cual];
      if (Math.abs(h.x) < 1e-9 && Math.abs(h.y) < 1e-9) continue;
      if (cercaEnPantalla({ x: n.p.x + h.x, y: n.p.y + h.y }, m)) return { tipo: 'manija', nodoId: n.id, cual };
    }
  }
  for (const n of pieza.contorno.nodos) if (cercaEnPantalla(n.p, m)) return { tipo: 'nodo', nodoId: n.id };
  for (const l of pieza.internas) {
    for (const n of l.contorno.nodos) {
      if (cercaEnPantalla(n.p, m)) return { tipo: 'internaNodo', lineaId: l.id, nodoId: n.id };
    }
  }
  if (pieza.hilo) {
    if (cercaEnPantalla(pieza.hilo.a, m)) return { tipo: 'hilo', extremo: 'a' };
    if (cercaEnPantalla(pieza.hilo.b, m)) return { tipo: 'hilo', extremo: 'b' };
  }

  if (estado.mostrarEjes) {
    const tolMm = TOL / estado.vista.escala;
    const pr = pieza.progresion;
    for (const r of pr.anchos) if (Math.abs(m.y - r.y) < tolMm) return { tipo: 'reglaAncho', id: r.id };
    for (const r of pr.largos) if (Math.abs(m.y - r.y) < tolMm) return { tipo: 'reglaLargo', id: r.id };
    if (Math.abs(m.y - pr.ejeY) < tolMm) return { tipo: 'ejeY' };
    if (Math.abs(m.x - pr.ejeX) < tolMm) return { tipo: 'ejeX' };
    if (Math.abs(m.x - pr.bordeX) < tolMm) return { tipo: 'bordeX' };
  }
  return null;
}

/** Segmento del contorno mas cercano al cursor, para insertar nodos o medir. */
function segmentoCercano(m: Punto): { indice: number; t: number; punto: Punto; largo: number } | null {
  const pieza = piezaActual();
  if (!pieza) return null;
  const tolMm = (TOL + 4) / estado.vista.escala;
  let mejor: { indice: number; t: number; punto: Punto; largo: number } | null = null;
  let mejorD = Infinity;
  segmentos(pieza.contorno).forEach(([a, b], i) => {
    const pasos = esRecta(a, b) ? 1 : 20;
    const [p0, p1, p2, p3] = controles(a, b);
    let prev = p0;
    for (let k = 1; k <= pasos; k++) {
      const t = k / pasos;
      const u = 1 - t;
      const q =
        pasos === 1
          ? p3
          : {
              x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
              y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
            };
      const cerca = puntoMasCercanoEnSegmento(m, prev, q);
      const d = distancia(m, cerca.punto);
      if (d < mejorD) {
        mejorD = d;
        mejor = { indice: i, t: (k - 1 + cerca.t) / pasos, punto: cerca.punto, largo: largoSegmento(a, b) };
      }
      prev = q;
    }
  });
  return mejorD <= tolMm ? mejor : null;
}

// ---------------------------------------------------------------------------
// Herramientas
// ---------------------------------------------------------------------------

function terminarTrazo(cerrado: boolean): void {
  if (trazoEnCurso.length < 2) {
    trazoEnCurso = [];
    render();
    return;
  }
  const nodos = trazoEnCurso;
  trazoEnCurso = [];
  cerrandoTrazo = false;
  if (estado.herramienta === 'interna') {
    const linea = nuevaLineaInterna(estado.tipoInterna, nodos.map((n) => n.p));
    linea.contorno = { nodos, cerrado };
    conPieza((pz) => {
      pz.internas.push(linea);
    });
  } else {
    conPieza((pz) => {
      pz.contorno = { nodos, cerrado };
    });
    actualizar({ herramienta: 'seleccionar' });
  }
  render();
}

async function aplicarCalibracion(a: Punto, b: Punto): Promise<void> {
  const pieza = piezaActual();
  if (!pieza?.foto) {
    avisarMensaje('Primero carga una foto en la pieza', 'error');
    return;
  }
  const actual = distancia(a, b);
  if (actual < 1e-6) return;
  const texto = await pedirTexto({
    titulo: 'Calibrar la escala',
    descripcion: 'Cuanto mide en la realidad la linea que acabas de marcar?',
    etiqueta: 'Medida real',
    valor: mmACm(actual),
    sufijo: 'cm',
  });
  const cm = texto === null ? null : leerCm(texto);
  if (cm === null || cm <= 0) return;
  const factor = (cm * 10) / actual;
  conPieza((pz) => {
    if (!pz.foto) return;
    pz.foto.mmPorPx *= factor;
    pz.foto.calibrada = true;
    // Dejamos el punto A quieto para que la foto no se escape de la pantalla.
    pz.foto.offset = {
      x: a.x - (a.x - pz.foto.offset.x) * factor,
      y: a.y - (a.y - pz.foto.offset.y) * factor,
    };
  });
  avisarMensaje(`Escala calibrada: la foto ahora mide ${mmACm(cm * 10)} cm en esa linea`, 'ok');
  actualizar({ herramienta: 'seleccionar' });
}

async function aplicarPerspectiva(esquinasMundo: Punto[]): Promise<void> {
  const pieza = piezaActual();
  if (!pieza?.foto) return;
  const foto = pieza.foto;
  const img = imagen(foto.datos);
  if (!img) {
    avisarMensaje('Espera a que termine de cargar la foto', 'error');
    return;
  }
  const respuesta = await pedirVarios(
    'Enderezar la foto',
    'Cuanto mide en la realidad el rectangulo que marcaste? (una hoja A4 mide 21 x 29,7 cm)',
    [
      { clave: 'ancho', etiqueta: 'Ancho real', valor: '21', sufijo: 'cm' },
      { clave: 'alto', etiqueta: 'Alto real', valor: '29,7', sufijo: 'cm' },
    ],
  );
  if (!respuesta) return;
  const anchoCm = leerCm(respuesta.ancho);
  const altoCm = leerCm(respuesta.alto);
  if (!anchoCm || !altoCm || anchoCm <= 0 || altoCm <= 0) {
    avisarMensaje('Las medidas no son validas', 'error');
    return;
  }

  const aPx = (p: Punto): Punto => ({
    x: (p.x - foto.offset.x) / foto.mmPorPx,
    y: (p.y - foto.offset.y) / foto.mmPorPx,
  });
  const esquinasPx = esquinasMundo.map(aPx) as Esquinas;

  try {
    const rect = rectificar(img, esquinasPx, anchoCm * 10, altoCm * 10);
    const { dataUrl, ancho, alto } = comprimir(rect.lienzo, 2400, 0.9);
    const origen = esquinasMundo[0];
    conPieza((pz) => {
      if (!pz.foto) return;
      pz.foto.original = pz.foto.original ?? pz.foto.datos;
      pz.foto.datos = dataUrl;
      pz.foto.anchoPx = ancho;
      pz.foto.altoPx = alto;
      pz.foto.mmPorPx = rect.anchoMm / ancho;
      pz.foto.calibrada = true;
      // La imagen enderezada arranca antes de la esquina que se marco primero.
      pz.foto.offset = { x: origen.x + rect.offsetMm.x, y: origen.y + rect.offsetMm.y };
    });
    ajustarVista();
    avisarMensaje('Foto enderezada y con la escala puesta. Ya podes trazar.', 'ok');
    actualizar({ herramienta: 'seleccionar' });
  } catch (e) {
    avisarMensaje(e instanceof Error ? e.message : 'No se pudo enderezar la foto', 'error');
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

function nuevoArrastre(
  objetivo: Arrastre['objetivo'],
  m: Punto,
  pantalla: Punto,
  romperSimetria = false,
): Arrastre {
  return {
    objetivo,
    inicioMundo: m,
    inicioPantalla: pantalla,
    inicioVista: { x: estado.vista.x, y: estado.vista.y },
    previoMundo: { ...m },
    actualMundo: { ...m },
    movio: false,
    romperSimetria,
  };
}

function alBajarPuntero(e: PointerEvent): void {
  lienzo.setPointerCapture(e.pointerId);
  const m = eventoAMundo(e);
  const pantalla = eventoAPantalla(e);
  cursorMundo = m;

  const quiereVista = e.button === 1 || barraEspacio || e.button === 2;
  if (quiereVista) {
    arrastre = nuevoArrastre('vista', m, pantalla);
    return;
  }
  if (e.button !== 0) return;

  if (!puedeEditar() && estado.herramienta !== 'medir') {
    avisarMensaje('Estas viendo un talle progresado. Volve al talle base para editar.', 'info');
    return;
  }

  switch (estado.herramienta) {
    case 'trazar':
    case 'interna': {
      if (trazoEnCurso.length > 2 && cercaEnPantalla(trazoEnCurso[0].p, m)) {
        terminarTrazo(true);
        return;
      }
      trazoEnCurso.push(nuevoNodo(m));
      arrastre = nuevoArrastre('herramienta', m, pantalla);
      render();
      return;
    }
    case 'calibrar':
    case 'medir': {
      puntosHerramienta = [m];
      arrastre = nuevoArrastre('herramienta', m, pantalla);
      return;
    }
    case 'perspectiva': {
      puntosHerramienta.push(m);
      if (puntosHerramienta.length === 4) {
        const esquinas = puntosHerramienta.slice();
        puntosHerramienta = [];
        void aplicarPerspectiva(esquinas);
      }
      render();
      return;
    }
    case 'piquete': {
      const objetivo = buscarObjetivo(m);
      if (objetivo?.tipo === 'nodo') {
        conPieza((pz) => {
          const n = pz.contorno.nodos.find((x) => x.id === objetivo.nodoId);
          if (n) n.piquete = !n.piquete;
        });
      } else {
        const seg = segmentoCercano(m);
        if (seg) insertarNodo(seg.indice, seg.punto, true);
        else avisarMensaje('Hace click sobre el contorno para poner un piquete', 'info');
      }
      return;
    }
    case 'hilo': {
      conPieza((pz) => {
        pz.hilo = { a: { ...m }, b: { x: m.x, y: m.y + 100 } };
      });
      actualizar({ herramienta: 'seleccionar' });
      avisarMensaje('Linea de hilo puesta. Arrastra las puntas para orientarla.', 'ok');
      return;
    }
    default:
      break;
  }

  // Herramienta seleccionar.
  const objetivo = buscarObjetivo(m);
  if (objetivo) {
    if (objetivo.tipo === 'nodo') {
      if (e.altKey) {
        alternarCurva(objetivo.nodoId);
        return;
      }
      const yaEsta = estado.seleccion.includes(objetivo.nodoId);
      const seleccion = e.shiftKey
        ? yaEsta
          ? estado.seleccion.filter((id) => id !== objetivo.nodoId)
          : [...estado.seleccion, objetivo.nodoId]
        : yaEsta
          ? estado.seleccion
          : [objetivo.nodoId];
      actualizar({ seleccion });
    } else if (objetivo.tipo === 'internaNodo') {
      actualizar({ seleccion: [objetivo.nodoId] });
    }
    arrastre = nuevoArrastre(objetivo, m, pantalla, e.altKey);
    return;
  }

  // Alt + arrastrar sobre el fondo mueve la foto de referencia.
  if (e.altKey && piezaActual()?.foto) {
    arrastre = nuevoArrastre({ tipo: 'foto' }, m, pantalla);
    return;
  }

  arrastre = nuevoArrastre('marco', m, pantalla);
  if (!e.shiftKey) actualizar({ seleccion: [] });
}

function alMoverPuntero(e: PointerEvent): void {
  const m = eventoAMundo(e);
  cursorMundo = m;

  if (!arrastre) {
    if (estado.herramienta === 'seleccionar') {
      const seg = buscarObjetivo(m) ? null : segmentoCercano(m);
      const cambio = (seg?.indice ?? -1) !== (segmentoResaltado?.indice ?? -1);
      segmentoResaltado = seg ? { indice: seg.indice, largo: seg.largo } : null;
      if (cambio || segmentoResaltado) render();
    }
    if (trazoEnCurso.length > 0) {
      cerrandoTrazo = trazoEnCurso.length > 2 && cercaEnPantalla(trazoEnCurso[0].p, m);
      render();
    }
    return;
  }

  const dx = m.x - arrastre.previoMundo.x;
  const dy = m.y - arrastre.previoMundo.y;
  arrastre.previoMundo = { ...m };
  arrastre.actualMundo = m;
  if (distancia(m, arrastre.inicioMundo) > 0.01) arrastre.movio = true;

  if (arrastre.objetivo === 'vista') {
    const p = eventoAPantalla(e);
    actualizar({
      vista: {
        ...estado.vista,
        x: arrastre.inicioVista.x + (p.x - arrastre.inicioPantalla.x),
        y: arrastre.inicioVista.y + (p.y - arrastre.inicioPantalla.y),
      },
    });
    return;
  }

  if (arrastre.objetivo === 'marco') {
    render();
    return;
  }

  if (arrastre.objetivo === 'herramienta') {
    if (estado.herramienta === 'trazar' || estado.herramienta === 'interna') {
      // Arrastrar al poner un nodo curva el segmento, como en cualquier editor vectorial.
      const ultimo = trazoEnCurso[trazoEnCurso.length - 1];
      if (ultimo) {
        const d = { x: m.x - ultimo.p.x, y: m.y - ultimo.p.y };
        ultimo.sal = d;
        ultimo.ent = { x: -d.x, y: -d.y };
        render();
      }
      return;
    }
    puntosHerramienta = [arrastre.inicioMundo, m];
    if (estado.herramienta === 'medir') medicion = { a: arrastre.inicioMundo, b: m };
    render();
    return;
  }

  const objetivo = arrastre.objetivo;
  const fusion = `arrastre:${objetivo.tipo}:${'nodoId' in objetivo ? objetivo.nodoId : 'id' in objetivo ? objetivo.id : ''}`;
  const romper = arrastre.romperSimetria;
  const seleccionados = new Set(estado.seleccion);

  conPieza((pz) => {
    switch (objetivo.tipo) {
      case 'nodo': {
        for (const n of pz.contorno.nodos) {
          if (seleccionados.has(n.id)) {
            n.p.x += dx;
            n.p.y += dy;
          }
        }
        break;
      }
      case 'manija': {
        const n = pz.contorno.nodos.find((x) => x.id === objetivo.nodoId);
        if (!n) break;
        const nueva = { x: m.x - n.p.x, y: m.y - n.p.y };
        n[objetivo.cual] = nueva;
        // Por defecto el nodo queda suave: la manija opuesta se refleja.
        if (!romper) {
          const opuesta = objetivo.cual === 'ent' ? 'sal' : 'ent';
          const largoOpuesto = Math.hypot(n[opuesta].x, n[opuesta].y);
          const largoNueva = Math.hypot(nueva.x, nueva.y) || 1;
          if (largoOpuesto > 1e-6) {
            n[opuesta] = {
              x: (-nueva.x / largoNueva) * largoOpuesto,
              y: (-nueva.y / largoNueva) * largoOpuesto,
            };
          }
        }
        break;
      }
      case 'internaNodo': {
        const linea = pz.internas.find((l) => l.id === objetivo.lineaId);
        const n = linea?.contorno.nodos.find((x) => x.id === objetivo.nodoId);
        if (n) {
          n.p.x += dx;
          n.p.y += dy;
        }
        break;
      }
      case 'ejeX':
        pz.progresion.ejeX = m.x;
        break;
      case 'bordeX':
        pz.progresion.bordeX = m.x;
        break;
      case 'ejeY':
        pz.progresion.ejeY = m.y;
        break;
      case 'reglaAncho': {
        const r = pz.progresion.anchos.find((x) => x.id === objetivo.id);
        if (r) r.y = m.y;
        break;
      }
      case 'reglaLargo': {
        const r = pz.progresion.largos.find((x) => x.id === objetivo.id);
        if (r) r.y = m.y;
        break;
      }
      case 'hilo': {
        if (!pz.hilo) break;
        pz.hilo[objetivo.extremo] = { ...m };
        break;
      }
      case 'foto': {
        if (!pz.foto) break;
        pz.foto.offset = { x: pz.foto.offset.x + dx, y: pz.foto.offset.y + dy };
        break;
      }
    }
  }, fusion);
}

function alSubirPuntero(e: PointerEvent): void {
  if (!arrastre) return;
  const m = eventoAMundo(e);
  const tipoArrastre = arrastre.objetivo;
  const movio = arrastre.movio;
  const inicio = arrastre.inicioMundo;
  arrastre = null;
  cerrarFusion();

  if (tipoArrastre === 'marco' && movio) {
    seleccionarEnMarco(inicio, m, e.shiftKey);
    return;
  }
  if (estado.herramienta === 'calibrar' && movio) {
    puntosHerramienta = [];
    void aplicarCalibracion(inicio, m);
    return;
  }
  if (estado.herramienta === 'medir') {
    puntosHerramienta = [];
    render();
    return;
  }
  render();
}

function seleccionarEnMarco(a: Punto, b: Punto, sumar: boolean): void {
  const pieza = piezaActual();
  if (!pieza) return;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const dentro = pieza.contorno.nodos
    .filter((n) => n.p.x >= x0 && n.p.x <= x1 && n.p.y >= y0 && n.p.y <= y1)
    .map((n) => n.id);
  actualizar({ seleccion: sumar ? [...new Set([...estado.seleccion, ...dentro])] : dentro });
}

function alDobleClick(e: MouseEvent): void {
  if (estado.herramienta === 'trazar' || estado.herramienta === 'interna') {
    // El doble click deja un nodo repetido encima del anterior: lo descartamos.
    if (trazoEnCurso.length > 2) {
      const ultimo = trazoEnCurso[trazoEnCurso.length - 1];
      const anterior = trazoEnCurso[trazoEnCurso.length - 2];
      if (distancia(ultimo.p, anterior.p) * estado.vista.escala < TOL) trazoEnCurso.pop();
    }
    terminarTrazo(false);
    return;
  }
  if (estado.herramienta !== 'seleccionar') return;
  const m = eventoAMundo(e);
  const objetivo = buscarObjetivo(m);
  if (objetivo?.tipo === 'nodo') {
    alternarCurva(objetivo.nodoId);
    return;
  }
  const seg = segmentoCercano(m);
  if (seg) insertarNodo(seg.indice, seg.punto, false);
}

function alternarCurva(nodoId: string): void {
  conPieza((pz) => {
    const i = pz.contorno.nodos.findIndex((n) => n.id === nodoId);
    if (i < 0) return;
    const n = pz.contorno.nodos[i];
    const tieneCurva = Math.hypot(n.ent.x, n.ent.y) + Math.hypot(n.sal.x, n.sal.y) > 1e-6;
    if (tieneCurva) {
      n.ent = { x: 0, y: 0 };
      n.sal = { x: 0, y: 0 };
    } else {
      const total = pz.contorno.nodos.length;
      const ant = pz.contorno.nodos[(i - 1 + total) % total];
      const sig = pz.contorno.nodos[(i + 1) % total];
      const t = { x: (sig.p.x - ant.p.x) / 6, y: (sig.p.y - ant.p.y) / 6 };
      n.ent = { x: -t.x, y: -t.y };
      n.sal = { x: t.x, y: t.y };
    }
  });
}

function insertarNodo(indiceSegmento: number, punto: Punto, conPiquete: boolean): void {
  conPieza((pz) => {
    const nodo = nuevoNodo(punto);
    if (conPiquete) nodo.piquete = true;
    pz.contorno.nodos.splice(indiceSegmento + 1, 0, nodo);
  });
}

function alRueda(e: WheelEvent): void {
  e.preventDefault();
  const antes = eventoAMundo(e);
  const factor = Math.exp(-e.deltaY * 0.0015);
  const escala = Math.min(30, Math.max(0.05, estado.vista.escala * factor));
  const r = lienzo.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  actualizar({ vista: { escala, x: px - antes.x * escala, y: py - antes.y * escala } });
}

function alTeclado(e: KeyboardEvent): void {
  const objetivo = e.target as HTMLElement | null;
  if (objetivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return;

  if (e.code === 'Space') {
    barraEspacio = true;
    lienzo.style.cursor = 'grab';
    return;
  }
  if (e.key === 'Escape') {
    trazoEnCurso = [];
    puntosHerramienta = [];
    medicion = null;
    actualizar({ seleccion: [], herramienta: 'seleccionar' });
    return;
  }
  if (e.key === 'Enter' && trazoEnCurso.length > 1) {
    terminarTrazo(estado.herramienta === 'trazar');
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && estado.seleccion.length > 0) {
    e.preventDefault();
    if (puedeEditar()) borrarSeleccion();
    return;
  }
  const flechas: Record<string, Punto> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  };
  if (flechas[e.key] && estado.seleccion.length > 0 && puedeEditar()) {
    e.preventDefault();
    const paso = e.shiftKey ? 10 : 1;
    const d = flechas[e.key];
    const sel = new Set(estado.seleccion);
    conPieza((pz) => {
      for (const n of pz.contorno.nodos) {
        if (sel.has(n.id)) {
          n.p.x += d.x * paso;
          n.p.y += d.y * paso;
        }
      }
      for (const l of pz.internas) {
        for (const n of l.contorno.nodos) {
          if (sel.has(n.id)) {
            n.p.x += d.x * paso;
            n.p.y += d.y * paso;
          }
        }
      }
    }, 'flechas');
  }
}

function alSoltarTecla(e: KeyboardEvent): void {
  if (e.code === 'Space') {
    barraEspacio = false;
    lienzo.style.cursor = '';
  }
}

export function borrarSeleccion(): void {
  const sel = new Set(estado.seleccion);
  if (sel.size === 0) return;
  conPieza((pz) => {
    pz.contorno.nodos = pz.contorno.nodos.filter((n) => !sel.has(n.id));
    for (const l of pz.internas) l.contorno.nodos = l.contorno.nodos.filter((n) => !sel.has(n.id));
    pz.internas = pz.internas.filter((l) => l.contorno.nodos.length >= 2);
  });
  actualizar({ seleccion: [] });
}

// ---------------------------------------------------------------------------
// Vista
// ---------------------------------------------------------------------------

export function cajaDeLaPieza(pieza: Pieza): Caja | null {
  let caja: Caja | null = null;
  if (pieza.contorno.nodos.length > 0) caja = cajaDePuntos(muestrear(pieza.contorno, 2));
  if (pieza.foto) {
    caja = unirCajas(caja, {
      x: pieza.foto.offset.x,
      y: pieza.foto.offset.y,
      ancho: pieza.foto.anchoPx * pieza.foto.mmPorPx,
      alto: pieza.foto.altoPx * pieza.foto.mmPorPx,
    });
  }
  return caja;
}

export function ajustarVista(): void {
  const pieza = piezaActual();
  const ancho = contenedor?.clientWidth ?? 800;
  const alto = contenedor?.clientHeight ?? 600;
  const caja = pieza ? cajaDeLaPieza(pieza) : null;
  if (!caja || caja.ancho < 1e-6 || caja.alto < 1e-6) {
    actualizar({ vista: { escala: 1.2, x: 60, y: 60 } });
    return;
  }
  const margen = 60;
  const escala = Math.min((ancho - margen * 2) / caja.ancho, (alto - margen * 2) / caja.alto);
  const e = Math.min(30, Math.max(0.05, escala));
  actualizar({
    vista: {
      escala: e,
      x: ancho / 2 - (caja.x + caja.ancho / 2) * e,
      y: alto / 2 - (caja.y + caja.alto / 2) * e,
    },
  });
}

export function zoom(factor: number): void {
  const ancho = contenedor.clientWidth / 2;
  const alto = contenedor.clientHeight / 2;
  const centro = aMundo(ancho, alto);
  const escala = Math.min(30, Math.max(0.05, estado.vista.escala * factor));
  actualizar({ vista: { escala, x: ancho - centro.x * escala, y: alto - centro.y * escala } });
}

/** Suaviza el contorno de la pieza actual (util despues de detectar la foto). */
export function suavizarPieza(): void {
  conPieza((pz) => {
    pz.contorno = suavizar(pz.contorno);
  });
}

export function crearLienzo(host: HTMLElement): () => void {
  contenedor = host;
  lienzo = document.createElement('canvas');
  lienzo.className = 'lienzo lienzo-editor';
  host.append(lienzo);
  ctx = lienzo.getContext('2d')!;

  lienzo.addEventListener('pointerdown', alBajarPuntero);
  lienzo.addEventListener('pointermove', alMoverPuntero);
  lienzo.addEventListener('pointerup', alSubirPuntero);
  lienzo.addEventListener('pointercancel', alSubirPuntero);
  lienzo.addEventListener('dblclick', alDobleClick);
  lienzo.addEventListener('wheel', alRueda, { passive: false });
  lienzo.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', alTeclado);
  window.addEventListener('keyup', alSoltarTecla);

  const observador = new ResizeObserver(() => render());
  observador.observe(host);
  desuscribir = suscribir(render);
  render();

  return () => {
    observador.disconnect();
    desuscribir?.();
    window.removeEventListener('keydown', alTeclado);
    window.removeEventListener('keyup', alSoltarTecla);
    lienzo.remove();
  };
}

export function cargarFotoEnPieza(dataUrl: string): Promise<void> {
  return cargarImagen(dataUrl).then((img) => {
    const { dataUrl: comprimida, ancho, alto } = comprimir(img, 2200, 0.88);
    conPieza((pz) => {
      pz.foto = {
        datos: comprimida,
        original: comprimida,
        anchoPx: ancho,
        altoPx: alto,
        // Arranca con 1 px = 1 mm; despues se calibra con la regla o con el rectangulo.
        mmPorPx: 1,
        calibrada: false,
        offset: { x: 0, y: 0 },
        opacidad: 0.75,
        visible: true,
      };
    });
    ajustarVista();
  });
}
