import { describe, expect, it } from 'vitest';
import { lineaDeCorte, marcasDePiquete, margenDeSegmento } from './costura';
import { cajaDePuntos } from './geometria';
import { contornoDesdePuntos, nuevaPieza } from './proyecto';
import type { Pieza } from './tipos';

function piezaRectangular(ancho: number, alto: number, costuraMm: number): Pieza {
  const p = nuevaPieza('Prueba');
  p.contorno = contornoDesdePuntos(
    [
      { x: 0, y: 0 },
      { x: ancho, y: 0 },
      { x: ancho, y: alto },
      { x: 0, y: alto },
    ],
    true,
  );
  p.costuraMm = costuraMm;
  return p;
}

describe('margen de costura', () => {
  it('agranda el rectangulo el margen indicado en los cuatro lados', () => {
    const corte = lineaDeCorte(piezaRectangular(100, 200, 10));
    expect(corte).not.toBeNull();
    const caja = cajaDePuntos(corte!);
    expect(caja.x).toBeCloseTo(-10, 3);
    expect(caja.y).toBeCloseTo(-10, 3);
    expect(caja.ancho).toBeCloseTo(120, 3);
    expect(caja.alto).toBeCloseTo(220, 3);
  });

  it('no devuelve linea de corte cuando el margen es cero', () => {
    expect(lineaDeCorte(piezaRectangular(100, 200, 0))).toBeNull();
  });

  it('respeta un margen distinto por segmento', () => {
    const pieza = piezaRectangular(100, 200, 10);
    // El tramo de abajo (el que arranca en el tercer nodo) lleva 30 mm de ruedo.
    pieza.costuraPorNodo[pieza.contorno.nodos[2].id] = 30;
    expect(margenDeSegmento(pieza, 2)).toBe(30);
    expect(margenDeSegmento(pieza, 0)).toBe(10);
    const caja = cajaDePuntos(lineaDeCorte(pieza)!);
    expect(caja.alto).toBeCloseTo(240, 3);
  });

  it('el contorno dibujado al reves tambien crece hacia afuera', () => {
    const pieza = piezaRectangular(100, 200, 10);
    pieza.contorno.nodos.reverse();
    const caja = cajaDePuntos(lineaDeCorte(pieza)!);
    expect(caja.ancho).toBeCloseTo(120, 3);
    expect(caja.alto).toBeCloseTo(220, 3);
  });

  it('genera una marca por cada nodo con piquete', () => {
    const pieza = piezaRectangular(100, 200, 10);
    pieza.contorno.nodos[1].piquete = true;
    expect(marcasDePiquete(pieza)).toHaveLength(1);
  });
});
