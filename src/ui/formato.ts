/**
 * Conversion entre lo que se guarda (milimetros) y lo que se muestra
 * (centimetros, que es como se habla en el taller).
 */

export function mmACm(mm: number, decimales = 1): string {
  return (mm / 10).toFixed(decimales).replace('.', ',');
}

export function cmAMm(cm: number): number {
  return cm * 10;
}

/** Acepta "12,5" y "12.5". Devuelve null si no es un numero. */
export function leerCm(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (limpio === '') return null;
  const v = Number(limpio);
  return Number.isFinite(v) ? v : null;
}

/** Lee un campo en cm y lo devuelve en mm. */
export function leerCmAMm(texto: string): number | null {
  const v = leerCm(texto);
  return v === null ? null : v * 10;
}

export function fecha(ms: number): string {
  return new Date(ms).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
