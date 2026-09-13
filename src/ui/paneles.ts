/** Paneles laterales: piezas, propiedades, tabla de talles, progresion y exportacion. */

import { descargarBlob } from '../nucleo/almacen';
import { margenDeSegmento } from '../nucleo/costura';
import { area, cajaDePuntos, largoSegmento, muestrear, perimetro, segmentos, simplificar } from '../nucleo/geometria';
import { cargarImagen, detectarContorno, leerArchivoComoDataUrl } from '../nucleo/imagen';
import { nuevaReglaAncho, nuevaReglaLargo, deltaDeRegla, resumenProgresion } from '../nucleo/progresion';
import { nuevoId } from '../nucleo/ids';
import { contornoDesdePuntos, enderezar, nuevaPieza, suavizar, sugerirEjes } from '../nucleo/proyecto';
import type { Medida, Pieza, Punto, Talle } from '../nucleo/tipos';
import {
  generarDxf,
  generarPdf,
  generarSvg,
  nombreArchivo,
  opcionesPorDefecto,
  planMosaico,
  armarLamina,
  type OpcionesExport,
} from '../exportar/exportadores';
import { HOJAS } from '../exportar/pdf';
import { resumenPrendas } from '../exportar/tizada';
import { generarPdfTizada, nombreArchivoTizada } from '../exportar/tizadaPdf';
import { tizadaActual } from './vistaTizada';
import { confirmar, pedirTexto } from './dialogos';
import { ayuda, boton, campo, casilla, h, seccion, seleccion } from './dom';
import { actualizar, avisarMensaje, editar, estado, piezaActual } from './estado';
import { leerCm, leerCmAMm, mmACm } from './formato';
import { ajustarVista, cargarFotoEnPieza } from './lienzo';

function conPieza(fn: (pz: Pieza) => void): void {
  const id = estado.piezaId;
  if (!id) return;
  editar((p) => {
    const pz = p.piezas.find((x) => x.id === id);
    if (pz) fn(pz);
  });
}

// ---------------------------------------------------------------------------
// Panel de piezas
// ---------------------------------------------------------------------------

export function panelPiezas(): HTMLElement {
  const p = estado.proyecto;
  if (!p) return h('div');

  const lista = h('ul', { clase: 'lista-piezas' });
  for (const pieza of p.piezas) {
    const activa = pieza.id === estado.piezaId;
    lista.append(
      h(
        'li',
        { clase: `item-pieza${activa ? ' activa' : ''}` },
        h('button', {
          clase: 'item-pieza-nombre',
          type: 'button',
          texto: pieza.nombre,
          onClick: () => actualizar({ piezaId: pieza.id, seleccion: [], panel: 'pieza' }),
        }),
        h('span', {
          clase: 'item-pieza-datos',
          texto: pieza.contorno.nodos.length === 0 ? 'sin trazar' : `${pieza.contorno.nodos.length} nodos`,
        }),
        h('button', {
          clase: 'icono',
          type: 'button',
          titulo: 'Duplicar',
          texto: '⧉',
          onClick: () => duplicarPieza(pieza.id),
        }),
        h('button', {
          clase: 'icono peligro',
          type: 'button',
          titulo: 'Borrar',
          texto: '✕',
          onClick: () => borrarPieza(pieza.id, pieza.nombre),
        }),
      ),
    );
  }

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccion(
      'Piezas del molde',
      p.piezas.length === 0 ? ayuda('Todavia no hay piezas. Agrega una por cada molde de papel: delantero, espalda, manga...') : lista,
      boton('+ Agregar pieza', agregarPieza, { clase: 'boton principal ancho' }),
    ),
    seccion(
      'Como se trabaja',
      h(
        'ol',
        { clase: 'pasos-lista' },
        h('li', { texto: 'Agrega una pieza y carga la foto del molde de papel.' }),
        h('li', { texto: 'Endereza la foto marcando las 4 esquinas de algo de medida conocida.' }),
        h('li', { texto: 'Traza el contorno (o usa la deteccion automatica).' }),
        h('li', { texto: 'Marca los ejes y las lineas de crecimiento en Progresion.' }),
        h('li', { texto: 'Carga la tabla de talles y exporta el PDF a tamano real.' }),
      ),
    ),
  );
}

function agregarPieza(): void {
  const nombres = ['Delantero', 'Espalda', 'Manga', 'Cuello', 'Puno', 'Bolsillo'];
  const usados = new Set(estado.proyecto?.piezas.map((p) => p.nombre) ?? []);
  const nombre = nombres.find((n) => !usados.has(n)) ?? `Pieza ${(estado.proyecto?.piezas.length ?? 0) + 1}`;
  const pieza = nuevaPieza(nombre);
  editar((p) => {
    p.piezas.push(pieza);
  });
  actualizar({ piezaId: pieza.id, seleccion: [], panel: 'pieza' });
}

function duplicarPieza(id: string): void {
  const original = estado.proyecto?.piezas.find((p) => p.id === id);
  if (!original) return;
  const copia: Pieza = JSON.parse(JSON.stringify(original));
  copia.id = nuevoId('pz');
  copia.nombre = `${original.nombre} (copia)`;
  copia.contorno.nodos = copia.contorno.nodos.map((n) => ({ ...n, id: nuevoId('n') }));
  copia.internas = copia.internas.map((l) => ({
    ...l,
    id: nuevoId('li'),
    contorno: { ...l.contorno, nodos: l.contorno.nodos.map((n) => ({ ...n, id: nuevoId('n') })) },
  }));
  copia.costuraPorNodo = {};
  editar((p) => {
    p.piezas.push(copia);
  });
  actualizar({ piezaId: copia.id, seleccion: [] });
}

