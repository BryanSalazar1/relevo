import { avanceDia, filasDelDia, pendientesDelDia } from '../utils/agenda-dia';
import { DatosSemaforoCompartido, agendaCompartida, nuevoTokenSemaforo } from './semaforo-compartido.service';

describe('semáforo compartido', () => {
  // Sábado 31 de octubre de 2026 (getDay() = 6)
  const dia = new Date(2026, 9, 31);
  const a = (h: number, m = 0) => new Date(2026, 9, 31, h, m).getTime();
  const med = (id: string, extra: Partial<DatosSemaforoCompartido['medicamentos'][number]> = {}) => ({
    id,
    nombre: id,
    dosis: '1',
    notas: '',
    horarios: [] as string[],
    segunNecesidad: false,
    inicio: null,
    duracionDias: null,
    creadoEn: null,
    ...extra,
  });
  const datos: DatosSemaforoCompartido = {
    nombre: 'Carmen',
    medicamentos: [
      med('Losartán', { horarios: ['08:00'] }),
      med('Metformina', { horarios: ['08:00', '20:00'] }),
      med('Paracetamol', { segunNecesidad: true }),
      med('Futuro', { horarios: ['09:00'], inicio: '2026-11-05' }),
    ],
    tomas: [
      { medicamentoId: 'Losartán', id: '20261031-0800', tomado: true, horaProgramada: a(8) },
      { medicamentoId: 'Paracetamol', id: '20261031-130000', tomado: true, horaProgramada: a(13) },
    ],
    tareas: [
      { id: 'Caminata', tipo: 'ejercicio', nombre: 'Caminata', notas: '', horarios: ['17:00'], dias: [6], duracionMin: 30, avisarMin: 15, creadoEn: null },
      { id: 'Baño', tipo: 'bano', nombre: 'Baño', notas: '', horarios: ['10:00'], dias: [1], duracionMin: 0, avisarMin: 15, creadoEn: null },
    ],
    registros: [{ tareaId: 'Caminata', id: '20261031-1700', hecha: false }],
  };

  it('arma la misma agenda del día que la app: horarios, tomas registradas, según necesidad y días', () => {
    const { dosis, tareas } = agendaCompartida(datos, dia);
    // Losartán 08:00 (tomada), Metformina 08:00 y 20:00, Paracetamol 13:00 (dado); "Futuro" aún no empieza
    expect(dosis.map((d) => `${d.medicamento.nombre} ${d.horario} ${d.toma ? 'R' : '-'}`)).toEqual([
      'Losartán 08:00 R',
      'Metformina 08:00 -',
      'Paracetamol 13:00 R',
      'Metformina 20:00 -',
    ]);
    // La caminata es de sábado y ya tiene registro (no hecha); el baño es de lunes
    expect(tareas.map((t) => `${t.tarea.nombre} ${t.registro ? 'R' : '-'}`)).toEqual(['Caminata R']);

    const filas = filasDelDia(dosis, tareas);
    expect(pendientesDelDia(filas).map((f) => `${f.titulo} ${f.horario}`)).toEqual([
      'Metformina 08:00',
      'Metformina 20:00',
    ]);
    // El paracetamol según necesidad no cuenta como programado
    expect(avanceDia(filas)).toEqual({ total: 4, registradas: 2 });
  });

  it('el token es aleatorio, de 32 caracteres en base64url (lo que aceptan reglas y función)', () => {
    const t1 = nuevoTokenSemaforo();
    const t2 = nuevoTokenSemaforo();
    expect(t1).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t2).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(t1).not.toEqual(t2);
  });
});
