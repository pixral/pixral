/**
 * Acomodado de formas irregulares sobre una tira de ancho fijo.
 *
 * Es el motor de la tizada: recibe los contornos de corte y los va apoyando
 * de arriba hacia abajo sobre la tela, buscando gastar el menor largo posible.
 *
 * Como funciona:
 *
 *  - Cada forma se pasa a una grilla de celdas (por defecto de 4 mm), ya
 *    engordada la mitad de la separacion que se quiere entre piezas.
 *  - Se guarda el "perfil" de cada columna: en que celda empieza y en cual
 *    termina. Eso es lo que permite que dos piezas se encastren: la curva de
 *    una sisa entra en el hueco que deja la de al lado.
 *  - Se lleva un "horizonte" con la altura ocupada en cada columna de la tela.
 *    Para cada posicion horizontal se calcula cuanto hay que bajar la pieza
 *    para que apoye, y se elige la que deja la tela mas corta.
 *
 * No es un encimado optimo (eso es un problema muy caro de resolver), pero es
 * determinista, rapido y bastante mejor que acomodar por rectangulos.
 */

import { cajaDePuntos, type Caja } from './geometria';
import type { Punto } from './tipos';

export interface Forma {
  id: string;
  /** Contornos cerrados en mm. Varios cuando la pieza va desplegada. */
  poligonos: Punto[][];
  /** Si es true va pegada al borde izquierdo, que es el doblez de la tela. */
  alDoblez?: boolean;
  /** Giros permitidos en grados. Solo se contemplan 0 y 180. */
  giros?: number[];
}

export interface OpcionesEncimado {
  /** Ancho util de la tira, en mm (ya descontado lo que sea). */
  anchoMm: number;
  /** Separacion minima entre piezas, en mm. */
  separacionMm: number;
  /** Margen libre contra los bordes, en mm. */
  margenMm: number;
  /** Tamano de celda de la grilla. Mas chico = mejor encastre y mas lento. */
  celdaMm: number;
}

export interface Ubicacion {
  id: string;
  /** 0 o 180. El giro se aplica respecto del origen (0,0). */
  giro: number;
  /** Desplazamiento a aplicar DESPUES del giro. */
  dx: number;
  dy: number;
}

export interface ResultadoEncimado {
  ubicaciones: Ubicacion[];
  /** Largo de tela ocupado, en mm, margenes incluidos. */
  largoMm: number;
  /** Ids que no entraron porque son mas anchos que la tela. */
  sinLugar: string[];
}

interface Mascara {
  ancho: number;
  alto: number;
  /** Primera celda ocupada de cada columna, -1 si la columna esta vacia. */
  desde: Int32Array;
  /** Una celda despues de la ultima ocupada. */
  hasta: Int32Array;
  /** Posicion en mm de la esquina de la celda (0,0). */
  origen: Punto;
  cajaOriginal: Caja;
}

function girar(p: Punto, giro: number): Punto {
  return giro === 180 ? { x: -p.x, y: -p.y } : p;
}

/** Pasa los poligonos a una grilla, engordandolos `dilatacionMm`. */
function rasterizar(poligonos: Punto[][], celda: number, dilatacionMm: number): Mascara | null {
  const todos = poligonos.flat();
  if (todos.length < 3) return null;
  const caja = cajaDePuntos(todos);
  const dil = Math.max(0, dilatacionMm);
  const origen = { x: caja.x - dil, y: caja.y - dil };
  const ancho = Math.max(1, Math.ceil((caja.ancho + 2 * dil) / celda));
  const alto = Math.max(1, Math.ceil((caja.alto + 2 * dil) / celda));
  const celdas = new Uint8Array(ancho * alto);

  const marcar = (cx: number, cy: number) => {
    if (cx >= 0 && cy >= 0 && cx < ancho && cy < alto) celdas[cy * ancho + cx] = 1;
  };

  for (const poli of poligonos) {
    if (poli.length < 3) continue;
    // Relleno por lineas de barrido: se marca lo que queda adentro.
    for (let j = 0; j < alto; j++) {
      const y = origen.y + (j + 0.5) * celda;
      const cortes: number[] = [];
      for (let i = 0, k = poli.length - 1; i < poli.length; k = i++) {
        const a = poli[k];
        const b = poli[i];
        if (a.y <= y === b.y <= y) continue;
        cortes.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
      cortes.sort((p, q) => p - q);
      for (let t = 0; t + 1 < cortes.length; t += 2) {
        const i0 = Math.ceil((cortes[t] - origen.x) / celda - 0.5);
        const i1 = Math.floor((cortes[t + 1] - origen.x) / celda - 0.5);
        for (let i = i0; i <= i1; i++) marcar(i, j);
      }
    }
    // El borde tambien se marca, para que una pieza finita no se pierda.
    for (let i = 0, k = poli.length - 1; i < poli.length; k = i++) {
      const a = poli[k];
      const b = poli[i];
      const pasos = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (celda / 2)));
      for (let s = 0; s <= pasos; s++) {
        const t = s / pasos;
        marcar(
          Math.floor((a.x + (b.x - a.x) * t - origen.x) / celda),
          Math.floor((a.y + (b.y - a.y) * t - origen.y) / celda),
        );
      }
    }
  }

  // Engorde: separable, primero en x y despues en y.
  const radio = Math.round(dil / celda);
  let fuente = celdas;
  if (radio > 0) {
    const paso1 = new Uint8Array(ancho * alto);
    for (let j = 0; j < alto; j++) {
      for (let i = 0; i < ancho; i++) {
        if (!fuente[j * ancho + i]) continue;
        for (let d = -radio; d <= radio; d++) {
          const x = i + d;
          if (x >= 0 && x < ancho) paso1[j * ancho + x] = 1;
        }
      }
    }
    const paso2 = new Uint8Array(ancho * alto);
    for (let j = 0; j < alto; j++) {
      for (let i = 0; i < ancho; i++) {
        if (!paso1[j * ancho + i]) continue;
        for (let d = -radio; d <= radio; d++) {
          const y = j + d;
          if (y >= 0 && y < alto) paso2[y * ancho + i] = 1;
        }
      }
    }
    fuente = paso2;
  }

  const desde = new Int32Array(ancho).fill(-1);
  const hasta = new Int32Array(ancho).fill(-1);
  for (let i = 0; i < ancho; i++) {
    for (let j = 0; j < alto; j++) {
      if (!fuente[j * ancho + i]) continue;
      if (desde[i] < 0) desde[i] = j;
      hasta[i] = j + 1;
    }
  }
  if (desde.every((v) => v < 0)) return null;
  return { ancho, alto, desde, hasta, origen, cajaOriginal: caja };
}

