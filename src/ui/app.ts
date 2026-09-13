/** Armado de la pantalla: barra superior, herramientas, paneles y lienzo. */

import * as almacen from '../nucleo/almacen';
import { nuevoProyecto } from '../nucleo/proyecto';
import type { Proyecto } from '../nucleo/tipos';
import { confirmar, mostrarPanel, pedirTexto } from './dialogos';
import { boton, h, vaciar } from './dom';
import {
  abrirProyecto,
  actualizar,
  avisarMensaje,
  deshacer,
  editar,
  estado,
  guardarYa,
  piezaActual,
  puedeDeshacer,
  puedeRehacer,
  rehacer,
  suscribir,
  type Herramienta,
  type PanelActivo,
} from './estado';
import { fecha } from './formato';
import { ajustarVista, crearLienzo, zoom } from './lienzo';
import { panelExportar, panelPieza, panelPiezas, panelProgresion, panelTalles, panelTizada } from './paneles';
import { crearVistaTizada } from './vistaTizada';

interface DefinicionHerramienta {
  id: Herramienta;
  icono: string;
  nombre: string;
  ayuda: string;
  tecla: string;
}

const HERRAMIENTAS: DefinicionHerramienta[] = [
  { id: 'seleccionar', icono: '⬉', nombre: 'Seleccionar', ayuda: 'Mover nodos, curvas y ejes. Doble click en el contorno agrega un nodo.', tecla: 'v' },
  { id: 'trazar', icono: '✎', nombre: 'Trazar', ayuda: 'Dibujar el contorno de la pieza. Arrastra al hacer click para curvar.', tecla: 't' },
  { id: 'interna', icono: '△', nombre: 'Linea interna', ayuda: 'Dibujar pinzas, doblez o lineas de referencia.', tecla: 'i' },
  { id: 'piquete', icono: '⊥', nombre: 'Piquete', ayuda: 'Poner o sacar las muescas que hacen coincidir las piezas.', tecla: 'q' },
  { id: 'hilo', icono: '↕', nombre: 'Linea de hilo', ayuda: 'Marcar el sentido del hilo de la tela.', tecla: 'g' },
  { id: 'perspectiva', icono: '▱', nombre: 'Enderezar foto', ayuda: 'Marcar 4 esquinas de un rectangulo conocido para sacarle la perspectiva a la foto.', tecla: 'p' },
  { id: 'calibrar', icono: '↔', nombre: 'Calibrar escala', ayuda: 'Arrastrar sobre una medida conocida para fijar la escala de la foto.', tecla: 'c' },
  { id: 'medir', icono: '⟷', nombre: 'Medir', ayuda: 'Medir distancias sobre el molde.', tecla: 'm' },
];

const PESTANAS: Array<{ id: PanelActivo; nombre: string }> = [
  { id: 'piezas', nombre: 'Piezas' },
  { id: 'pieza', nombre: 'Pieza' },
  { id: 'talles', nombre: 'Talles' },
  { id: 'progresion', nombre: 'Progresion' },
  { id: 'tizada', nombre: 'Tizada' },
  { id: 'exportar', nombre: 'Exportar' },
];

let barraSuperior: HTMLElement;
let barraHerramientas: HTMLElement;
let panelLateral: HTMLElement;
let hostLienzo: HTMLElement;
let hostTizada: HTMLElement;
let firmaPanel = '';

