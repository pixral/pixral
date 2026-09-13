/**
 * Procesamiento de la foto del molde: detectar el borde del papel
 * automaticamente para no tener que marcar punto por punto.
 */

import { simplificar } from './geometria';
import type { Punto } from './tipos';

export function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((resolver, rechazar) => {
    const img = new Image();
    img.onload = () => resolver(img);
    img.onerror = () => rechazar(new Error('No se pudo leer la imagen'));
    img.src = src;
  });
}

export function leerArchivoComoDataUrl(archivo: File | Blob): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result));
    lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
    lector.readAsDataURL(archivo);
  });
}

/** Reduce la foto para que no ocupe de mas al guardarla en el navegador. */
export function comprimir(
  fuente: HTMLImageElement | HTMLCanvasElement,
  ladoMaximo = 2000,
  calidad = 0.85,
): { dataUrl: string; ancho: number; alto: number } {
  const lado = Math.max(fuente.width, fuente.height);
  const k = lado > ladoMaximo ? ladoMaximo / lado : 1;
  const ancho = Math.max(1, Math.round(fuente.width * k));
  const alto = Math.max(1, Math.round(fuente.height * k));
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  return { dataUrl: lienzo.toDataURL('image/jpeg', calidad), ancho, alto };
}

/** Imagen en escala de grises lista para analizar. */
export interface MapaGris {
  gris: Uint8Array;
  ancho: number;
  alto: number;
}

interface Mapa extends MapaGris {
  /** Factor para volver de las coordenadas del mapa a las de la imagen. */
  escala: number;
}

function aGrises(fuente: HTMLImageElement | HTMLCanvasElement, ladoTrabajo: number): Mapa {
  const lado = Math.max(fuente.width, fuente.height);
  const k = lado > ladoTrabajo ? ladoTrabajo / lado : 1;
  const ancho = Math.max(1, Math.round(fuente.width * k));
  const alto = Math.max(1, Math.round(fuente.height * k));
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(fuente, 0, 0, ancho, alto);
  const d = ctx.getImageData(0, 0, ancho, alto).data;
  const gris = new Uint8Array(ancho * alto);
  for (let i = 0, j = 0; i < gris.length; i++, j += 4) {
    gris[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  }
  return { gris, ancho, alto, escala: 1 / k };
}

/** Umbral automatico de Otsu: separa "papel" de "fondo" sin tocar nada. */
export function umbralOtsu(gris: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (const v of gris) hist[v]++;
  const total = gris.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0;
  let pesoB = 0;
  let mejorVar = -1;
  let umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (pesoB === 0) continue;
    const pesoF = total - pesoB;
    if (pesoF === 0) break;
    sumaB += t * hist[t];
    const mediaB = sumaB / pesoB;
    const mediaF = (suma - sumaB) / pesoF;
    const varianza = pesoB * pesoF * (mediaB - mediaF) ** 2;
    if (varianza > mejorVar) {
      mejorVar = varianza;
      umbral = t;
    }
  }
  return umbral;
}

/**
 * Se queda con la mancha del molde y descarta la suciedad, las sombras y el
 * fondo.
 *
 * Entre varias manchas elige la mas grande de las que NO tocan el borde de la
 * imagen: un molde apoyado sobre la mesa entra entero en la foto, mientras que
 * el fondo y el relleno que queda al enderezar la perspectiva siempre llegan
 * hasta el borde. Si todas tocan el borde (por ejemplo cuando el molde quedo
 * cortado en la foto) se usa igual la mas grande.
 */
function manchaDelMolde(bin: Uint8Array, ancho: number, alto: number): Uint8Array {
  const etiqueta = new Int32Array(bin.length).fill(-1);
  const pila = new Int32Array(bin.length);
  const tamanos: number[] = [];
  const tocaBorde: boolean[] = [];
  let actual = 0;

  for (let inicio = 0; inicio < bin.length; inicio++) {
    if (bin[inicio] === 0 || etiqueta[inicio] !== -1) continue;
    let tope = 0;
    pila[tope++] = inicio;
    etiqueta[inicio] = actual;
    let tam = 0;
    let borde = false;
    while (tope > 0) {
      const i = pila[--tope];
      tam++;
      const x = i % ancho;
      const y = (i / ancho) | 0;
      if (x === 0 || y === 0 || x === ancho - 1 || y === alto - 1) borde = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
          const j = ny * ancho + nx;
          if (bin[j] === 1 && etiqueta[j] === -1) {
            etiqueta[j] = actual;
            pila[tope++] = j;
          }
        }
      }
    }
    tamanos.push(tam);
    tocaBorde.push(borde);
    actual++;
  }

  let elegida = -1;
  let mejor = 0;
  for (let i = 0; i < tamanos.length; i++) {
    if (!tocaBorde[i] && tamanos[i] > mejor) {
      mejor = tamanos[i];
      elegida = i;
    }
  }
  if (elegida < 0) {
    for (let i = 0; i < tamanos.length; i++) {
      if (tamanos[i] > mejor) {
        mejor = tamanos[i];
        elegida = i;
      }
    }
  }

  const salida = new Uint8Array(bin.length);
  if (elegida < 0) return salida;
  for (let i = 0; i < bin.length; i++) if (etiqueta[i] === elegida) salida[i] = 1;
  return salida;
}

