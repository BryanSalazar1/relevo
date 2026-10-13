import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Timestamp } from '@angular/fire/firestore';
import { EntradaBitacora, Medicamento, SignoVital, Tarea, Turno } from '../models';
import { DosisProgramada } from '../services/medicamentos.service';
import { TareaProgramada } from '../services/tareas.service';
import { filasDelDia } from './agenda-dia';
import {
  VENTANA_MAX_MS,
  VENTANA_SIN_TURNOS_MS,
  finTurnoAnterior,
  fueraDeRango,
  inicioEntrega,
  novedadesEntrega,
  textoDesde,
} from './entrega-turno';

registerLocaleData(localeEs, 'es');

/** Lunes 21 de septiembre de 2026 (o `diasDespues` días después) a la hora indicada. */
function a(hhmm: string, diasDespues = 0): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 8, 21 + diasDespues, h, m, 0, 0);
}
const horas = (n: number) => n * 3_600_000;

const todos = [0, 1, 2, 3, 4, 5, 6];
const diurno: Turno = { dias: todos, desde: '08:00', hasta: '16:00' };
const nocturno: Turno = { dias: todos, desde: '22:00', hasta: '06:00' };

describe('entrega de turno', () => {
  describe('inicioEntrega y finTurnoAnterior', () => {
    it('sin turnos: las últimas 8 horas', () => {
      const ahora = a('14:00');
      expect(inicioEntrega({ turnos: [], ahora }).getTime()).toBe(ahora.getTime() - VENTANA_SIN_TURNOS_MS);
      expect(inicioEntrega({ turnos: null, ahora }).getTime()).toBe(ahora.getTime() - horas(8));
    });

    it('con turno diurno y fuera de guardia: desde que terminó el turno de ayer', () => {
      const ahora = a('07:00'); // antes de empezar el de hoy
      expect(finTurnoAnterior([diurno], ahora)).toEqual(a('16:00', -1));
      expect(inicioEntrega({ turnos: [diurno], ahora })).toEqual(a('16:00', -1));
    });

    it('de guardia ahora: el turno anterior es el de ayer, no el que está en curso', () => {
      const ahora = a('10:00');
      expect(finTurnoAnterior([diurno], ahora)).toEqual(a('16:00', -1));
    });

    it('turno nocturno que cruza la medianoche: terminó esta mañana a las 06:00', () => {
      const ahora = a('09:00');
      expect(finTurnoAnterior([nocturno], ahora)).toEqual(a('06:00'));
      // A las 23:00 está de guardia (empezó a las 22:00): el anterior acabó hoy a las 06:00
      expect(finTurnoAnterior([nocturno], a('23:00'))).toEqual(a('06:00'));
      // A las 02:00 sigue el turno que empezó ayer a las 22:00: el anterior acabó ayer a las 06:00
      expect(finTurnoAnterior([nocturno], a('02:00'))).toEqual(a('06:00', -1));
    });

    it('turno solo los lunes: si el anterior fue hace una semana, se acota a 3 días', () => {
      const lunes: Turno = { dias: [1], desde: '08:00', hasta: '16:00' };
      const ahora = a('07:00'); // lunes temprano: el anterior fue el lunes pasado
      expect(finTurnoAnterior([lunes], ahora)).toEqual(a('16:00', -7));
      expect(inicioEntrega({ turnos: [lunes], ahora }).getTime()).toBe(ahora.getTime() - VENTANA_MAX_MS);
    });

    it('la última visita manda si es más reciente que el turno anterior (y nunca en el futuro)', () => {
      const ahora = a('14:00');
      expect(inicioEntrega({ turnos: [], ahora, ultimaVisita: a('12:30') })).toEqual(a('12:30'));
      expect(inicioEntrega({ turnos: [], ahora, ultimaVisita: a('01:00') })).toEqual(a('06:00'));
      expect(inicioEntrega({ turnos: [], ahora, ultimaVisita: a('15:00') })).toEqual(a('06:00'));
    });
  });

  describe('fueraDeRango', () => {
    it('glucosa y presión con sus rangos; el peso no tiene', () => {
      expect(fueraDeRango({ tipo: 'glucosa', valor: 110 })).toBeNull();
      expect(fueraDeRango({ tipo: 'glucosa', valor: 210 })).toBe('70–180');
      expect(fueraDeRango({ tipo: 'presion', valor: 120, valorSecundario: 80 })).toBeNull();
      expect(fueraDeRango({ tipo: 'presion', valor: 120, valorSecundario: 95 })).toBe('90–140/60–90');
      expect(fueraDeRango({ tipo: 'peso', valor: 120 })).toBeNull();
    });
  });

  describe('novedadesEntrega', () => {
    const losartan: Medicamento = { id: 'm1', nombre: 'Losartán', dosis: '50 mg', horarios: ['08:00'], inventario: 10, activo: true };
    const bano: Tarea = { id: 't1', tipo: 'bano', nombre: 'Baño', horarios: ['10:00'], activo: true };
    const dosis = (hhmm: string, extra: Partial<DosisProgramada> = {}): DosisProgramada => ({
      medicamento: losartan, horario: hhmm, hora: a(hhmm), idToma: `x-${hhmm}`, ...extra,
    });
    const tarea = (hhmm: string, extra: Partial<TareaProgramada> = {}): TareaProgramada => ({
      tarea: bano, horario: hhmm, hora: a(hhmm), idRegistro: `y-${hhmm}`, ...extra,
    });
    const entrada = (tipo: EntradaBitacora['tipo'], hhmm: string, autorUid: string, texto = 'texto'): EntradaBitacora => ({
      tipo, texto, fotos: [], autorUid, autorNombre: autorUid === 'yo' ? 'Yo' : 'Marta', fecha: Timestamp.fromDate(a(hhmm)),
    });
    const signo = (tipo: SignoVital['tipo'], valor: number, hhmm: string): SignoVital => ({
      tipo, valor, unidad: '', fecha: Timestamp.fromDate(a(hhmm)), autorUid: 'otro',
    });

    it('nada relevante: lista vacía (tomas hechas, notas propias, signos normales, lo pendiente aún a tiempo)', () => {
      const filas = filasDelDia(
        [dosis('08:00', { toma: { horaProgramada: Timestamp.fromDate(a('08:00')), tomado: true, registradoPor: 'u' } }), dosis('14:05')],
        [tarea('10:00', { registro: { horaProgramada: Timestamp.fromDate(a('10:00')), hecha: true, registradoPor: 'u' } })],
      );
      const lista = novedadesEntrega({
        desde: a('06:00'),
        ahora: a('14:00'),
        filas,
        entradas: [entrada('nota', '09:00', 'yo'), entrada('animo', '09:30', 'marta')],
        signos: [signo('glucosa', 110, '08:30')],
        miUid: 'yo',
      });
      expect(lista).toEqual([]);
    });

    it('varias alertas: omitidas, vencidas, incidente, signo fuera de rango y la última nota de otra persona, de reciente a antigua', () => {
      const filas = filasDelDia(
        [
          dosis('08:00', { toma: { horaProgramada: Timestamp.fromDate(a('08:00')), horaReal: null, tomado: false, registradoPor: 'u', registradoNombre: 'Marta', nota: 'vomitó' } }),
          dosis('12:00'),
        ],
        [tarea('10:00')],
      );
      const lista = novedadesEntrega({
        desde: a('06:00'),
        ahora: a('14:00'),
        filas,
        entradas: [
          entrada('incidente', '11:30', 'marta', 'Se cayó en el baño'),
          entrada('nota', '07:00', 'marta', 'Durmió mal'),
          entrada('nota', '09:00', 'marta', 'Desayunó poco'),
          entrada('nota', '09:30', 'yo', 'mi nota'),
          entrada('sintoma', '05:00', 'marta', 'antes de la ventana'),
        ],
        signos: [signo('glucosa', 210, '08:30'), signo('oxigenacion', 97, '08:30')],
        miUid: 'yo',
      });
      expect(lista.map((n) => `${n.tipo} ${n.hora.getHours()}`)).toEqual([
        'toma_vencida 12',
        'incidente 11',
        'tarea_vencida 10',
        'nota 9',
        'signo 8',
        'toma_omitida 8',
      ]);
      expect(lista[1].texto).toBe('Incidente: Se cayó en el baño');
      expect(lista[3].texto).toBe('Nota: Desayunó poco');
      expect(lista[4].texto).toBe('Glucosa 210 mg/dL (habitual 70–180)');
      expect(lista[5].texto).toBe('Losartán 08:00: no tomada · vomitó');
      expect(lista[5].quien).toBe('Marta');
    });

    it('una "no tomada" de la mañana registrada por la noche entra por la hora en que se registró', () => {
      const filas = filasDelDia(
        [dosis('08:00', { toma: { horaProgramada: Timestamp.fromDate(a('08:00')), horaReal: null, tomado: false, registradoPor: 'u', registradoEn: Timestamp.fromDate(a('20:55')) } })],
        [],
      );
      const lista = novedadesEntrega({ desde: a('12:56'), ahora: a('20:56'), filas, entradas: [], signos: [], miUid: 'yo' });
      expect(lista.map((n) => `${n.tipo} ${n.hora.getHours()}:${n.hora.getMinutes()}`)).toEqual(['toma_omitida 20:55']);
      expect(lista[0].texto).toBe('Losartán 08:00: no tomada');
    });

    it('una dosis pendiente dentro de la gracia no cuenta como vencida', () => {
      const filas = filasDelDia([dosis('13:50')], []);
      expect(novedadesEntrega({ desde: a('06:00'), ahora: a('14:00'), filas, entradas: [], signos: [], miUid: 'yo' })).toEqual([]);
      expect(novedadesEntrega({ desde: a('06:00'), ahora: a('14:06'), filas, entradas: [], signos: [], miUid: 'yo' }).length).toBe(1);
    });
  });

  describe('textoDesde', () => {
    it('hoy, ayer o fecha', () => {
      expect(textoDesde(a('06:00'), a('14:00'))).toBe('desde hoy 06:00');
      expect(textoDesde(a('22:00', -1), a('14:00'))).toBe('desde ayer 22:00');
      expect(textoDesde(a('16:00', -3), a('14:00'))).toBe('desde el 18 sept 16:00');
    });
  });
});
