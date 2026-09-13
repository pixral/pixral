/**
 * Vista de la tizada: dibuja la tela con las piezas acomodadas.
 *
 * Es solo para mirar: no se edita nada aca. Lo que se cambia son las opciones
 * del panel de la izquierda y el dibujo se rehace solo.
 */

import { armarTizada, type ResultadoTizada } from '../exportar/tizada';
import type { Cmd } from '../exportar/dibujo';
import type { Punto } from '../nucleo/tipos';
import { estado, suscribir } from './estado';
import { mmACm } from './formato';

let lienzo: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let contenedor: HTMLElement;
let desuscribir: (() => void) | null = null;

let cache: { firma: string; resultado: ResultadoTizada } | null = null;

/** Recalcular la tizada en cada dibujo seria al pepe: se guarda la ultima. */
export function tizadaActual(): ResultadoTizada | null {
  const p = estado.proyecto;
  const op = estado.opcionesTizada;
  if (!p || !op) return null;
  const firma = JSON.stringify([p.id, p.modificado, op]);
  if (cache?.firma === firma) return cache.resultado;
  const resultado = armarTizada(p, op);
  cache = { firma, resultado };
  return resultado;
}

function camino(cmds: Cmd[], aP: (p: Punto) => Punto): void {
  ctx.beginPath();
  let actual = { x: 0, y: 0 };
  for (const c of cmds) {
    if (c.t === 'M') {
      actual = aP({ x: c.x, y: c.y });
      ctx.moveTo(actual.x, actual.y);
    } else if (c.t === 'L') {
      actual = aP({ x: c.x, y: c.y });
      ctx.lineTo(actual.x, actual.y);
    } else if (c.t === 'C') {
      const a = aP({ x: c.x1, y: c.y1 });
      const b = aP({ x: c.x2, y: c.y2 });
      const d = aP({ x: c.x, y: c.y });
      ctx.bezierCurveTo(a.x, a.y, b.x, b.y, d.x, d.y);
      actual = d;
    } else {
      ctx.closePath();
    }
  }
}