interface Variante {
  giro: number;
  mascara: Mascara;
}

export function acomodar(formas: Forma[], op: OpcionesEncimado): ResultadoEncimado {
  const celda = Math.max(1, op.celdaMm);
  const dil = op.separacionMm / 2;
  // La grilla arranca en -dil, asi el borde real de cada pieza cae justo en
  // un multiplo de la celda y las cuentas de margen y doblez dan exactas.
  const columnas = Math.max(1, Math.ceil((op.anchoMm + 2 * dil) / celda) + 2);
  const filaInicial = Math.ceil(op.margenMm / celda);
  const horizonte = new Int32Array(columnas).fill(filaInicial);
  const ubicaciones: Ubicacion[] = [];
  const sinLugar: string[] = [];
  let largoOcupadoMm = 0;

  // Las piezas al doblez van primero porque tienen la posicion forzada, y
  // despues las mas grandes, que son las dificiles de ubicar.
  const areaDe = (f: Forma) => {
    const c = cajaDePuntos(f.poligonos.flat());
    return c.ancho * c.alto;
  };
  const orden = formas.slice().sort((a, b) => {
    if (!!a.alDoblez !== !!b.alDoblez) return a.alDoblez ? -1 : 1;
    return areaDe(b) - areaDe(a);
  });

  for (const forma of orden) {
    const giros = forma.alDoblez ? [0] : (forma.giros ?? [0]);
    const variantes: Variante[] = [];
    for (const giro of giros) {
      const polis = forma.poligonos.map((poli) => poli.map((p) => girar(p, giro)));
      const m = rasterizar(polis, celda, dil);
      if (m) variantes.push({ giro, mascara: m });
    }
    if (variantes.length === 0) continue;

    let mejor: { variante: Variante; cx: number; cy: number; alto: number } | null = null;
    for (const variante of variantes) {
      const m = variante.mascara;
      // Una pieza al lomo se corta sobre el doblez, asi que apoya en x = 0.
      // Las demas respetan el margen contra los dos bordes.
      const desdeX = forma.alDoblez ? 0 : Math.ceil(op.margenMm / celda);
      const hastaX = forma.alDoblez
        ? 0
        : Math.floor((op.anchoMm - op.margenMm - m.cajaOriginal.ancho) / celda);
      if (hastaX < desdeX) continue;
      if (forma.alDoblez && m.cajaOriginal.ancho > op.anchoMm - op.margenMm) continue;

      for (let cx = desdeX; cx <= hastaX; cx++) {
        if (cx + m.ancho > columnas) break;
        let cy = filaInicial;
        for (let c = 0; c < m.ancho; c++) {
          if (m.desde[c] < 0) continue;
          const apoyo = horizonte[cx + c] - m.desde[c];
          if (apoyo > cy) cy = apoyo;
        }
        let alto = 0;
        for (let c = 0; c < m.ancho; c++) {
          if (m.hasta[c] > 0) alto = Math.max(alto, cy + m.hasta[c]);
        }
        if (!mejor || alto < mejor.alto || (alto === mejor.alto && cx < mejor.cx)) {
          mejor = { variante, cx, cy, alto };
        }
      }
    }

    if (!mejor) {
      sinLugar.push(forma.id);
      continue;
    }

    const m = mejor.variante.mascara;
    // El borde de la pieza cae justo en el limite de la celda elegida.
    const bordeX = mejor.cx * celda;
    const bordeY = mejor.cy * celda;
    ubicaciones.push({
      id: forma.id,
      giro: mejor.variante.giro,
      dx: bordeX - m.cajaOriginal.x,
      dy: bordeY - m.cajaOriginal.y,
    });
    largoOcupadoMm = Math.max(largoOcupadoMm, bordeY + m.cajaOriginal.alto);

    for (let c = 0; c < m.ancho; c++) {
      if (m.hasta[c] <= 0) continue;
      horizonte[mejor.cx + c] = Math.max(horizonte[mejor.cx + c], mejor.cy + m.hasta[c]);
    }
  }

  return {
    ubicaciones,
    largoMm: ubicaciones.length === 0 ? 0 : largoOcupadoMm + op.margenMm,
    sinLugar,
  };
}
