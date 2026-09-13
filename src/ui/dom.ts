/** Ayudas minimas para armar DOM sin framework. */

type Hijo = Node | string | number | null | undefined | false;

export interface Props {
  clase?: string;
  texto?: string;
  html?: string;
  titulo?: string;
  [clave: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  props: Props = {},
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(props)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'clase') el.className = String(valor);
    else if (clave === 'texto') el.textContent = String(valor);
    else if (clave === 'html') el.innerHTML = String(valor);
    else if (clave === 'titulo') el.title = String(valor);
    else if (clave === 'estilo' && typeof valor === 'object') Object.assign(el.style, valor);
    else if (clave === 'datos' && typeof valor === 'object') Object.assign(el.dataset, valor);
    else if (clave.startsWith('on') && typeof valor === 'function') {
      el.addEventListener(clave.slice(2).toLowerCase(), valor as EventListener);
    } else if (clave === 'valor') (el as HTMLInputElement).value = String(valor);
    else if (typeof valor === 'boolean') {
      if (valor) el.setAttribute(clave, '');
    } else el.setAttribute(clave, String(valor));
  }
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

export function vaciar(el: HTMLElement): HTMLElement {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function boton(texto: string, alHacerClick: () => void, props: Props = {}): HTMLButtonElement {
  return h('button', { clase: 'boton', ...props, type: 'button', onClick: alHacerClick }, texto);
}

/** Campo numerico con etiqueta. Devuelve la fila lista para insertar. */
export function campo(
  etiqueta: string,
  valor: string,
  alCambiar: (v: string) => void,
  props: Props = {},
): HTMLElement {
  const input = h('input', {
    clase: 'campo-input',
    valor,
    ...props,
    onChange: (e: Event) => alCambiar((e.target as HTMLInputElement).value),
  });
  return h('label', { clase: 'campo' }, h('span', { clase: 'campo-etiqueta', texto: etiqueta }), input);
}

export function seleccion(
  etiqueta: string,
  opciones: Array<{ valor: string; texto: string }>,
  actual: string,
  alCambiar: (v: string) => void,
): HTMLElement {
  const sel = h('select', {
    clase: 'campo-input',
    onChange: (e: Event) => alCambiar((e.target as HTMLSelectElement).value),
  });
  for (const o of opciones) {
    sel.append(h('option', { value: o.valor, selected: o.valor === actual, texto: o.texto }));
  }
  sel.value = actual;
  return h('label', { clase: 'campo' }, h('span', { clase: 'campo-etiqueta', texto: etiqueta }), sel);
}

export function casilla(etiqueta: string, marcada: boolean, alCambiar: (v: boolean) => void): HTMLElement {
  return h(
    'label',
    { clase: 'casilla' },
    h('input', {
      type: 'checkbox',
      checked: marcada,
      onChange: (e: Event) => alCambiar((e.target as HTMLInputElement).checked),
    }),
    h('span', { texto: etiqueta }),
  );
}

export function seccion(titulo: string, ...hijos: Hijo[]): HTMLElement {
  return h('section', { clase: 'seccion' }, h('h3', { clase: 'seccion-titulo', texto: titulo }), ...hijos);
}

export function ayuda(texto: string): HTMLElement {
  return h('p', { clase: 'ayuda', texto });
}