async function borrarPieza(id: string, nombre: string): Promise<void> {
  if (!(await confirmar('Borrar pieza', `Se va a borrar "${nombre}" con todo su trazado. Se puede deshacer con Ctrl+Z.`, 'Borrar'))) {
    return;
  }
  editar((p) => {
    p.piezas = p.piezas.filter((x) => x.id !== id);
  });
  if (estado.piezaId === id) {
    actualizar({ piezaId: estado.proyecto?.piezas[0]?.id ?? null, seleccion: [] });
  }
}

// ---------------------------------------------------------------------------
// Panel de la pieza actual
// ---------------------------------------------------------------------------

const opcionesDeteccion = { invertir: false, toleranciaPx: 1.5 };

export function panelPieza(): HTMLElement {
  const pieza = piezaActual();
  if (!pieza) return h('div', { clase: 'panel-contenido' }, ayuda('Elegi o crea una pieza.'));

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccionFoto(pieza),
    seccionContorno(pieza),
    seccionCostura(pieza),
    seccionDatos(pieza),
    seccionMedidas(pieza),
  );
}

function seccionFoto(pieza: Pieza): HTMLElement {
  const entrada = h('input', {
    type: 'file',
    accept: 'image/*',
    clase: 'oculto',
    onChange: async (e: Event) => {
      const archivo = (e.target as HTMLInputElement).files?.[0];
      if (!archivo) return;
      try {
        const url = await leerArchivoComoDataUrl(archivo);
        await cargarFotoEnPieza(url);
        avisarMensaje('Foto cargada. Ahora endereza la perspectiva o calibra la escala.', 'ok');
      } catch {
        avisarMensaje('No se pudo cargar la foto', 'error');
      }
      (e.target as HTMLInputElement).value = '';
    },
  });

  if (!pieza.foto) {
    return seccion(
      '1. Foto del molde',
      ayuda('Saca la foto lo mas de frente posible, con buena luz y el molde sobre un fondo que contraste. Poni al lado una hoja A4 o algo de medida conocida.'),
      entrada,
      boton('Cargar foto', () => entrada.click(), { clase: 'boton principal ancho' }),
    );
  }

  const foto = pieza.foto;
  return seccion(
    '1. Foto del molde',
    h(
      'div',
      { clase: 'fila-botones' },
      boton('Enderezar perspectiva', () => {
        actualizar({ herramienta: 'perspectiva' });
        avisarMensaje('Marca las 4 esquinas del rectangulo conocido, en orden y siguiendo el borde.', 'info');
      }),
      boton('Calibrar escala', () => {
        actualizar({ herramienta: 'calibrar' });
        avisarMensaje('Arrastra sobre una medida conocida de la foto y despues escribi cuanto mide.', 'info');
      }),
    ),
    campo('Opacidad', String(Math.round(foto.opacidad * 100)), (v) => {
      const n = Number(v);
      if (Number.isFinite(n)) {
        conPieza((pz) => {
          if (pz.foto) pz.foto.opacidad = Math.min(1, Math.max(0.05, n / 100));
        });
      }
    }, { type: 'number', min: '5', max: '100', step: '5' }),
    casilla('Mostrar la foto', foto.visible, (v) =>
      conPieza((pz) => {
        if (pz.foto) pz.foto.visible = v;
      }),
    ),
    foto.calibrada
      ? ayuda(`Escala puesta: la foto mide ${mmACm(foto.anchoPx * foto.mmPorPx)} x ${mmACm(foto.altoPx * foto.mmPorPx)} cm reales.`)
      : h('p', {
          clase: 'aviso',
          texto:
            'Ojo: la escala todavia no esta puesta. Hasta que endereces la foto o calibres una ' +
            'medida conocida, lo que midas y lo que imprimas NO va a ser del tamano real.',
        }),
    ayuda('Con Alt + arrastrar movas la foto sin tocar el trazado.'),
    h(
      'div',
      { clase: 'fila-botones' },
      foto.original && foto.original !== foto.datos
        ? boton('Volver a la original', () =>
            conPieza((pz) => {
              if (pz.foto?.original) {
                pz.foto.datos = pz.foto.original;
                avisarMensaje('Foto restaurada. Hay que calibrar la escala de nuevo.', 'info');
              }
            }),
          )
        : null,
      boton('Quitar foto', () =>
        conPieza((pz) => {
          pz.foto = undefined;
        }),
        { clase: 'boton peligro' },
      ),
    ),
  );
}

