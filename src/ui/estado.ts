/**
 * Estado de la aplicacion.
 *
 * Un objeto plano mas suscripciones: alcanza y sobra para una app de una sola
 * pantalla, y permite guardar el historial de deshacer como copias del proyecto.
 */

import * as almacen from '../nucleo/almacen';
import type { Pieza, Proyecto } from '../nucleo/tipos';

export type Herramienta =
  | 'seleccionar'
  | 'trazar'
  | 'interna'
  | 'piquete'
  | 'hilo'
  | 'calibrar'
  | 'perspectiva'
  | 'medir';

export type PanelActivo = 'piezas' | 'pieza' | 'talles' | 'progresion' | 'exportar';

export interface Vista {
  /** Pixeles de pantalla por milimetro. */
  escala: number;
  /** Desplazamiento en pixeles. */
  x: number;
  y: number;
}

export interface Estado {
  proyecto: Proyecto | null;
  piezaId: string | null;
  seleccion: string[];
  herramienta: Herramienta;
  tipoInterna: 'pinza' | 'doblez' | 'referencia' | 'interna';
  vista: Vista;
  /** Talle que se muestra en el lienzo (null = talle base). */
  talleVista: string | null;
  mostrarNido: boolean;
  mostrarFoto: boolean;
  mostrarCostura: boolean;
  mostrarGrilla: boolean;
  mostrarEjes: boolean;
  panel: PanelActivo;
  mensaje: { texto: string; tipo: 'info' | 'error' | 'ok' } | null;
  cargando: boolean;
  /** Se incrementa para forzar el redibujo de los paneles. */
  revisionPanel: number;
}

const inicial: Estado = {
  proyecto: null,
  piezaId: null,
  seleccion: [],
  herramienta: 'seleccionar',
  tipoInterna: 'pinza',
  vista: { escala: 1.2, x: 60, y: 60 },
  talleVista: null,
  mostrarNido: false,
  mostrarFoto: true,
  mostrarCostura: true,
  mostrarGrilla: true,
  mostrarEjes: true,
  panel: 'piezas',
  mensaje: null,
  cargando: false,
  revisionPanel: 0,
};

export const estado: Estado = { ...inicial };

type Oyente = () => void;
const oyentes = new Set<Oyente>();

export function suscribir(fn: Oyente): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

let pendiente = false;
export function avisar(): void {
  if (pendiente) return;
  pendiente = true;
  queueMicrotask(() => {
    pendiente = false;
    for (const fn of oyentes) fn();
  });
}

export function actualizar(parcial: Partial<Estado>): void {
  Object.assign(estado, parcial);
  avisar();
}

export function piezaActual(): Pieza | null {
  if (!estado.proyecto || !estado.piezaId) return null;
  return estado.proyecto.piezas.find((p) => p.id === estado.piezaId) ?? null;
}

export function avisarMensaje(texto: string, tipo: 'info' | 'error' | 'ok' = 'info'): void {
  actualizar({ mensaje: { texto, tipo } });
  setTimeout(() => {
    if (estado.mensaje?.texto === texto) actualizar({ mensaje: null });
  }, 5000);
}

// ---------------------------------------------------------------------------
// Historial (deshacer / rehacer)
// ---------------------------------------------------------------------------

/**
 * Copia el proyecto compartiendo las fotos por referencia: los data URL pesan
 * cientos de kilobytes y duplicarlos en cada paso del historial comeria memoria.
 * Las cadenas son inmutables, asi que compartirlas es seguro.
 */
export function clonarProyecto(p: Proyecto): Proyecto {
  const fotos = p.piezas.map((pz) => pz.foto);
  const liviano: Proyecto = { ...p, piezas: p.piezas.map((pz) => ({ ...pz, foto: undefined })) };
  const copia = JSON.parse(JSON.stringify(liviano)) as Proyecto;
  copia.piezas.forEach((pz, i) => {
    const f = fotos[i];
    if (f) pz.foto = { ...f };
  });
  return copia;
}

const MAX_HISTORIAL = 40;
let atras: Proyecto[] = [];
let adelante: Proyecto[] = [];

export function puedeDeshacer(): boolean {
  return atras.length > 0;
}

export function puedeRehacer(): boolean {
  return adelante.length > 0;
}

let guardadoPendiente: number | null = null;

function guardarMasTarde(): void {
  if (guardadoPendiente !== null) clearTimeout(guardadoPendiente);
  guardadoPendiente = window.setTimeout(() => {
    guardadoPendiente = null;
    if (estado.proyecto) void almacen.guardar(estado.proyecto);
  }, 800);
}

/**
 * Cambia el proyecto registrando un paso de historial.
 * `fn` recibe una copia y la modifica (o devuelve una nueva).
 */
export function editar(fn: (p: Proyecto) => Proyecto | void, opciones: { fusionar?: string } = {}): void {
  const actual = estado.proyecto;
  if (!actual) return;

  // Al arrastrar se llama muchas veces seguidas: con `fusionar` todos esos
  // cambios quedan como un solo paso de deshacer.
  if (!opciones.fusionar || opciones.fusionar !== ultimaFusion) {
    atras.push(clonarProyecto(actual));
    if (atras.length > MAX_HISTORIAL) atras.shift();
    adelante = [];
  }
  ultimaFusion = opciones.fusionar ?? null;

  const copia = clonarProyecto(actual);
  const resultado = fn(copia);
  estado.proyecto = (resultado ?? copia) as Proyecto;
  estado.proyecto.modificado = Date.now();
  guardarMasTarde();
  avisar();
}

let ultimaFusion: string | null = null;

/** Corta la fusion: el proximo `editar` arranca un paso nuevo de historial. */
export function cerrarFusion(): void {
  ultimaFusion = null;
}

export function deshacer(): void {
  const actual = estado.proyecto;
  if (!actual || atras.length === 0) return;
  adelante.push(clonarProyecto(actual));
  estado.proyecto = atras.pop()!;
  ultimaFusion = null;
  guardarMasTarde();
  avisar();
}

export function rehacer(): void {
  const actual = estado.proyecto;
  if (!actual || adelante.length === 0) return;
  atras.push(clonarProyecto(actual));
  estado.proyecto = adelante.pop()!;
  ultimaFusion = null;
  guardarMasTarde();
  avisar();
}

export function abrirProyecto(p: Proyecto): void {
  atras = [];
  adelante = [];
  ultimaFusion = null;
  estado.proyecto = p;
  estado.piezaId = p.piezas[0]?.id ?? null;
  estado.seleccion = [];
  estado.talleVista = null;
  estado.panel = p.piezas.length > 0 ? 'pieza' : 'piezas';
  void almacen.guardar(p);
  avisar();
}

export function guardarYa(): Promise<void> {
  return estado.proyecto ? almacen.guardar(estado.proyecto) : Promise.resolve();
}
