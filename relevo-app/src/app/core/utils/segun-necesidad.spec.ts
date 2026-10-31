import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Timestamp } from '@angular/fire/firestore';
import { MotivoToma, Toma } from '../models';
import {
  momentoToma,
  resumenCondicional,
  revisarNuevaToma,
  textoHoy,
  textoIndicacion,
  textosExceso,
  textoUso,
} from './segun-necesidad';

registerLocaleData(localeEs, 'es');

/** 28 de octubre de 2026 (o `dia`) a la hora "HH:mm". */
const a = (hhmm: string, dia = 28) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 9, dia, h, m, 0, 0);
};
const toma = (hhmm: string, dia = 28, extra: Partial<Toma> = {}): Toma => ({
  horaProgramada: Timestamp.fromDate(a(hhmm, dia)),
  horaReal: Timestamp.fromDate(a(hhmm, dia)),
  tomado: true,
  registradoPor: 'u',
  aDemanda: true,
  ...extra,
});
const conMotivo = (hhmm: string, dia: number, motivo: MotivoToma, intensidad?: number) =>
  toma(hhmm, dia, { motivo, ...(intensidad !== undefined ? { intensidad } : {}) });

const paracetamol = { condicion: 'si hay dolor', maxAlDia: 3, horasEntreTomas: 8 };

describe('medicamentos según necesidad con indicación del médico', () => {
  it('textoIndicacion resume lo que dijo el médico (y queda vacío sin indicación)', () => {
    expect(textoIndicacion(paracetamol)).toBe('Si hay dolor · máximo 3 al día · cada 8 h');
    expect(textoIndicacion({ condicion: '', maxAlDia: null, horasEntreTomas: null })).toBe('');
    expect(textoIndicacion({ maxAlDia: 2 })).toBe('máximo 2 al día');
    expect(textoHoy(2, 3)).toBe('Hoy van 2 de 3');
    expect(textoHoy(2, null)).toBe('Hoy van 2');
  });

  describe('revisarNuevaToma', () => {
    it('dentro de lo indicado: sin avisos', () => {
      const r = revisarNuevaToma(paracetamol, [toma('06:00'), toma('06:00', 27)], a('15:00'));
      expect(r.tomadasHoy).toBe(1);
      expect(r.horasDesdeUltima).toBe(9);
      expect(r.avisos).toEqual([]);
    });

    it('la cuarta del día se pasa del máximo: avisa sin impedir', () => {
      const r = revisarNuevaToma(paracetamol, [toma('00:30'), toma('08:30'), toma('16:30')], a('23:00'));
      expect(r.excedeMaximo).toBeTrue();
      expect(r.antesDeTiempo).toBeTrue();
      expect(r.avisos).toEqual([
        'Hoy ya van 3 de 3 permitidas. Consulta al médico antes de dar otra.',
        'La última fue hace 6 h 30 min; la indicación es cada 8 h.',
      ]);
    });

    it('antes del intervalo aunque no llegue al máximo', () => {
      const r = revisarNuevaToma(paracetamol, [toma('09:00')], a('12:00'));
      expect(r.excedeMaximo).toBeFalse();
      expect(r.avisos).toEqual(['La última fue hace 3 h; la indicación es cada 8 h.']);
    });

    it('las tomas de ayer no cuentan para el máximo de hoy, pero sí para el intervalo', () => {
      const r = revisarNuevaToma(paracetamol, [toma('09:00', 27), toma('15:00', 27), toma('22:00', 27)], a('02:00'));
      expect(r.tomadasHoy).toBe(0);
      expect(r.excedeMaximo).toBeFalse();
      expect(r.antesDeTiempo).toBeTrue();
    });

    it('las tomas marcadas como no tomadas no cuentan', () => {
      const r = revisarNuevaToma(paracetamol, [toma('09:00', 28, { tomado: false, horaReal: null })], a('10:00'));
      expect(r.tomadasHoy).toBe(0);
      expect(r.avisos).toEqual([]);
    });

    it('sin indicación de intervalo, avisa de un posible registro repetido (como antes)', () => {
      const sinLimites = { maxAlDia: null, horasEntreTomas: null };
      expect(revisarNuevaToma(sinLimites, [toma('09:00')], a('09:40')).avisos).toEqual([
        'Ya hay una toma de hace menos de una hora: revisa que no sea un registro repetido.',
      ]);
      expect(revisarNuevaToma(sinLimites, [toma('09:00')], a('10:30')).avisos).toEqual([]);
      // Con intervalo indicado, el aviso del intervalo reemplaza al de registro repetido
      expect(revisarNuevaToma(paracetamol, [toma('09:00')], a('09:40')).posibleRepetida).toBeFalse();
    });
  });

  describe('resumen para el médico', () => {
    const semana = [
      conMotivo('08:00', 24, 'dolor', 7),
      conMotivo('07:00', 26, 'dolor', 6),
      conMotivo('13:00', 26, 'dolor', 5),
      conMotivo('17:00', 26, 'fiebre'),
      conMotivo('21:00', 26, 'dolor', 6),
      toma('10:00', 27, { tomado: false, horaReal: null }),
    ];

    it('cuenta tomas, motivos, intensidad promedio, días sobre el máximo y tomas antes de tiempo', () => {
      const r = resumenCondicional(paracetamol, semana);
      expect(r.tomas).toBe(5);
      expect(r.porMotivo).toEqual({ dolor: 4, fiebre: 1, otro: 0 });
      expect(r.intensidadPromedio).toBe(6);
      expect(r.diasSobreMaximo.map((d) => d.tomas)).toEqual([4]);
      // 07:00→13:00 (6 h), 13:00→17:00 (4 h), 17:00→21:00 (4 h)
      expect(r.antesDeTiempo).toBe(3);
      expect(textoUso(r)).toBe('5 tomas: 4 por dolor (intensidad promedio 6/10), 1 por fiebre');
      expect(textosExceso('Paracetamol', paracetamol, r)).toEqual([
        'Paracetamol (si hay dolor): el 26 oct se dieron 4, más del máximo de 3 al día',
        'Paracetamol (si hay dolor): 3 tomas con menos de 8 h desde la anterior',
      ]);
    });

    it('sin indicación: solo cuenta el uso, sin excesos', () => {
      const r = resumenCondicional({ maxAlDia: null, horasEntreTomas: null }, semana);
      expect(r.diasSobreMaximo).toEqual([]);
      expect(r.antesDeTiempo).toBe(0);
      expect(textosExceso('Paracetamol', {}, r)).toEqual([]);
    });

    it('sin tomas en el periodo', () => {
      const r = resumenCondicional(paracetamol, []);
      expect(textoUso(r)).toBe('Sin tomas en el periodo');
      expect(r.intensidadPromedio).toBeNull();
    });

    it('momentoToma usa la hora real y si no la programada', () => {
      expect(momentoToma(toma('09:00')).getHours()).toBe(9);
      expect(momentoToma({ horaProgramada: Timestamp.fromDate(a('07:15')), horaReal: null }).getMinutes()).toBe(15);
    });
  });
});