function seccionContorno(pieza: Pieza): HTMLElement {
  const tieneContorno = pieza.contorno.nodos.length >= 2;
  return seccion(
    '2. Contorno',
    h(
      'div',
      { clase: 'fila-botones' },
      boton(tieneContorno ? 'Redibujar a mano' : 'Trazar a mano', async () => {
        if (tieneContorno && !(await confirmar('Redibujar', 'Se reemplaza el contorno actual. Se puede deshacer con Ctrl+Z.', 'Redibujar'))) {
          return;
        }
        actualizar({ herramienta: 'trazar', seleccion: [] });
        avisarMensaje('Hace click para poner nodos. Arrastra para curvar. Cerra haciendo click en el primer nodo.', 'info');
      }, { clase: 'boton principal' }),
      pieza.foto ? boton('Detectar de la foto', () => void detectar(), { clase: 'boton' }) : null,
    ),
    pieza.foto
      ? h(
          'div',
          { clase: 'sub-opciones' },
          casilla('El molde es mas oscuro que el fondo', opcionesDeteccion.invertir, (v) => {
            opcionesDeteccion.invertir = v;
          }),
          campo('Detalle del borde (px)', String(opcionesDeteccion.toleranciaPx), (v) => {
            const n = leerCm(v);
            if (n !== null) opcionesDeteccion.toleranciaPx = Math.min(10, Math.max(0.3, n));
          }, { type: 'number', step: '0.5', min: '0.3', max: '10' }),
        )
      : null,
    tieneContorno
      ? h(
          'div',
          { clase: 'fila-botones' },
          boton('Suavizar', () => conPieza((pz) => {
            pz.contorno = suavizar(pz.contorno);
          })),
          boton('Sacar curvas', () => conPieza((pz) => {
            pz.contorno = enderezar(pz.contorno);
          })),
          boton('Simplificar', () => simplificarContorno()),
        )
      : null,
    tieneContorno
      ? h(
          'div',
          { clase: 'fila-botones' },
          boton('Piquetes', () => {
            actualizar({ herramienta: 'piquete' });
            avisarMensaje('Hace click en un nodo para poner o sacar el piquete.', 'info');
          }),
          boton('Linea de hilo', () => {
            actualizar({ herramienta: 'hilo' });
            avisarMensaje('Hace click donde arranca la linea de hilo.', 'info');
          }),
        )
      : null,
    tieneContorno ? seccionInternas(pieza) : null,
  );
}

function seccionInternas(pieza: Pieza): HTMLElement {
  const tipos = [
    { valor: 'pinza', texto: 'Pinza' },
    { valor: 'doblez', texto: 'Doblez / al lomo' },
    { valor: 'referencia', texto: 'Linea de referencia' },
    { valor: 'interna', texto: 'Linea interna (bolsillo, etc.)' },
  ];
  const lista = pieza.internas.map((l) =>
    h(
      'li',
      { clase: 'item-simple' },
      h('span', { texto: `${l.nombre} (${l.contorno.nodos.length} nodos)` }),
      h('button', {
        clase: 'icono peligro',
        type: 'button',
        texto: '✕',
        titulo: 'Borrar',
        onClick: () =>
          conPieza((pz) => {
            pz.internas = pz.internas.filter((x) => x.id !== l.id);
          }),
      }),
    ),
  );
  return h(
    'div',
    { clase: 'sub-opciones' },
    seleccion('Tipo de linea interna', tipos, estado.tipoInterna, (v) =>
      actualizar({ tipoInterna: v as typeof estado.tipoInterna }),
    ),
    boton('Dibujar linea interna', () => {
      actualizar({ herramienta: 'interna', seleccion: [] });
      avisarMensaje('Hace click para ir poniendo puntos. Doble click o Enter para terminar.', 'info');
    }),
    lista.length > 0 ? h('ul', { clase: 'lista-simple' }, ...lista) : null,
  );
}

async function detectar(): Promise<void> {
  const pieza = piezaActual();
  if (!pieza?.foto) return;
  const foto = pieza.foto;
  try {
    const img = await cargarImagen(foto.datos);
    const { puntos } = detectarContorno(img, {
      invertir: opcionesDeteccion.invertir,
      toleranciaPx: opcionesDeteccion.toleranciaPx,
    });
    // Con 3 puntos ya hay una figura: una pretina o un puno son rectangulos.
    if (puntos.length < 3) {
      avisarMensaje('No se encontro un contorno claro. Proba con mas contraste o marca "el molde es mas oscuro".', 'error');
      return;
    }
    // La deteccion trabaja sobre la imagen: pasamos los puntos a milimetros.
    const enMm: Punto[] = puntos.map((p) => ({
      x: foto.offset.x + p.x * foto.mmPorPx,
      y: foto.offset.y + p.y * foto.mmPorPx,
    }));
    conPieza((pz) => {
      pz.contorno = suavizar(contornoDesdePuntos(enMm, true));
      Object.assign(pz, sugerirEjes(pz));
    });
    actualizar({ seleccion: [] });
    avisarMensaje(`Contorno detectado con ${enMm.length} nodos. Revisalo y ajusta lo que haga falta.`, 'ok');
  } catch (e) {
    avisarMensaje(e instanceof Error ? e.message : 'Fallo la deteccion', 'error');
  }
}

function simplificarContorno(): void {
  conPieza((pz) => {
    const pts = pz.contorno.nodos.map((n) => n.p);
    const simples = simplificar(pts, 1.2);
    if (simples.length >= 4) pz.contorno = suavizar(contornoDesdePuntos(simples, pz.contorno.cerrado));
  });
  avisarMensaje('Contorno simplificado.', 'ok');
}

function seccionCostura(pieza: Pieza): HTMLElement {
  const seleccionado = estado.seleccion[0];
  const indice = pieza.contorno.nodos.findIndex((n) => n.id === seleccionado);
  return seccion(
    '3. Margen de costura',
    campo('Margen general', mmACm(pieza.costuraMm), (v) => {
      const mm = leerCmAMm(v);
      if (mm !== null) conPieza((pz) => {
        pz.costuraMm = Math.max(0, mm);
      });
    }, { type: 'text', inputmode: 'decimal' }),
    ayuda('En centimetros. Poni 0 si preferis los moldes sin margen.'),
    indice >= 0
      ? h(
          'div',
          { clase: 'sub-opciones' },
          campo(
            `Margen del segmento ${indice + 1} (el que arranca en el nodo elegido)`,
            mmACm(margenDeSegmento(pieza, indice)),
            (v) => {
              const mm = leerCmAMm(v);
              if (mm === null) return;
              conPieza((pz) => {
                pz.costuraPorNodo[pieza.contorno.nodos[indice].id] = Math.max(0, mm);
              });
            },
            { type: 'text', inputmode: 'decimal' },
          ),
          boton('Volver al margen general', () =>
            conPieza((pz) => {
              delete pz.costuraPorNodo[pieza.contorno.nodos[indice].id];
            }),
          ),
        )
      : ayuda('Elegi un nodo en el lienzo para darle un margen distinto a ese tramo (por ejemplo 3 cm en el ruedo).'),
  );
}

