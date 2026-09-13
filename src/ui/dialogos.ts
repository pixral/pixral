/** Dialogos modales simples (evitamos prompt/confirm del navegador). */

import { h, vaciar } from './dom';

let capa: HTMLElement | null = null;

function abrir(contenido: HTMLElement): () => void {
  if (!capa) {
    capa = h('div', { clase: 'capa-modal' });
    document.body.append(capa);
  }
  vaciar(capa);
  capa.append(contenido);
  capa.classList.add('visible');
  const cerrar = () => {
    capa?.classList.remove('visible');
    if (capa) vaciar(capa);
  };
  return cerrar;
}

interface OpcionesPedir {
  titulo: string;
  descripcion?: string;
  etiqueta: string;
  valor?: string;
  sufijo?: string;
  textoAceptar?: string;
}

export function pedirTexto(op: OpcionesPedir): Promise<string | null> {
  return new Promise((resolver) => {
    const input = h('input', { clase: 'campo-input', valor: op.valor ?? '', autofocus: true });
    let cerrar = () => {};
    const aceptar = () => {
      cerrar();
      resolver(input.value);
    };
    const cancelar = () => {
      cerrar();
      resolver(null);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') aceptar();
      if (e.key === 'Escape') cancelar();
    });
    const caja = h(
      'div',
      { clase: 'modal' },
      h('h2', { clase: 'modal-titulo', texto: op.titulo }),
      op.descripcion ? h('p', { clase: 'modal-texto', texto: op.descripcion }) : null,
      h(
        'label',
        { clase: 'campo' },
        h('span', { clase: 'campo-etiqueta', texto: op.etiqueta }),
        h('div', { clase: 'campo-con-sufijo' }, input, op.sufijo ? h('span', { clase: 'sufijo', texto: op.sufijo }) : null),
      ),
      h(
        'div',
        { clase: 'modal-botones' },
        h('button', { clase: 'boton', type: 'button', onClick: cancelar, texto: 'Cancelar' }),
        h('button', { clase: 'boton principal', type: 'button', onClick: aceptar, texto: op.textoAceptar ?? 'Aceptar' }),
      ),
    );
    cerrar = abrir(caja);
    setTimeout(() => {
      input.focus();
      input.select();
    }, 20);
  });
}

export interface CampoDialogo {
  clave: string;
  etiqueta: string;
  valor: string;
  sufijo?: string;
}

export function pedirVarios(
  titulo: string,
  descripcion: string,
  campos: CampoDialogo[],
): Promise<Record<string, string> | null> {
  return new Promise((resolver) => {
    const inputs = new Map<string, HTMLInputElement>();
    let cerrar = () => {};
    const aceptar = () => {
      const salida: Record<string, string> = {};
      for (const [k, el] of inputs) salida[k] = el.value;
      cerrar();
      resolver(salida);
    };
    const cancelar = () => {
      cerrar();
      resolver(null);
    };
    const filas = campos.map((c) => {
      const input = h('input', { clase: 'campo-input', valor: c.valor });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') aceptar();
        if (e.key === 'Escape') cancelar();
      });
      inputs.set(c.clave, input);
      return h(
        'label',
        { clase: 'campo' },
        h('span', { clase: 'campo-etiqueta', texto: c.etiqueta }),
        h('div', { clase: 'campo-con-sufijo' }, input, c.sufijo ? h('span', { clase: 'sufijo', texto: c.sufijo }) : null),
      );
    });
    const caja = h(
      'div',
      { clase: 'modal' },
      h('h2', { clase: 'modal-titulo', texto: titulo }),
      descripcion ? h('p', { clase: 'modal-texto', texto: descripcion }) : null,
      ...filas,
      h(
        'div',
        { clase: 'modal-botones' },
        h('button', { clase: 'boton', type: 'button', onClick: cancelar, texto: 'Cancelar' }),
        h('button', { clase: 'boton principal', type: 'button', onClick: aceptar, texto: 'Aceptar' }),
      ),
    );
    cerrar = abrir(caja);
    setTimeout(() => {
      const primero = inputs.values().next().value;
      primero?.focus();
      primero?.select();
    }, 20);
  });
}

export function confirmar(titulo: string, texto: string, textoAceptar = 'Si, dale'): Promise<boolean> {
  return new Promise((resolver) => {
    let cerrar = () => {};
    const responder = (v: boolean) => () => {
      cerrar();
      resolver(v);
    };
    const caja = h(
      'div',
      { clase: 'modal' },
      h('h2', { clase: 'modal-titulo', texto: titulo }),
      h('p', { clase: 'modal-texto', texto }),
      h(
        'div',
        { clase: 'modal-botones' },
        h('button', { clase: 'boton', type: 'button', onClick: responder(false), texto: 'Cancelar' }),
        h('button', { clase: 'boton principal', type: 'button', onClick: responder(true), texto: textoAceptar }),
      ),
    );
    cerrar = abrir(caja);
  });
}

export function mostrarPanel(titulo: string, contenido: HTMLElement): () => void {
  let cerrar = () => {};
  const caja = h(
    'div',
    { clase: 'modal ancho' },
    h('h2', { clase: 'modal-titulo', texto: titulo }),
    contenido,
    h(
      'div',
      { clase: 'modal-botones' },
      h('button', { clase: 'boton principal', type: 'button', onClick: () => cerrar(), texto: 'Cerrar' }),
    ),
  );
  cerrar = abrir(caja);
  return cerrar;
}
