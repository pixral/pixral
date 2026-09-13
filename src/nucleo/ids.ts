/** Identificadores cortos y unicos para nodos, piezas, reglas, etc. */
let contador = 0;

export function nuevoId(prefijo: string): string {
  contador += 1;
  const azar = Math.random().toString(36).slice(2, 7);
  return `${prefijo}_${Date.now().toString(36)}${contador.toString(36)}${azar}`;
}
