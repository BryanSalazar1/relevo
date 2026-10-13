import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Timestamp } from '@angular/fire/firestore';
import { Medicamento, Tarea } from '../models';

// Las filas se formatean en español (formatDate con 'es'); en la app lo registra main.ts
registerLocaleData(localeEs, 'es');
import { DosisProgramada } from '../services/medicamentos.service';
import { TareaProgramada } from '../services/tareas.service';
import {
  avanceDia,
  filasDelDia,
  pendientesDelDia,
  textoCuando,
  tituloEstado,
} from './agenda-dia';
import { estadoSemaforo } from './semaforo';

/** Hoy a la hora indicada ("HH:mm"). */
function a(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 8, 21, h, m, 0, 0);
}

const losartan: Medicamento = {
  id: 'm1',
  nombre: 'Losartán',
  dosis: '50 mg',
  horarios: ['08:00', '20:00'],
  inventario: 10,
  activo: true,
};

const comida: Tarea = {
  id: 't1',
  tipo: 'comida',
  nombre: 'Desayuno',
  horarios: ['08:30'],
  duracionMin: 60,
  avisarMin: 30,
  activo: true,
};

function dosis(hhmm: string, extra: Partial<DosisProgramada> = {}): DosisProgramada {
  return { medicamento: losartan, horario: hhmm, hora: a(hhmm), idToma: `20260921-${hhmm.replace(':', '')}`, ...extra };
}

function tarea(hhmm: string, extra: Partial<TareaProgramada> = {}): TareaProgramada {
  return { tarea: comida, horario: hhmm, hora: a(hhmm), idRegistro: `20260921-${hhmm.replace(':', '')}`, ...extra };
}

const tomada = (quien = 'Rosa') => ({
  horaProgramada: Timestamp.fromDate(a('08:00')),
  horaReal: Timestamp.fromDate(a('08:05')),
  tomado: true,
  registradoPor: 'u1',
  registradoNombre: quien,
});

describe('agenda del día', () => {
  describe('filasDelDia', () => {
    it('une tomas y tareas por hora; a la misma hora van primero los medicamentos', () => {
      const filas = filasDelDia([dosis('20:00'), dosis('08:30')], [tarea('08:30'), tarea('07:00')]);
      // Las tareas con duración muestran su rango
      expect(filas.map((f) => `${f.tipo} ${f.horario}`)).toEqual([
        'tarea 07:00–08:00',
        'toma 08:30',
        'tarea 08:30–09:30',
        'toma 20:00',
      ]);
    });

    it('describe cada fila: horario con rango en tareas, estado y quién registró', () => {
      const [t, d] = filasDelDia([dosis('08:00', { toma: tomada('Marta') })], [tarea('08:30')]).sort((x, y) =>
        x.tipo.localeCompare(y.tipo),
      );
      expect(t.titulo).toBe('Desayuno');
      expect(t.horario).toBe('08:30–09:30');
      expect(t.horarioTexto).toBe('de 08:30 a 09:30');
      expect(t.detalle).toBe('Comida');
      expect(t.duracionMin).toBe(60);
      expect(t.avisarMin).toBe(30);
      expect(t.registrado).toBeFalse();
      expect(t.hecho).toBeNull();

      expect(d.titulo).toBe('Losartán');
      expect(d.horarioTexto).toBe('a las 08:00');
      expect(d.detalle).toBe('50 mg');
      expect(d.registrado).toBeTrue();
      expect(d.hecho).toBeTrue();
      expect(d.quien).toBe('Marta');
      expect(d.horaReal?.getMinutes()).toBe(5);
    });
  });

  describe('pendientesDelDia y avanceDia', () => {
    it('deja fuera lo registrado y las tomas según necesidad', () => {
      const filas = filasDelDia(
        [dosis('08:00', { toma: tomada() }), dosis('20:00'), dosis('11:15', { aDemanda: true, toma: tomada() })],
        [tarea('08:30'), tarea('14:00', { registro: { horaProgramada: Timestamp.fromDate(a('14:00')), hecha: false, registradoPor: 'u1' } })],
      );
      expect(pendientesDelDia(filas).map((f) => f.clave)).toEqual(['tarea-t1-20260921-0830', 'toma-m1-20260921-2000']);
      // La toma según necesidad no cuenta en lo programado; la no hecha sí cuenta como registrada
      expect(avanceDia(filas)).toEqual({ total: 4, registradas: 2 });
    });

    it('sin nada programado el avance es 0 de 0', () => {
      expect(avanceDia([])).toEqual({ total: 0, registradas: 0 });
    });
  });

  describe('tituloEstado y textoCuando', () => {
    it('todo al día: título verde y "sigue" con cuánto falta', () => {
      const filas = filasDelDia([dosis('20:00')], []);
      const e = estadoSemaforo(pendientesDelDia(filas), a('18:00'));
      expect(e.color).toBe('verde');
      expect(tituloEstado(e)).toBe('Todo al día');
      expect(textoCuando(e, a('18:00'))).toBe('A las 20:00 · en 2 h');
    });

    it('varios atrasados: cuenta y el más antiguo manda', () => {
      const filas = filasDelDia([dosis('08:00')], [tarea('08:30')]);
      const e = estadoSemaforo(pendientesDelDia(filas), a('11:00'));
      expect(e.color).toBe('rojo');
      expect(tituloEstado(e)).toBe('2 atrasados');
      expect(e.principal?.titulo).toBe('Losartán');
      expect(textoCuando(e, a('11:00'))).toBe('Era a las 08:00 · hace 3 h');
    });

    it('una tarea con rango es "ahora" mientras dura', () => {
      const e = estadoSemaforo(pendientesDelDia(filasDelDia([], [tarea('08:30')])), a('09:00'));
      expect(e.fase).toBe('ahora');
      expect(tituloEstado(e)).toBe('Es hora');
      expect(textoCuando(e, a('09:00'))).toBe('De 08:30 a 09:30 · hace 30 min');
    });

    it('sin pendientes no hay texto', () => {
      const e = estadoSemaforo(pendientesDelDia([]), a('09:00'));
      expect(tituloEstado(e)).toBe('Todo al día');
      expect(textoCuando(e, a('09:00'))).toBe('');
    });
  });
});
