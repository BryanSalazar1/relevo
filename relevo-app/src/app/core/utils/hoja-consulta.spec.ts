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
  cambiosPersonales,
  metaPresion,
  tendenciaPresion,
  textoCambio,
  textoTendencia,
  zonaClinica,
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
  describe('cambiosPersonales: lo habitual de la persona leído con la zona clínica', () => {
    const pa = (sis: number, dia: number, diast = 78) => signo('presion', sis, dia, { valorSecundario: diast, unidad: 'mmHg' });
    // Carmen: presión sana y estable alrededor de 121/78
    const carmen = [118, 122, 120, 124, 119, 121, 120, 123].map((sis, i) => pa(sis, 1 + i, 76 + (i % 4)));
    // Don José: siempre alta, alrededor de 160/100
    const jose = [158, 162, 160, 159, 161, 160].map((sis, i) => pa(sis, 1 + i, 100));
    // Doña Rosa: siempre baja, alrededor de 93/60
    const rosa = [92, 95, 93, 94, 92, 93].map((sis, i) => pa(sis, 1 + i, 60));

    it('Carmen (habitual sano) con 138: salió del rango y es raro para ella', () => {
      const [c, ...resto] = cambiosPersonales(carmen, [pa(138, 27, 90)]);
      expect(resto).toEqual([]);
      expect(c.clase).toBe('salio_del_rango');
      expect(c.valor).toBe('138/90 mmHg');
      expect(c.habitual).toBe('121/78 mmHg');
      expect(c.n).toBe(8);
      expect(textoCambio(c)).toContain('más alta de lo habitual y fuera del rango recomendado (lo habitual en esta persona: 121/78 mmHg, 8 lecturas)');
    });

    it('variaciones pequeñas o sin suficientes lecturas previas: nada', () => {
      expect(cambiosPersonales(carmen, [pa(130, 27)])).toEqual([]);
      expect(cambiosPersonales(carmen.slice(0, 4), [pa(170, 27)])).toEqual([]);
    });

    it('Don José (habitual alto) baja a 122: es una mejoría, nunca una alarma', () => {
      const [c] = cambiosPersonales(jose, [pa(122, 27, 80)]);
      expect(c.clase).toBe('mejoro');
      expect(textoCambio(c)).toContain('volvió al rango recomendado (lo habitual en esta persona: 160/100 mmHg');
      const banderas = banderasHoja({ resumen: resumenClinico([]), caidas: resumenCaidas([]), medicamentos: [], cambios: [c] });
      expect(banderas.map((b) => b.nivel)).toEqual(['buena']);
    });

    it('Doña Rosa (habitual bajo) sube a 118: también es mejoría', () => {
      const [c] = cambiosPersonales(rosa, [pa(118, 27, 76)]);
      expect(c.clase).toBe('mejoro');
      expect(c.direccion).toBe('alta');
    });

    it('Don José sube a 195: empeoró (y la lectura es de peligro)', () => {
      const [c] = cambiosPersonales(jose, [pa(195, 27, 115)]);
      expect(c.clase).toBe('empeoro');
      expect(c.zona).toBe('peligro_alto');
      expect(textoCambio(c)).toContain('empeoró, más alta que lo habitual');
      // La lectura de 180 o más sigue avisándose como urgente por su cuenta
      const r = resumenClinico([pa(195, 27, 115)]);
      expect(r.presion!.urgentes).toBe(1);
    });

    it('Don José con 162 (su habitual alto): nada personal; el promedio alto lo avisa la otra regla', () => {
      expect(cambiosPersonales(jose, [pa(162, 27, 100)])).toEqual([]);
      const banderas = banderasHoja({ resumen: resumenClinico([pa(162, 27, 100)]), caidas: resumenCaidas([]), medicamentos: [] });
      expect(banderas.map((b) => b.texto)).toEqual(['Presión promedio 162/100 mmHg (meta en casa menor de 135/85)']);
    });

    it('si cambió el tratamiento, lo habitual se calcula de nuevo desde esa fecha', () => {
      const cambio = el(10).toDate();
      // Con el medicamento nuevo el 10 de octubre, las lecturas de José (1 al 6) ya no cuentan
      expect(cambiosPersonales(jose, [pa(122, 27, 80)], { reinicio: cambio })).toEqual([]);
      // Un cambio anterior a todas sus lecturas no cambia nada
      expect(cambiosPersonales(jose, [pa(122, 27, 80)], { reinicio: el(1, 0).toDate() }).length).toBe(1);
    });

    it('una lectura mal tomada en lo habitual casi no lo mueve (mediana)', () => {
      const conError = [120, 121, 119, 122, 200, 120].map((sis, i) => pa(sis, 1 + i));
      const [c] = cambiosPersonales(conError, [pa(138, 27, 90)]);
      // Con promedio quedaría en 133.7; con mediana sigue en lo de siempre
      expect(c.habitual).toBe('121/78 mmHg');
      expect(c.clase).toBe('salio_del_rango');
    });

    it('desde los 80 años la meta es 145: 140 ya no se marca como fuera de rango', () => {
      const base = [124, 126, 125, 125, 124, 126].map((sis, i) => pa(sis, 1 + i));
      expect(cambiosPersonales(base, [pa(140, 27)], { edad: 82 })).toEqual([]);
      expect(cambiosPersonales(base, [pa(140, 27)], { edad: 70 })[0].clase).toBe('salio_del_rango');
      expect(metaPresion(82)).toEqual({ sistolica: 145, diastolica: 85 });
      expect(promedioPresion([pa(140, 27, 80)], 7, 82)!.alto).toBeFalse();
      expect(promedioPresion([pa(140, 27, 80)], 7, 70)!.alto).toBeTrue();
    });

    it('la glucosa solo se compara contra el mismo momento', () => {
      const ayunas = [95, 100, 98, 102, 97, 99].map((v, i) => signo('glucosa', v, 1 + i, { momento: 'ayunas', unidad: 'mg/dL' }));
      expect(cambiosPersonales(ayunas, [signo('glucosa', 160, 25, { momento: 'despues_comer', unidad: 'mg/dL' })])).toEqual([]);
      const [c] = cambiosPersonales(ayunas, [signo('glucosa', 160, 25, { momento: 'ayunas', unidad: 'mg/dL' })]);
      expect(c.valor).toBe('160 mg/dL en ayunas');
      expect(c.clase).toBe('salio_del_rango');
    });

    it('la oxigenación: se elige la lectura más alejada y subir no es problema', () => {
      const ox = [97, 96, 97, 98, 97, 96].map((v, i) => signo('oxigenacion', v, 1 + i, { unidad: '%' }));
      expect(cambiosPersonales(ox, [signo('oxigenacion', 99, 25, { unidad: '%' })])).toEqual([]);
      const [c] = cambiosPersonales(ox, [signo('oxigenacion', 93, 25, { unidad: '%' }), signo('oxigenacion', 90, 26, { unidad: '%' })]);
      expect(c.valor).toBe('90 %');
      expect(c.zona).toBe('peligro_bajo');
    });

    it('zonas clínicas de referencia', () => {
      expect(zonaClinica('presion', 88)).toBe('peligro_bajo');
      expect(zonaClinica('presion', 98)).toBe('baja');
      expect(zonaClinica('presion', 120)).toBe('sana');
      expect(zonaClinica('presion', 150)).toBe('alta');
      expect(zonaClinica('presion', 185)).toBe('peligro_alto');
      expect(zonaClinica('glucosa', 150, { momento: 'despues_comer' })).toBe('sana');
      expect(zonaClinica('glucosa', 150, { momento: 'ayunas' })).toBe('alta');
      expect(zonaClinica('pulso', 135)).toBe('peligro_alto');
    });
  });

  describe('tendenciaPresion: empeoramiento lento', () => {
    const pa = (sis: number, dia: number, diast = 90) => signo('presion', sis, dia, { valorSecundario: diast, unidad: 'mmHg' });
    const hasta = el(29, 0).toDate();
    // Semana de hace 3 semanas (1 al 7 oct) y última semana (22 al 28 oct)
    const antes = [140, 141, 139].map((s, i) => pa(s, 2 + i));

    it('sube 12 mmHg en 4 semanas y ya está alta: se avisa', () => {
      const t = tendenciaPresion([...antes, ...[152, 151, 153].map((s, i) => pa(s, 24 + i, 95))], hasta)!;
      expect(t.direccion).toBe('sube');
      expect(textoTendencia(t)).toBe('La presión promedio subió de 140/90 a 152/95 mmHg en las últimas 4 semanas');
    });

    it('sube pero sigue en rango sano, o cambia poco: no se avisa', () => {
      const sanas = [115, 116, 114].map((s, i) => pa(s, 2 + i, 75));
      expect(tendenciaPresion([...sanas, ...[127, 128, 126].map((s, i) => pa(s, 24 + i, 80))], hasta)).toBeNull();
      expect(tendenciaPresion([...antes, ...[145, 146, 144].map((s, i) => pa(s, 24 + i))], hasta)).toBeNull();
    });

    it('con un cambio de tratamiento en medio no se compara, ni con pocas lecturas', () => {
      const despues = [152, 151, 153].map((s, i) => pa(s, 24 + i, 95));
      expect(tendenciaPresion([...antes, ...despues], hasta, { reinicio: el(15).toDate() })).toBeNull();
      expect(tendenciaPresion([...antes.slice(0, 2), ...despues], hasta)).toBeNull();
    });
  });

  it('presión sistólica de 90 o menos: bandera urgente', () => {
    const r = resumenClinico([signo('presion', 88, 27, { valorSecundario: 55, unidad: 'mmHg' })]);
    expect(r.presion!.bajas).toBe(1);
    const banderas = banderasHoja({ resumen: r, caidas: resumenCaidas([]), medicamentos: [] });
    expect(banderas[0]).toEqual({ nivel: 'alta', texto: '1 lectura de presión sistólica de 90 o menos' });
  });

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