function seccionDatos(pieza: Pieza): HTMLElement {
  return seccion(
    'Datos de la pieza',
    campo('Nombre', pieza.nombre, (v) =>
      conPieza((pz) => {
        pz.nombre = v || pz.nombre;
      }),
    ),
    campo('Cortar (cantidad)', String(pieza.cantidad), (v) => {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) conPieza((pz) => {
        pz.cantidad = Math.round(n);
      });
    }, { type: 'number', min: '1', step: '1' }),
    campo('Material', pieza.material, (v) =>
      conPieza((pz) => {
        pz.material = v;
      }),
    ),
    casilla('Cortar al lomo (sobre el doblez)', pieza.alLomo, (v) =>
      conPieza((pz) => {
        pz.alLomo = v;
      }),
    ),
    casilla('Incluir al exportar', pieza.incluirEnExport, (v) =>
      conPieza((pz) => {
        pz.incluirEnExport = v;
      }),
    ),
    h('label', { clase: 'campo' },
      h('span', { clase: 'campo-etiqueta', texto: 'Notas' }),
      h('textarea', {
        clase: 'campo-input',
        rows: '3',
        onChange: (e: Event) => {
          const v = (e.target as HTMLTextAreaElement).value;
          conPieza((pz) => {
            pz.notas = v;
          });
        },
      }, pieza.notas),
    ),
  );
}

