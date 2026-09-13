/**
 * Exportacion a PDF (mosaico A4 y hoja unica), SVG y DXF.
 *
 * Regla de oro: TODO sale a tamano real. El PDF trae ademas un cuadrado de
 * control de 5 cm para verificar que la impresora no achico nada.
 */

import { limpiarNombre } from '../nucleo/almacen';
import type { Proyecto } from '../nucleo/tipos';
import {
  aplanar,
  desplazarCmds,
  dibujoDePieza,
  dibujoNido,
  distribuir,
  type Cmd,
  type Dibujo,
  type EstiloTrazo,
  type Lamina,
  type OpcionesDibujo,
} from './dibujo';
import { DocumentoPdf, HOJAS, type NombreHoja } from './pdf';

export interface OpcionesExport extends OpcionesDibujo {
  /** Ids de los talles a exportar. */
  talles: string[];
  /** 'separado' = una copia de cada pieza por talle. 'nido' = todos superpuestos. */
  modo: 'separado' | 'nido';
  /** Ids de piezas; si esta vacio salen todas las marcadas para exportar. */
  piezas: string[];
  hoja: NombreHoja | 'unica';
  orientacion: 'vertical' | 'horizontal';
  margenMm: number;
  solapeMm: number;
  separacionMm: number;
}

export function opcionesPorDefecto(proyecto: Proyecto): OpcionesExport {
  return {
    talles: [proyecto.talleBaseId],
    modo: 'separado',
    piezas: [],
    incluirCostura: true,
    incluirInternas: true,
    incluirHilo: true,
    incluirEtiquetas: true,
    hoja: 'A4',
    orientacion: 'vertical',
    margenMm: 8,
    solapeMm: 10,
    separacionMm: 12,
  };
}

function piezasElegidas(proyecto: Proyecto, op: OpcionesExport) {
  const base = proyecto.piezas.filter((p) => p.incluirEnExport && p.contorno.nodos.length >= 2);
  return op.piezas.length > 0 ? base.filter((p) => op.piezas.includes(p.id)) : base;
}

export function armarDibujos(proyecto: Proyecto, op: OpcionesExport): Dibujo[] {
  const piezas = piezasElegidas(proyecto, op);
  const talles = op.talles.length > 0 ? op.talles : [proyecto.talleBaseId];
  if (op.modo === 'nido') return piezas.map((p) => dibujoNido(p, proyecto, talles, op));
  const salida: Dibujo[] = [];
  for (const talleId of talles) for (const p of piezas) salida.push(dibujoDePieza(p, proyecto, talleId, op));
  return salida;
}

function medidaHoja(op: OpcionesExport): { ancho: number; alto: number } {
  if (op.hoja === 'unica') return { ancho: 0, alto: 0 };
  const h = HOJAS[op.hoja];
  return op.orientacion === 'horizontal' ? { ancho: h.alto, alto: h.ancho } : { ancho: h.ancho, alto: h.alto };
}

export function armarLamina(proyecto: Proyecto, op: OpcionesExport): Lamina {
  const dibujos = armarDibujos(proyecto, op);
  const anchoMaxPieza = dibujos.reduce((m, d) => Math.max(m, d.caja.ancho), 0);
  let anchoMaximo: number;
  if (op.hoja === 'unica') {
    // Ancho tipico de un rollo de plotter / copisteria.
    anchoMaximo = Math.max(anchoMaxPieza, 900);
  } else {
    const hoja = medidaHoja(op);
    const util = hoja.ancho - 2 * op.margenMm;
    const area = dibujos.reduce((s, d) => s + d.caja.ancho * d.caja.alto, 0);
    // Apuntamos a una lamina mas o menos cuadrada, redondeada a hojas enteras.
    const objetivo = Math.max(util, Math.sqrt(area * 1.5), anchoMaxPieza);
    const paso = Math.max(1, util - op.solapeMm);
    anchoMaximo = Math.max(util, Math.ceil((objetivo - op.solapeMm) / paso) * paso + op.solapeMm);
  }
  return distribuir(dibujos, anchoMaximo, op.separacionMm);
}

