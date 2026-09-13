/**
 * PDF de la tizada: una hoja A4 con el dibujo de la tela a escala, las piezas
 * acomodadas y, arriba de todo, cuantos metros hay que comprar.
 *
 * A diferencia de los moldes, esto NO se imprime a tamano real: es un plano
 * para mirar mientras se acomoda la tela sobre la mesa.
 */

import type { Proyecto } from '../nucleo/tipos';
import { camino } from './exportadores';
import { DocumentoPdf, HOJAS } from './pdf';
import { limpiarNombre } from '../nucleo/almacen';
import type { EstiloTrazo } from './dibujo';
import { mapearTrazos } from './dibujo';
import { resumenPrendas, type OpcionesTizada, type ResultadoTizada } from './tizada';

const ESCALAS = [2, 2.5, 3, 4, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 75, 100];

/** Elige la escala "redonda" mas grande que entra en el espacio disponible. */
function elegirEscala(anchoMm: number, largoMm: number, anchoHueco: number, altoHueco: number) {
  const limite = Math.min(anchoHueco / Math.max(anchoMm, 1), altoHueco / Math.max(largoMm, 1));
  const redonda = ESCALAS.find((d) => 1 / d <= limite);
  if (redonda) return { factor: 1 / redonda, texto: `Escala 1:${String(redonda).replace('.', ',')}` };
  return { factor: limite, texto: `Escala 1:${(1 / limite).toFixed(0)} (aproximada)` };
}

const cm = (mm: number) => (mm / 10).toFixed(1).replace('.', ',');
const metros = (mm: number) => (mm / 1000).toFixed(2).replace('.', ',');

/** En la tizada solo interesan el contorno de corte, el hilo y el doblez. */
const VISIBLES: EstiloTrazo[] = ['contorno', 'costura', 'hilo', 'doblez', 'pinza'];

const GROSOR: Partial<Record<EstiloTrazo, number>> = {
  contorno: 0.25,
  costura: 0.35,
  hilo: 0.2,
  doblez: 0.2,
  pinza: 0.15,
};

export function generarPdfTizada(
  proyecto: Proyecto,
  op: OpcionesTizada,
  r: ResultadoTizada,
): Blob {
  const hoja = HOJAS.A4;
  const doc = new DocumentoPdf();
  doc.nuevaPagina(hoja.ancho, hoja.alto);

  const m = 14;
  let y = m + 8;

  doc.textoNegrita(m, y, `TIZADA - ${proyecto.nombre}`, { tamanoMm: 6 });
  y += 8;
  doc.texto(m, y, resumenPrendas(proyecto, op), { tamanoMm: 3.6, gris: 0.2 });
  y += 5.5;
  doc.texto(
    m,
    y,
    op.doblada
      ? `Tela de ${cm(op.anchoTelaMm)} cm doblada al medio (ancho util ${cm(r.anchoUtilMm)} cm)`
      : `Tela de ${cm(op.anchoTelaMm)} cm abierta`,
    { tamanoMm: 3.6, gris: 0.2 },
  );
  y += 8;

  doc.textoNegrita(m, y, `NECESITAS ${metros(r.largoMm)} m de tela`, { tamanoMm: 6.5 });
  y += 7;

  const hueco = { ancho: hoja.ancho - 2 * m - 16, alto: hoja.alto - y - 22 };
  const escala = elegirEscala(r.anchoUtilMm, r.largoMm, hueco.ancho, hueco.alto);

  doc.texto(
    m,
    y,
    `Aprovechamiento ${(r.aprovechamiento * 100).toFixed(0)}% - ${r.piezas.length} piezas a cortar - ${escala.texto}`,
    { tamanoMm: 3.4, gris: 0.35 },
  );
  y += 5;
  if (r.sinLugar.length > 0) {
    doc.texto(m, y, `No entran a lo ancho de la tela: ${r.sinLugar.join(', ')}`, { tamanoMm: 3.4, gris: 0.2 });
    y += 5;
  }
  y += 4;

  // --- la tela ---
  const anchoDibujo = r.anchoUtilMm * escala.factor;
  const altoDibujo = r.largoMm * escala.factor;
  const x0 = m + 8 + Math.max(0, (hueco.ancho - anchoDibujo) / 2);
  const y0 = y + 6;

  doc.texto(x0, y0 - 2, op.doblada ? 'DOBLEZ' : 'ORILLO', { tamanoMm: 3, gris: 0.35 });
  const textoDerecha = 'ORILLO';
  doc.texto(x0 + anchoDibujo - doc.anchoTexto(textoDerecha, 3), y0 - 2, textoDerecha, { tamanoMm: 3, gris: 0.35 });

  doc.rayado(null).gris(0.94);
  doc.rectangulo(x0, y0, anchoDibujo, altoDibujo).rellenar();
  doc.gris(0.35).grosor(0.3);
  doc.rectangulo(x0, y0, anchoDibujo, altoDibujo).trazar();
  if (op.doblada) {
    // El doblez se marca mas grueso: ahi la tela no se corta.
    doc.gris(0).grosor(0.8);
    doc.linea(x0, y0, x0, y0 + altoDibujo);
  }

  // Regla en centimetros sobre el costado derecho.
  const pasoRegla = altoDibujo / (r.largoMm / 100) > 4 ? 100 : 500;
  doc.gris(0.45).grosor(0.2);
  for (let mm = 0; mm <= r.largoMm; mm += pasoRegla) {
    const py = y0 + mm * escala.factor;
    doc.linea(x0 + anchoDibujo, py, x0 + anchoDibujo + 2.5, py);
    doc.texto(x0 + anchoDibujo + 3.5, py + 1, `${Math.round(mm / 10)}`, { tamanoMm: 2.5, gris: 0.45 });
  }

  // --- las piezas ---
  for (const pieza of r.piezas) {
    const trazos = mapearTrazos(pieza.trazos, (p) => ({
      x: x0 + p.x * escala.factor,
      y: y0 + p.y * escala.factor,
    }));
    for (const t of trazos) {
      if (!VISIBLES.includes(t.estilo)) continue;
      doc.gris(t.estilo === 'costura' ? 0 : 0.5).grosor(GROSOR[t.estilo] ?? 0.2);
      doc.rayado(t.estilo === 'contorno' && op.incluirCostura ? [1.2, 1] : null);
      camino(doc, t.cmds);
      doc.trazar();
    }
    doc.rayado(null);
    const cx = x0 + (pieza.caja.x + pieza.caja.ancho / 2) * escala.factor;
    const cy = y0 + (pieza.caja.y + pieza.caja.alto / 2) * escala.factor;
    const tam = Math.min(3.2, Math.max(1.8, pieza.caja.ancho * escala.factor * 0.11));
    doc.texto(cx - doc.anchoTexto(pieza.etiqueta, tam) / 2, cy, pieza.etiqueta, { tamanoMm: tam, gris: 0 });
    if (pieza.alDoblez) {
      doc.texto(cx - doc.anchoTexto('AL LOMO', tam * 0.85) / 2, cy + tam + 0.6, 'AL LOMO', {
        tamanoMm: tam * 0.85,
        gris: 0.35,
      });
    }
  }

  doc.texto(m, hoja.alto - m, 'Las piezas solo se giran 180 grados: la linea de hilo va siempre paralela al orillo.', {
    tamanoMm: 3,
    gris: 0.45,
  });

  return doc.blob();
}

export function nombreArchivoTizada(proyecto: Proyecto): string {
  return `${limpiarNombre(proyecto.nombre)}-tizada.pdf`;
}