function seccionMedidas(pieza: Pieza): HTMLElement {
  if (pieza.contorno.nodos.length < 2) return h('div');
  const pts = muestrear(pieza.contorno, 1);
  const caja = cajaDePuntos(pts);
  const segs = segmentos(pieza.contorno);
  const filas = segs.map(([a, b], i) =>
    h(
      'tr',
      { clase: estado.seleccion.includes(a.id) ? 'fila-activa' : '' },
      h('td', { texto: `${i + 1}` }),
      h('td', { texto: `${mmACm(largoSegmento(a, b))} cm` }),
      h('td', { texto: a.piquete ? 'piquete' : '' }),
    ),
  );
  return seccion(
    'Medidas de control',
    h(
      'dl',
      { clase: 'datos' },
      h('dt', { texto: 'Contorno total' }),
      h('dd', { texto: `${mmACm(perimetro(pieza.contorno))} cm` }),
      h('dt', { texto: 'Ancho x alto' }),
      h('dd', { texto: `${mmACm(caja.ancho)} x ${mmACm(caja.alto)} cm` }),
      h('dt', { texto: 'Superficie' }),
      h('dd', { texto: `${(area(pts) / 10000).toFixed(1)} cm2` }),
    ),
    h(
      'details',
      { clase: 'detalle' },
      h('summary', { texto: `Largo de cada tramo (${segs.length})` }),
      h(
        'table',
        { clase: 'tabla-chica' },
        h('thead', {}, h('tr', {}, h('th', { texto: '#' }), h('th', { texto: 'Largo' }), h('th', { texto: '' }))),
        h('tbody', {}, ...filas),
      ),
      ayuda('Sirve para controlar que dos costuras que se unen midan lo mismo.'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Panel de talles
// ---------------------------------------------------------------------------

export function panelTalles(): HTMLElement {
  const p = estado.proyecto;
  if (!p) return h('div');

  const encabezado = h(
    'tr',
    {},
    h('th', { clase: 'col-medida', texto: 'Medida (cm)' }),
    ...p.talles.map((t) =>
      h(
        'th',
        { clase: t.id === p.talleBaseId ? 'talle-base' : '' },
        h('input', {
          clase: 'campo-input chico',
          valor: t.nombre,
          titulo: 'Nombre del talle',
          onChange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            editar((pr) => {
              const talle = pr.talles.find((x) => x.id === t.id);
              if (talle) talle.nombre = v;
            });
          },
        }),
        h('button', {
          clase: `mini${t.id === p.talleBaseId ? ' activo' : ''}`,
          type: 'button',
          titulo: 'Usar como talle base',
          texto: t.id === p.talleBaseId ? 'BASE' : 'base',
          onClick: () =>
            editar((pr) => {
              pr.talleBaseId = t.id;
            }),
        }),
        h('button', {
          clase: 'icono peligro',
          type: 'button',
          texto: '✕',
          titulo: 'Quitar talle',
          onClick: () => quitarTalle(t.id),
        }),
      ),
    ),
  );

  const cuerpo = p.medidas.map((m) =>
    h(
      'tr',
      {},
      h(
        'td',
        { clase: 'col-medida' },
        h('input', {
          clase: 'campo-input chico',
          valor: m.nombre,
          onChange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            editar((pr) => {
              const med = pr.medidas.find((x) => x.id === m.id);
              if (med) med.nombre = v;
            });
          },
        }),
        h('button', {
          clase: 'icono peligro',
          type: 'button',
          texto: '✕',
          titulo: 'Quitar medida',
          onClick: () => quitarMedida(m.id),
        }),
      ),
      ...p.talles.map((t) =>
        h(
          'td',
          {},
          h('input', {
            clase: 'campo-input chico numero',
            valor: t.valores[m.id] === undefined ? '' : mmACm(t.valores[m.id]),
            inputmode: 'decimal',
            onChange: (e: Event) => {
              const mm = leerCmAMm((e.target as HTMLInputElement).value);
              editar((pr) => {
                const talle = pr.talles.find((x) => x.id === t.id);
                if (!talle) return;
                if (mm === null) delete talle.valores[m.id];
                else talle.valores[m.id] = mm;
              });
            },
          }),
        ),
      ),
    ),
  );

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccion(
      'Tabla de medidas por talle',
      ayuda('Todo en centimetros. El talle BASE es el que dibujaste: los demas se calculan a partir de la diferencia con el.'),
      h('div', { clase: 'tabla-scroll' },
        h('table', { clase: 'tabla-talles' }, h('thead', {}, encabezado), h('tbody', {}, ...cuerpo)),
      ),
      h(
        'div',
        { clase: 'fila-botones' },
        boton('+ Talle', agregarTalle),
        boton('+ Medida', () => void agregarMedida()),
      ),
    ),
  );
}

function agregarTalle(): void {
  editar((p) => {
    const ultimo = p.talles[p.talles.length - 1];
    const anteultimo = p.talles[p.talles.length - 2];
    const valores: Record<string, number> = {};
    // El talle nuevo sigue el mismo salto que venia usando la tabla.
    for (const m of p.medidas) {
      const a = anteultimo?.valores[m.id];
      const b = ultimo?.valores[m.id];
      if (b === undefined) continue;
      valores[m.id] = a === undefined ? b : b + (b - a);
    }
    const numero = Number(ultimo?.nombre);
    const nombre = Number.isFinite(numero) ? String(numero + 2) : `Talle ${p.talles.length + 1}`;
    p.talles.push({ id: nuevoId('tl'), nombre, valores });
  });
}

function quitarTalle(id: string): void {
  editar((p) => {
    if (p.talles.length <= 1) return;
    p.talles = p.talles.filter((t) => t.id !== id);
    if (p.talleBaseId === id) p.talleBaseId = p.talles[0].id;
  });
}

async function agregarMedida(): Promise<void> {
  const nombre = await pedirTexto({
    titulo: 'Nueva medida',
    etiqueta: 'Nombre de la medida',
    valor: 'Contorno de cuello',
  });
  if (!nombre) return;
  const medida: Medida = { id: nuevoId('md'), nombre };
  editar((p) => {
    p.medidas.push(medida);
  });
}

function quitarMedida(id: string): void {
  editar((p) => {
    p.medidas = p.medidas.filter((m) => m.id !== id);
    for (const t of p.talles) delete t.valores[id];
    for (const pz of p.piezas) {
      for (const r of pz.progresion.anchos) if (r.medidaId === id) r.medidaId = undefined;
      for (const r of pz.progresion.largos) if (r.medidaId === id) r.medidaId = undefined;
    }
  });
}

// ---------------------------------------------------------------------------
// Panel de progresion
// ---------------------------------------------------------------------------

const FRACCIONES = [
  { valor: '0.25', texto: 'Un cuarto (pieza cortada al medio)' },
  { valor: '0.5', texto: 'La mitad del contorno' },
  { valor: '1', texto: 'El contorno entero' },
  { valor: '0.125', texto: 'Un octavo' },
];

export function panelProgresion(): HTMLElement {
  const p = estado.proyecto;
  const pieza = piezaActual();
  if (!p || !pieza) return h('div', { clase: 'panel-contenido' }, ayuda('Elegi una pieza.'));

  const pr = pieza.progresion;
  const opcionesMedida = [
    { valor: '', texto: '- elegir medida -' },
    ...p.medidas.map((m) => ({ valor: m.id, texto: m.nombre })),
  ];

  const filaRegla = (r: typeof pr.anchos[number], eje: 'ancho' | 'largo') =>
    h(
      'div',
      { clase: 'regla' },
      h(
        'div',
        { clase: 'regla-cabecera' },
        h('input', {
          clase: 'campo-input chico',
          valor: r.nombre,
          onChange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value;
            conPieza((pz) => {
              const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
              const regla = lista.find((x) => x.id === r.id);
              if (regla) regla.nombre = v;
            });
          },
        }),
        h('button', {
          clase: 'icono peligro',
          type: 'button',
          texto: '✕',
          onClick: () =>
            conPieza((pz) => {
              if (eje === 'ancho') pz.progresion.anchos = pz.progresion.anchos.filter((x) => x.id !== r.id);
              else pz.progresion.largos = pz.progresion.largos.filter((x) => x.id !== r.id);
            }),
        }),
      ),
      campo('Altura en la pieza', mmACm(r.y), (v) => {
        const mm = leerCmAMm(v);
        if (mm === null) return;
        conPieza((pz) => {
          const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
          const regla = lista.find((x) => x.id === r.id);
          if (regla) regla.y = mm;
        });
      }, { inputmode: 'decimal' }),
      seleccion(
        'De donde sale el crecimiento',
        [
          { valor: 'medida', texto: 'De la tabla de talles' },
          { valor: 'manual', texto: 'A mano (mm por talle)' },
        ],
        r.origen,
        (v) =>
          conPieza((pz) => {
            const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
            const regla = lista.find((x) => x.id === r.id);
            if (regla) regla.origen = v as 'medida' | 'manual';
          }),
      ),
      r.origen === 'medida'
        ? h(
            'div',
            {},
            seleccion('Medida', opcionesMedida, r.medidaId ?? '', (v) =>
              conPieza((pz) => {
                const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
                const regla = lista.find((x) => x.id === r.id);
                if (regla) regla.medidaId = v || undefined;
              }),
            ),
            seleccion('Que parte le toca a esta pieza', FRACCIONES, String(r.fraccion ?? 1), (v) =>
              conPieza((pz) => {
                const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
                const regla = lista.find((x) => x.id === r.id);
                if (regla) regla.fraccion = Number(v);
              }),
            ),
          )
        : campo('Crecimiento por talle (mm)', String(r.mmPorTalle ?? 0), (v) => {
            const n = leerCm(v);
            if (n === null) return;
            conPieza((pz) => {
              const lista = eje === 'ancho' ? pz.progresion.anchos : pz.progresion.largos;
              const regla = lista.find((x) => x.id === r.id);
              if (regla) regla.mmPorTalle = n;
            });
          }, { inputmode: 'decimal' }),
      h('p', {
        clase: 'ayuda',
        texto: p.talles
          .map((t) => `${t.nombre}: ${deltaDeRegla(r, p, t.id) >= 0 ? '+' : ''}${mmACm(deltaDeRegla(r, p, t.id))} cm`)
          .join('   '),
      }),
    );

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccion(
      'Ejes de la pieza',
      ayuda('Se pueden arrastrar directamente en el lienzo. El eje fijo es la parte que no se mueve al cambiar de talle (normalmente el centro), y el borde es donde se aplica todo el crecimiento (normalmente el costado).'),
      campo('Eje vertical fijo (x)', mmACm(pr.ejeX), (v) => {
        const mm = leerCmAMm(v);
        if (mm !== null) conPieza((pz) => {
          pz.progresion.ejeX = mm;
        });
      }, { inputmode: 'decimal' }),
      campo('Borde de crecimiento (x)', mmACm(pr.bordeX), (v) => {
        const mm = leerCmAMm(v);
        if (mm !== null) conPieza((pz) => {
          pz.progresion.bordeX = mm;
        });
      }, { inputmode: 'decimal' }),
      campo('Altura fija (y)', mmACm(pr.ejeY), (v) => {
        const mm = leerCmAMm(v);
        if (mm !== null) conPieza((pz) => {
          pz.progresion.ejeY = mm;
        });
      }, { inputmode: 'decimal' }),
      boton('Ubicar ejes automaticamente', () =>
        conPieza((pz) => {
          Object.assign(pz, sugerirEjes(pz));
        }),
      ),
    ),
    seccion(
      'Crecimiento a lo ancho',
      ayuda('Una linea por cada altura donde la pieza cambia de ancho: busto, cintura, cadera...'),
      ...pr.anchos.map((r) => filaRegla(r, 'ancho')),
      h(
        'div',
        { clase: 'fila-botones' },
        boton('+ Linea de ancho', () => agregarRegla('ancho')),
        pr.anchos.length === 0 && pr.largos.length === 0 ? boton('Armado automatico', armadoAutomatico, { clase: 'boton principal' }) : null,
      ),
    ),
    seccion(
      'Crecimiento a lo largo',
      ayuda('Cada linea se aleja de la altura fija lo que diga la medida de largo.'),
      ...pr.largos.map((r) => filaRegla(r, 'largo')),
      boton('+ Linea de largo', () => agregarRegla('largo')),
    ),
    resumen(pieza),
  );
}

