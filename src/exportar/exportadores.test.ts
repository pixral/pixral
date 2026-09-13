import { describe, expect, it } from 'vitest';
import { contornoDesdePuntos, nuevaPieza, nuevoProyecto } from '../nucleo/proyecto';
import type { Proyecto } from '../nucleo/tipos';
import {
  armarLamina,
  generarDxf,
  generarPdf,
  generarSvg,
  nombreArchivo,
  opcionesPorDefecto,
  planMosaico,
} from './exportadores';

/** Proyecto con una pieza cuadrada de 10 x 10 cm y sin margen de costura. */
function proyectoConCuadrado(ladoMm = 100): Proyecto {
  const p = nuevoProyecto('Prueba');
  const pieza = nuevaPieza('Cuadrado');
  pieza.contorno = contornoDesdePuntos(
    [
      { x: 0, y: 0 },
      { x: ladoMm, y: 0 },
      { x: ladoMm, y: ladoMm },
      { x: 0, y: ladoMm },
    ],
    true,
  );
  pieza.costuraMm = 0;
  p.piezas.push(pieza);
  return p;
}

const sinAdornos = (p: Proyecto) => ({
  ...opcionesPorDefecto(p),
  incluirCostura: false,
  incluirInternas: false,
  incluirHilo: false,
  incluirEtiquetas: false,
});

describe('exportacion', () => {
  it('la lamina conserva la medida real de la pieza', () => {
    const p = proyectoConCuadrado(100);
    const lamina = armarLamina(p, sinAdornos(p));
    expect(lamina.colocados).toHaveLength(1);
    expect(lamina.colocados[0].dibujo.caja.ancho).toBeCloseTo(100, 3);
    expect(lamina.colocados[0].dibujo.caja.alto).toBeCloseTo(100, 3);
  });

  it('el PDF sale con hoja A4 exacta en puntos PostScript', async () => {
    const p = proyectoConCuadrado();
    const texto = await generarPdf(p, sinAdornos(p)).text();
    // 210 mm y 297 mm pasados a puntos: 1 mm = 72/25.4 pt.
    expect(texto).toContain('/MediaBox [0 0 595.276 841.89]');
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto).toContain('%%EOF');
  });

  it('el PDF pone la escala de milimetros a puntos en cada pagina', async () => {
    const p = proyectoConCuadrado();
    const texto = await generarPdf(p, sinAdornos(p)).text();
    expect(texto).toContain('2.835 0 0 -2.835 0 841.89 cm');
  });

  it('el PDF de mosaico trae la hoja de control mas una por cada tramo', async () => {
    const p = proyectoConCuadrado(600);
    const op = sinAdornos(p);
    const plan = planMosaico(op, armarLamina(p, op));
    expect(plan.paginas).toBe(plan.filas * plan.columnas + 1);
    const texto = await generarPdf(p, op).text();
    expect(texto).toContain(`/Count ${plan.paginas}`);
    expect(texto).toContain('control de escala');
  });

  it('una pieza chica entra en una sola hoja mas la de control', () => {
    const p = proyectoConCuadrado(100);
    const op = sinAdornos(p);
    const plan = planMosaico(op, armarLamina(p, op));
    expect(plan.filas).toBe(1);
    expect(plan.columnas).toBe(1);
    expect(plan.paginas).toBe(2);
  });

  it('la hoja unica mide lo que mide el molde mas los margenes', async () => {
    const p = proyectoConCuadrado(300);
    const op = { ...sinAdornos(p), hoja: 'unica' as const, margenMm: 10 };
    const texto = await generarPdf(p, op).text();
    // 300 mm + 2 x 10 mm de margen = 320 mm = 907.087 pt.
    expect(texto).toContain('/MediaBox [0 0 907.087 907.087]');
  });

  it('el cuadrado queda dibujado en las coordenadas reales en milimetros', async () => {
    const p = proyectoConCuadrado(100);
    const op = { ...sinAdornos(p), hoja: 'unica' as const, margenMm: 8 };
    const texto = await generarPdf(p, op).text();
    // El contenido arranca corriendo el origen al margen y despues dibuja
    // el cuadrado con sus medidas reales: 0,0 -> 100,0 -> 100,100 -> 0,100.
    expect(texto).toContain('1 0 0 1 8 8 cm');
    expect(texto).toMatch(/0 0 m\n100 0 l\n100 100 l\n0 100 l\nh\nS/);
  });

  it('una pieza corrida del origen se dibuja igual de grande', async () => {
    const p = proyectoConCuadrado(100);
    // Movemos la pieza 500 mm: la lamina la reacomoda, pero no cambia su medida.
    for (const n of p.piezas[0].contorno.nodos) {
      n.p.x += 500;
      n.p.y += 500;
    }
    const op = { ...sinAdornos(p), hoja: 'unica' as const, margenMm: 8 };
    const texto = await generarPdf(p, op).text();
    expect(texto).toContain('/MediaBox [0 0 328.819 328.819]');
    expect(texto).toMatch(/0 0 m\n100 0 l\n100 100 l\n0 100 l\nh\nS/);
  });

  it('el SVG declara el tamano real en milimetros', async () => {
    const p = proyectoConCuadrado(150);
    const op = { ...sinAdornos(p), margenMm: 10 };
    const texto = await generarSvg(p, op).text();
    expect(texto).toContain('width="170mm" height="170mm"');
    expect(texto).toContain('viewBox="0 0 170 170"');
  });

  it('el DXF sale con polilineas en la capa de contorno', async () => {
    const p = proyectoConCuadrado();
    const texto = await generarDxf(p, sinAdornos(p)).text();
    expect(texto).toContain('POLYLINE');
    expect(texto).toContain('CONTORNO');
    expect(texto.trimEnd().endsWith('EOF')).toBe(true);
  });

  it('exporta cada talle elegido por separado', () => {
    const p = proyectoConCuadrado();
    const op = { ...sinAdornos(p), talles: p.talles.map((t) => t.id) };
    expect(armarLamina(p, op).colocados).toHaveLength(p.talles.length);
  });

  it('en modo nido todos los talles van en un solo dibujo', () => {
    const p = proyectoConCuadrado();
    const op = { ...sinAdornos(p), talles: p.talles.map((t) => t.id), modo: 'nido' as const };
    const lamina = armarLamina(p, op);
    expect(lamina.colocados).toHaveLength(1);
    expect(lamina.colocados[0].dibujo.trazos.length).toBeGreaterThanOrEqual(p.talles.length);
  });

  it('deja afuera las piezas destildadas', () => {
    const p = proyectoConCuadrado();
    p.piezas[0].incluirEnExport = false;
    expect(armarLamina(p, sinAdornos(p)).colocados).toHaveLength(0);
  });

  it('arma un nombre de archivo legible', () => {
    const p = proyectoConCuadrado();
    p.nombre = 'Blusa de verano';
    const op = sinAdornos(p);
    expect(nombreArchivo(p, op, 'pdf')).toBe('Blusa-de-verano-42.pdf');
  });
});