export function render(): void {
  if (!lienzo || contenedor.hidden) return;
  const dpr = window.devicePixelRatio || 1;
  const ancho = contenedor.clientWidth;
  const alto = contenedor.clientHeight;
  if (ancho === 0 || alto === 0) return;
  if (lienzo.width !== Math.round(ancho * dpr) || lienzo.height !== Math.round(alto * dpr)) {
    lienzo.width = Math.round(ancho * dpr);
    lienzo.height = Math.round(alto * dpr);
    lienzo.style.width = `${ancho}px`;
    lienzo.style.height = `${alto}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#f4f1ec';
  ctx.fillRect(0, 0, ancho, alto);

  const r = tizadaActual();
  ctx.textAlign = 'start';
  if (!r || r.piezas.length === 0) {
    ctx.fillStyle = '#8a8578';
    ctx.font = '500 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      r && r.sinLugar.length > 0
        ? 'Ninguna pieza entra a lo ancho de esta tela'
        : 'Elegi cuantas prendas cortar en el panel de la izquierda',
      ancho / 2,
      alto / 2,
    );
    ctx.textAlign = 'start';
    return;
  }

  // Encabezado con lo unico que de verdad importa: cuanta tela comprar.
  const cabecera = 54;
  ctx.fillStyle = '#1d1d1b';
  ctx.font = '700 26px system-ui, sans-serif';
  ctx.fillText(`${(r.largoMm / 1000).toFixed(2).replace('.', ',')} m de tela`, 24, 36);
  ctx.font = '400 13px system-ui, sans-serif';
  ctx.fillStyle = '#5f5b52';
  const detalle = `tela de ${mmACm(r.anchoTelaMm)} cm ${r.doblada ? 'doblada al medio' : 'abierta'} · ${
    r.piezas.length
  } piezas · aprovechamiento ${(r.aprovechamiento * 100).toFixed(0)}%`;
  ctx.fillText(detalle, 24, 47);

  const relleno = 28;
  const escala = Math.min(
    (ancho - relleno * 2 - 40) / r.anchoUtilMm,
    (alto - cabecera - relleno * 2) / r.largoMm,
  );
  const anchoDibujo = r.anchoUtilMm * escala;
  const altoDibujo = r.largoMm * escala;
  const x0 = Math.max(relleno, (ancho - anchoDibujo - 40) / 2);
  const y0 = cabecera + relleno / 2;
  const aP = (p: Punto): Punto => ({ x: x0 + p.x * escala, y: y0 + p.y * escala });

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0, y0, anchoDibujo, altoDibujo);
  ctx.strokeStyle = '#c9c0b0';
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, anchoDibujo, altoDibujo);

  // El doblez: ahi la tela no se corta.
  ctx.strokeStyle = '#1d1d1b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0, y0 + altoDibujo);
  ctx.stroke();
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.fillStyle = '#8a8578';
  ctx.fillText(r.doblada ? 'DOBLEZ' : 'ORILLO', x0 + 3, y0 - 5);
  const orillo = 'ORILLO';
  ctx.fillText(orillo, x0 + anchoDibujo - ctx.measureText(orillo).width - 3, y0 - 5);

  // Regla en centimetros al costado.
  const paso = (altoDibujo / (r.largoMm / 100)) > 16 ? 100 : 500;
  ctx.strokeStyle = '#c9c0b0';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#8a8578';
  ctx.font = '400 10px system-ui, sans-serif';
  for (let mm = 0; mm <= r.largoMm; mm += paso) {
    const py = y0 + mm * escala;
    ctx.beginPath();
    ctx.moveTo(x0 + anchoDibujo, py);
    ctx.lineTo(x0 + anchoDibujo + 6, py);
    ctx.stroke();
    ctx.fillText(`${Math.round(mm / 10)} cm`, x0 + anchoDibujo + 9, py + 3);
  }

  for (const pieza of r.piezas) {
    for (const t of pieza.trazos) {
      if (t.estilo === 'piquete' || t.estilo === 'referencia' || t.estilo === 'interna') continue;
      camino(t.cmds, aP);
      if (t.estilo === 'contorno' || t.estilo === 'costura') {
        const esCorte = t.estilo === 'costura' || !estado.opcionesTizada?.incluirCostura;
        if (esCorte) {
          ctx.fillStyle = 'rgba(196, 132, 74, 0.14)';
          ctx.fill();
        }
        ctx.strokeStyle = esCorte ? '#1d1d1b' : '#b0752f';
        ctx.lineWidth = esCorte ? 1.6 : 1;
        ctx.setLineDash(esCorte ? [] : [4, 3]);
      } else {
        ctx.strokeStyle = '#0f766e';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const centro = aP({ x: pieza.caja.x + pieza.caja.ancho / 2, y: pieza.caja.y + pieza.caja.alto / 2 });
    const tam = Math.max(8, Math.min(13, pieza.caja.ancho * escala * 0.12));
    ctx.font = `600 ${tam}px system-ui, sans-serif`;
    ctx.fillStyle = '#1d1d1b';
    ctx.textAlign = 'center';
    ctx.fillText(pieza.etiqueta, centro.x, centro.y);
    if (pieza.alDoblez) {
      ctx.font = `500 ${tam * 0.82}px system-ui, sans-serif`;
      ctx.fillStyle = '#8a8578';
      ctx.fillText('AL LOMO', centro.x, centro.y + tam + 2);
    }
    ctx.textAlign = 'start';
  }

  if (r.sinLugar.length > 0) {
    ctx.fillStyle = '#b91c1c';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(`No entran a lo ancho: ${r.sinLugar.join(', ')}`, 24, alto - 14);
  }
}

export function crearVistaTizada(host: HTMLElement): () => void {
  contenedor = host;
  lienzo = document.createElement('canvas');
  lienzo.className = 'lienzo lienzo-tizada';
  host.append(lienzo);
  ctx = lienzo.getContext('2d')!;
  const observador = new ResizeObserver(() => render());
  observador.observe(host);
  desuscribir = suscribir(render);
  render();
  return () => {
    observador.disconnect();
    desuscribir?.();
    lienzo.remove();
  };
}
