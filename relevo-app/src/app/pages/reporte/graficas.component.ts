import { Component, computed, input } from '@angular/core';
import { Reporte } from '../../core/services/reporte.service';

/**
 * Paleta del reporte: azul para la actividad por día y verde para la adherencia. Los seis tonos
 * pasan las comprobaciones de luminosidad, croma, separación para daltonismo y contraste ≥ 3:1
 * sobre la superficie clara; se conservan por si vuelve una gráfica por categorías.
 */
const PALETA = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

/** Una barra de cualquiera de las gráficas, ya resuelta a coordenadas. */
interface Barra {
  etiqueta: string;
  valorTexto: string;
  cantidad: number;
  color: string;
  /** 0-100, para el ancho o el alto en porcentaje */
  porcentaje: number;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/** Convierte lo que venga de Firestore (Timestamp o Date) en Date. */
function aFecha(valor: unknown): Date {
  const posible = valor as { toDate?: () => Date } | Date | string;
  if (posible instanceof Date) return posible;
  if (posible && typeof (posible as { toDate?: () => Date }).toDate === 'function') {
    return (posible as { toDate: () => Date }).toDate();
  }
  return new Date(posible as string);
}

@Component({
  selector: 'app-graficas-reporte',
  styleUrl: './graficas.component.scss',
  template: `
    <div class="viz-root">
      <!-- ---------- 1. Actividad por día ---------- -->
      @if (actividad().length) {
        <figure class="grafica">
          <figcaption>
            <h3>Actividad por día</h3>
            <p>{{ totalEntradas() }} registros en el periodo</p>
          </figcaption>

          <svg
            [attr.viewBox]="'0 0 ' + ANCHO + ' ' + ALTO_COLUMNAS"
            preserveAspectRatio="none"
            class="lienzo columnas"
            role="img"
            [attr.aria-label]="'Actividad por día: ' + totalEntradas() + ' registros'"
          >
            <!-- Rejilla recesiva: referencia, no protagonista. -->
            @for (l of lineasActividad(); track l.y) {
              <line class="rejilla" x1="0" [attr.y1]="l.y" [attr.x2]="ANCHO" [attr.y2]="l.y" />
            }
            @for (b of actividad(); track b.etiqueta) {
              <rect
                class="barra"
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.ancho"
                [attr.height]="b.alto"
                rx="4"
                [attr.fill]="b.color"
              >
                <title>{{ b.etiqueta }}: {{ b.valorTexto }}</title>
              </rect>
            }
          </svg>

          <div class="eje-x">
            @for (e of ejeDias(); track e.texto) {
              <span [style.left.%]="e.posicion">{{ e.texto }}</span>
            }
          </div>
        </figure>
      }

      <!-- "Entradas por tipo" se quitó el 22/10/2026: repetía las chips de la tarjeta de arriba. -->

      <!-- ---------- 2. Adherencia a medicamentos ---------- -->
      @if (adherencia().length) {
        <figure class="grafica">
          <figcaption>
            <h3>Adherencia a medicamentos</h3>
            <p>Tomas registradas sobre las programadas</p>
          </figcaption>

          <div class="barras-h adherencia">
            @for (b of adherencia(); track b.etiqueta) {
              <div class="fila">
                <span class="nombre">{{ b.etiqueta }}</span>
                <span class="pista">
                  <i class="relleno" [style.width.%]="b.porcentaje" [style.background]="b.color"></i>
                </span>
                <span class="valor">{{ b.valorTexto }}</span>
              </div>
            }
          </div>
        </figure>
      }

      <!-- Las fichas de signos vitales se quitaron el 22/10/2026: la lista "Signos vitales" de la
           pantalla ya los resume como los lee el médico (promedio de la semana, fuera de rango). -->
    </div>
  `,
})
export class GraficasReporte {
  readonly reporte = input.required<Reporte>();

  protected readonly ANCHO = 720;
  protected readonly ALTO_COLUMNAS = 160;

  protected readonly totalEntradas = computed(() => this.reporte().entradas.length);

  /** Un día por columna, incluidos los días sin registros: los huecos también informan. */
  protected readonly actividad = computed<Barra[]>(() => {
    const r = this.reporte();
    const desde = new Date(r.desde);
    desde.setHours(0, 0, 0, 0);
    const hasta = new Date(r.hasta);

    const dias: { clave: string; fecha: Date; cantidad: number }[] = [];
    for (const d = new Date(desde); d < hasta; d.setDate(d.getDate() + 1)) {
      dias.push({ clave: d.toDateString(), fecha: new Date(d), cantidad: 0 });
    }
    if (!dias.length) return [];

    const indice = new Map(dias.map((d, i) => [d.clave, i]));
    for (const e of r.entradas) {
      const i = indice.get(aFecha(e.fecha).toDateString());
      if (i !== undefined) dias[i].cantidad++;
    }

    const maximo = Math.max(1, ...dias.map((d) => d.cantidad));
    // 2px de separación entre barras contiguas, como pide la especificación de marca.
    const paso = this.ANCHO / dias.length;
    const ancho = Math.max(2, paso - 2);

    return dias.map((d, i) => {
      const alto = d.cantidad === 0 ? 0 : Math.max(4, (d.cantidad / maximo) * (this.ALTO_COLUMNAS - 8));
      return {
        etiqueta: d.fecha.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }),
        valorTexto: d.cantidad === 1 ? '1 registro' : `${d.cantidad} registros`,
        cantidad: d.cantidad,
        color: PALETA[0],
        porcentaje: (d.cantidad / maximo) * 100,
        x: i * paso + 1,
        // Anclada a la línea base: la barra crece hacia arriba desde abajo.
        y: this.ALTO_COLUMNAS - alto,
        ancho,
        alto,
      };
    });
  });

  /** Tres líneas de rejilla, suficientes para dar escala sin competir con los datos. */
  protected readonly lineasActividad = computed(() =>
    [0.33, 0.66, 1].map((f) => ({ y: this.ALTO_COLUMNAS - f * (this.ALTO_COLUMNAS - 8) })),
  );

  /** Etiquetas del eje: todas si es una semana, cada cinco días si es un mes. */
  protected readonly ejeDias = computed(() => {
    const dias = this.actividad();
    if (!dias.length) return [];
    const salto = dias.length > 10 ? 5 : 1;
    return dias
      .map((d, i) => ({ i, d }))
      .filter(({ i }) => i % salto === 0)
      .map(({ i, d }) => ({
        texto: d.etiqueta.split(' ')[1] ?? d.etiqueta,
        posicion: ((i + 0.5) / dias.length) * 100,
      }));
  });

  /**
   * Los medicamentos "según necesidad" se excluyen: no tienen tomas programadas,
   * así que una adherencia del 0 % sería una acusación falsa.
   */
  protected readonly adherencia = computed<Barra[]>(() =>
    this.reporte()
      .medicamentos.filter((m) => !m.segunNecesidad && m.adherencia !== null)
      .map((m) => ({
        etiqueta: m.nombre,
        valorTexto: `${m.adherencia}% · ${m.tomadas}/${m.programadas}`,
        cantidad: m.adherencia ?? 0,
        // Un solo tono para todas: la comparación es entre longitudes, no entre colores.
        color: PALETA[2],
        porcentaje: m.adherencia ?? 0,
        x: 0,
        y: 0,
        ancho: 0,
        alto: 0,
      })),
  );
}
