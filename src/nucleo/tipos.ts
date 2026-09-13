/**
 * Modelo de datos de la app.
 *
 * UNIDADES: todo se guarda internamente en MILIMETROS. La interfaz muestra
 * centimetros porque es la unidad del taller. La conversion vive en ui/formato.ts.
 *
 * SISTEMA DE COORDENADAS: x crece hacia la derecha, y crece hacia ABAJO
 * (igual que el canvas y que una hoja apoyada en la mesa mirandola de frente).
 */

export interface Punto {
  x: number;
  y: number;
}

/**
 * Un nodo del contorno, al estilo de los nodos de Inkscape/Illustrator.
 *
 * `ent` y `sal` son las manijas de curva, guardadas como desplazamiento
 * RELATIVO al nodo. El segmento que va del nodo A al nodo B es una bezier
 * cubica con puntos de control (A + A.sal) y (B + B.ent).
 * Si ambas manijas del segmento son (0,0) el segmento es una recta.
 */
export interface Nodo {
  id: string;
  p: Punto;
  ent: Punto;
  sal: Punto;
  /** Marca de piquete (la muesca que se corta para hacer coincidir dos piezas). */
  piquete?: boolean;
  /** Si esta en true, el nodo no se mueve al progresar talles. */
  fijo?: boolean;
}

export interface Contorno {
  nodos: Nodo[];
  cerrado: boolean;
}

export type TipoLinea = 'pinza' | 'doblez' | 'referencia' | 'interna';

/** Lineas dibujadas dentro de la pieza: pinzas, bolsillos, doblez, guias. */
export interface LineaInterna {
  id: string;
  nombre: string;
  tipo: TipoLinea;
  contorno: Contorno;
}

/** Foto del molde de papel, ubicada en el espacio en milimetros. */
export interface Foto {
  /** Imagen que se muestra (ya enderezada si se corrigio la perspectiva). */
  datos: string;
  /** Imagen original, para poder rehacer la correccion de perspectiva. */
  original?: string;
  anchoPx: number;
  altoPx: number;
  /** Cuantos milimetros reales mide un pixel de la imagen. */
  mmPorPx: number;
  /**
   * true cuando la escala ya se fijo (enderezando la foto o calibrando con una
   * medida conocida). Mientras sea false, lo que se mida no es real.
   */
  calibrada: boolean;
  /** Posicion en mm de la esquina superior izquierda de la imagen. */
  offset: Punto;
  opacidad: number;
  visible: boolean;
}

export type OrigenRegla = 'medida' | 'manual';

/**
 * Regla de crecimiento horizontal (ancho).
 *
 * Dice cuanto crece la pieza EN TOTAL a una altura `y` determinada.
 * Ese crecimiento se reparte entre el eje fijo y el borde de referencia.
 */
export interface ReglaAncho {
  id: string;
  nombre: string;
  /** Altura de la linea dentro de la pieza, en mm. */
  y: number;
  origen: OrigenRegla;
  /** Id de la medida de la tabla de talles (si origen === 'medida'). */
  medidaId?: string;
  /**
   * Que parte del contorno representa esta pieza a esa altura.
   * 0.25 = un cuarto (pieza cortada al medio, mitad delantero),
   * 0.5 = medio contorno, 1 = contorno completo.
   */
  fraccion?: number;
  /** Crecimiento fijo en mm por cada salto de talle (si origen === 'manual'). */
  mmPorTalle?: number;
}

/**
 * Regla de crecimiento vertical (largo).
 *
 * La linea ubicada a la altura `y` se ALEJA del eje horizontal fijo
 * la cantidad indicada. El signo lo calcula el motor segun de que lado
 * del eje este la linea.
 */
export interface ReglaLargo {
  id: string;
  nombre: string;
  y: number;
  origen: OrigenRegla;
  medidaId?: string;
  fraccion?: number;
  mmPorTalle?: number;
}

export interface ReglasProgresion {
  /** x en mm que NO se mueve (tipicamente el centro delantero o el doblez). */
  ejeX: number;
  /** x en mm donde se aplica el 100% del crecimiento (tipicamente el costado). */
  bordeX: number;
  /** y en mm que NO se mueve (tipicamente la linea de cintura). */
  ejeY: number;
  anchos: ReglaAncho[];
  largos: ReglaLargo[];
}

export interface Pieza {
  id: string;
  nombre: string;
  /** Cuantas veces hay que cortarla. */
  cantidad: number;
  /** Se corta sobre el doblez de la tela (se refleja al cortar). */
  alLomo: boolean;
  /** Tela o material: "principal", "forro", "entretela"... */
  material: string;
  contorno: Contorno;
  internas: LineaInterna[];
  /** Linea de hilo / sentido del hilo de la tela. */
  hilo?: { a: Punto; b: Punto };
  /** Margen de costura por defecto, en mm. 0 = sin margen. */
  costuraMm: number;
  /** Margen distinto para el segmento que arranca en el nodo indicado. */
  costuraPorNodo: Record<string, number>;
  foto?: Foto;
  progresion: ReglasProgresion;
  notas: string;
  /** Si esta en false no entra en las exportaciones. */
  incluirEnExport: boolean;
}

/** Una medida del cuerpo o de la prenda: "Contorno de busto", "Largo de talle". */
export interface Medida {
  id: string;
  nombre: string;
  /** Texto de ayuda que se muestra en la tabla. */
  ayuda?: string;
}

export interface Talle {
  id: string;
  nombre: string;
  /** medidaId -> valor en mm. */
  valores: Record<string, number>;
}

export interface Proyecto {
  id: string;
  nombre: string;
  creado: number;
  modificado: number;
  medidas: Medida[];
  /** Ordenados de menor a mayor. El orden define el "salto de talle". */
  talles: Talle[];
  talleBaseId: string;
  piezas: Pieza[];
  /** Version del formato, para migrar proyectos viejos. */
  version: number;
}

export const VERSION_FORMATO = 1;
