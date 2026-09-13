import { describe, expect, it } from 'vitest';
import { aplicarHomografia, calcularHomografia, ordenarEsquinas } from './homografia';
import type { Esquinas } from './homografia';

describe('homografia', () => {
  it('lleva las 4 esquinas exactamente a destino', () => {
    const origen: Esquinas = [
      { x: 120, y: 80 },
      { x: 900, y: 140 },
      { x: 860, y: 700 },
      { x: 60, y: 640 },
    ];
    const destino: Esquinas = [
      { x: 0, y: 0 },
      { x: 210, y: 0 },
      { x: 210, y: 297 },
      { x: 0, y: 297 },
    ];
    const h = calcularHomografia(origen, destino);
    origen.forEach((p, i) => {
      const q = aplicarHomografia(h, p);
      expect(q.x).toBeCloseTo(destino[i].x, 6);
      expect(q.y).toBeCloseTo(destino[i].y, 6);
    });
  });

  it('la transformacion de ida y vuelta devuelve el punto original', () => {
    const origen: Esquinas = [
      { x: 10, y: 20 },
      { x: 400, y: 35 },
      { x: 390, y: 300 },
      { x: 5, y: 280 },
    ];
    const destino: Esquinas = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 70 },
      { x: 0, y: 70 },
    ];
    const ida = calcularHomografia(origen, destino);
    const vuelta = calcularHomografia(destino, origen);
    const p = { x: 200, y: 150 };
    const r = aplicarHomografia(vuelta, aplicarHomografia(ida, p));
    expect(r.x).toBeCloseTo(p.x, 4);
    expect(r.y).toBeCloseTo(p.y, 4);
  });

  it('rechaza 4 puntos alineados', () => {
    const degenerado: Esquinas = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(() => calcularHomografia(degenerado, degenerado)).toThrow();
  });

  it('ordena las esquinas empezando por la de arriba a la izquierda', () => {
    const sueltas = [
      { x: 100, y: 100 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const orden = ordenarEsquinas(sueltas);
    expect(orden[0]).toEqual({ x: 0, y: 0 });
    expect(orden[2]).toEqual({ x: 100, y: 100 });
  });
});
