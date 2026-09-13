import { describe, expect, it } from 'vitest';
import {
  construirDeformacion,
  deformarPunto,
  deltaDeRegla,
  escalones,
  nuevaReglaAncho,
  nuevaReglaLargo,
  piezaEnTalle,
} from './progresion';
import { contornoDesdePuntos, nuevaPieza } from './proyecto';
import type { Pieza, Proyecto } from './tipos';

/**
 * Escenario: un delantero de 20 x 40 cm cortado al medio.
 * El centro (x = 0) no se mueve y el costado (x = 200) se lleva todo el crecimiento.
 */
function escenario(): { proyecto: Proyecto; pieza: Pieza } {
  const pieza = nuevaPieza('Delantero');
  pieza.contorno = contornoDesdePuntos(
    [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 400 },
      { x: 0, y: 400 },
    ],
    true,
  );
  pieza.progresion = {
    ejeX: 0,
    bordeX: 200,
    ejeY: 0,
    anchos: [nuevaReglaAncho({ nombre: 'Busto', y: 200, medidaId: 'busto', fraccion: 0.25 })],
    largos: [nuevaReglaLargo({ nombre: 'Largo', y: 400, medidaId: 'largo', fraccion: 1 })],
  };

  const proyecto: Proyecto = {
    id: 'pr',
    nombre: 'Prueba',
    creado: 0,
    modificado: 0,
    version: 1,
    medidas: [
      { id: 'busto', nombre: 'Contorno de busto' },
      { id: 'largo', nombre: 'Largo de talle' },
    ],
    talles: [
      { id: 't38', nombre: '38', valores: { busto: 880, largo: 410 } },
      { id: 't40', nombre: '40', valores: { busto: 920, largo: 420 } },
      { id: 't42', nombre: '42', valores: { busto: 960, largo: 430 } },
    ],
    talleBaseId: 't40',
    piezas: [pieza],
  };
  return { proyecto, pieza };
}

describe('progresion por tabla de medidas', () => {
  it('cuenta los saltos de talle respecto de la base', () => {
    const { proyecto } = escenario();
    expect(escalones(proyecto, 't38')).toBe(-1);
    expect(escalones(proyecto, 't40')).toBe(0);
    expect(escalones(proyecto, 't42')).toBe(1);
  });

  it('reparte la diferencia de contorno segun la fraccion de la pieza', () => {
    const { proyecto, pieza } = escenario();
    // El busto pasa de 92 a 96 cm: 4 cm de diferencia, y a esta pieza le toca un cuarto.
    expect(deltaDeRegla(pieza.progresion.anchos[0], proyecto, 't42')).toBeCloseTo(10, 6);
    expect(deltaDeRegla(pieza.progresion.anchos[0], proyecto, 't38')).toBeCloseTo(-10, 6);
  });

  it('el talle base no deforma nada', () => {
    const { proyecto, pieza } = escenario();
    const d = construirDeformacion(pieza, proyecto, 't40');
    expect(d.identidad).toBe(true);
    expect(piezaEnTalle(pieza, proyecto, 't40')).toBe(pieza);
  });

  it('el eje fijo no se mueve y el borde se lleva todo el crecimiento', () => {
    const { proyecto, pieza } = escenario();
    const d = construirDeformacion(pieza, proyecto, 't42');
    expect(deformarPunto({ x: 0, y: 200 }, d).x).toBeCloseTo(0, 6);
    expect(deformarPunto({ x: 200, y: 200 }, d).x).toBeCloseTo(210, 6);
    // Un punto a mitad de camino se corre la mitad: 100 + 10 * (100 / 200).
    expect(deformarPunto({ x: 100, y: 200 }, d).x).toBeCloseTo(105, 6);
  });

  it('el largo crece alejandose de la altura fija', () => {
    const { proyecto, pieza } = escenario();
    const d = construirDeformacion(pieza, proyecto, 't42');
    expect(deformarPunto({ x: 0, y: 0 }, d).y).toBeCloseTo(0, 6);
    expect(deformarPunto({ x: 0, y: 400 }, d).y).toBeCloseTo(410, 6);
    // Entre el eje y la linea de largo se interpola.
    expect(deformarPunto({ x: 0, y: 200 }, d).y).toBeCloseTo(205, 6);
  });

  it('un talle mas chico achica la pieza', () => {
    const { proyecto, pieza } = escenario();
    const chica = piezaEnTalle(pieza, proyecto, 't38');
    expect(chica.contorno.nodos[1].p.x).toBeCloseTo(190, 6);
    expect(chica.contorno.nodos[2].p.y).toBeCloseTo(390, 6);
  });

  it('los nodos marcados como fijos no se mueven', () => {
    const { proyecto, pieza } = escenario();
    pieza.contorno.nodos[1].fijo = true;
    const grande = piezaEnTalle(pieza, proyecto, 't42');
    expect(grande.contorno.nodos[1].p.x).toBeCloseTo(200, 6);
    expect(grande.contorno.nodos[2].p.x).toBeCloseTo(210, 6);
  });

  it('acepta reglas cargadas a mano en milimetros por talle', () => {
    const { proyecto, pieza } = escenario();
    pieza.progresion.anchos = [nuevaReglaAncho({ y: 200, origen: 'manual', mmPorTalle: 6 })];
    const d = construirDeformacion(pieza, proyecto, 't42');
    expect(deformarPunto({ x: 200, y: 200 }, d).x).toBeCloseTo(206, 6);
  });

  it('las manijas de las curvas acompanan la deformacion', () => {
    const { proyecto, pieza } = escenario();
    pieza.contorno.nodos[1].ent = { x: 0, y: -20 };
    const grande = piezaEnTalle(pieza, proyecto, 't42');
    const nodo = grande.contorno.nodos[1];
    // La manija sigue siendo relativa al nodo y mantiene el sentido.
    expect(nodo.ent.y).toBeLessThan(0);
    expect(Math.abs(nodo.ent.y)).toBeGreaterThan(15);
  });
});
