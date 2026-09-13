import { describe, expect, it } from 'vitest';
import { contornoDesdePuntos, nuevaPieza, nuevoProyecto } from '../nucleo/proyecto';
import type { Pieza, Proyecto } from '../nucleo/tipos';
import { armarTizada, opcionesTizadaPorDefecto, resumenPrendas, type OpcionesTizada } from './tizada';
import { generarPdfTizada } from './tizadaPdf';

function piezaRect(nombre: string, ancho: number, alto: number, extra: Partial<Pieza> = {}): Pieza {
  const p = nuevaPieza(nombre);
  p.contorno = contornoDesdePuntos(
    [
      { x: 0, y: 0 },
      { x: ancho, y: 0 },
      { x: ancho, y: alto },
      { x: 0, y: alto },
    ],
    true,
  );
  p.costuraMm = 0;
  p.progresion.ejeX = 0;
  return Object.assign(p, extra);
}

function proyectoCon(...piezas: Pieza[]): Proyecto {
  const p = nuevoProyecto('Blusa');
  p.piezas.push(...piezas);
  return p;
}

const opciones = (p: Proyecto, extra: Partial<OpcionesTizada> = {}): OpcionesTizada => ({
  ...opcionesTizadaPorDefecto(p),
  incluirCostura: false,
  ...extra,
});

describe('tizada', () => {
  it('con la tela doblada el ancho util es la mitad', () => {
    const p = proyectoCon(piezaRect('Delantero', 200, 400));
    const r = armarTizada(p, opciones(p, { anchoTelaMm: 1400, doblada: true }));
    expect(r.anchoUtilMm).toBe(700);
    expect(r.piezas).toHaveLength(1);
  });

  it('con la tela abierta se usa el ancho entero', () => {
    const p = proyectoCon(piezaRect('Delantero', 200, 400));
    const r = armarTizada(p, opciones(p, { anchoTelaMm: 1400, doblada: false }));
    expect(r.anchoUtilMm).toBe(1400);
  });

  it('con la tela doblada una pieza que va de a dos se corta una sola vez', () => {
    const p = proyectoCon(piezaRect('Manga', 200, 400, { cantidad: 2 }));
    const r = armarTizada(p, opciones(p, { doblada: true }));
    expect(r.piezas).toHaveLength(1);
  });

  it('con la tela abierta esa misma pieza se corta dos veces', () => {
    const p = proyectoCon(piezaRect('Manga', 200, 400, { cantidad: 2 }));
    const r = armarTizada(p, opciones(p, { doblada: false }));
    expect(r.piezas).toHaveLength(2);
  });

  it('la pieza al lomo se apoya sobre el doblez', () => {
    const p = proyectoCon(piezaRect('Espalda', 200, 400, { alLomo: true }));
    const r = armarTizada(p, opciones(p, { doblada: true }));
    expect(r.piezas[0].alDoblez).toBe(true);
    expect(r.piezas[0].caja.x).toBeCloseTo(0, 3);
  });

  it('con la tela abierta la pieza al lomo se despliega entera', () => {
    const p = proyectoCon(piezaRect('Espalda', 200, 400, { alLomo: true }));
    const r = armarTizada(p, opciones(p, { doblada: false }));
    // Espejada sobre el centro: pasa a medir el doble de ancho.
    expect(r.piezas[0].caja.ancho).toBeCloseTo(400, 1);
  });

  it('corta las prendas de todos los talles elegidos', () => {
    const p = proyectoCon(piezaRect('Delantero', 200, 300));
    const op = opciones(p, {
      prendasPorTalle: { [p.talles[0].id]: 1, [p.talles[1].id]: 2 },
    });
    const r = armarTizada(p, op);
    expect(r.piezas).toHaveLength(3);
    expect(r.piezas.filter((x) => x.etiqueta.endsWith(p.talles[1].nombre))).toHaveLength(2);
  });

  it('mas prendas necesitan mas tela', () => {
    const p = proyectoCon(piezaRect('Delantero', 400, 500));
    const una = armarTizada(p, opciones(p, { prendasPorTalle: { [p.talleBaseId]: 1 } }));
    const cuatro = armarTizada(p, opciones(p, { prendasPorTalle: { [p.talleBaseId]: 4 } }));
    expect(cuatro.largoMm).toBeGreaterThan(una.largoMm);
    expect(cuatro.piezas).toHaveLength(4);
  });

  it('el aprovechamiento queda entre 0 y 1 y es alto con piezas rectangulares', () => {
    const p = proyectoCon(piezaRect('a', 340, 400), piezaRect('b', 340, 400));
    const r = armarTizada(p, opciones(p, { separacionMm: 0, margenMm: 0 }));
    expect(r.aprovechamiento).toBeGreaterThan(0.9);
    expect(r.aprovechamiento).toBeLessThanOrEqual(1);
  });

  it('avisa cuando una pieza no entra a lo ancho de la tela', () => {
    const p = proyectoCon(piezaRect('Falda entera', 900, 400));
    const r = armarTizada(p, opciones(p, { anchoTelaMm: 1400, doblada: true }));
    expect(r.sinLugar).toEqual(['Falda entera - 42']);
    expect(r.piezas).toHaveLength(0);
  });

  it('deja afuera las piezas destildadas', () => {
    const p = proyectoCon(piezaRect('Delantero', 200, 300, { incluirEnExport: false }));
    expect(armarTizada(p, opciones(p)).piezas).toHaveLength(0);
  });

  it('resume en texto que talles se van a cortar', () => {
    const p = proyectoCon(piezaRect('a', 100, 100));
    const op = opciones(p, { prendasPorTalle: { [p.talles[0].id]: 2 } });
    expect(resumenPrendas(p, op)).toBe(`Talle ${p.talles[0].nombre} x2`);
  });

  it('genera el PDF con los metros de tela bien visibles', async () => {
    const p = proyectoCon(piezaRect('Delantero', 300, 500, { cantidad: 2 }));
    const op = opciones(p);
    const r = armarTizada(p, op);
    const texto = await generarPdfTizada(p, op, r).text();
    expect(texto.startsWith('%PDF-')).toBe(true);
    expect(texto).toContain('NECESITAS');
    expect(texto).toContain('TIZADA');
    expect(texto).toContain('DOBLEZ');
    expect(texto).toContain('Escala 1:');
  });
});