function agregarRegla(eje: 'ancho' | 'largo'): void {
  const pieza = piezaActual();
  if (!pieza) return;
  const pts = muestrear(pieza.contorno, 4);
  const caja = pts.length > 1 ? cajaDePuntos(pts) : { x: 0, y: 0, ancho: 200, alto: 400 };
  conPieza((pz) => {
    if (eje === 'ancho') {
      pz.progresion.anchos.push(
        nuevaReglaAncho({ nombre: `Linea ${pz.progresion.anchos.length + 1}`, y: caja.y + caja.alto / 2 }),
      );
    } else {
      pz.progresion.largos.push(
        nuevaReglaLargo({ nombre: `Largo ${pz.progresion.largos.length + 1}`, y: caja.y + caja.alto }),
      );
    }
  });
}

/** Arma un juego de reglas tipico de cuerpo: busto, cintura, cadera y largo. */
function armadoAutomatico(): void {
  const p = estado.proyecto;
  const pieza = piezaActual();
  if (!p || !pieza || pieza.contorno.nodos.length < 3) {
    avisarMensaje('Primero traza el contorno de la pieza', 'error');
    return;
  }
  const caja = cajaDePuntos(muestrear(pieza.contorno, 4));
  const buscar = (texto: string) => p.medidas.find((m) => m.nombre.toLowerCase().includes(texto))?.id;

  conPieza((pz) => {
    pz.progresion.anchos = [
      nuevaReglaAncho({ nombre: 'Busto', y: caja.y + caja.alto * 0.25, medidaId: buscar('busto'), fraccion: 0.25 }),
      nuevaReglaAncho({ nombre: 'Cintura', y: caja.y + caja.alto * 0.55, medidaId: buscar('cintura'), fraccion: 0.25 }),
      nuevaReglaAncho({ nombre: 'Cadera', y: caja.y + caja.alto * 0.85, medidaId: buscar('cadera'), fraccion: 0.25 }),
    ];
    pz.progresion.largos = [
      nuevaReglaLargo({ nombre: 'Largo de talle', y: caja.y, medidaId: buscar('largo de talle'), fraccion: 1 }),
    ];
    pz.progresion.ejeX = caja.x;
    pz.progresion.bordeX = caja.x + caja.ancho;
    pz.progresion.ejeY = caja.y + caja.alto * 0.55;
  });
  avisarMensaje('Reglas armadas. Arrastra las lineas en el lienzo para ponerlas donde van.', 'ok');
}

