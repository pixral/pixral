/** Fabricas y valores por defecto: proyectos, piezas, medidas y talles. */

import { cajaDePuntos, distancia, escalar, normalizar, resta, suma } from './geometria';
import { nuevoId } from './ids';
import type {
  Contorno,
  LineaInterna,
  Medida,
  Nodo,
  Pieza,
  Proyecto,
  Punto,
  Talle,
  TipoLinea,
} from './tipos';
import { VERSION_FORMATO } from './tipos';

export function nuevoNodo(p: Punto): Nodo {
  return { id: nuevoId('n'), p: { ...p }, ent: { x: 0, y: 0 }, sal: { x: 0, y: 0 } };
}

export function contornoDesdePuntos(pts: Punto[], cerrado = true): Contorno {
  return { nodos: pts.map(nuevoNodo), cerrado };
}

/** Un quiebre mas cerrado que esto se considera esquina de verdad y queda en punta. */
const QUIEBRE_ESQUINA = Math.cos((50 * Math.PI) / 180);

const SIN_MANIJAS = { ent: { x: 0, y: 0 }, sal: { x: 0, y: 0 } };

/**
 * Redondea el contorno sin deformarlo.
 *
 * Despues de detectar el borde en la foto quedan tramos rectos entre puntos
 * que en el molde de papel son curvas. Esto los redondea, pero con dos
 * cuidados: las esquinas de verdad (hombro, costado con el ruedo) se dejan en
 * punta, y el largo de cada manija depende del tramo que sale de ese nodo.
 * Si no, la curva se escapa para afuera y la pieza termina mas grande que el
 * molde original.
 */
export function suavizar(c: Contorno, fuerza = 1): Contorno {
  const n = c.nodos.length;
  if (n < 3) return c;
  const k = (fuerza * 1) / 3;
  return {
    cerrado: c.cerrado,
    nodos: c.nodos.map((nodo, i) => {
      const esExtremo = !c.cerrado && (i === 0 || i === n - 1);
      if (esExtremo) return { ...nodo, ...SIN_MANIJAS };

      const ant = c.nodos[(i - 1 + n) % n];
      const sig = c.nodos[(i + 1) % n];
      const dirEntrada = normalizar(resta(nodo.p, ant.p));
      const dirSalida = normalizar(resta(sig.p, nodo.p));
      const alineacion = dirEntrada.x * dirSalida.x + dirEntrada.y * dirSalida.y;
      if (alineacion < QUIEBRE_ESQUINA) return { ...nodo, ...SIN_MANIJAS };

      const tangente = normalizar(suma(dirEntrada, dirSalida));
      return {
        ...nodo,
        ent: escalar(tangente, -distancia(nodo.p, ant.p) * k),
        sal: escalar(tangente, distancia(nodo.p, sig.p) * k),
      };
    }),
  };
}

/** Deja el contorno anguloso otra vez (saca todas las curvas). */
export function enderezar(c: Contorno): Contorno {
  return {
    cerrado: c.cerrado,
    nodos: c.nodos.map((n) => ({ ...n, ent: { x: 0, y: 0 }, sal: { x: 0, y: 0 } })),
  };
}

export function nuevaLineaInterna(tipo: TipoLinea, pts: Punto[]): LineaInterna {
  const nombres: Record<TipoLinea, string> = {
    pinza: 'Pinza',
    doblez: 'Doblez',
    referencia: 'Linea de referencia',
    interna: 'Linea interna',
  };
  return {
    id: nuevoId('li'),
    nombre: nombres[tipo],
    tipo,
    contorno: contornoDesdePuntos(pts, tipo === 'pinza' ? false : false),
  };
}

export function nuevaPieza(nombre = 'Pieza nueva'): Pieza {
  return {
    id: nuevoId('pz'),
    nombre,
    cantidad: 1,
    alLomo: false,
    material: 'Tela principal',
    contorno: { nodos: [], cerrado: true },
    internas: [],
    costuraMm: 10,
    costuraPorNodo: {},
    progresion: { ejeX: 0, bordeX: 200, ejeY: 0, anchos: [], largos: [] },
    notas: '',
    incluirEnExport: true,
  };
}

/**
 * Ubica los ejes de progresion mirando la forma de la pieza.
 * Es solo un punto de partida razonable: despues se arrastran a mano.
 */
