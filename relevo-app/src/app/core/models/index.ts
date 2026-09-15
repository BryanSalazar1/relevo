import { Timestamp } from '@angular/fire/firestore';

/**
 * Tipo de cuenta, elegido al registrarse. Define qué puede hacer el usuario en la app:
 * solo un familiar da de alta personas cuidadas; los demás se unen con un código.
 */
export type TipoUsuario = 'familiar' | 'enfermero' | 'medico';

export const TIPOS_USUARIO: { valor: TipoUsuario; etiqueta: string; icono: string; descripcion: string }[] = [
  {
    valor: 'familiar',
    etiqueta: 'Familiar',
    icono: 'people-outline',
    descripcion: 'Das de alta a tu familiar, administras su bitácora e invitas al equipo.',
  },
  {
    valor: 'enfermero',
    etiqueta: 'Enfermero/a',
    icono: 'medkit-outline',
    descripcion: 'Te unes con un código y registras la bitácora en tus turnos.',
  },
  {
    valor: 'medico',
    etiqueta: 'Médico',
    icono: 'medical-outline',
    descripcion: 'Te unes con un código y consultas el historial y los reportes.',
  },
];

export const TIPO_USUARIO_ETIQUETA: Record<TipoUsuario, string> = {
  familiar: 'Familiar',
  enfermero: 'Enfermero/a',
  medico: 'Médico',
};

/** Roles dentro de cada persona cuidada (sección 4 de la documentación). */
export type Rol = 'familiar' | 'cuidador_principal' | 'cuidador_turno' | 'medico';

/** Rol con el que entra cada tipo de cuenta al unirse por invitación (igual en firestore.rules). */
export const ROL_POR_TIPO: Record<TipoUsuario, Rol> = {
  familiar: 'familiar',
  enfermero: 'cuidador_turno',
  medico: 'medico',
};

/** Roles que puede tener cada tipo de cuenta (igual en firestore.rules). */
export const ROLES_COMPATIBLES: Record<TipoUsuario, Rol[]> = {
  familiar: ['familiar', 'cuidador_principal'],
  enfermero: ['cuidador_turno'],
  medico: ['medico'],
};

export const ROLES: { valor: Rol; etiqueta: string; descripcion: string }[] = [
  { valor: 'cuidador_principal', etiqueta: 'Responsable', descripcion: 'Familiar que administra la bitácora, los medicamentos y el equipo' },
  { valor: 'familiar', etiqueta: 'Familiar', descripcion: 'Escribe en la bitácora, registra tomas y coordina citas' },
  { valor: 'cuidador_turno', etiqueta: 'Enfermero/a', descripcion: 'Registra la bitácora, tomas y signos vitales en sus turnos' },
  { valor: 'medico', etiqueta: 'Médico', descripcion: 'Consulta el historial y los reportes (solo lectura)' },
];

export const ROL_ETIQUETA: Record<Rol, string> = {
  cuidador_principal: 'Responsable',
  familiar: 'Familiar',
  cuidador_turno: 'Enfermero/a',
  medico: 'Médico',
};

export const ROL_COLOR: Record<Rol, string> = {
  familiar: 'tertiary',
  cuidador_principal: 'primary',
  cuidador_turno: 'success',
  medico: 'medium',
};

/** Roles que pueden crear entradas en la bitácora (coincide con firestore.rules). */
export const PUEDE_ESCRIBIR_BITACORA: Rol[] = ['cuidador_principal', 'cuidador_turno', 'familiar'];
/** Roles que registran tomas de medicamentos (coincide con firestore.rules). */
export const PUEDE_REGISTRAR_TOMAS: Rol[] = ['cuidador_principal', 'cuidador_turno', 'familiar'];
/** Roles que dan de alta / editan medicamentos (coincide con firestore.rules). */
export const PUEDE_EDITAR_MEDICAMENTOS: Rol[] = ['cuidador_principal'];

/** usuarios/{uid} */
export interface Usuario {
  uid: string;
  nombre: string;
  email: string;
  /** Tipo de cuenta elegido al registrarse (cuentas antiguas pueden no tenerlo) */
  tipo?: TipoUsuario;
  fotoUrl?: string | null;
  fcmTokens: string[];
  /** IDs de personas_cuidadas a las que tiene acceso */
  personas: string[];
  creadoEn: Timestamp;
}

export interface ContactoEmergencia {
  nombre: string;
  telefono: string;
  relacion?: string;
}