function resumen(pieza: Pieza): HTMLElement {
  const p = estado.proyecto;
  if (!p) return h('div');
  const filas = resumenProgresion(pieza, p);
  if (filas.length === 0) return h('div');
  return seccion(
    'Cuanto crece en cada talle',
    h('div', { clase: 'tabla-scroll' },
      h(
        'table',
        { clase: 'tabla-chica' },
        h('thead', {}, h('tr', {}, h('th', { texto: 'Linea' }), ...p.talles.map((t) => h('th', { texto: t.nombre })))),
        h(
          'tbody',
          {},
          ...filas.map((f) =>
            h(
              'tr',
              {},
              h('td', { texto: `${f.nombre} (${f.eje})` }),
              ...f.porTalle.map((v) =>
                h('td', { texto: v.mm === 0 ? '-' : `${v.mm > 0 ? '+' : ''}${mmACm(v.mm)}` }),
              ),
            ),
          ),
        ),
      ),
    ),
    ayuda('Valores en centimetros respecto del talle base.'),
  );
}

// ---------------------------------------------------------------------------
// Panel de la tizada
// ---------------------------------------------------------------------------

export function panelTizada(): HTMLElement {
  const p = estado.proyecto;
  const op = estado.opcionesTizada;
  if (!p || !op) return h('div');
  const refrescar = () => actualizar({ revisionPanel: estado.revisionPanel + 1 });

  const numero = (etiqueta: string, valorMm: number, alCambiar: (mm: number) => void) =>
    campo(etiqueta, mmACm(valorMm), (v) => {
      const mm = leerCmAMm(v);
      if (mm !== null && mm >= 0) {
        alCambiar(mm);
        refrescar();
      }
    }, { inputmode: 'decimal' });

  const listas = p.piezas.filter((pz) => pz.incluirEnExport && pz.contorno.nodos.length >= 3);
  if (listas.length === 0) {
    return h('div', { clase: 'panel-contenido' }, seccion('Tizada', ayuda('Primero traza alguna pieza.')));
  }

  const r = tizadaActual();

  const filasTalle = p.talles.map((t) =>
    h(
      'label',
      { clase: 'fila-talle' },
      h('span', { texto: `Talle ${t.nombre}${t.id === p.talleBaseId ? ' (base)' : ''}` }),
      h('input', {
        clase: 'campo-input chico numero',
        type: 'number',
        min: '0',
        step: '1',
        valor: String(op.prendasPorTalle[t.id] ?? 0),
        onChange: (e: Event) => {
          const n = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0));
          op.prendasPorTalle = { ...op.prendasPorTalle, [t.id]: n };
          refrescar();
        },
      }),
    ),
  );

  const resultado = r
    ? h(
        'div',
        {},
        h('p', { clase: 'numero-grande', texto: `${(r.largoMm / 1000).toFixed(2).replace('.', ',')} m` }),
        ayuda(
          `de tela de ${mmACm(r.anchoTelaMm)} cm ${r.doblada ? 'doblada al medio' : 'abierta'}. ` +
            `Aprovechamiento ${(r.aprovechamiento * 100).toFixed(0)}%, ${r.piezas.length} piezas a cortar.`,
        ),
        r.sinLugar.length > 0
          ? h('p', {
              clase: 'aviso',
              texto: `No entran a lo ancho de la tela: ${r.sinLugar.join(', ')}. Proba con una tela mas ancha o con la tela abierta.`,
            })
          : null,
        boton('Descargar PDF de la tizada', () => descargarTizada(), {
          clase: 'boton principal ancho',
          disabled: r.piezas.length === 0,
        }),
      )
    : ayuda('Elegi cuantas prendas vas a cortar.');

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccion(
      'La tela',
      numero('Ancho de la tela', op.anchoTelaMm, (mm) => {
        op.anchoTelaMm = Math.max(100, mm);
      }),
      casilla('Doblada al medio', op.doblada, (v) => {
        op.doblada = v;
        refrescar();
      }),
      ayuda(
        op.doblada
          ? 'Como se corta en casa: la tela se dobla y cada pieza sale de a dos. Las que van al lomo se apoyan sobre el doblez.'
          : 'Tela abierta: cada pieza se corta de a una, y las que van al lomo salen desplegadas enteras.',
      ),
    ),
    seccion('Cuantas prendas', ...filasTalle, ayuda(resumenPrendas(p, op))),
    seccion(
      'Detalles',
      casilla('Cortar con margen de costura', op.incluirCostura, (v) => {
        op.incluirCostura = v;
        refrescar();
      }),
      casilla('Dejar girar las piezas 180 grados', op.girar180, (v) => {
        op.girar180 = v;
        refrescar();
      }),
      ayuda('Girar 180 grados no rompe el hilo de la tela y deja encastrar mejor las piezas. Girar 90 no se puede: la prenda quedaria torcida.'),
      numero('Separacion entre piezas', op.separacionMm, (mm) => {
        op.separacionMm = Math.min(100, mm);
      }),
      numero('Margen a los bordes', op.margenMm, (mm) => {
        op.margenMm = Math.min(100, mm);
      }),
    ),
    seccion('Tela necesaria', resultado),
  );
}

function descargarTizada(): void {
  const p = estado.proyecto;
  const op = estado.opcionesTizada;
  const r = tizadaActual();
  if (!p || !op || !r) return;
  try {
    descargarBlob(generarPdfTizada(p, op, r), nombreArchivoTizada(p));
    avisarMensaje('Tizada descargada.', 'ok');
  } catch (e) {
    avisarMensaje(e instanceof Error ? e.message : 'No se pudo generar la tizada', 'error');
  }
}

// ---------------------------------------------------------------------------
// Panel de exportacion
// ---------------------------------------------------------------------------

let opcionesExport: OpcionesExport | null = null;

