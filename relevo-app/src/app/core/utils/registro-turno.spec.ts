import { Turno } from '../models';
import {
  AVISO_FIN_TURNO_MIN,
  TOLERANCIA_TURNO_MIN,
  estadoRegistro,
  franjaDe,
  franjasDeTurnos,
  textoSinRegistro,
} from './registro-turno';

// Noviembre de 2026: el lunes 2 es la semana de las pruebas
const lunes = (h: number, m = 0) => new Date(2026, 10, 2, h, m);
const dia = (d: number, h: number, m = 0) => new Date(2026, 10, 1 + d, h, m); // d: 0 = domingo 1 de nov
const LV: number[] = [1, 2, 3, 4, 5];
const manana: Turno = { dias: LV, desde: '08:00', hasta: '16:00' };

describe('registro por turno', () => {
  it('usa 30 minutos de tolerancia y de aviso', () => {
    expect(TOLERANCIA_TURNO_MIN).toBe(30);
    expect(AVISO_FIN_TURNO_MIN).toBe(30);
  });

  describe('franjasDeTurnos (lo que exigen las rules)', () => {
    it('cubre el turno más la tolerancia, en franjas de 15 min', () => {
      const f = franjasDeTurnos([manana]);
      expect(f).toContain(franjaDe(1, 8 * 60));
      expect(f).toContain(franjaDe(1, 16 * 60 + 29));
      expect(f).not.toContain(franjaDe(1, 16 * 60 + 30));
      expect(f).not.toContain(franjaDe(1, 7 * 60 + 59));
      expect(f).not.toContain(franjaDe(6, 10 * 60));
      // 8 h + 30 min = 34 franjas por día, 5 días
      expect(f.length).toBe(34 * 5);
    });

    it('un turno nocturno del sábado sigue el domingo (la semana da la vuelta)', () => {
      const f = franjasDeTurnos([{ dias: [6], desde: '22:00', hasta: '06:00' }]);
      expect(f).toContain(franjaDe(6, 22 * 60));
      expect(f).toContain(franjaDe(0, 3 * 60));
      expect(f).toContain(franjaDe(0, 6 * 60 + 15));
      expect(f).not.toContain(franjaDe(0, 6 * 60 + 30));
    });

    it('las 24 h todos los días cubren la semana completa sin repetir', () => {
      const f = franjasDeTurnos([{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }]);
      expect(f.length).toBe(672);
      expect(new Set(f).size).toBe(672);
    });

    it('una hora que no cae en múltiplo de 15 toma la franja que la contiene', () => {
      const f = franjasDeTurnos([{ dias: [3], desde: '07:10', hasta: '07:40' }]);
      expect(f).toContain(franjaDe(3, 7 * 60));
      // 07:40 + 30 = 08:10: la franja de las 08:00 todavía cuenta
      expect(f).toContain(franjaDe(3, 8 * 60));
      expect(f).not.toContain(franjaDe(3, 8 * 60 + 15));
    });

    it('sin turnos o con datos inválidos no da franjas', () => {
      expect(franjasDeTurnos(null)).toEqual([]);
      expect(franjasDeTurnos([{ dias: [1], desde: '25:00', hasta: '08:00' }])).toEqual([]);
    });
  });

  describe('estadoRegistro', () => {
    it('el responsable siempre registra; el médico no', () => {
      expect(estadoRegistro('cuidador_principal', {}, lunes(3)).puede).toBeTrue();
      const medico = estadoRegistro('medico', {}, lunes(10));
      expect(medico.puede).toBeFalse();
      expect(medico.motivo).toBe('medico');
    });

    it('el familiar registra solo con permiso del responsable', () => {
      expect(estadoRegistro('familiar', {}, lunes(10)).motivo).toBe('sin_permiso');
      expect(estadoRegistro('familiar', { puedeRegistrar: false }, lunes(10)).puede).toBeFalse();
      expect(estadoRegistro('familiar', { puedeRegistrar: true }, lunes(10)).puede).toBeTrue();
    });

    it('en pausa nadie registra, aunque esté en turno o tenga permiso', () => {
      expect(estadoRegistro('cuidador_turno', { turnos: [manana], pausado: true }, lunes(10)).motivo).toBe('pausa');
      expect(estadoRegistro('familiar', { puedeRegistrar: true, pausado: true }, lunes(10)).motivo).toBe('pausa');
    });

    it('el enfermero sin turnos no registra', () => {
      const e = estadoRegistro('cuidador_turno', { turnos: [] }, lunes(10));
      expect(e.motivo).toBe('sin_turnos');
      expect(textoSinRegistro(e, lunes(10))).toContain('Pide al responsable');
    });

    it('dentro del turno registra y sabe cuándo termina', () => {
      const e = estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(10));
      expect(e.puede).toBeTrue();
      expect(e.finTurno).toEqual(lunes(16));
      expect(e.registraHasta).toEqual(lunes(16, 30));
      expect(e.porAcabar).toBeFalse();
      expect(textoSinRegistro(e, lunes(10))).toBe('');
    });

    it('30 minutos antes del fin se ofrece la nota de entrega', () => {
      expect(estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(15, 29)).porAcabar).toBeFalse();
      const e = estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(15, 30));
      expect(e.porAcabar).toBeTrue();
      expect(e.enTolerancia).toBeFalse();
    });

    it('en la tolerancia todavía registra; después ya no', () => {
      const tolerancia = estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(16, 20));
      expect(tolerancia.puede).toBeTrue();
      expect(tolerancia.enTolerancia).toBeTrue();
      expect(tolerancia.porAcabar).toBeTrue();
      const fuera = estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(16, 30));
      expect(fuera.puede).toBeFalse();
      expect(fuera.motivo).toBe('fuera_de_turno');
      expect(fuera.ultimoFin).toEqual(lunes(16));
      expect(fuera.proximoInicio).toEqual(dia(2, 8));
      const texto = textoSinRegistro(fuera, lunes(16, 30));
      expect(texto).toContain('Tu turno terminó a las 16:00');
      expect(texto).toContain('mañana a las 08:00');
    });

    it('antes de su turno dice cuándo empieza', () => {
      const e = estadoRegistro('cuidador_turno', { turnos: [manana] }, lunes(6));
      expect(e.motivo).toBe('fuera_de_turno');
      expect(e.proximoInicio).toEqual(lunes(8));
      expect(textoSinRegistro(e, lunes(6))).toContain('hoy a las 08:00');
    });

    it('turnos seguidos son una sola guardia: no avisa a media guardia', () => {
      const turnos: Turno[] = [manana, { dias: LV, desde: '16:00', hasta: '00:00' }];
      const e = estadoRegistro('cuidador_turno', { turnos }, lunes(15, 50));
      expect(e.porAcabar).toBeFalse();
      expect(e.finTurno).toEqual(dia(2, 0));
    });

    it('un turno nocturno sigue al día siguiente, también de sábado a domingo', () => {
      const noche: Turno = { dias: [5, 6], desde: '22:00', hasta: '06:00' };
      const sabado = estadoRegistro('cuidador_turno', { turnos: [noche] }, dia(6, 5, 45));
      expect(sabado.puede).toBeTrue();
      expect(sabado.porAcabar).toBeTrue();
      const domingo = estadoRegistro('cuidador_turno', { turnos: [noche] }, dia(7, 1));
      expect(domingo.puede).toBeTrue();
      expect(domingo.finTurno).toEqual(dia(7, 6));
    });

    it('las 24 h todos los días siempre registra y nunca pide la nota', () => {
      const e = estadoRegistro(
        'cuidador_turno',
        { turnos: [{ dias: [0, 1, 2, 3, 4, 5, 6], desde: '00:00', hasta: '00:00' }] },
        lunes(23, 50),
      );
      expect(e.puede).toBeTrue();
      expect(e.porAcabar).toBeFalse();
    });
  });
});