export function sugerirEjes(pieza: Pieza): Pieza {
  const pts = pieza.contorno.nodos.map((n) => n.p);
  if (pts.length < 2) return pieza;
  const caja = cajaDePuntos(pts);
  return {
    ...pieza,
    progresion: {
      ...pieza.progresion,
      ejeX: caja.x,
      bordeX: caja.x + caja.ancho,
      ejeY: caja.y,
    },
  };
}

export function medidasPorDefecto(): Medida[] {
  const def = (nombre: string, ayuda: string): Medida => ({ id: nuevoId('md'), nombre, ayuda });
  return [
    def('Contorno de busto', 'Alrededor del busto, en la parte mas ancha'),
    def('Contorno de cintura', 'Alrededor de la cintura natural'),
    def('Contorno de cadera', 'Alrededor de la cadera, en la parte mas ancha'),
    def('Largo de talle', 'Del hombro a la cintura, por delante'),
    def('Ancho de espalda', 'De axila a axila por la espalda'),
    def('Largo total', 'Del hombro al ruedo'),
    def('Contorno de brazo', 'Alrededor del brazo, cerca de la axila'),
    def('Largo de manga', 'Del hombro a la muneca'),
  ];
}

/** Tabla de arranque con talles 38 a 46. Se edita entera desde la app. */
export function tallesPorDefecto(medidas: Medida[]): { talles: Talle[]; baseId: string } {
  const cm = (v: number) => v * 10;
  const tabla: Record<string, number[]> = {
    'Contorno de busto': [88, 92, 96, 100, 104].map(cm),
    'Contorno de cintura': [68, 72, 76, 80, 84].map(cm),
    'Contorno de cadera': [94, 98, 102, 106, 110].map(cm),
    'Largo de talle': [41, 42, 43, 44, 45].map(cm),
    'Ancho de espalda': [34, 35, 36, 37, 38].map(cm),
    'Largo total': [62, 63, 64, 65, 66].map(cm),
    'Contorno de brazo': [28, 29.5, 31, 32.5, 34].map(cm),
    'Largo de manga': [58, 59, 60, 61, 62].map(cm),
  };
  const nombres = ['38', '40', '42', '44', '46'];
  const talles = nombres.map((nombre, i) => {
    const valores: Record<string, number> = {};
    for (const m of medidas) {
      const fila = tabla[m.nombre];
      if (fila) valores[m.id] = fila[i];
    }
    return { id: nuevoId('tl'), nombre, valores };
  });
  return { talles, baseId: talles[2].id };
}

export function nuevoProyecto(nombre = 'Proyecto sin nombre'): Proyecto {
  const medidas = medidasPorDefecto();
  const { talles, baseId } = tallesPorDefecto(medidas);
  const ahora = Date.now();
  return {
    id: nuevoId('pr'),
    nombre,
    creado: ahora,
    modificado: ahora,
    medidas,
    talles,
    talleBaseId: baseId,
    piezas: [],
    version: VERSION_FORMATO,
  };
}

/** Copia profunda simple; los proyectos son datos planos serializables. */
export function clonar<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Rellena lo que falte al abrir un proyecto guardado con una version vieja. */
export function migrar(p: Proyecto): Proyecto {
  const piezas = (p.piezas ?? []).map((pz) => {
    const base = nuevaPieza();
    const vieja = (pz.progresion ?? {}) as Partial<Pieza['progresion']>;
    return {
      ...base,
      ...pz,
      costuraPorNodo: pz.costuraPorNodo ?? {},
      internas: pz.internas ?? [],
      foto: pz.foto ? { ...pz.foto, calibrada: pz.foto.calibrada ?? false } : undefined,
      progresion: {
        ejeX: vieja.ejeX ?? base.progresion.ejeX,
        bordeX: vieja.bordeX ?? base.progresion.bordeX,
        ejeY: vieja.ejeY ?? base.progresion.ejeY,
        anchos: vieja.anchos ?? [],
        largos: vieja.largos ?? [],
      },
    };
  });
  return {
    ...p,
    version: VERSION_FORMATO,
    medidas: p.medidas ?? [],
    talles: p.talles ?? [],
    piezas,
  };
}