function opciones(): OpcionesExport {
  const p = estado.proyecto!;
  if (!opcionesExport) opcionesExport = opcionesPorDefecto(p);
  opcionesExport.talles = opcionesExport.talles.filter((id) => p.talles.some((t) => t.id === id));
  if (opcionesExport.talles.length === 0) opcionesExport.talles = [p.talleBaseId];
  return opcionesExport;
}

export function panelExportar(): HTMLElement {
  const p = estado.proyecto;
  if (!p) return h('div');
  const op = opciones();
  const refrescar = () => actualizar({ revisionPanel: estado.revisionPanel + 1 });

  const piezasListas = p.piezas.filter((pz) => pz.incluirEnExport && pz.contorno.nodos.length >= 2);
  if (piezasListas.length === 0) {
    return h('div', { clase: 'panel-contenido' }, seccion('Exportar', ayuda('Todavia no hay piezas trazadas para exportar.')));
  }

  let info: HTMLElement;
  try {
    const lamina = armarLamina(p, op);
    if (op.hoja === 'unica') {
      info = ayuda(`Una sola hoja de ${mmACm(lamina.ancho + 2 * op.margenMm)} x ${mmACm(lamina.alto + 2 * op.margenMm)} cm.`);
    } else {
      const plan = planMosaico(op, lamina);
      info = ayuda(
        `${plan.paginas} hojas ${op.hoja} (${plan.filas} filas x ${plan.columnas} columnas, mas la hoja de control). ` +
          `El molde completo mide ${mmACm(lamina.ancho)} x ${mmACm(lamina.alto)} cm.`,
      );
    }
  } catch {
    info = ayuda('No se pudo calcular la distribucion.');
  }

  return h(
    'div',
    { clase: 'panel-contenido' },
    seccion(
      'Que talles imprimir',
      ...p.talles.map((t) =>
        casilla(t.nombre + (t.id === p.talleBaseId ? '  (base)' : ''), op.talles.includes(t.id), (v) => {
          op.talles = v ? [...op.talles, t.id] : op.talles.filter((x) => x !== t.id);
          refrescar();
        }),
      ),
      seleccion(
        'Como se acomodan',
        [
          { valor: 'separado', texto: 'Una copia de cada pieza por talle' },
          { valor: 'nido', texto: 'Todos los talles superpuestos (nido)' },
        ],
        op.modo,
        (v) => {
          op.modo = v as 'separado' | 'nido';
          refrescar();
        },
      ),
    ),
    seccion(
      'Que se dibuja',
      casilla('Margen de costura', op.incluirCostura, (v) => {
        op.incluirCostura = v;
        refrescar();
      }),
      casilla('Pinzas y lineas internas', op.incluirInternas, (v) => {
        op.incluirInternas = v;
        refrescar();
      }),
      casilla('Linea de hilo', op.incluirHilo, (v) => {
        op.incluirHilo = v;
        refrescar();
      }),
      casilla('Nombre y datos de la pieza', op.incluirEtiquetas, (v) => {
        op.incluirEtiquetas = v;
        refrescar();
      }),
    ),
    seccion(
      'Hoja',
      seleccion(
        'Tamano de hoja',
        [
          ...Object.entries(HOJAS).map(([clave, v]) => ({ valor: clave, texto: v.etiqueta })),
          { valor: 'unica', texto: 'Una sola hoja gigante (copisteria / plotter)' },
        ],
        op.hoja,
        (v) => {
          op.hoja = v as OpcionesExport['hoja'];
          refrescar();
        },
      ),
      op.hoja !== 'unica'
        ? seleccion(
            'Orientacion',
            [
              { valor: 'vertical', texto: 'Vertical' },
              { valor: 'horizontal', texto: 'Horizontal' },
            ],
            op.orientacion,
            (v) => {
              op.orientacion = v as 'vertical' | 'horizontal';
              refrescar();
            },
          )
        : null,
      campo('Margen de la hoja', mmACm(op.margenMm), (v) => {
        const mm = leerCmAMm(v);
        if (mm !== null) {
          op.margenMm = Math.max(0, Math.min(40, mm));
          refrescar();
        }
      }, { inputmode: 'decimal' }),
      op.hoja !== 'unica'
        ? campo('Solape para pegar', mmACm(op.solapeMm), (v) => {
            const mm = leerCmAMm(v);
            if (mm !== null) {
              op.solapeMm = Math.max(0, Math.min(50, mm));
              refrescar();
            }
          }, { inputmode: 'decimal' })
        : null,
      info,
    ),
    seccion(
      'Descargar',
      boton('Descargar PDF a tamano real', () => descargar('pdf'), { clase: 'boton principal ancho' }),
      h(
        'div',
        { clase: 'fila-botones' },
        boton('SVG', () => descargar('svg')),
        boton('DXF', () => descargar('dxf')),
      ),
      ayuda('Al imprimir el PDF elegi escala 100% o "tamano real". Nunca "ajustar a la pagina". La primera hoja trae un cuadrado de 5 cm para controlarlo.'),
    ),
  );
}

function descargar(formato: 'pdf' | 'svg' | 'dxf'): void {
  const p = estado.proyecto;
  if (!p) return;
  const op = opciones();
  try {
    const blob = formato === 'pdf' ? generarPdf(p, op) : formato === 'svg' ? generarSvg(p, op) : generarDxf(p, op);
    descargarBlob(blob, nombreArchivo(p, op, formato));
    avisarMensaje('Archivo generado. Fijate en tus descargas.', 'ok');
  } catch (e) {
    avisarMensaje(e instanceof Error ? e.message : 'No se pudo generar el archivo', 'error');
  }
}

export function ajustarDespuesDeCargar(): void {
  ajustarVista();
}

export type { Talle };