export interface PlanMosaico {
  columnas: number;
  filas: number;
  paginas: number;
  anchoHoja: number;
  altoHoja: number;
  utilAncho: number;
  utilAlto: number;
}

export function planMosaico(op: OpcionesExport, lamina: Lamina): PlanMosaico {
  const hoja = medidaHoja(op);
  const utilAncho = hoja.ancho - 2 * op.margenMm;
  const utilAlto = hoja.alto - 2 * op.margenMm;
  const pasoX = Math.max(1, utilAncho - op.solapeMm);
  const pasoY = Math.max(1, utilAlto - op.solapeMm);
  const columnas = Math.max(1, Math.ceil((lamina.ancho - op.solapeMm) / pasoX));
  const filas = Math.max(1, Math.ceil((lamina.alto - op.solapeMm) / pasoY));
  return {
    columnas,
    filas,
    paginas: columnas * filas + 1, // +1 por la hoja de control
    anchoHoja: hoja.ancho,
    altoHoja: hoja.alto,
    utilAncho,
    utilAlto,
  };
}

// ---------------------------------------------------------------------------
// Estilos de linea
// ---------------------------------------------------------------------------

interface Estilo {
  grosor: number;
  gris: number;
  rayas: number[] | null;
}

const ESTILOS: Record<EstiloTrazo, Estilo> = {
  contorno: { grosor: 0.45, gris: 0, rayas: null },
  costura: { grosor: 0.3, gris: 0.4, rayas: [4, 2.5] },
  pinza: { grosor: 0.3, gris: 0.15, rayas: [2.5, 2] },
  doblez: { grosor: 0.35, gris: 0.25, rayas: [8, 2, 1.5, 2] },
  referencia: { grosor: 0.22, gris: 0.6, rayas: [1.5, 1.5] },
  interna: { grosor: 0.3, gris: 0.15, rayas: null },
  hilo: { grosor: 0.4, gris: 0.1, rayas: null },
  piquete: { grosor: 0.35, gris: 0, rayas: null },
};

function aplicarEstilo(doc: DocumentoPdf, estilo: EstiloTrazo): void {
  const e = ESTILOS[estilo];
  doc.grosor(e.grosor).gris(e.gris).rayado(e.rayas);
}

