import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Auth,
  User,
  authState,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from '@angular/fire/auth';
import { Firestore, doc, docData, serverTimestamp, setDoc, updateDoc } from '@angular/fire/firestore';
import { Observable, catchError, of, switchMap } from 'rxjs';
import { ROL_POR_TIPO, Rol, TipoUsuario, Usuario } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);

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

  /** Rol con el que esta cuenta entra a una bitácora por invitación. */
  get rolAlUnirse(): Rol | undefined {
    const tipo = this.tipoActual;
    return tipo ? ROL_POR_TIPO[tipo] : undefined;
  }

  /** Crea la cuenta en Auth y su perfil en `usuarios/{uid}` con el tipo elegido. */
  async registrar(nombre: string, email: string, password: string, tipo: TipoUsuario): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await updateProfile(cred.user, { displayName: nombre });
    await setDoc(doc(this.db, 'usuarios', cred.user.uid), {
      uid: cred.user.uid,
      nombre,
      email,
      tipo,
      fotoUrl: null,
      fcmTokens: [],
      personas: [],
      creadoEn: serverTimestamp(),
    });
    return cred.user;
  }

  /** Para cuentas creadas antes de que existiera el tipo: se define una sola vez. */
  async definirTipo(tipo: TipoUsuario): Promise<void> {
    const uid = this.uid;
    if (!uid) throw new Error('No hay sesión iniciada');
    await updateDoc(doc(this.db, 'usuarios', uid), { tipo });
  }

  async iniciarSesion(email: string, password: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    return cred.user;
  }

  cerrarSesion(): Promise<void> {
    return signOut(this.auth);
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
        return 'La contraseña debe tener al menos 6 caracteres.';
      case 'auth/network-request-failed':
        return 'Sin conexión. Revisa tu internet.';
      case 'auth/too-many-requests':
        return 'Demasiados intentos. Espera un momento.';
      case 'auth/operation-not-allowed':
        return 'Falta habilitar Correo/Contraseña en Firebase Console > Authentication.';
      default:
        return `Ocurrió un error (${code || 'desconocido'}).`;
    }
  }
}
