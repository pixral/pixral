/**
 * Generador de PDF minimo, escrito a mano.
 *
 * La razon de no usar una libreria es el control exacto de la escala: si el
 * molde no imprime a tamano real, no sirve para nada. Aca el sistema de
 * coordenadas es directamente MILIMETROS con la y hacia abajo, igual que en
 * el editor, y la unica conversion es la de mm a puntos PostScript.
 */

const MM_A_PT = 72 / 25.4;

function aLatin1(texto: string): string {
  let salida = '';
  for (const ch of texto) {
    const c = ch.codePointAt(0)!;
    salida += c <= 255 ? String.fromCharCode(c) : '?';
  }
  return salida;
}

function escaparTexto(texto: string): string {
  return aLatin1(texto).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const num = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

export interface OpcionesTexto {
  tamanoMm?: number;
  gris?: number;
  centrado?: boolean;
  /** Ancho disponible, necesario para centrar. */
  ancho?: number;
}

export class DocumentoPdf {
  private objetos: string[] = [];
  private paginas: number[] = [];
  private flujo: string[] = [];
  private altoPagina = 0;
  private anchoPagina = 0;
  private abierta = false;

  /** Abre una pagina nueva. Cierra la anterior si habia una. */
  nuevaPagina(anchoMm: number, altoMm: number): void {
    if (this.abierta) this.cerrarPagina();
    this.anchoPagina = anchoMm;
    this.altoPagina = altoMm;
    this.flujo = [];
    this.abierta = true;
    // Origen arriba a la izquierda y unidades en mm.
    this.flujo.push(`${num(MM_A_PT)} 0 0 ${num(-MM_A_PT)} 0 ${num(altoMm * MM_A_PT)} cm`);
    this.flujo.push('1 J 1 j');
  }

  private cerrarPagina(): void {
    const contenido = this.flujo.join('\n');
    const idContenido = this.agregarObjeto(
      `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    );
    const idPagina = this.agregarObjeto(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.anchoPagina * MM_A_PT)} ${num(
        this.altoPagina * MM_A_PT,
      )}] /Resources << /Font << /F1 ${this.idFuenteNormal} 0 R /F2 ${this.idFuenteNegrita} 0 R >> >> /Contents ${idContenido} 0 R >>`,
    );
    this.paginas.push(idPagina);
    this.abierta = false;
  }

  private idFuenteNormal = 0;
  private idFuenteNegrita = 0;

  private agregarObjeto(cuerpo: string): number {
    this.objetos.push(cuerpo);
    return this.objetos.length + 2; // los objetos 1 y 2 son el catalogo y las paginas
  }

  constructor() {
    this.idFuenteNormal = this.agregarObjeto(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    this.idFuenteNegrita = this.agregarObjeto(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
  }

  // --- estado de dibujo --------------------------------------------------

  grosor(mm: number): this {
    this.flujo.push(`${num(mm)} w`);
    return this;
  }

  gris(v: number): this {
    this.flujo.push(`${num(v)} G ${num(v)} g`);
    return this;
  }

  colorRgb(r: number, g: number, b: number): this {
    this.flujo.push(`${num(r)} ${num(g)} ${num(b)} RG ${num(r)} ${num(g)} ${num(b)} rg`);
    return this;
  }

  /** Patron de rayas en mm. null vuelve a linea llena. */
  rayado(patron: number[] | null): this {
    this.flujo.push(patron && patron.length ? `[${patron.map(num).join(' ')}] 0 d` : '[] 0 d');
    return this;
  }

  guardar(): this {
    this.flujo.push('q');
    return this;
  }

  restaurar(): this {
    this.flujo.push('Q');
    return this;
  }

  trasladar(x: number, y: number): this {
    this.flujo.push(`1 0 0 1 ${num(x)} ${num(y)} cm`);
    return this;
  }

  recortarRectangulo(x: number, y: number, ancho: number, alto: number): this {
    this.flujo.push(`${num(x)} ${num(y)} ${num(ancho)} ${num(alto)} re W n`);
    return this;
  }

  // --- caminos -----------------------------------------------------------

  moverA(x: number, y: number): this {
    this.flujo.push(`${num(x)} ${num(y)} m`);
    return this;
  }

  lineaA(x: number, y: number): this {
    this.flujo.push(`${num(x)} ${num(y)} l`);
    return this;
  }

  curvaA(x1: number, y1: number, x2: number, y2: number, x: number, y: number): this {
    this.flujo.push(`${num(x1)} ${num(y1)} ${num(x2)} ${num(y2)} ${num(x)} ${num(y)} c`);
    return this;
  }

  cerrarCamino(): this {
    this.flujo.push('h');
    return this;
  }

  trazar(): this {
    this.flujo.push('S');
    return this;
  }

  rellenar(): this {
    this.flujo.push('f');
    return this;
  }

  rectangulo(x: number, y: number, ancho: number, alto: number): this {
    this.flujo.push(`${num(x)} ${num(y)} ${num(ancho)} ${num(alto)} re`);
    return this;
  }

  linea(x1: number, y1: number, x2: number, y2: number): this {
    return this.moverA(x1, y1).lineaA(x2, y2).trazar();
  }

  // --- texto -------------------------------------------------------------

  /** Ancho aproximado del texto en mm (Helvetica ~0.52 em promedio). */
  anchoTexto(texto: string, tamanoMm: number): number {
    return texto.length * tamanoMm * 0.52;
  }

  texto(x: number, y: number, texto: string, opciones: OpcionesTexto = {}): this {
    const tam = opciones.tamanoMm ?? 3.5;
    const g = opciones.gris ?? 0;
    let px = x;
    if (opciones.centrado && opciones.ancho) {
      px = x + (opciones.ancho - this.anchoTexto(texto, tam)) / 2;
    }
    // La matriz de texto invierte la y para compensar el sistema de la pagina.
    this.flujo.push(
      `BT ${num(g)} g /F1 ${num(tam)} Tf 1 0 0 -1 ${num(px)} ${num(y)} Tm (${escaparTexto(texto)}) Tj ET`,
    );
    return this;
  }

  textoNegrita(x: number, y: number, texto: string, opciones: OpcionesTexto = {}): this {
    const tam = opciones.tamanoMm ?? 3.5;
    const g = opciones.gris ?? 0;
    this.flujo.push(
      `BT ${num(g)} g /F2 ${num(tam)} Tf 1 0 0 -1 ${num(x)} ${num(y)} Tm (${escaparTexto(texto)}) Tj ET`,
    );
    return this;
  }

  // --- salida ------------------------------------------------------------

  private armar(): string {
    if (this.abierta) this.cerrarPagina();
    const cuerpos: string[] = [];
    cuerpos[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    cuerpos[1] = `<< /Type /Pages /Kids [${this.paginas.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.paginas.length} >>`;
    this.objetos.forEach((o, i) => {
      cuerpos[i + 2] = o;
    });

    let salida = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const posiciones: number[] = [];
    cuerpos.forEach((cuerpo, i) => {
      posiciones[i] = salida.length;
      salida += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`;
    });

    const inicioXref = salida.length;
    salida += `xref\n0 ${cuerpos.length + 1}\n0000000000 65535 f \n`;
    for (const pos of posiciones) salida += `${String(pos).padStart(10, '0')} 00000 n \n`;
    salida += `trailer\n<< /Size ${cuerpos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`;
    return salida;
  }

  blob(): Blob {
    const texto = this.armar();
    const bytes = new Uint8Array(texto.length);
    for (let i = 0; i < texto.length; i++) bytes[i] = texto.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

export const HOJAS = {
  A4: { ancho: 210, alto: 297, etiqueta: 'A4 (21 x 29,7 cm)' },
  A3: { ancho: 297, alto: 420, etiqueta: 'A3 (29,7 x 42 cm)' },
  Carta: { ancho: 215.9, alto: 279.4, etiqueta: 'Carta (21,6 x 27,9 cm)' },
  Oficio: { ancho: 215.9, alto: 355.6, etiqueta: 'Oficio (21,6 x 35,6 cm)' },
} as const;

export type NombreHoja = keyof typeof HOJAS;
