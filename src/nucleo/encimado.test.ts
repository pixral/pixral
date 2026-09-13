import { describe, expect, it } from 'vitest';
import { acomodar, type Forma } from './encimado';
import { cajaDePuntos } from './geometria';
import type { Punto } from './tipos';

const rect = (ancho: number, alto: number): Punto[] => [
  { x: 0, y: 0 },
  { x: ancho, y: 0 },
  { x: ancho, y: alto },
  { x: 0, y: alto },
];

/** Triangulo rectangulo con el angulo recto arriba a la izquierda. */
const triangulo = (ancho: number, alto: number): Punto[] => [
  { x: 0, y: 0 },
  { x: ancho, y: 0 },
  { x: 0, y: alto },
];

const forma = (id: string, poli: Punto[], extra: Partial<Forma> = {}): Forma => ({
  id,
  poligonos: [poli],
  ...extra,
});

/** Aplica la ubicacion a los poligonos, para poder controlar el resultado. */
function ubicar(f: Forma, u: { giro: number; dx: number; dy: number }): Punto[] {
  return f.poligonos.flat().map((p) => {
    const g = u.giro === 180 ? { x: -p.x, y: -p.y } : p;
    return { x: g.x + u.dx, y: g.y + u.dy };
  });
}

const seSuperponen = (a: Punto[], b: Punto[], holgura = 0) => {
  const ca = cajaDePuntos(a);
  const cb = cajaDePuntos(b);
  return (
    ca.x < cb.x + cb.ancho - holgura &&
    cb.x < ca.x + ca.ancho - holgura &&
    ca.y < cb.y + cb.alto - holgura &&
    cb.y < ca.y + ca.alto - holgura
  );
};

const opciones = { anchoMm: 300, separacionMm: 10, margenMm: 10, celdaMm: 4 };

describe('encimado', () => {
  it('pone dos piezas una al lado de la otra si entran a lo ancho', () => {
    const a = forma('a', rect(100, 120));
    const b = forma('b', rect(100, 120));
    const r = acomodar([a, b], opciones);
    expect(r.ubicaciones).toHaveLength(2);
    expect(r.sinLugar).toHaveLength(0);
    // Entran las dos a lo ancho: la tela se gasta solo el alto de una.
    expect(r.largoMm).toBeLessThan(150);
  });

  it('las piezas no se pisan y respetan la separacion', () => {
    const formas = [forma('a', rect(100, 120)), forma('b', rect(100, 120)), forma('c', rect(120, 90))];
    const r = acomodar(formas, opciones);
    const puestas = r.ubicaciones.map((u) => ubicar(formas.find((f) => f.id === u.id)!, u));
    for (let i = 0; i < puestas.length; i++) {
      for (let j = i + 1; j < puestas.length; j++) {
        expect(seSuperponen(puestas[i], puestas[j])).toBe(false);
      }
    }
  });

  it('deja el margen contra los bordes de la tela', () => {
    const a = forma('a', rect(100, 120));
    const r = acomodar([a], opciones);
    const caja = cajaDePuntos(ubicar(a, r.ubicaciones[0]));
    expect(caja.x).toBeGreaterThanOrEqual(opciones.margenMm - 0.01);
    expect(caja.y).toBeGreaterThanOrEqual(opciones.margenMm - 0.01);
    expect(caja.x + caja.ancho).toBeLessThanOrEqual(opciones.anchoMm - opciones.margenMm + 0.01);
  });

  it('encastra dos piezas girandolas, en vez de apilarlas', () => {
    // Dos triangulos de 100 x 150 en una tela donde solo entra uno a lo ancho.
    // Apilados gastarian 300 mm; encastrados tienen que entrar en poco mas de 150.
    const formas = [
      forma('a', triangulo(100, 150), { giros: [0, 180] }),
      forma('b', triangulo(100, 150), { giros: [0, 180] }),
    ];
    const r = acomodar(formas, { anchoMm: 120, separacionMm: 0, margenMm: 0, celdaMm: 4 });
    expect(r.ubicaciones).toHaveLength(2);
    expect(r.ubicaciones.some((u) => u.giro === 180)).toBe(true);
    expect(r.largoMm).toBeLessThan(200);
  });

  it('sin permiso para girar, no puede encastrarlas', () => {
    const formas = [
      forma('a', triangulo(100, 150), { giros: [0] }),
      forma('b', triangulo(100, 150), { giros: [0] }),
    ];
    const r = acomodar(formas, { anchoMm: 120, separacionMm: 0, margenMm: 0, celdaMm: 4 });
    expect(r.largoMm).toBeGreaterThan(250);
  });

  it('pega al doblez las piezas que se cortan al lomo', () => {
    const alLomo = forma('lomo', rect(90, 200), { alDoblez: true });
    const suelta = forma('suelta', rect(90, 200));
    const r = acomodar([suelta, alLomo], opciones);
    // Va sobre el doblez, que es el borde mismo de la tela doblada: sin margen.
    const caja = cajaDePuntos(ubicar(alLomo, r.ubicaciones.find((u) => u.id === 'lomo')!));
    expect(caja.x).toBeCloseTo(0, 3);
  });

  it('avisa cuando una pieza es mas ancha que la tela', () => {
    const r = acomodar([forma('gigante', rect(500, 100)), forma('ok', rect(100, 100))], opciones);
    expect(r.sinLugar).toEqual(['gigante']);
    expect(r.ubicaciones.map((u) => u.id)).toEqual(['ok']);
  });

  it('da siempre el mismo resultado con la misma entrada', () => {
    const formas = [forma('a', rect(100, 120)), forma('b', rect(140, 80)), forma('c', rect(60, 200))];
    expect(acomodar(formas, opciones)).toEqual(acomodar(formas, opciones));
  });

  it('sin piezas devuelve una tela de largo cero', () => {
    const r = acomodar([], opciones);
    expect(r.largoMm).toBe(0);
    expect(r.ubicaciones).toHaveLength(0);
  });
});
