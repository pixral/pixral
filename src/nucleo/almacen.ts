/**
 * Guardado local en el navegador (IndexedDB). No hay servidor: los proyectos
 * quedan en la maquina. Igual conviene usar "Exportar copia" cada tanto.
 */

import { migrar } from './proyecto';
import type { Proyecto } from './tipos';

const BASE = 'pixral-moldes';
const TIENDA = 'proyectos';
const CLAVE_ULTIMO = 'pixral-moldes:ultimo';

let conexion: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexion) return conexion;
  conexion = new Promise((resolver, rechazar) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(TIENDA)) db.createObjectStore(TIENDA, { keyPath: 'id' });
    };
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => rechazar(pedido.error ?? new Error('No se pudo abrir la base local'));
  });
  return conexion;
}

function transaccion<T>(modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolver, rechazar) => {
        const tx = db.transaction(TIENDA, modo);
        const pedido = fn(tx.objectStore(TIENDA));
        pedido.onsuccess = () => resolver(pedido.result);
        pedido.onerror = () => rechazar(pedido.error ?? new Error('Error al acceder a la base local'));
      }),
  );
}

export async function guardar(p: Proyecto): Promise<void> {
  const copia: Proyecto = { ...p, modificado: Date.now() };
  await transaccion('readwrite', (t) => t.put(copia));
  try {
    localStorage.setItem(CLAVE_ULTIMO, p.id);
  } catch {
    // Modo incognito o almacenamiento bloqueado: no es grave.
  }
}

export async function listar(): Promise<Proyecto[]> {
  const todos = await transaccion<Proyecto[]>('readonly', (t) => t.getAll() as IDBRequest<Proyecto[]>);
  return todos.map(migrar).sort((a, b) => b.modificado - a.modificado);
}

export async function cargar(id: string): Promise<Proyecto | null> {
  const p = await transaccion<Proyecto | undefined>('readonly', (t) => t.get(id) as IDBRequest<Proyecto | undefined>);
  return p ? migrar(p) : null;
}

export async function borrar(id: string): Promise<void> {
  await transaccion('readwrite', (t) => t.delete(id));
}

export function ultimoAbierto(): string | null {
  try {
    return localStorage.getItem(CLAVE_ULTIMO);
  } catch {
    return null;
  }
}

export function descargarJson(p: Proyecto): void {
  const texto = JSON.stringify(p, null, 2);
  const blob = new Blob([texto], { type: 'application/json' });
  descargarBlob(blob, `${limpiarNombre(p.nombre)}.moldes.json`);
}

export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function limpiarNombre(nombre: string): string {
  return (nombre || 'proyecto').replace(/[^\w\d\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '-') || 'proyecto';
}

export async function importarJson(texto: string): Promise<Proyecto> {
  const datos = JSON.parse(texto) as Proyecto;
  if (!datos || typeof datos !== 'object' || !Array.isArray(datos.piezas)) {
    throw new Error('El archivo no parece ser un proyecto de moldes');
  }
  const p = migrar(datos);
  await guardar(p);
  return p;
}
