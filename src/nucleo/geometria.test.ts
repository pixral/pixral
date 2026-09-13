import { describe, expect, it } from 'vitest';
import {
  areaConSigno,
  cajaDePuntos,
  distanciaASegmento,
  interseccionRectas,
  largoSegmento,
  muestrear,
  perimetro,
  simplificar,
} from './geometria';
import { contornoDesdePuntos, suavizar } from './proyecto';

const rectangulo = (ancho: number, alto: number) =>
  contornoDesdePuntos(
    [
      { x: 0, y: 0 },
      { x: ancho, y: 0 },
      { x: ancho, y: alto },
      { x: 0, y: alto },
    ],
    true,
  );

describe('geometria', () => {
  it('mide el perimetro de un rectangulo', () => {
    expect(perimetro(rectangulo(100, 200))).toBeCloseTo(600, 6);
  });

  it('un contorno dibujado en sentido horario tiene area positiva', () => {
    const pts = muestrear(rectangulo(100, 200));
    expect(areaConSigno(pts)).toBeGreaterThan(0);
  });

  it('calcula la caja que envuelve los puntos', () => {
    const caja = cajaDePuntos(muestrear(rectangulo(100, 200)));
    expect(caja).toMatchObject({ x: 0, y: 0, ancho: 100, alto: 200 });
  });

  it('el largo de un segmento recto es la distancia entre sus nodos', () => {
    const c = rectangulo(100, 200);
    expect(largoSegmento(c.nodos[0], c.nodos[1])).toBeCloseTo(100, 6);
  });

  it('suavizar deja en punta las esquinas de verdad', () => {
    const suave = suavizar(rectangulo(100, 200));
    // Las cuatro esquinas son de 90 grados: tienen que seguir siendo esquinas.
    expect(largoSegmento(suave.nodos[0], suave.nodos[1])).toBeCloseTo(100, 6);
    expect(cajaDePuntos(muestrear(suave))).toMatchObject({ ancho: 100, alto: 200 });
  });

  it('suavizar redondea los quiebres suaves sin agrandar la pieza', () => {
    // Un borde tipo sisa: quiebres chicos entre punto y punto.
    const curva = contornoDesdePuntos(
      [
        { x: 0, y: 0 },
        { x: 40, y: 6 },
        { x: 80, y: 22 },
        { x: 110, y: 50 },
        { x: 124, y: 90 },
      ],
      false,
    );
    const suave = suavizar(curva);
    const conCurvas = suave.nodos.filter((n) => Math.hypot(n.sal.x, n.sal.y) > 0.01);
    expect(conCurvas.length).toBeGreaterThan(0);
    const cajaRecta = cajaDePuntos(muestrear(curva));
    const cajaSuave = cajaDePuntos(muestrear(suave));
    // La curva puede pasarse un poco, pero no puede inflar la pieza.
    expect(cajaSuave.ancho).toBeLessThan(cajaRecta.ancho * 1.03);
    expect(cajaSuave.alto).toBeLessThan(cajaRecta.alto * 1.03);
  });

  it('simplificar saca los puntos que no aportan forma', () => {
    const recta = Array.from({ length: 50 }, (_, i) => ({ x: i * 2, y: 0 }));
    expect(simplificar(recta, 0.5)).toHaveLength(2);
  });

  it('simplificar conserva los quiebres importantes', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
      { x: 0, y: 50 },
    ];
    expect(simplificar(pts, 0.5)).toHaveLength(4);
  });

  it('mide la distancia de un punto a un segmento', () => {
    expect(distanciaASegmento({ x: 50, y: 30 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(30, 6);
    // Fuera del segmento, la distancia es a la punta mas cercana.
    expect(distanciaASegmento({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBeCloseTo(30, 6);
  });

  it('cruza dos rectas y detecta las paralelas', () => {
    const cruce = interseccionRectas({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 });
    expect(cruce).toEqual({ x: 5, y: 0 });
    expect(interseccionRectas({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 })).toBeNull();
  });
});