/** Rellena los agujeros internos (marcas de lapiz, pinzas dibujadas). */
function rellenarHuecos(mask: Uint8Array, ancho: number, alto: number): Uint8Array {
  const fondo = new Uint8Array(mask.length);
  const pila: number[] = [];
  const empujar = (i: number) => {
    if (mask[i] === 0 && fondo[i] === 0) {
      fondo[i] = 1;
      pila.push(i);
    }
  };
  for (let x = 0; x < ancho; x++) {
    empujar(x);
    empujar((alto - 1) * ancho + x);
  }
  for (let y = 0; y < alto; y++) {
    empujar(y * ancho);
    empujar(y * ancho + ancho - 1);
  }
  while (pila.length > 0) {
    const i = pila.pop()!;
    const x = i % ancho;
    const y = (i / ancho) | 0;
    if (x > 0) empujar(i - 1);
    if (x < ancho - 1) empujar(i + 1);
    if (y > 0) empujar(i - ancho);
    if (y < alto - 1) empujar(i + ancho);
  }
  const salida = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) salida[i] = fondo[i] === 1 ? 0 : 1;
  return salida;
}

/** Recorre el borde de la mancha pixel por pixel (algoritmo de Moore). */
function trazarBorde(mask: Uint8Array, ancho: number, alto: number): Punto[] {
  let inicio = -1;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1) {
      inicio = i;
      break;
    }
  }
  if (inicio < 0) return [];

  const sx = inicio % ancho;
  const sy = (inicio / ancho) | 0;
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];

  const puntos: Punto[] = [];
  let px = sx;
  let py = sy;
  let atras = 6; // venimos desde el oeste: por el orden de barrido, ahi hay fondo
  const tope = ancho * alto * 4 + 1000;

  for (let iter = 0; iter < tope; iter++) {
    puntos.push({ x: px, y: py });
    let elegido = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (atras + k) % 8;
      const nx = px + dx[d];
      const ny = py + dy[d];
      if (nx >= 0 && ny >= 0 && nx < ancho && ny < alto && mask[ny * ancho + nx] === 1) {
        elegido = d;
        break;
      }
    }
    if (elegido < 0) break;
    px += dx[elegido];
    py += dy[elegido];
    atras = (elegido + 4) % 8;
    if (puntos.length > 2 && px === sx && py === sy) break;
  }

  return puntos;
}

export interface OpcionesDeteccion {
  /** 0..255. Si es null se calcula solo con Otsu. */
  umbral?: number | null;
  /** true cuando el molde es mas oscuro que el fondo. */
  invertir?: boolean;
  /** Cuanto se puede alejar la linea simplificada del borde real, en pixeles. */
  toleranciaPx?: number;
  ladoTrabajo?: number;
}

export interface ResultadoDeteccion {
  /** Contorno en pixeles de la imagen original. */
  puntos: Punto[];
  umbralUsado: number;
}

/**
 * Parte pura de la deteccion: recibe la imagen ya pasada a grises y devuelve
 * el contorno en coordenadas de ese mapa. Se separo del canvas para poder
 * probarla sin navegador.
 */
export function contornoDeMascara(mapa: MapaGris, opciones: OpcionesDeteccion = {}): ResultadoDeteccion {
  const { gris, ancho, alto } = mapa;
  const umbral = opciones.umbral ?? umbralOtsu(gris);
  const invertir = opciones.invertir ?? false;

  const bin = new Uint8Array(gris.length);
  for (let i = 0; i < gris.length; i++) {
    const claro = gris[i] > umbral;
    // Por defecto el molde es el papel claro sobre fondo oscuro.
    bin[i] = (invertir ? !claro : claro) ? 1 : 0;
  }

  const mancha = rellenarHuecos(manchaDelMolde(bin, ancho, alto), ancho, alto);
  const borde = trazarBorde(mancha, ancho, alto);
  if (borde.length < 8) return { puntos: [], umbralUsado: umbral };

  return { puntos: simplificar(borde, opciones.toleranciaPx ?? 1.5), umbralUsado: umbral };
}

export function detectarContorno(
  fuente: HTMLImageElement | HTMLCanvasElement,
  opciones: OpcionesDeteccion = {},
): ResultadoDeteccion {
  const mapa = aGrises(fuente, opciones.ladoTrabajo ?? 1000);
  const { puntos, umbralUsado } = contornoDeMascara(mapa, opciones);
  return {
    // Volvemos a las coordenadas de la imagen original.
    puntos: puntos.map((p) => ({ x: p.x * mapa.escala, y: p.y * mapa.escala })),
    umbralUsado,
  };
}
