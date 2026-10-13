import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { textoAnticipacion, textoFechaRelativa } from './fechas';

registerLocaleData(localeEs, 'es');

describe('textoFechaRelativa', () => {
  const ahora = new Date(2026, 9, 13, 9, 0); // martes 13 de octubre de 2026

  it('hoy, mañana y ayer con la hora', () => {
    expect(textoFechaRelativa(new Date(2026, 9, 13, 17, 30), ahora)).toBe('hoy 17:30');
    expect(textoFechaRelativa(new Date(2026, 9, 14, 7, 30), ahora)).toBe('mañana 07:30');
    expect(textoFechaRelativa(new Date(2026, 9, 12, 16, 0), ahora)).toBe('ayer 16:00');
  });

  it('otros días del año con el día de la semana; otro año con el año', () => {
    expect(textoFechaRelativa(new Date(2026, 9, 19, 10, 0), ahora)).toBe('lun 19 oct, 10:00');
    expect(textoFechaRelativa(new Date(2027, 0, 15, 10, 0), ahora)).toBe('15 ene 2027, 10:00');
  });
});

describe('textoAnticipacion', () => {
  it('sin aviso, minutos, horas y días', () => {
    expect(textoAnticipacion(0)).toBe('Sin aviso');
    expect(textoAnticipacion(undefined)).toBe('Sin aviso');
    expect(textoAnticipacion(30)).toBe('30 min antes');
    expect(textoAnticipacion(60)).toBe('1 h antes');
    expect(textoAnticipacion(90)).toBe('1 h 30 min antes');
    expect(textoAnticipacion(120)).toBe('2 h antes');
    expect(textoAnticipacion(1440)).toBe('1 día antes');
    expect(textoAnticipacion(2880)).toBe('2 días antes');
  });
});
