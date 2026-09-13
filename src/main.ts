import * as almacen from './nucleo/almacen';
import { nuevoProyecto } from './nucleo/proyecto';
import { iniciarApp } from './ui/app';
import { abrirProyecto } from './ui/estado';
import { ajustarVista } from './ui/lienzo';
import './estilos.css';

async function arrancar(): Promise<void> {
  const raiz = document.getElementById('app');
  if (!raiz) throw new Error('Falta el contenedor #app');
  iniciarApp(raiz);

  let proyecto = null;
  try {
    const ultimo = almacen.ultimoAbierto();
    if (ultimo) proyecto = await almacen.cargar(ultimo);
    if (!proyecto) proyecto = (await almacen.listar())[0] ?? null;
  } catch {
    // Si IndexedDB no esta disponible seguimos con un proyecto en memoria.
  }
  abrirProyecto(proyecto ?? nuevoProyecto('Mi primer molde'));
  ajustarVista();
}

void arrancar();
