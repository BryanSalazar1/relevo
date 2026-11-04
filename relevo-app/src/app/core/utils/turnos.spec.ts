import { Miembro, Turno } from '../models';
import {
  cruzaMedianoche,
  esTodoElDia,
  huecosCobertura,
  resumenCobertura,
  textoDuracionTurno,
  textoHuecos,
  textoTurno,
  textoTurnos,
  turnosQueCubren,
  turnosTraslapados,
} from './turnos';

const todos = [0, 1, 2, 3, 4, 5, 6];
const entreSemana = [1, 2, 3, 4, 5];
const siempre: Turno = { dias: todos, desde: '00:00', hasta: '00:00' };
const manana: Turno = { dias: entreSemana, desde: '08:00', hasta: '16:00' };
const noche: Turno = { dias: entreSemana, desde: '22:00', hasta: '06:00' };

describe('turnos', () => {
  it('todo el día, nocturno y duración', () => {
    expect(esTodoElDia(siempre)).toBeTrue();
    expect(esTodoElDia(manana)).toBeFalse();
    expect(cruzaMedianoche(noche)).toBeTrue();
    expect(cruzaMedianoche(siempre)).toBeFalse();
    expect(textoDuracionTurno(manana)).toBe('8 h');
    expect(textoDuracionTurno(noche)).toBe('8 h');
    expect(textoDuracionTurno(siempre)).toBe('24 h');
    expect(textoDuracionTurno({ desde: '07:00', hasta: '14:30' })).toBe('7 h 30 min');
  });

  it('textos: todos los días las 24 h, horario y nocturno', () => {
    expect(textoTurno(siempre)).toBe('Todos los días, las 24 h');
    expect(textoTurno(manana)).toBe('L, M, X, J y V 08:00–16:00');
    expect(textoTurno(noche)).toBe('L, M, X, J y V 22:00–06:00 (termina al día siguiente)');
    expect(textoTurnos([])).toBe('Sin turnos');
    expect(textoTurnos([manana, { dias: [6, 0], desde: '09:00', hasta: '13:00' }])).toBe(
      'L, M, X, J y V 08:00–16:00 · S y D 09:00–13:00',
    );
  });

  it('traslapes del mismo miembro: el nocturno invade la mañana siguiente; 24 h choca con todo', () => {
    expect(turnosTraslapados([manana, { dias: [6, 0], desde: '08:00', hasta: '16:00' }])).toBeNull();
    // Viernes 22:00–06:00 sigue el sábado hasta las 06:00: choca con un sábado 05:00–09:00
    expect(turnosTraslapados([{ dias: [5], desde: '22:00', hasta: '06:00' }, { dias: [6], desde: '05:00', hasta: '09:00' }])).toBe(6);
    expect(turnosTraslapados([siempre, { dias: [3], desde: '10:00', hasta: '11:00' }])).toBe(3);
    // Mañana y noche seguidas no se pisan
    expect(turnosTraslapados([manana, { dias: entreSemana, desde: '16:00', hasta: '22:00' }])).toBeNull();
  });

  it('cobertura: sin turnos no aplica; 24 h cubre todo; los huecos se agrupan por días', () => {
    expect(huecosCobertura([[], null, undefined])).toBeNull();
    expect(resumenCobertura([[]])).toBeNull();
    expect(textoHuecos(huecosCobertura([[siempre]])!)).toBe('');
    expect(resumenCobertura([[siempre]])).toBe('Siempre hay alguien de guardia.');

    const huecos = huecosCobertura([[manana]])!;
    expect(huecos[1]).toEqual([
      { desde: 0, hasta: 480 },
      { desde: 960, hasta: 1440 },
    ]);
    expect(textoHuecos(huecos)).toBe('L, M, X, J y V 00:00–08:00 y 16:00–24:00 · S y D todo el día');
  });

  it('cobertura del equipo: turnos de varios miembros, el nocturno cubre la madrugada siguiente', () => {
    const marta = [manana];
    const sofia = [{ dias: entreSemana, desde: '16:00', hasta: '22:00' }];
    const pedro = [noche];
    const fin = [{ dias: [6, 0], desde: '00:00', hasta: '00:00' }];
    // El lunes de madrugada nadie cubre (Pedro no hace la noche del domingo); el sábado de madrugada sí
    expect(textoHuecos(huecosCobertura([marta, sofia, pedro, fin])!)).toBe(
      'Lunes 00:00–08:00 · M, X, J y V 06:00–08:00',
    );
    expect(textoHuecos(huecosCobertura([marta, sofia, pedro])!)).toBe(
      'Lunes 00:00–08:00 · M, X, J y V 06:00–08:00 · Sábado 06:00–24:00 · Domingo todo el día',
    );
  });

  it('solo cuentan quienes reciben recordatorios: el médico, quien los apagó y quien está en pausa no cubren', () => {
    const m = (rol: Miembro['rol'], turnos: Turno[], recordatorios?: boolean, pausado?: boolean) =>
      ({ rol, turnos, recordatorios, pausado }) as Pick<Miembro, 'rol' | 'turnos' | 'recordatorios' | 'pausado'>;
    const lista = turnosQueCubren([
      m('medico', [siempre]),
      m('cuidador_turno', [manana], false),
      m('familiar', [noche]),
      m('cuidador_principal', []),
      m('cuidador_turno', [siempre], true, true),
    ]);
    expect(lista).toEqual([[noche], []]);
  });
});
