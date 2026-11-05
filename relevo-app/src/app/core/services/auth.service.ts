import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  EmailAuthProvider,
  User,
  authState,
  createUserWithEmailAndPassword,
  deleteUser,
  reauthenticateWithCredential,
  reload,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from '@angular/fire/auth';
import {
  Firestore,
  clearIndexedDbPersistence,
  collection,
  doc,
  docData,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  terminate,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, catchError, of, switchMap } from 'rxjs';
import { CONTRASENA_MIN, TipoUsuario, Usuario } from '../models';
import { NotificacionesService } from './notificaciones.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  private readonly notificaciones = inject(NotificacionesService);
  private readonly fns = inject(Functions);

  /** Emite el usuario actual (o null) cada vez que cambia la sesión. */
  readonly user$ = authState(this.auth);

  /** Versión signal: `undefined` mientras Firebase resuelve la sesión inicial. */
  readonly user = toSignal<User | null | undefined>(this.user$, { initialValue: undefined });

  /** Perfil en `usuarios/{uid}` en tiempo real: null sin sesión, undefined cargando o sin perfil. */
  readonly perfil$: Observable<Usuario | null | undefined> = this.user$.pipe(
    switchMap((user) => {
      if (!user) return of(null);
      return (docData(doc(this.db, 'usuarios', user.uid)) as Observable<Usuario | undefined>).pipe(
        catchError(() => of(undefined)),
      );
    }),
  );
  readonly perfil = toSignal<Usuario | null | undefined>(this.perfil$, { initialValue: undefined });

  get uid(): string | null {
    return this.auth.currentUser?.uid ?? null;
  }

  /** Nombre para mostrar del usuario actual (o su correo). */
  get nombreActual(): string {
    const u = this.auth.currentUser;
    return u?.displayName || u?.email || '';
  }

  /** Tipo de cuenta (familiar / enfermero / medico), si el perfil ya cargó. */
  get tipoActual(): TipoUsuario | undefined {
    return this.perfil()?.tipo;
  }


  /** Crea la cuenta en Auth y su perfil en `usuarios/{uid}` con el tipo elegido. */
  async registrar(nombre: string, email: string, password: string, tipo: TipoUsuario): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    try {
      await updateProfile(cred.user, { displayName: nombre });
      await this.crearPerfil(cred.user, nombre, tipo);
    } catch (error) {
      // Sin perfil la cuenta no sirve (no tiene tipo): se deshace para que pueda registrarse de nuevo
      await deleteUser(cred.user).catch(() => undefined);
      throw error;
    }
    return cred.user;
  }

  /** Documento `usuarios/{uid}` de una cuenta (la de un registro nuevo, o una que se quedó sin perfil). */
  async crearPerfil(user: User, nombre: string, tipo: TipoUsuario): Promise<void> {
    await setDoc(doc(this.db, 'usuarios', user.uid), {
      uid: user.uid,
      nombre,
      email: user.email ?? '',
      tipo,
      fotoUrl: null,
      fcmTokens: [],
      personas: [],
      creadoEn: serverTimestamp(),
      // Al registrarse se acepta el aviso de privacidad (/privacidad); queda cuándo
      aceptoPrivacidadEn: serverTimestamp(),
    });
  }

  /**
   * ¿El correo de la sesión está verificado? Si Auth aún no lo sabe, lo pregunta al servidor (reload);
   * si ya está verificado pero el token no lo dice (cuentas marcadas por el servidor, o recién
   * verificadas), renueva el token: las rules leen email_verified del token.
   */
  async asegurarVerificado(user: User): Promise<boolean> {
    if (!user.emailVerified) {
      try {
        await reload(user);
      } catch {
        // sin conexión: se queda como estaba
      }
    }
    if (!user.emailVerified) return false;
    try {
      const token = await user.getIdTokenResult();
      if (token.claims['email_verified'] !== true) await user.getIdToken(true);
    } catch {
      // sin conexión: el token se renueva solo al volver la red
    }
    return true;
  }

  /**
   * Pide un código de 6 dígitos (Cloud Function enviarCodigoCorreo) al correo de la sesión o, si se
   * pasa `email`, a ese correo nuevo: al escribir el código, la cuenta se queda con él (cambiar correo).
   */
  async enviarCodigo(
    email?: string,
  ): Promise<{ verificado?: boolean; email?: string; vigenciaMin?: number; reenvioSeg?: number }> {
    const llamar = httpsCallable<
      { email?: string },
      { verificado?: boolean; email?: string; vigenciaMin?: number; reenvioSeg?: number }
    >(this.fns, 'enviarCodigoCorreo');
    return (await llamar(email ? { email } : {})).data;
  }

  /**
   * Revisa el código; si es correcto la cuenta queda verificada y se renueva el token. Si con el código
   * se cambió el correo, Firebase cierra las sesiones abiertas: devuelve el correo nuevo para entrar con él.
   */
  async verificarCodigo(codigo: string): Promise<{ correoNuevo?: string }> {
    const llamar = httpsCallable<{ codigo: string }, { verificado: boolean; email?: string }>(
      this.fns,
      'verificarCodigoCorreo',
    );
    const { data } = await llamar({ codigo });
    if (data.email) return { correoNuevo: data.email };
    const user = this.auth.currentUser;
    if (user) {
      await reload(user);
      await user.getIdToken(true);
    }
    return {};
  }

  /** Correo con enlace para crear una contraseña nueva (Firebase responde igual exista o no la cuenta). */
  async recuperarContrasena(email: string): Promise<void> {
    await sendPasswordResetEmail(this.auth, email);
  }

  /** Cambia la contraseña validando la actual (Firebase exige sesión reciente). */
  async cambiarContrasena(actual: string, nueva: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user?.email) throw new Error('No hay sesión iniciada');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, actual));
    await updatePassword(user, nueva);
  }

  /** ¿Existe el perfil de la sesión actual? (null si no hay sesión) */
  async perfilExiste(): Promise<boolean | null> {
    const uid = this.uid;
    if (!uid) return null;
    const snap = await getDoc(doc(this.db, 'usuarios', uid));
    return snap.exists();
  }

  /** Para cuentas creadas antes de que existiera el tipo: se define una sola vez. */
  async definirTipo(tipo: TipoUsuario): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    await updateDoc(doc(this.db, 'usuarios', uid), { tipo });
  }

  /** Cambia el nombre para mostrar en Auth, en el perfil y en cada equipo del que forma parte. */
  async actualizarNombre(nombre: string): Promise<void> {
    const user = this.auth.currentUser;
    const limpio = nombre.trim();
    if (!user) throw new Error('No hay sesión iniciada');
    if (!limpio) throw new Error('El nombre no puede estar vacío');
    await updateProfile(user, { displayName: limpio });
    await updateDoc(doc(this.db, 'usuarios', user.uid), { nombre: limpio });
    // Copia desnormalizada en cada equipo (las rules permiten a cada quien cambiar solo su nombre)
    const equipos = await getDocs(
      query(collection(this.db, 'personas_cuidadas'), where('miembrosUids', 'array-contains', user.uid)),
    );
    await Promise.all(
      equipos.docs.map((p) =>
        updateDoc(doc(this.db, `personas_cuidadas/${p.id}/miembros/${user.uid}`), { nombre: limpio }).catch(
          (e) => console.warn('No se pudo actualizar el nombre en un equipo', p.id, e),
        ),
      ),
    );
  }

  /**
   * Elimina la cuenta. Firebase exige sesión reciente, así que se vuelve a validar la contraseña.
   * La Cloud Function `limpiarUsuarioEliminado` borra el perfil y lo quita de cada equipo.
   */
  async eliminarCuenta(password: string): Promise<void> {
    const user = this.auth.currentUser;
    if (!user?.email) throw new Error('No hay sesión iniciada');
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    await this.notificaciones.quitarDispositivo();
    await deleteUser(user);
    await this.borrarCopiaLocal();
  }

  async iniciarSesion(email: string, password: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }

  /**
   * Da de baja este teléfono de las notificaciones (requiere sesión), cierra la sesión y borra la
   * copia local de Firestore (modo sin conexión), para que nada de la bitácora quede en el equipo.
   */
  async cerrarSesion(destino = '/login'): Promise<void> {
    await this.notificaciones.quitarDispositivo().catch(() => undefined);
    await signOut(this.auth);
    await this.borrarCopiaLocal(destino);
  }

  /**
   * Borra la caché persistente de Firestore (IndexedDB) de este dispositivo. Firestore queda
   * detenido, así que después se recarga la app en la pantalla de entrada. Si hay otra pestaña de
   * Relevo abierta el navegador no deja borrarla; la sesión igual queda cerrada y las reglas impiden
   * leer del servidor.
   */
  private async borrarCopiaLocal(destino = '/login'): Promise<void> {
    try {
      await terminate(this.db);
      await clearIndexedDbPersistence(this.db);
    } catch (error) {
      console.warn('No se pudo borrar la copia local de Firestore', error);
    }
    window.location.replace(destino);
  }

  /** Traduce los códigos de error de Firebase Auth a mensajes para el usuario. */
  mensajeError(error: unknown): string {
    const code = (error as { code?: string })?.code ?? '';
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Correo o contraseña incorrectos.';
      case 'auth/email-already-in-use':
        return 'Ya existe una cuenta con ese correo.';
      case 'auth/invalid-email':
        return 'El correo no es válido.';
      case 'auth/weak-password':
        return `La contraseña debe tener al menos ${CONTRASENA_MIN} caracteres.`;
      case 'auth/network-request-failed':
        return 'Sin conexión. Revisa tu internet.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos. Espera un momento.';
      case 'auth/requires-recent-login':
        return 'Por seguridad, cierra sesión, vuelve a entrar e inténtalo de nuevo.';
      case 'auth/operation-not-allowed':
        return 'Falta habilitar Correo/Contraseña en Firebase Console > Authentication.';
      default:
        return `Ocurrió un error (${code || 'desconocido'}).`;
    }
  }
}
