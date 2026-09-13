# Moldes — digitalizador de moldes de ropa

App web para pasar los moldes de papel a digital: se saca una foto, se endereza,
se traza el contorno, se arma la tabla de talles y se imprime **a tamaño real**.

Anda entera en el navegador, sin servidor y sin cuenta. Los proyectos se guardan
en la propia computadora.

---

## Cómo se usa (paso a paso)

### 1. Sacar la foto del molde

- Apoyá el molde sobre un fondo que **contraste**: si el papel es blanco, ponelo
  sobre algo oscuro (una tela, el piso, una frazada).
- Sacá la foto lo más **de frente** posible y con buena luz pareja, sin sombras
  fuertes ni flash.
- Poné al lado del molde **algo de medida conocida**: una hoja A4 (21 × 29,7 cm)
  es lo más práctico. También sirve un cuadrado dibujado con la regla.
- Que entre todo en la foto: el molde completo y la hoja de referencia.

### 2. Enderezar la foto

Toda foto sale con algo de perspectiva: el lado de arriba mide menos que el de
abajo. Con **Enderezar perspectiva** se marcan las 4 esquinas de la hoja A4
(en orden, siguiendo el borde) y se escribe cuánto mide de verdad. La app
devuelve la foto a plano y de paso le pone la escala.

La foto no se recorta: la hoja A4 sirve solo de referencia, el molde que está
al lado se conserva.

> Si no tenés un rectángulo pero sí una medida conocida (por ejemplo el molde
> mide 40 cm de largo), usá **Calibrar escala**: arrastrás sobre esa medida y
> escribís cuánto es.

Hasta que no hagas una de las dos cosas, la app avisa que lo que midas **no es
del tamaño real**.

### 3. Trazar el contorno

- **Detectar de la foto** encuentra el borde del papel solo. Es lo más rápido.
  Si el molde es más oscuro que el fondo, tildá esa opción antes.
- **Trazar a mano**: click para poner nodos, arrastrar mientras hacés click para
  curvar, y click en el primer nodo para cerrar.
- Después se corrige lo que haga falta: arrastrar nodos, doble click sobre el
  contorno para agregar uno, doble click sobre un nodo para pasarlo de esquina a
  curva y al revés, `Supr` para borrar.

También se marcan **piquetes** (las muescas que hacen coincidir dos piezas),
la **línea de hilo**, y **pinzas / doblez / líneas de referencia**.

### 4. Margen de costura

Se pone un margen general para toda la pieza (1 cm es lo habitual) y, eligiendo
un nodo, se le puede dar un margen distinto a ese tramo: por ejemplo 3 cm en el
ruedo. Se dibuja punteado por fuera del contorno.

### 5. Talles

En la solapa **Talles** está la tabla de medidas, en centímetros. Un talle está
marcado como **BASE**: es el que dibujaste. Los demás se calculan a partir de la
diferencia con ese.

En **Progresión** se marca, sobre la pieza:

- el **eje vertical fijo**, que no se mueve (normalmente el centro delantero o
  el doblez);
- el **borde de crecimiento**, donde se aplica todo el ancho que crece
  (normalmente el costado);
- la **altura fija**, que no se mueve a lo largo (normalmente la cintura);
- las **líneas de crecimiento**: "a la altura del busto esta pieza crece un
  cuarto de lo que crece el contorno de busto en la tabla".

Todas esas líneas se arrastran directamente en el lienzo. El botón
**Armado automático** deja armado un juego típico de cuerpo (busto, cintura,
cadera y largo de talle) para después acomodarlo.

Con **Nido** se ven todos los talles superpuestos, y con el selector de arriba
se puede mirar un talle puntual.

### 6. Imprimir a tamaño real

En **Exportar** se elige qué talles, si va con costura, y el tamaño de hoja:

- **PDF en hojas A4** para imprimir en casa. Sale una **hoja de control** con un
  cuadrado de 5 cm: se imprime primero esa hoja sola, se mide el cuadrado con la
  regla y recién ahí se imprime el resto. Cada hoja dice su fila y su columna, y
  trae cruces para hacerlas coincidir al pegar.
- **Una sola hoja gigante** para mandar a una copistería o a un plotter.
- **SVG** y **DXF** para abrir en Illustrator, Inkscape o software de moldería.

> Al imprimir hay que elegir **escala 100%** o **"tamaño real"**. Nunca
> "ajustar a la página": eso achica el molde y arruina todo.

---

## Cómo funciona la progresión

El motor no estira el molde en forma proporcional (eso está mal para ropa: una
persona más grande no es una persona más chica agrandada). Lo que hace es armar
un campo de deformación a partir de la tabla de medidas:

- **A lo ancho**: cada línea de crecimiento dice cuánto crece la pieza a esa
  altura. Entre línea y línea se interpola en forma lineal. Ese crecimiento se
  reparte entre el eje fijo (se queda quieto) y el borde (se lleva el total), y
  los puntos del medio se corren en proporción a la distancia al eje.
- **A lo largo**: cada línea se aleja de la altura fija lo que diga la medida de
  largo correspondiente.

Un nodo se puede marcar como **fijo** para que no se mueva nunca, y una regla se
puede cargar a mano en milímetros por talle en vez de sacarla de la tabla.

---

## Desarrollo

```bash
npm install
npm run dev        # servidor de desarrollo
npm run verificar  # tipos + tests
npm run build      # genera dist/ (estático, se puede subir a cualquier lado)
```

No tiene dependencias en tiempo de ejecución: ni framework, ni librería de PDF.
El build pesa unos 30 KB comprimidos.

### Cómo está organizado

```
src/
  nucleo/       lógica pura, sin DOM: geometría, costura, progresión, imagen
    tipos.ts        modelo de datos (todo en milímetros)
    geometria.ts    vectores, bézier, muestreo, simplificación
    costura.ts      margen de costura (offset de polígono, con margen por tramo)
    progresion.ts   motor de talles a partir de la tabla de medidas
    homografia.ts   corrección de perspectiva
    imagen.ts       detección automática del contorno en la foto
    proyecto.ts     fábricas, valores por defecto y migraciones
    almacen.ts      guardado local (IndexedDB) e importar/exportar respaldo
  exportar/
    dibujo.ts       representación intermedia que comparten los tres formatos
    pdf.ts          generador de PDF propio, para controlar la escala al milímetro
    exportadores.ts PDF (mosaico y hoja única), SVG y DXF
  ui/             lienzo, paneles, estado y diálogos
```

La regla de oro del proyecto: **todo se guarda en milímetros y se muestra en
centímetros**. La única conversión vive en `ui/formato.ts`.

### Tests

`npm test` corre los tests de la lógica: geometría, margen de costura,
progresión, homografía, detección de contorno y exportación. Entre otras cosas
se verifica que el PDF salga con la hoja A4 exacta en puntos PostScript y que
un cuadrado de 10 cm quede dibujado con esas coordenadas, que es lo que
garantiza que imprima a tamaño real.

---

- the bast majority of my Files are made in spanish, unless someone tells me to translate them i might do it instead ( depends on my mood)
