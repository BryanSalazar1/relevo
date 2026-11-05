/**
 * Perfiles guardados en este dispositivo, para el teléfono o la tableta que comparte la familia: en la
 * entrada se elige el perfil y solo se escribe la contraseña. Se guardan el nombre y el correo, NUNCA
 * la contraseña, en localStorage (solo en este dispositivo). Funciones puras sobre la lista + lectura
 * y escritura tolerantes a un almacenamiento bloqueado. Probadas en perfiles-guardados.spec.ts.
 */

export interface PerfilGuardado {
  email: string;
  nombre: string;
  /** Última vez que entró con este perfil (ms), para mostrar primero el más reciente */
  usadoEn: number;
}

export const CLAVE_PERFILES = 'relevo:perfiles';
/** Cuántos perfiles se recuerdan como máximo (los menos usados salen primero) */
export const MAX_PERFILES = 8;

const normalizar = (email: string) => email.trim().toLowerCase();

/** La lista con este perfil al principio (sin repetir el correo) y como mucho MAX_PERFILES. */
export function recordarPerfil(lista: PerfilGuardado[], perfil: PerfilGuardado): PerfilGuardado[] {
  const email = normalizar(perfil.email);
  if (!email) return lista;
  const anterior = lista.find((p) => normalizar(p.email) === email);
  const nombre = perfil.nombre.trim() || anterior?.nombre || email;
  return [{ email, nombre, usadoEn: perfil.usadoEn }, ...lista.filter((p) => normalizar(p.email) !== email)]
    .sort((a, b) => b.usadoEn - a.usadoEn)
    .slice(0, MAX_PERFILES);
}

export function olvidarPerfil(lista: PerfilGuardado[], email: string): PerfilGuardado[] {
  return lista.filter((p) => normalizar(p.email) !== normalizar(email));
}

/** Lo guardado, validado (si alguien lo editó a mano o está dañado, se ignora lo que no sirve). */
export function leerPerfiles(texto: string | null): PerfilGuardado[] {
  try {
    const datos = JSON.parse(texto ?? '[]');
    if (!Array.isArray(datos)) return [];
    return datos
      .filter(
        (p): p is PerfilGuardado =>
          !!p && typeof p.email === 'string' && p.email.includes('@') && typeof p.nombre === 'string',
      )
      .map((p) => ({ email: normalizar(p.email), nombre: p.nombre, usadoEn: Number(p.usadoEn) || 0 }))
      .sort((a, b) => b.usadoEn - a.usadoEn)
      .slice(0, MAX_PERFILES);
  } catch {
    return [];
  }
}

/** "RM" para Rosa Martínez; sin nombre, la inicial del correo. */
export function inicialesPerfil(p: Pick<PerfilGuardado, 'nombre' | 'email'>): string {
  const palabras = p.nombre
    .replace(/^(dra?|lic|enf)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const iniciales = palabras.slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join('');
  return iniciales || p.email.charAt(0).toUpperCase();
}

export function cargarPerfiles(): PerfilGuardado[] {
  try {
    return leerPerfiles(localStorage.getItem(CLAVE_PERFILES));
  } catch {
    return [];
  }
}

export function guardarPerfiles(lista: PerfilGuardado[]): void {
  try {
    localStorage.setItem(CLAVE_PERFILES, JSON.stringify(lista));
  } catch {
    // sin almacenamiento (modo privado): no se recuerda
  }
}