export function camino(doc: DocumentoPdf, cmds: Cmd[]): void {
  for (const c of cmds) {
    if (c.t === 'M') doc.moverA(c.x, c.y);
    else if (c.t === 'L') doc.lineaA(c.x, c.y);
    else if (c.t === 'C') doc.curvaA(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else doc.cerrarCamino();
  }
}

function dibujarLamina(doc: DocumentoPdf, lamina: Lamina): void {
  for (const { dibujo, dx, dy } of lamina.colocados) {
    for (const trazo of dibujo.trazos) {
      aplicarEstilo(doc, trazo.estilo);
      camino(doc, desplazarCmds(trazo.cmds, dx, dy));
      doc.trazar();
    }
    doc.rayado(null);
    for (const et of dibujo.etiquetas) {
      const x = et.x + dx;
      const y = et.y + dy;
      if (et.negrita) doc.textoNegrita(x, y, et.texto, { tamanoMm: et.tamanoMm });
      else doc.texto(x, y, et.texto, { tamanoMm: et.tamanoMm, gris: 0.15 });
    }
  }
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

function hojaDeControl(
  doc: DocumentoPdf,
  proyecto: Proyecto,
  op: OpcionesExport,
  lamina: Lamina,
  plan: PlanMosaico,
): void {
  doc.nuevaPagina(plan.anchoHoja, plan.altoHoja);
  const m = 15;
  let y = m + 8;

  doc.textoNegrita(m, y, proyecto.nombre, { tamanoMm: 7 });
  y += 8;
  const nombresTalles = op.talles
    .map((id) => proyecto.talles.find((t) => t.id === id)?.nombre ?? '')
    .filter(Boolean)
    .join(' - ');
  doc.texto(m, y, `Talles: ${nombresTalles || '-'}`, { tamanoMm: 4 });
  y += 6;
  doc.texto(m, y, `Hojas del molde: ${plan.columnas} columnas x ${plan.filas} filas`, { tamanoMm: 4 });
  y += 6;
  doc.texto(m, y, `Medida total del molde: ${(lamina.ancho / 10).toFixed(1)} x ${(lamina.alto / 10).toFixed(1)} cm`, {
    tamanoMm: 4,
  });
  y += 12;

  doc.grosor(0.4).gris(0);
  doc.rectangulo(m, y, plan.anchoHoja - 2 * m, 0.2).rellenar();
  y += 10;

  doc.textoNegrita(m, y, 'ANTES DE IMPRIMIR TODO: control de escala', { tamanoMm: 5 });
  y += 7;
  const pasos = [
    '1. Imprimi SOLO esta hoja.',
    '2. En el cuadro de impresion elegi Escala 100% o "Tamano real".',
    '3. NO uses "Ajustar a la pagina" ni "Reducir para encajar".',
    '4. Medi con la regla el cuadrado de abajo: tiene que dar 5 cm de lado.',
    '5. Si da 5 cm, imprimi el resto. Si no, corregi la escala y probá de nuevo.',
  ];
  for (const p of pasos) {
    doc.texto(m, y, p, { tamanoMm: 3.8 });
    y += 5.5;
  }
  y += 6;

  // Cuadrado de control de 50 mm.
  doc.grosor(0.5).gris(0).rayado(null);
  doc.rectangulo(m, y, 50, 50).trazar();
  doc.texto(m + 4, y + 28, '5 cm x 5 cm', { tamanoMm: 4 });
  // Regla de 10 cm con marcas cada centimetro.
  const rx = m + 65;
  doc.rectangulo(rx, y, 100, 12).trazar();
  for (let i = 0; i <= 10; i++) {
    const alto = i % 5 === 0 ? 12 : 6;
    doc.grosor(0.3).linea(rx + i * 10, y, rx + i * 10, y + alto);
  }
  doc.texto(rx, y + 18, '10 cm de punta a punta', { tamanoMm: 3.5 });
  y += 30;

  // Mapa de armado.
  doc.textoNegrita(m, y, 'Como se arma', { tamanoMm: 5 });
  y += 7;
  doc.texto(m, y, 'Cada hoja dice su fila y su columna. Recorta por la linea punteada de la derecha', { tamanoMm: 3.6 });
  y += 5;
  doc.texto(m, y, 'y de abajo, y pega esa hoja encima de la siguiente haciendo coincidir las cruces.', { tamanoMm: 3.6 });
  y += 9;

  const anchoMapa = Math.min(plan.anchoHoja - 2 * m, 120);
  const celda = Math.min(anchoMapa / plan.columnas, 18);
  doc.grosor(0.25).gris(0.3);
  for (let f = 0; f < plan.filas; f++) {
    for (let c = 0; c < plan.columnas; c++) {
      const x = m + c * celda;
      const yy = y + f * celda;
      doc.rectangulo(x, yy, celda, celda).trazar();
      doc.texto(x + celda / 2 - 3, yy + celda / 2 + 1.5, `${f + 1}-${c + 1}`, { tamanoMm: 2.6, gris: 0.35 });
    }
  }
}

function marcasDeArmado(doc: DocumentoPdf, plan: PlanMosaico, op: OpcionesExport, fila: number, col: number): void {
  const m = op.margenMm;
  const w = plan.utilAncho;
  const h = plan.utilAlto;

  doc.gris(0.45).grosor(0.2).rayado([2, 2]);
  doc.rectangulo(m, m, w, h).trazar();

  // Cruces en las esquinas para hacer coincidir hoja con hoja.
  doc.rayado(null).grosor(0.3).gris(0);
  const cruz = (x: number, y: number) => {
    doc.linea(x - 3, y, x + 3, y);
    doc.linea(x, y - 3, x, y + 3);
  };
  cruz(m, m);
  cruz(m + w, m);
  cruz(m, m + h);
  cruz(m + w, m + h);
  cruz(m + w / 2, m);
  cruz(m + w / 2, m + h);
  cruz(m, m + h / 2);
  cruz(m + w, m + h / 2);

  doc.textoNegrita(m, m - 2.5, `FILA ${fila + 1}  -  COLUMNA ${col + 1}`, { tamanoMm: 3.4 });
  const pie = `${col + 1 < plan.columnas ? 'sigue a la derecha' : 'fin de la fila'} | ${
    fila + 1 < plan.filas ? 'sigue abajo' : 'ultima fila'
  }`;
  doc.texto(m, m + h + 4.5, pie, { tamanoMm: 3, gris: 0.45 });
}

export function generarPdf(proyecto: Proyecto, op: OpcionesExport): Blob {
  const lamina = armarLamina(proyecto, op);
  const doc = new DocumentoPdf();

  if (op.hoja === 'unica') {
    const m = op.margenMm;
    const ancho = Math.min(5000, lamina.ancho + 2 * m);
    const alto = Math.min(5000, lamina.alto + 2 * m);
    doc.nuevaPagina(ancho, alto);
    doc.guardar();
    doc.trasladar(m, m);
    dibujarLamina(doc, lamina);
    doc.restaurar();
    doc.rayado(null).gris(0.4).grosor(0.3);
    doc.rectangulo(m, m, 50, 50).trazar();
    doc.texto(m + 2, m + 28, 'control 5 cm', { tamanoMm: 3.5, gris: 0.4 });
    doc.texto(m, alto - 4, `${proyecto.nombre} - imprimir al 100%, tamano real`, { tamanoMm: 4, gris: 0.3 });
    return doc.blob();
  }

  const plan = planMosaico(op, lamina);
  hojaDeControl(doc, proyecto, op, lamina, plan);

  const pasoX = plan.utilAncho - op.solapeMm;
  const pasoY = plan.utilAlto - op.solapeMm;

  for (let f = 0; f < plan.filas; f++) {
    for (let c = 0; c < plan.columnas; c++) {
      doc.nuevaPagina(plan.anchoHoja, plan.altoHoja);
      doc.guardar();
      doc.recortarRectangulo(op.margenMm, op.margenMm, plan.utilAncho, plan.utilAlto);
      doc.trasladar(op.margenMm - c * pasoX, op.margenMm - f * pasoY);
      dibujarLamina(doc, lamina);
      doc.restaurar();
      marcasDeArmado(doc, plan, op, f, c);
    }
  }

  return doc.blob();
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const ESTILO_SVG: Record<EstiloTrazo, string> = {
  contorno: 'stroke="#000" stroke-width="0.45" fill="none"',
  costura: 'stroke="#666" stroke-width="0.3" fill="none" stroke-dasharray="4 2.5"',
  pinza: 'stroke="#222" stroke-width="0.3" fill="none" stroke-dasharray="2.5 2"',
  doblez: 'stroke="#444" stroke-width="0.35" fill="none" stroke-dasharray="8 2 1.5 2"',
  referencia: 'stroke="#999" stroke-width="0.22" fill="none" stroke-dasharray="1.5 1.5"',
  interna: 'stroke="#222" stroke-width="0.3" fill="none"',
  hilo: 'stroke="#111" stroke-width="0.4" fill="none"',
  piquete: 'stroke="#000" stroke-width="0.35" fill="none"',
};

function aD(cmds: Cmd[]): string {
  return cmds
    .map((c) => {
      if (c.t === 'M') return `M${c.x.toFixed(3)} ${c.y.toFixed(3)}`;
      if (c.t === 'L') return `L${c.x.toFixed(3)} ${c.y.toFixed(3)}`;
      if (c.t === 'C') {
        return `C${c.x1.toFixed(3)} ${c.y1.toFixed(3)} ${c.x2.toFixed(3)} ${c.y2.toFixed(3)} ${c.x.toFixed(3)} ${c.y.toFixed(3)}`;
      }
      return 'Z';
    })
    .join(' ');
}

export function generarSvg(proyecto: Proyecto, op: OpcionesExport): Blob {
  const lamina = armarLamina(proyecto, op);
  const m = op.margenMm;
  const ancho = lamina.ancho + 2 * m;
  const alto = lamina.alto + 2 * m;
  const partes: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ancho}mm" height="${alto}mm" viewBox="0 0 ${ancho} ${alto}">`,
    `<title>${proyecto.nombre}</title>`,
    `<g transform="translate(${m} ${m})">`,
  ];
  for (const { dibujo, dx, dy } of lamina.colocados) {
    partes.push(`<g id="${dibujo.id}" transform="translate(${dx} ${dy})">`);
    for (const t of dibujo.trazos) partes.push(`<path ${ESTILO_SVG[t.estilo]} d="${aD(t.cmds)}"/>`);
    for (const e of dibujo.etiquetas) {
      partes.push(
        `<text x="${e.x}" y="${e.y}" font-family="Helvetica, Arial, sans-serif" font-size="${e.tamanoMm}" ${
          e.negrita ? 'font-weight="bold"' : ''
        } fill="#111">${e.texto.replace(/[<&>]/g, '')}</text>`,
      );
    }
    partes.push('</g>');
  }
  partes.push('</g></svg>');
  return new Blob([partes.join('\n')], { type: 'image/svg+xml' });
}

// ---------------------------------------------------------------------------
// DXF (para copisterias con plotter y software de molderia)
// ---------------------------------------------------------------------------

const CAPA: Record<EstiloTrazo, string> = {
  contorno: 'CONTORNO',
  costura: 'COSTURA',
  pinza: 'PINZAS',
  doblez: 'DOBLEZ',
  referencia: 'REFERENCIA',
  interna: 'INTERNAS',
  hilo: 'HILO',
  piquete: 'PIQUETES',
};

export function generarDxf(proyecto: Proyecto, op: OpcionesExport): Blob {
  const lamina = armarLamina(proyecto, op);
  const l: string[] = [];
  const par = (codigo: number, valor: string | number) => l.push(String(codigo), String(valor));

  par(0, 'SECTION');
  par(2, 'ENTITIES');

  for (const { dibujo, dx, dy } of lamina.colocados) {
    for (const t of dibujo.trazos) {
      const pts = aplanar(desplazarCmds(t.cmds, dx, dy), 24);
      if (pts.length < 2) continue;
      const cerrado = t.cmds.some((c) => c.t === 'Z');
      par(0, 'POLYLINE');
      par(8, CAPA[t.estilo]);
      par(66, 1);
      par(70, cerrado ? 1 : 0);
      for (const p of pts) {
        par(0, 'VERTEX');
        par(8, CAPA[t.estilo]);
        par(10, p.x.toFixed(4));
        // El DXF tiene la y hacia arriba, al reves que la pantalla.
        par(20, (lamina.alto - p.y).toFixed(4));
        par(30, '0.0');
      }
      par(0, 'SEQEND');
    }
    for (const e of dibujo.etiquetas) {
      par(0, 'TEXT');
      par(8, 'TEXTOS');
      par(10, (e.x + dx).toFixed(4));
      par(20, (lamina.alto - (e.y + dy)).toFixed(4));
      par(30, '0.0');
      par(40, e.tamanoMm.toFixed(2));
      par(1, e.texto);
    }
  }

  par(0, 'ENDSEC');
  par(0, 'EOF');
  return new Blob([l.join('\n')], { type: 'application/dxf' });
}

export function nombreArchivo(proyecto: Proyecto, op: OpcionesExport, extension: string): string {
  const talles = op.talles
    .map((id) => proyecto.talles.find((t) => t.id === id)?.nombre ?? '')
    .filter(Boolean)
    .join('-');
  const sufijo = op.modo === 'nido' ? 'nido' : talles || 'talle';
  return `${limpiarNombre(proyecto.nombre)}-${sufijo}.${extension}`;
}
