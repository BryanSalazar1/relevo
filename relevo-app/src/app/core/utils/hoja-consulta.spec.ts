import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { Timestamp } from '@angular/fire/firestore';
import { EntradaBitacora, SignoVital, Toma } from '../models';
import {
  banderasHoja,
  cambioPeso,
  filasSignos,
  patronOmisiones,
  promedioPresion,
  resumenCaidas,
  resumenClinico,
  resumenGlucosa,
} from './hoja-consulta';

registerLocaleData(localeEs, 'es');

/** Fecha del día `dia` de octubre de 2026 a la hora dada */
const el = (dia: number, hora = 8) => Timestamp.fromDate(new Date(2026, 9, dia, hora, 0));

const signo = (tipo: SignoVital['tipo'], valor: number, dia: number, extra: Partial<SignoVital> = {}): SignoVital => ({
  tipo,
  valor,
  unidad: '',
  fecha: el(dia, extra.fecha ? 8 : 8),
  autorUid: 'u',
  ...extra,
});
const presion = (sis: number, dia: number, dia2 = 80) => signo('presion', sis, dia, { valorSecundario: dia2 });

describe('hoja para la consulta', () => {
  describe('promedioPresion', () => {
    it('promedia solo la última semana con lecturas y cuenta las urgentes de todo el periodo', () => {
      const lecturas = [
        presion(190, 1, 115), // hace tres semanas: no entra al promedio, sí cuenta como urgente
        presion(130, 15, 82),
        presion(140, 18, 88),
        presion(150, 21, 90),
      ];
      const r = promedioPresion(lecturas)!;
      expect(r.n).toBe(3);
      expect(r.sistolica).toBe(140);
      expect(r.diastolica).toBe(87);
      expect(r.urgentes).toBe(1);
      expect(r.alto).toBeTrue();
      expect(promedioPresion([])).toBeNull();
    });

    it('un promedio de 128/80 no se marca como alto', () => {
      expect(promedioPresion([presion(126, 20, 78), presion(130, 21, 82)])!.alto).toBeFalse();
    });
  });

  describe('resumenGlucosa', () => {
    it('cuenta hipoglucemias e hiperglucemias y agrupa por momento', () => {
      const r = resumenGlucosa([
        signo('glucosa', 65, 1, { momento: 'ayunas' }),
        signo('glucosa', 120, 2, { momento: 'ayunas' }),
        signo('glucosa', 210, 3, { momento: 'despues_comer' }),
        signo('glucosa', 260, 4),
      ])!;
      expect(r.n).toBe(4);
      expect(r.bajas).toBe(1);
      expect(r.altas).toBe(2);
      expect(r.muyAltas).toBe(1);
      expect(r.sinMomento).toBe(1);
      expect(r.porMomento.map((m) => [m.momento, m.n, m.promedio])).toEqual([
        ['ayunas', 2, 93],
        ['despues_comer', 1, 210],
      ]);
    });
  });

  describe('cambioPeso', () => {
    it('toma el primero y el último peso del periodo y calcula el porcentaje', () => {
      const r = cambioPeso([signo('peso', 70, 1), signo('peso', 68.5, 10), signo('peso', 66.4, 20)])!;
      expect(r.n).toBe(3);
      expect(r.kg).toBe(-3.6);
      expect(r.porcentaje).toBe(-5.1);
      expect(cambioPeso([signo('peso', 70, 1)])).toBeNull();
    });
  });

  describe('resumenCaidas', () => {
    it('cuenta las caídas marcadas y detecta por el texto las de registros antiguos', () => {
      const entrada = (tipo: EntradaBitacora['tipo'], texto: string, extra: Partial<EntradaBitacora> = {}): EntradaBitacora => ({
        tipo,
        texto,
        autorUid: 'u',
        autorNombre: 'Marta',
        fecha: el(5),
        ...extra,
      });
      const r = resumenCaidas([
        entrada('incidente', 'Se cayó en el baño', { caida: true, lesion: true }),
        entrada('incidente', 'Resbaló en la cocina, sin golpe', { caida: true, lesion: false }),
        entrada('incidente', 'Casi se cae al levantarse'), // sin la pregunta contestada: posible
        entrada('incidente', 'Se le olvidó la pastilla', { caida: false }),
        entrada('sintoma', 'Mareo al caminar; dice que casi se cae'), // no es incidente
      ]);
      expect(r).toEqual({ total: 2, conLesion: 1, posibles: 1 });
    });
  });

  describe('patronOmisiones', () => {
    const toma = (hora: number, tomado: boolean, dia: number): Toma => ({
      horaProgramada: el(dia, hora),
      tomado,
      registradoPor: 'u',
    });

    it('detecta cuando casi siempre se omite la misma dosis', () => {
      const r = patronOmisiones([
        toma(8, true, 1),
        toma(20, false, 1),
        toma(8, true, 2),
        toma(20, false, 2),
        toma(8, false, 3),
        toma(20, false, 3),
      ]);
      expect(r.omitidas).toBe(4);
      expect(r.patron).toBe('3 de 4 a las 20:00');
    });

    it('sin patrón claro o con una sola omisión no inventa nada', () => {
      expect(patronOmisiones([toma(8, false, 1), toma(20, false, 1)]).patron).toBeNull();
      expect(patronOmisiones([toma(8, false, 1)])).toEqual({ omitidas: 1, patron: null });
      expect(patronOmisiones([])).toEqual({ omitidas: 0, patron: null });
    });
  });

  describe('filasSignos y banderasHoja', () => {
    const signos = [
      presion(150, 20, 95),
      presion(146, 21, 92),
      signo('glucosa', 62, 20, { momento: 'ayunas' }),
      signo('peso', 70, 1),
      signo('peso', 66, 21),
      signo('temperatura', 38.4, 21),
      signo('oxigenacion', 95, 21),
      signo('pulso', 72, 21),
    ];

    it('una fila por medición, con lo que salió de rango', () => {
      const filas = filasSignos(resumenClinico(signos));
      expect(filas.map((f) => f.etiqueta)).toEqual(['Presión arterial', 'Glucosa', 'Peso', 'Temperatura', 'Oxigenación', 'Pulso']);
      expect(filas[0].resumen).toContain('148/94 mmHg (2 lecturas');
      expect(filas[0].fuera).toBe('promedio por arriba de 135/85');
      expect(filas[1].resumen).toBe('Promedio 62 mg/dL (1 lectura): en ayunas 62 (1)');
      expect(filas[1].fuera).toBe('1 por debajo de 70');
      expect(filas[2].fuera).toBe('pérdida de 5.7 % en el periodo');
      expect(filas[3].fuera).toBe('1 de 38 °C o más');
      expect(filas[4].fuera).toBe('');
      expect(filas[4].alerta).toBeFalse();
    });

    it('las banderas altas van primero y los medicamentos con adherencia baja o patrón se mencionan', () => {
      const banderas = banderasHoja({
        resumen: resumenClinico(signos),
        caidas: { total: 1, conLesion: 0, posibles: 1 },
        medicamentos: [
          { nombre: 'Metformina', adherencia: 70, omisiones: { omitidas: 6, patron: '5 de 6 a las 20:00' } },
          { nombre: 'Losartán', adherencia: 95, omisiones: { omitidas: 2, patron: '2 de 2 a las 08:00' } },
          { nombre: 'Omeprazol', adherencia: 100, omisiones: { omitidas: 0, patron: null } },
        ],
      });
      expect(banderas.map((b) => b.nivel)).toEqual(['alta', 'alta', 'alta', 'alta', 'media', 'media', 'media', 'media']);
      expect(banderas.map((b) => b.texto)).toEqual([
        '1 caída en el periodo',
        'Pérdida de peso de 5.7 % (70 → 66 kg)',
        '1 glucosa por debajo de 70 mg/dL',
        '1 registro de fiebre (38 °C o más)',
        '1 incidente que parece una caída (revisar)',
        'Presión promedio 148/94 mmHg (meta en casa menor de 135/85)',
        'Metformina: adherencia 70 % (6 dosis omitidas, 5 de 6 a las 20:00)',
        'Losartán: se omite casi siempre la misma dosis (2 de 2 a las 08:00)',
      ]);
    });

    it('sin datos no hay banderas ni filas', () => {
      const rc = resumenClinico([]);
      expect(filasSignos(rc)).toEqual([]);
      expect(banderasHoja({ resumen: rc, caidas: { total: 0, conLesion: 0, posibles: 0 }, medicamentos: [] })).toEqual([]);
    });
  });
});
