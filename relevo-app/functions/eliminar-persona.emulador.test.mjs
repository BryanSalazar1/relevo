// Prueba de la función `eliminarPersona` contra el emulador de Firestore. Se salta sola si no hay
// emulador (npm test la ignora); para correrla:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-relevo node --test eliminar-persona.emulador.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const emulador = process.env.FIRESTORE_EMULATOR_HOST;

test(
  'eliminarPersona: solo el responsable; borra subcolecciones e invitaciones y la quita de cada perfil',
  { skip: !emulador && 'requiere el emulador de Firestore (FIRESTORE_EMULATOR_HOST)' },
  async () => {
    process.env.GCLOUD_PROJECT ??= 'demo-relevo';
    const { eliminarPersona } = await import('./index.js');
    const { getFirestore } = await import('firebase-admin/firestore');
    const db = getFirestore();
    const id = `p-borrar-${Date.now()}`;
    const ref = db.doc(`personas_cuidadas/${id}`);
    await ref.set({ nombre: 'Prueba', miembrosUids: ['ana', 'luis'], creadoPor: 'ana' });
    await ref.collection('miembros').doc('ana').set({ uid: 'ana', rol: 'cuidador_principal', nombre: 'Ana' });
    await ref.collection('miembros').doc('luis').set({ uid: 'luis', rol: 'medico', nombre: 'Luis' });
    await ref.collection('entradas_bitacora').doc('e1').set({ tipo: 'nota', texto: 'x', autorUid: 'ana' });
    await ref.collection('medicamentos').doc('m1').collection('tomas').doc('t1').set({ tomado: true });
    await db.doc('usuarios/ana').set({ personas: [id, 'otra'] }, { merge: true });
    await db.doc('usuarios/luis').set({ personas: [id] }, { merge: true });
    await db.doc('invitaciones/CODIGO1').set({ personaId: id, codigo: 'CODIGO1' });
    const llamada = (auth) => eliminarPersona.run({ auth, data: { personaId: id }, rawRequest: {} });

    await assert.rejects(llamada({ uid: 'luis' }), /Solo el responsable/);
    await assert.rejects(llamada(undefined), /Inicia sesión/);
    await assert.rejects(
      eliminarPersona.run({ auth: { uid: 'ana' }, data: {}, rawRequest: {} }),
      /Falta la persona/,
    );
    assert.equal((await ref.get()).exists, true, 'los intentos rechazados no borran nada');

    assert.deepEqual(await llamada({ uid: 'ana' }), { eliminada: true });
    assert.equal((await ref.get()).exists, false);
    assert.equal((await ref.collection('miembros').doc('ana').get()).exists, false);
    assert.equal(
      (await ref.collection('medicamentos').doc('m1').collection('tomas').doc('t1').get()).exists,
      false,
      'las subcolecciones anidadas también se borran',
    );
    assert.deepEqual((await db.doc('usuarios/ana').get()).data().personas, ['otra']);
    assert.deepEqual((await db.doc('usuarios/luis').get()).data().personas, []);
    assert.equal((await db.doc('invitaciones/CODIGO1').get()).exists, false);
    await assert.rejects(llamada({ uid: 'ana' }), /ya no existe/);
  },
);
