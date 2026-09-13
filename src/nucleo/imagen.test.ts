import { describe, expect, it } from 'vitest';
import { cajaDePuntos } from './geometria';
import { contornoDeMascara, umbralOtsu, type MapaGris } from './imagen';

/** Fabrica un mapa de grises pintando rectangulos, como una foto de laboratorio. */
function mapa(
  ancho: number,
  alto: number,
  fondo: number,
  rectangulos: Array<{ x: number; y: number; ancho: number; alto: number; tono: number }>,
): MapaGris {
  const gris = new Uint8Array(ancho * alto).fill(fondo);
  for (const r of rectangulos) {
    for (let y = r.y; y < r.y + r.alto; y++) {
      for (let x = r.x; x < r.x + r.ancho; x++) {
        if (x >= 0 && y >= 0 && x < ancho && y < alto) gris[y * ancho + x] = r.tono;
      }
    }
  }
  return { gris, ancho, alto };
}

describe('deteccion del contorno', () => {
  it('el umbral de Otsu deja el fondo de un lado y el molde del otro', () => {
    const m = mapa(100, 100, 40, [{ x: 20, y: 20, ancho: 50, alto: 50, tono: 220 }]);
    const u = umbralOtsu(m.gris);
    // El corte va justo arriba del fondo: lo que esta por encima es el molde.
    expect(40 > u).toBe(false);
    expect(220 > u).toBe(true);
  });

  it('encuentra un molde claro sobre fondo oscuro', () => {
    const m = mapa(200, 200, 35, [{ x: 40, y: 30, ancho: 100, alto: 120, tono: 240 }]);
    const caja = cajaDePuntos(contornoDeMascara(m, { toleranciaPx: 0.8 }).puntos);
    expect(caja.x).toBeCloseTo(40, 0);
    expect(caja.y).toBeCloseTo(30, 0);
    expect(caja.ancho).toBeCloseTo(99, 0);
    expect(caja.alto).toBeCloseTo(119, 0);
  });

  it('encuentra un molde oscuro sobre fondo claro cuando se invierte', () => {
    const m = mapa(200, 200, 240, [{ x: 40, y: 30, ancho: 100, alto: 120, tono: 35 }]);
    const caja = cajaDePuntos(contornoDeMascara(m, { invertir: true, toleranciaPx: 0.8 }).puntos);
    expect(caja.ancho).toBeCloseTo(99, 0);
    expect(caja.alto).toBeCloseTo(119, 0);
  });

  it('ignora el relleno blanco del borde que deja enderezar la perspectiva', () => {
    // Marco blanco pegado al borde, fondo oscuro adentro y el molde en el medio.
    const m = mapa(240, 240, 255, [
      { x: 20, y: 20, ancho: 200, alto: 200, tono: 30 },
      { x: 60, y: 70, ancho: 90, alto: 100, tono: 245 },
    ]);
    const caja = cajaDePuntos(contornoDeMascara(m, { toleranciaPx: 0.8 }).puntos);
    expect(caja.ancho).toBeCloseTo(89, 0);
    expect(caja.alto).toBeCloseTo(99, 0);
  });

  it('entre varias piezas sueltas se queda con la mas grande', () => {
    const m = mapa(300, 200, 30, [
      { x: 20, y: 20, ancho: 60, alto: 60, tono: 240 },
      { x: 140, y: 30, ancho: 120, alto: 140, tono: 240 },
    ]);
    const caja = cajaDePuntos(contornoDeMascara(m, { toleranciaPx: 0.8 }).puntos);
    expect(caja.ancho).toBeCloseTo(119, 0);
    expect(caja.alto).toBeCloseTo(139, 0);
  });

  it('las marcas de lapiz de adentro no agujerean el contorno', () => {
    const m = mapa(200, 200, 35, [
      { x: 40, y: 30, ancho: 100, alto: 120, tono: 240 },
      { x: 60, y: 80, ancho: 60, alto: 3, tono: 60 },
    ]);
    const caja = cajaDePuntos(contornoDeMascara(m, { toleranciaPx: 0.8 }).puntos);
    expect(caja.ancho).toBeCloseTo(99, 0);
    expect(caja.alto).toBeCloseTo(119, 0);
  });

  it('si no hay nada que detectar devuelve vacio', () => {
    expect(contornoDeMascara(mapa(50, 50, 128, [])).puntos).toHaveLength(0);
  });
});