function firma(): string {
  const p = estado.proyecto;
  return [
    p?.id,
    p?.modificado,
    estado.piezaId,
    estado.panel,
    estado.herramienta,
    estado.talleVista,
    estado.seleccion.join(','),
    estado.mostrarNido,
    estado.mostrarFoto,
    estado.mostrarCostura,
    estado.mostrarGrilla,
    estado.mostrarEjes,
    estado.mensaje?.texto ?? '',
    estado.revisionPanel,
    estado.tipoInterna,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Barra superior
// ---------------------------------------------------------------------------

function renderBarraSuperior(): void {
  vaciar(barraSuperior);
  const p = estado.proyecto;

  barraSuperior.append(
    h('div', { clase: 'marca' }, h('span', { clase: 'marca-icono', texto: '✂' }), h('span', { texto: 'Moldes' })),
    h('input', {
      clase: 'nombre-proyecto',
      valor: p?.nombre ?? '',
      titulo: 'Nombre del proyecto',
      onChange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        editar((pr) => {
          pr.nombre = v || 'Proyecto sin nombre';
        });
      },
    }),
    h(
      'div',
      { clase: 'barra-acciones' },
      boton('↶', deshacer, { titulo: 'Deshacer (Ctrl+Z)', clase: 'boton icono-grande', disabled: !puedeDeshacer() }),
      boton('↷', rehacer, { titulo: 'Rehacer (Ctrl+Shift+Z)', clase: 'boton icono-grande', disabled: !puedeRehacer() }),
      boton('Nuevo', () => void crearProyecto()),
      boton('Abrir', () => void abrirLista()),
      boton('Guardar copia', () => {
        if (estado.proyecto) almacen.descargarJson(estado.proyecto);
      }, { titulo: 'Descarga un archivo de respaldo del proyecto' }),
      boton('Importar', () => importar()),
    ),
    estado.mensaje
      ? h('div', { clase: `mensaje ${estado.mensaje.tipo}`, texto: estado.mensaje.texto })
      : h('div', { clase: 'mensaje vacio' }),
  );
}

async function crearProyecto(): Promise<void> {
  const nombre = await pedirTexto({
    titulo: 'Proyecto nuevo',
    descripcion: 'Un proyecto es una prenda: guarda todas sus piezas y su tabla de talles.',
    etiqueta: 'Nombre',
    valor: 'Blusa',
  });
  if (nombre === null) return;
  await guardarYa();
  abrirProyecto(nuevoProyecto(nombre || 'Proyecto sin nombre'));
  ajustarVista();
}

async function abrirLista(): Promise<void> {
  const proyectos = await almacen.listar();
  const lista = h('ul', { clase: 'lista-proyectos' });
  let cerrar = () => {};
  if (proyectos.length === 0) {
    lista.append(h('li', { texto: 'Todavia no hay proyectos guardados.' }));
  }
  for (const pr of proyectos) {
    lista.append(
      h(
        'li',
        { clase: 'item-proyecto' },
        h('button', {
          clase: 'item-proyecto-nombre',
          type: 'button',
          onClick: async () => {
            await guardarYa();
            abrirProyecto(pr);
            ajustarVista();
            cerrar();
          },
          texto: pr.nombre,
        }),
        h('span', { clase: 'item-proyecto-datos', texto: `${pr.piezas.length} piezas - ${fecha(pr.modificado)}` }),
        h('button', {
          clase: 'icono peligro',
          type: 'button',
          texto: '✕',
          titulo: 'Borrar proyecto',
          onClick: async () => {
            if (await confirmar('Borrar proyecto', `Se borra "${pr.nombre}" para siempre. Esto no se puede deshacer.`, 'Borrar')) {
              await almacen.borrar(pr.id);
              cerrar();
              void abrirLista();
            }
          },
        }),
      ),
    );
  }
  cerrar = mostrarPanel('Abrir proyecto', lista);
}

function importar(): void {
  const entrada = h('input', { type: 'file', accept: '.json,application/json', clase: 'oculto' });
  entrada.addEventListener('change', async () => {
    const archivo = entrada.files?.[0];
    if (!archivo) return;
    try {
      const texto = await archivo.text();
      const p: Proyecto = await almacen.importarJson(texto);
      abrirProyecto(p);
      ajustarVista();
      avisarMensaje('Proyecto importado.', 'ok');
    } catch {
      avisarMensaje('El archivo no se pudo leer como proyecto de moldes', 'error');
    }
    entrada.remove();
  });
  document.body.append(entrada);
  entrada.click();
}

// ---------------------------------------------------------------------------
// Barra de herramientas
// ---------------------------------------------------------------------------

function renderBarraHerramientas(): void {
  vaciar(barraHerramientas);
  // En la tizada no hay nada que editar: se esconde la barra de herramientas.
  const enTizada = estado.panel === 'tizada';
  barraHerramientas.hidden = enTizada;
  hostLienzo.hidden = enTizada;
  hostTizada.hidden = !enTizada;
  if (enTizada) return;
  const p = estado.proyecto;
  const hayPieza = piezaActual() !== null;

  const grupoHerramientas = h('div', { clase: 'grupo' });
  for (const t of HERRAMIENTAS) {
    grupoHerramientas.append(
      h('button', {
        clase: `herramienta${estado.herramienta === t.id ? ' activa' : ''}`,
        type: 'button',
        disabled: !hayPieza,
        titulo: `${t.nombre} (${t.tecla.toUpperCase()}) - ${t.ayuda}`,
        onClick: () => actualizar({ herramienta: t.id, seleccion: [] }),
        html: `<span class="herramienta-icono">${t.icono}</span><span class="herramienta-nombre">${t.nombre}</span>`,
      }),
    );
  }

  const alternador = (etiqueta: string, activo: boolean, alCambiar: () => void, titulo: string) =>
    h('button', {
      clase: `alternador${activo ? ' activo' : ''}`,
      type: 'button',
      titulo,
      onClick: alCambiar,
      texto: etiqueta,
    });

  const grupoVista = h(
    'div',
    { clase: 'grupo' },
    alternador('Foto', estado.mostrarFoto, () => actualizar({ mostrarFoto: !estado.mostrarFoto }), 'Mostrar u ocultar la foto de referencia'),
    alternador('Costura', estado.mostrarCostura, () => actualizar({ mostrarCostura: !estado.mostrarCostura }), 'Mostrar el margen de costura'),
    alternador('Grilla', estado.mostrarGrilla, () => actualizar({ mostrarGrilla: !estado.mostrarGrilla }), 'Grilla de 1 cm'),
    alternador('Ejes', estado.mostrarEjes, () => actualizar({ mostrarEjes: !estado.mostrarEjes }), 'Ejes y lineas de progresion'),
    alternador('Nido', estado.mostrarNido, () => actualizar({ mostrarNido: !estado.mostrarNido }), 'Ver todos los talles superpuestos'),
  );

  const selectorTalle = h('select', {
    clase: 'campo-input chico',
    titulo: 'Talle que se muestra en pantalla',
    onChange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      actualizar({ talleVista: v === 'base' ? null : v, seleccion: [] });
    },
  });
  if (p) {
    selectorTalle.append(h('option', { value: 'base', texto: 'Talle base (editable)' }));
    for (const t of p.talles) {
      if (t.id === p.talleBaseId) continue;
      selectorTalle.append(h('option', { value: t.id, texto: `Ver talle ${t.nombre}` }));
    }
    selectorTalle.value = estado.talleVista ?? 'base';
  }

  const grupoZoom = h(
    'div',
    { clase: 'grupo' },
    selectorTalle,
    boton('−', () => zoom(1 / 1.25), { titulo: 'Alejar', clase: 'boton icono-grande' }),
    boton('Ajustar', () => ajustarVista(), { titulo: 'Encuadrar la pieza' }),
    boton('+', () => zoom(1.25), { titulo: 'Acercar', clase: 'boton icono-grande' }),
  );

  barraHerramientas.append(grupoHerramientas, grupoVista, grupoZoom);

  if (estado.talleVista && p && estado.talleVista !== p.talleBaseId) {
    const nombre = p.talles.find((t) => t.id === estado.talleVista)?.nombre ?? '';
    barraHerramientas.append(
      h('div', { clase: 'aviso-talle', texto: `Estas viendo el talle ${nombre}: es de solo lectura. Volve al talle base para editar.` }),
    );
  }
}

