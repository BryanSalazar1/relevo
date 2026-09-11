import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  Timestamp,
  arrayUnion,
  collection,
  collectionData,
  doc,
  getDoc,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, catchError, map, of } from 'rxjs';
import { appUrl } from '../../../environments/firebase.config';
import { Invitacion, PersonaCuidada } from '../models';
import { AuthService } from './auth.service';

/** Sin 0/O/1/I para que el código se pueda dictar por teléfono sin confusiones. */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LARGO = 8;

/** Deja solo los caracteres válidos, en mayúsculas: "abcd-efgh" -> "ABCDEFGH". */
export function normalizarCodigo(texto: string): string {
  return (texto ?? '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[^A-Z2-9]/g, '')
    .replace(/0/g, 'O')
    .slice(0, LARGO);
}

/** "ABCDEFGH" -> "ABCD-EFGH" */
export function formatearCodigo(codigo: string): string {
  const c = normalizarCodigo(codigo);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Extrae el código de un enlace de invitación o de un texto escaneado. */
export function extraerCodigo(texto: string): string | null {
  const porEnlace = texto.match(/unirse\/([A-Za-z0-9-]{4,})/);
  const candidato = normalizarCodigo(porEnlace ? porEnlace[1] : texto);
  return candidato.length === LARGO ? candidato : null;
}

export type EstadoInvitacion = 'valida' | 'inexistente' | 'inactiva' | 'vencida' | 'agotada';

@Injectable({ providedIn: 'root' })
export class InvitacionesService {
  private readonly db = inject(Firestore);
  private readonly authSvc = inject(AuthService);

  enlace(codigo: string): string {
    return `${appUrl}/unirse/${normalizarCodigo(codigo)}`;
  }

  private generarCodigo(): string {
    const bytes = new Uint8Array(LARGO);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('');
  }

  /**
   * Crea una invitación (solo el responsable, según las rules). No lleva rol: cada persona
   * entra con el rol que corresponde a su tipo de cuenta.
   */
  async crear(persona: PersonaCuidada, diasValidez = 7, usosMax = 10): Promise<Invitacion> {
    const uid = this.authSvc.uid;
    if (!uid || !persona.id) throw new Error('Datos incompletos');
    const codigo = this.generarCodigo();
    const expira = new Date();
    expira.setDate(expira.getDate() + diasValidez);
    const datos = {
      codigo,
      personaId: persona.id,
      personaNombre: persona.nombre,
      creadoPor: uid,
      creadoEn: serverTimestamp(),
      expiraEn: Timestamp.fromDate(expira),
      activa: true,
      usos: 0,
      usosMax,
    };
    await setDoc(doc(this.db, 'invitaciones', codigo), datos);
    return { ...datos, creadoEn: Timestamp.now() };
  }

  /** Invitaciones activas de una persona (solo visibles para el responsable). */
  activas(personaId: string): Observable<Invitacion[]> {
    const q = query(
      collection(this.db, 'invitaciones'),
      where('personaId', '==', personaId),
      where('activa', '==', true),
    );
    return (collectionData(q) as Observable<Invitacion[]>).pipe(
      map((lista) =>
        lista
          .filter((i) => i.expiraEn.toMillis() > Date.now() && i.usos < i.usosMax)
          .sort((a, b) => b.creadoEn?.toMillis() - a.creadoEn?.toMillis()),
      ),
      catchError(() => of([] as Invitacion[])),
    );
  }

  async desactivar(codigo: string): Promise<void> {
    await updateDoc(doc(this.db, 'invitaciones', codigo), { activa: false });
  }

  /** Busca una invitación por código y dice si se puede usar. */
  async buscar(
    codigoCrudo: string,
  ): Promise<{ estado: EstadoInvitacion; invitacion: Invitacion | null }> {
    const codigo = normalizarCodigo(codigoCrudo);
    if (codigo.length !== LARGO) return { estado: 'inexistente', invitacion: null };
    const snap = await getDoc(doc(this.db, 'invitaciones', codigo));
    if (!snap.exists()) return { estado: 'inexistente', invitacion: null };
    const inv = snap.data() as Invitacion;
    if (!inv.activa) return { estado: 'inactiva', invitacion: inv };
    if (inv.expiraEn.toMillis() <= Date.now()) return { estado: 'vencida', invitacion: inv };
    if (inv.usos >= inv.usosMax) return { estado: 'agotada', invitacion: inv };
    return { estado: 'valida', invitacion: inv };
  }

  /**
   * Canjea la invitación: en un solo batch incrementa usos, crea mi documento de miembro
   * con el rol que corresponde a mi tipo de cuenta y me agrega a miembrosUids.
   * Las rules verifican todo (incluido que el rol coincida con mi tipo).
   */
  async canjear(inv: Invitacion): Promise<string> {
    const uid = this.authSvc.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    const rol = this.authSvc.rolAlUnirse;
    if (!rol) throw new Error('Tu cuenta no tiene tipo definido');

    const personaRef = doc(this.db, 'personas_cuidadas', inv.personaId);
    const batch = writeBatch(this.db);
    batch.update(doc(this.db, 'invitaciones', inv.codigo), { usos: increment(1) });
    batch.set(doc(personaRef, 'miembros', uid), {
      uid,
      rol,
      nombre: this.authSvc.nombreActual,
      agregadoEn: serverTimestamp(),
      invitacionCodigo: inv.codigo,
    });
    batch.update(personaRef, { miembrosUids: arrayUnion(uid) });
    batch.update(doc(this.db, 'usuarios', uid), { personas: arrayUnion(inv.personaId) });
    await batch.commit();
    return inv.personaId;
  }
}
