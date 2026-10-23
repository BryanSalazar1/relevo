import {
  GRACIA_MIN,
  PendienteSemaforo,
  cuandoEs,
  estadoSemaforo,
  faseDe,
  textoMinutos,
} from './semaforo';

/** Hoy a la hora indicada ("HH:mm"). */
function a(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2026, 8, 21, h, m, 0, 0);
}

type P = PendienteSemaforo & { nombre: string };
const p = (nombre: string, hhmm: string, extra: Partial<PendienteSemaforo> = {}): P => ({
  nombre,
  hora: a(hhmm),
  ...extra,
});

describe('semáforo', () => {
  describe('faseDe', () => {
    it('falta mucho: después', () => {
      expect(faseDe(p('x', '14:00'), a('13:00'))).toBe('despues');
    });

    it('entra en "pronto" justo al llegar a su aviso (15 min por defecto)', () => {
      expect(faseDe(p('x', '14:00'), a('13:44'))).toBe('despues');
      expect(faseDe(p('x', '14:00'), a('13:45'))).toBe('pronto');
    });

    it('respeta el aviso propio de la tarea', () => {
      expect(faseDe(p('x', '14:00', { avisarMin: 60 }), a('13:00'))).toBe('pronto');
      expect(faseDe(p('x', '14:00', { avisarMin: 0 }), a('13:59'))).toBe('despues');
    });

    it('dos horas después de su hora pasa de "atrasado" a "sin registrar"', () => {
      const pendiente = p('Losartán', '08:00');
      expect(faseDe(pendiente, a('09:59'))).toBe('atrasado');
      expect(faseDe(pendiente, a('10:00'))).toBe('sin_registrar');
      expect(faseDe(p('Caminata', '10:00', { duracionMin: 30 }), a('12:29'))).toBe('atrasado');
      expect(faseDe(p('Caminata', '10:00', { duracionMin: 30 }), a('12:30'))).toBe('sin_registrar');
    });

    it('a su hora es "ahora" y tras la tolerancia pasa a "atrasado"', () => {
      expect(faseDe(p('x', '14:00'), a('14:00'))).toBe('ahora');
      expect(faseDe(p('x', '14:00'), a(`14:${GRACIA_MIN - 1}`))).toBe('ahora');
      expect(faseDe(p('x', '14:00'), a(`14:${GRACIA_MIN}`))).toBe('atrasado');
    });

    it('una tarea con rango no se atrasa mientras dura', () => {
      const ejercicio = p('Ejercicio', '10:00', { duracionMin: 60 });
      expect(faseDe(ejercicio, a('10:45'))).toBe('ahora');
      expect(faseDe(ejercicio, a('11:14'))).toBe('ahora');
      expect(faseDe(ejercicio, a('11:15'))).toBe('atrasado');
    });
  });

  describe('estadoSemaforo', () => {
    it('sin pendientes: verde y sin principal', () => {
      const e = estadoSemaforo([], a('12:00'));
      expect(e.color).toBe('verde');
      expect(e.principal).toBeNull();
      expect(e.fase).toBeNull();
      expect(e.resto).toEqual([]);
    });

    it('verde: muestra lo que sigue, aunque venga desordenado', () => {
      const e = estadoSemaforo([p('Cena', '19:30'), p('Caminata', '17:00')], a('12:00'));
      expect(e.color).toBe('verde');
      expect(e.principal?.nombre).toBe('Caminata');
      expect(e.fase).toBe('despues');
      expect(e.resto.map((x) => x.pendiente.nombre)).toEqual(['Cena']);
    });

    it('amarillo: manda lo que está por tocar', () => {
      const e = estadoSemaforo([p('Cena', '19:30'), p('Losartán', '12:10')], a('12:00'));
      expect(e.color).toBe('amarillo');
      expect(e.principal?.nombre).toBe('Losartán');
      expect(e.fase).toBe('pronto');
    });

    it('rojo gana a todo y manda el atrasado más antiguo', () => {
      const e = estadoSemaforo(
        [p('Comida', '10:30'), p('Baño', '10:00'), p('Desayuno', '08:45'), p('Cena', '19:30')],
        a('10:35'),
      );
      expect(e.color).toBe('rojo');
      expect(e.atrasados).toBe(2);
      expect(e.sinRegistrar).toBe(0);
      expect(e.principal?.nombre).toBe('Desayuno');
      // El resto va por hora, con su fase
      expect(e.resto.map((x) => `${x.pendiente.nombre}:${x.fase}`)).toEqual([
        'Baño:atrasado',
        'Comida:ahora',
        'Cena:despues',
      ]);
    });

    it('lo viejo (más de 2 h) ya no pone rojo: queda "sin registrar" en amarillo y manda lo que toca', () => {
      const e = estadoSemaforo(
        [p('Comida', '14:00'), p('Baño', '10:00'), p('Desayuno', '08:30'), p('Cena', '19:30')],
        a('14:05'),
      );
      expect(e.color).toBe('amarillo');
      expect(e.atrasados).toBe(0);
      expect(e.sinRegistrar).toBe(2);
      expect(e.principal?.nombre).toBe('Comida');
      expect(e.fase).toBe('ahora');
      expect(e.resto.map((x) => `${x.pendiente.nombre}:${x.fase}`)).toEqual([
        'Desayuno:sin_registrar',
        'Baño:sin_registrar',
        'Cena:despues',
      ]);
    });

    it('de noche, con solo dosis viejas sin anotar, es amarillo y manda la más antigua', () => {
      const e = estadoSemaforo([p('Losartán', '08:00'), p('Metformina', '08:00')], a('22:30'));
      expect(e.color).toBe('amarillo');
      expect(e.fase).toBe('sin_registrar');
      expect(e.sinRegistrar).toBe(2);
      expect(e.principal?.nombre).toBe('Losartán');
    });

    it('al registrar el atrasado (deja de ser pendiente) el color baja', () => {
      const pendientes = [p('Desayuno', '08:30'), p('Cena', '19:30')];
      expect(estadoSemaforo(pendientes, a('09:00')).color).toBe('rojo');
      expect(estadoSemaforo(pendientes.slice(1), a('09:00')).color).toBe('verde');
    });
  });

  describe('textos', () => {
    it('textoMinutos', () => {
      expect(textoMinutos(0.2)).toBe('1 min');
      expect(textoMinutos(45)).toBe('45 min');
      expect(textoMinutos(120)).toBe('2 h');
      expect(textoMinutos(135)).toBe('2 h 15 min');
    });

    it('cuandoEs', () => {
      expect(cuandoEs(a('14:00'), a('13:50'))).toBe('en 10 min');
      expect(cuandoEs(a('08:00'), a('08:35'))).toBe('hace 35 min');
      expect(cuandoEs(a('14:00'), a('14:00'))).toBe('ahora');
    });
  });
});