// ---------------------------------------------------------------------------
// Panel lateral
// ---------------------------------------------------------------------------

function renderPanel(): void {
  vaciar(panelLateral);
  const pestanas = h('div', { clase: 'pestanas' });
  for (const t of PESTANAS) {
    pestanas.append(
      h('button', {
        clase: `pestana${estado.panel === t.id ? ' activa' : ''}`,
        type: 'button',
        texto: t.nombre,
        onClick: () => actualizar({ panel: t.id }),
      }),
    );
  }
  const paneles: Record<PanelActivo, () => HTMLElement> = {
    piezas: panelPiezas,
    pieza: panelPieza,
    talles: panelTalles,
    progresion: panelProgresion,
    tizada: panelTizada,
    exportar: panelExportar,
  };
  const contenido = paneles[estado.panel]();

  panelLateral.append(pestanas, contenido);
}

// ---------------------------------------------------------------------------
// Atajos
// ---------------------------------------------------------------------------

function atajos(e: KeyboardEvent): void {
  const objetivo = e.target as HTMLElement | null;
  if (objetivo && ['INPUT', 'TEXTAREA', 'SELECT'].includes(objetivo.tagName)) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) rehacer();
    else deshacer();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    rehacer();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void guardarYa().then(() => avisarMensaje('Guardado.', 'ok'));
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === '0') {
    ajustarVista();
    return;
  }
  const herramienta = HERRAMIENTAS.find((t) => t.tecla === e.key.toLowerCase());
  if (herramienta && piezaActual()) actualizar({ herramienta: herramienta.id, seleccion: [] });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

export function iniciarApp(raiz: HTMLElement): void {
  barraSuperior = h('header', { clase: 'barra-superior' });
  barraHerramientas = h('div', { clase: 'barra-herramientas' });
  panelLateral = h('aside', { clase: 'panel-lateral' });
  hostLienzo = h('div', { clase: 'host-lienzo' });
  hostTizada = h('div', { clase: 'host-lienzo', hidden: true });

  raiz.append(
    h(
      'div',
      { clase: 'app' },
      barraSuperior,
      h(
        'div',
        { clase: 'cuerpo' },
        panelLateral,
        h('main', { clase: 'area-lienzo' }, barraHerramientas, hostLienzo, hostTizada),
      ),
    ),
  );

  crearLienzo(hostLienzo);
  crearVistaTizada(hostTizada);
  window.addEventListener('keydown', atajos);

  suscribir(() => {
    const f = firma();
    if (f === firmaPanel) return;
    firmaPanel = f;
    renderBarraSuperior();
    renderBarraHerramientas();
    renderPanel();
  });

  renderBarraSuperior();
  renderBarraHerramientas();
  renderPanel();
  firmaPanel = firma();
}