/** personas_cuidadas/{id} */
export interface PersonaCuidada {
  id?: string;
  nombre: string;
  fechaNacimiento?: string; // ISO yyyy-mm-dd
  tipoSangre?: string;
  alergias?: string[];
  condiciones?: string[];
  medicoTratante?: string;
  contactosEmergencia?: ContactoEmergencia[];
  /**
   * Copia desnormalizada de los uids en la subcolección `miembros`.
   * Permite listar "mis personas" con un query array-contains y que las
   * Security Rules validen la lectura sin lecturas extra.
   */
  miembrosUids: string[];
  creadoPor: string;
  creadoEn: Timestamp;
}

/** personas_cuidadas/{id}/miembros/{uid} */
export interface Miembro {
  uid: string;
  rol: Rol;
  nombre: string;
  agregadoEn: Timestamp;
  /** Código con el que se unió (si entró por invitación). Lo validan las rules. */
  invitacionCodigo?: string;
}

/**
 * invitaciones/{codigo} — colección raíz para poder buscar por código.
 * La crea el responsable; quien la canjea se agrega a sí mismo como miembro con el rol
 * que corresponde a su tipo de cuenta (ROL_POR_TIPO, validado en firestore.rules).
 */
export interface Invitacion {
  codigo: string;
  personaId: string;
  personaNombre: string;
  creadoPor: string;
  creadoEn: Timestamp;
  expiraEn: Timestamp;
  activa: boolean;
  usos: number;
  usosMax: number;
}

export type TipoEntrada = 'sintoma' | 'animo' | 'comida' | 'sueno' | 'incidente' | 'nota';

export interface TipoEntradaInfo {
  valor: TipoEntrada;
  etiqueta: string;
  icono: string;
  color: string;
}

export const TIPOS_ENTRADA: TipoEntradaInfo[] = [
  { valor: 'sintoma', etiqueta: 'Síntoma', icono: 'medical-outline', color: 'danger' },
  { valor: 'animo', etiqueta: 'Ánimo', icono: 'happy-outline', color: 'warning' },
  { valor: 'comida', etiqueta: 'Comida', icono: 'restaurant-outline', color: 'success' },
  { valor: 'sueno', etiqueta: 'Sueño', icono: 'moon-outline', color: 'tertiary' },
  { valor: 'incidente', etiqueta: 'Incidente', icono: 'warning-outline', color: 'danger' },
  { valor: 'nota', etiqueta: 'Nota', icono: 'chatbox-ellipses-outline', color: 'medium' },
];

export const TIPO_ENTRADA_INFO: Record<TipoEntrada, TipoEntradaInfo> = Object.fromEntries(
  TIPOS_ENTRADA.map((t) => [t.valor, t]),
) as Record<TipoEntrada, TipoEntradaInfo>;

/** personas_cuidadas/{id}/entradas_bitacora/{id} */
export interface EntradaBitacora {
  id?: string;
  tipo: TipoEntrada;
  texto: string;
  fotos: string[]; // URLs de Storage
  notaVozUrl?: string | null;
  autorUid: string;
  autorNombre: string;
  fecha: Timestamp;
}

/** personas_cuidadas/{id}/medicamentos/{id} */
export interface Medicamento {
  id?: string;
  nombre: string;
  dosis: string;
  horarios: string[]; // "08:00", "20:00"
  /** Unidades restantes; null si no se controla */
  inventario: number | null;
  activo: boolean;
  notas?: string;
  creadoEn?: Timestamp;
}

/** personas_cuidadas/{id}/medicamentos/{id}/tomas/{id}  (id = yyyyMMdd-HHmm de la hora programada) */
export interface Toma {
  id?: string;
  horaProgramada: Timestamp;
  horaReal?: Timestamp | null;
  tomado: boolean;
  registradoPor: string;
  registradoNombre?: string;
}

export type TipoEvento = 'cita' | 'terapia' | 'turno';

/** personas_cuidadas/{id}/eventos_calendario/{id} */
export interface EventoCalendario {
  id?: string;
  tipo: TipoEvento;
  titulo: string;
  inicio: Timestamp;
  fin: Timestamp;
  responsableUid?: string | null;
  notas?: string;
}

export type TipoSigno = 'presion' | 'glucosa' | 'temperatura' | 'peso';

export const TIPO_SIGNO_ETIQUETA: Record<TipoSigno, string> = {
  presion: 'Presión arterial',
  glucosa: 'Glucosa',
  temperatura: 'Temperatura',
  peso: 'Peso',
};

/** personas_cuidadas/{id}/signos_vitales/{id} */
export interface SignoVital {
  id?: string;
  tipo: TipoSigno;
  valor: number;
  /** Para presión arterial: diastólica (valor = sistólica) */
  valorSecundario?: number | null;
  unidad: string;
  fecha: Timestamp;
  autorUid: string;
}
