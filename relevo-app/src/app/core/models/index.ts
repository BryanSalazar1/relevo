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

/** Opciones del selector de tipo de sangre. */
export const TIPOS_SANGRE = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

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
  /** Texto libre del responsable: quién es, qué padece, qué le gusta… Lo ve todo el equipo. */
  descripcion?: string;
  // ---- Ficha médica (la edita el responsable; la ve todo el equipo) ----
  tipoSangre?: string;
  alergias?: string[];
  condiciones?: string[];
  medicoTratante?: string;
  telefonoMedico?: string;
  /** Aseguradora, número de póliza o "IMSS / ISSSTE / particular" */
  seguro?: string;
  /** Hospital o clínica a la que se le lleva */
  hospital?: string;
  /** Lo que el médico o el equipo deben saber: marcapasos, prótesis, dieta, movilidad… */
  notasMedicas?: string;
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

/**
 * Franja de guardia de un miembro: días de la semana (Date.getDay(): 0 = domingo) y horas "HH:mm".
 * Si `hasta` es menor o igual que `desde`, el turno cruza la medianoche (p. ej. 22:00–06:00).
 */
export interface Turno {
  dias: number[];
  desde: string;
  hasta: string;
}

/** personas_cuidadas/{id}/miembros/{uid} */
export interface Miembro {
  uid: string;
  rol: Rol;
  nombre: string;
  agregadoEn: Timestamp;
  /**
   * Guardias del miembro. Los recordatorios de tomas y tareas solo le llegan en sus turnos.
   * Sin turnos (o vacío): si nadie del equipo tiene turnos, recibe todo; si otros sí tienen,
   * no recibe recordatorios de rutina (salvo el responsable, que es el respaldo cuando nadie está de guardia).
   */
  turnos?: Turno[];
  /** Recibe incidentes, síntomas y tomas omitidas aunque no esté de guardia (por defecto sí) */
  alertas?: boolean;
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

/**
 * Todos los tipos que han existido, para mostrar registros antiguos. "comida" ya no se captura desde
 * el 15/09/2026: las comidas son tareas de la rutina.
 */
export const TIPOS_ENTRADA_TODOS: TipoEntradaInfo[] = [
  { valor: 'sintoma', etiqueta: 'Síntoma', icono: 'medical-outline', color: 'danger' },
  { valor: 'animo', etiqueta: 'Ánimo', icono: 'happy-outline', color: 'warning' },
  { valor: 'comida', etiqueta: 'Comida', icono: 'restaurant-outline', color: 'success' },
  { valor: 'sueno', etiqueta: 'Sueño', icono: 'moon-outline', color: 'tertiary' },
  { valor: 'incidente', etiqueta: 'Incidente', icono: 'warning-outline', color: 'danger' },
  { valor: 'nota', etiqueta: 'Nota', icono: 'chatbox-ellipses-outline', color: 'medium' },
];

/** Tipos que se pueden elegir al escribir en la bitácora (y por los que se filtra). */
export const TIPOS_ENTRADA: TipoEntradaInfo[] = TIPOS_ENTRADA_TODOS.filter((t) => t.valor !== 'comida');

export const TIPO_ENTRADA_INFO: Record<TipoEntrada, TipoEntradaInfo> = Object.fromEntries(
  TIPOS_ENTRADA_TODOS.map((t) => [t.valor, t]),
) as Record<TipoEntrada, TipoEntradaInfo>;

/** Cómo se muestra una toma de medicamento dentro de la bitácora (no es un tipo de entrada que se guarde). */
export const INFO_TOMA: Omit<TipoEntradaInfo, 'valor'> = {
  etiqueta: 'Medicamento',
  icono: 'medkit-outline',
  color: 'primary',
};

/** personas_cuidadas/{id}/entradas_bitacora/{id} */
export interface EntradaBitacora {
  id?: string;
  tipo: TipoEntrada;
  texto: string;
  fotos: string[]; // URLs de Storage
  notaVozUrl?: string | null;
  autorUid: string;
  autorNombre: string;
  /** Cuándo ocurrió (lo elige quien escribe, hasta 1 h atrás) */
  fecha: Timestamp;
  /** Cuándo se registró; ordena la bitácora. Entradas antiguas no lo tienen (se usa `fecha`) */
  creadoEn?: Timestamp;
}

/** personas_cuidadas/{id}/medicamentos/{id} */
export interface Medicamento {
  id?: string;
  nombre: string;
  dosis: string;
  horarios: string[]; // "08:00", "20:00" (vacío si es según necesidad)
  /** Sin horario fijo: se toma solo cuando hace falta (p. ej. "si siente dolor") y se registra al momento */
  segunNecesidad?: boolean;
  /** Desde qué día se toma (ISO yyyy-mm-dd). Sin valor = desde siempre (medicamentos antiguos) */
  inicio?: string;
  /** Cuántos días dura el tratamiento; null/sin valor = hasta que el médico lo indique */
  duracionDias?: number | null;
  /** Unidades restantes (entero, nunca menor que 0); null si no se controla */
  inventario: number | null;
  /** Unidades del último resurtido; es la cantidad que propone el botón Resurtir */
  ultimoResurtido?: number;
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
  /** Toma de un medicamento según necesidad: no había horario, se registró en el momento */
  aDemanda?: boolean;
  /** La toma no restó del inventario (estaba en 0 o no se controlaba): al deshacerla no se devuelve nada */
  sinDescuento?: boolean;
  /** Nota de quien registró: motivo ("dolor de cabeza"), observación, etc. */
  nota?: string;
  /** Cuándo se registró; ordena la bitácora. Tomas antiguas no lo tienen (se usa horaReal u horaProgramada) */
  registradoEn?: Timestamp;
}

// ---------------------------------------------------------------------------
// Rutina: tareas diarias con horario (comidas, baño, ejercicio…) que define el responsable
// ---------------------------------------------------------------------------
export type TipoTarea = 'comida' | 'bano' | 'ejercicio' | 'terapia' | 'signos' | 'cita' | 'otro';

export interface TipoTareaInfo {
  valor: TipoTarea;
  etiqueta: string;
  icono: string;
  color: string;
}

export const TIPOS_TAREA: TipoTareaInfo[] = [
  { valor: 'comida', etiqueta: 'Comida', icono: 'restaurant-outline', color: 'success' },
  { valor: 'bano', etiqueta: 'Baño', icono: 'water-outline', color: 'tertiary' },
  { valor: 'ejercicio', etiqueta: 'Ejercicio', icono: 'walk-outline', color: 'warning' },
  { valor: 'terapia', etiqueta: 'Terapia', icono: 'fitness-outline', color: 'secondary' },
  // Al marcarla como hecha se capturan las mediciones (pages/rutina/signos.modal.ts)
  { valor: 'signos', etiqueta: 'Signos vitales', icono: 'pulse-outline', color: 'danger' },
  { valor: 'cita', etiqueta: 'Cita', icono: 'calendar-outline', color: 'primary' },
  { valor: 'otro', etiqueta: 'Otra', icono: 'checkmark-circle-outline', color: 'medium' },
];

export const TIPO_TAREA_INFO: Record<TipoTarea, TipoTareaInfo> = Object.fromEntries(
  TIPOS_TAREA.map((t) => [t.valor, t]),
) as Record<TipoTarea, TipoTareaInfo>;

/** Días de la semana en orden de calendario (valor = Date.getDay()). */
export const DIAS_SEMANA: { valor: number; corto: string; nombre: string }[] = [
  { valor: 1, corto: 'L', nombre: 'lunes' },
  { valor: 2, corto: 'M', nombre: 'martes' },
  { valor: 3, corto: 'X', nombre: 'miércoles' },
  { valor: 4, corto: 'J', nombre: 'jueves' },
  { valor: 5, corto: 'V', nombre: 'viernes' },
  { valor: 6, corto: 'S', nombre: 'sábado' },
  { valor: 0, corto: 'D', nombre: 'domingo' },
];

/** Cómo se muestra un registro de tarea dentro de la bitácora (el color e icono vienen del tipo de tarea). */
export const INFO_TAREA_BITACORA: Omit<TipoEntradaInfo, 'valor'> = {
  etiqueta: 'Tarea',
  icono: 'alarm-outline',
  color: 'secondary',
};

/** Duraciones que ofrece el formulario de tarea, en minutos (0 = solo hora de inicio). */
export const OPCIONES_DURACION_MIN = [0, 15, 30, 45, 60, 90, 120, 180, 240];

/** Minutos de anticipación con que se avisa una tarea (el responsable elige uno por tarea). */
export const OPCIONES_AVISO_MIN = [5, 10, 15, 30, 60];
export const AVISO_MIN_POR_DEFECTO = 15;

/** Roles que definen tareas de la rutina (coincide con firestore.rules). */
export const PUEDE_EDITAR_TAREAS: Rol[] = ['cuidador_principal'];
/** Roles que marcan una tarea como hecha (coincide con firestore.rules). */
export const PUEDE_REGISTRAR_TAREAS: Rol[] = ['cuidador_principal', 'cuidador_turno', 'familiar'];

/** personas_cuidadas/{id}/tareas/{id} */
export interface Tarea {
  id?: string;
  tipo: TipoTarea;
  nombre: string;
  horarios: string[]; // "08:00", "14:00"
  /** Minutos antes de la hora en que se avisa al cuidador (tareas antiguas pueden no tenerlo) */
  avisarMin?: number;
  /** Cuánto dura cada horario, en minutos ("ejercicio de 10 a 11" = 60); 0 o sin valor = solo hora de inicio */
  duracionMin?: number;
  /** Días de la semana en que aplica (0 = domingo … 6 = sábado). Vacío o sin valor = todos los días */
  dias?: number[];
  /** Solo tipo 'signos': qué se mide en esta tarea (p. ej. glucosa en ayunas). Vacío o sin valor = todos */
  signos?: TipoSigno[];
  notas?: string;
  activo: boolean;
  creadoEn?: Timestamp;
}

/** personas_cuidadas/{id}/tareas/{id}/registros/{id}  (id = yyyyMMdd-HHmm de la hora programada) */
export interface RegistroTarea {
  id?: string;
  horaProgramada: Timestamp;
  horaReal?: Timestamp | null;
  hecha: boolean;
  registradoPor: string;
  registradoNombre?: string;
  /** Cuándo se registró */
  registradoEn?: Timestamp;
  /** Nota de quien registró: por qué no se hizo, cómo estuvo ("comió poco"), etc. */
  nota?: string;
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

export type TipoSigno = 'presion' | 'glucosa' | 'temperatura' | 'oxigenacion' | 'pulso' | 'peso';

export const TIPO_SIGNO_ETIQUETA: Record<TipoSigno, string> = {
  presion: 'Presión arterial',
  glucosa: 'Glucosa',
  temperatura: 'Temperatura',
  oxigenacion: 'Oxigenación',
  pulso: 'Pulso',
  peso: 'Peso',
};

export interface TipoSignoInfo {
  valor: TipoSigno;
  etiqueta: string;
  /** Para resumir en una nota: "Presión 130/85 mmHg" */
  corto: string;
  unidad: string;
  /** Límites de lo que se acepta al capturar: fuera de ellos es un error de dedo, no una medición */
  min: number;
  max: number;
  decimales: number;
  ejemplo: string;
}

/** Signos que se pueden medir, en el orden en que se capturan. firestore.rules valida los mismos tipos. */
export const TIPOS_SIGNO: TipoSignoInfo[] = [
  { valor: 'presion', etiqueta: 'Presión arterial', corto: 'Presión', unidad: 'mmHg', min: 50, max: 260, decimales: 0, ejemplo: '120' },
  { valor: 'glucosa', etiqueta: 'Glucosa', corto: 'Glucosa', unidad: 'mg/dL', min: 20, max: 600, decimales: 0, ejemplo: '110' },
  { valor: 'temperatura', etiqueta: 'Temperatura', corto: 'Temp.', unidad: '°C', min: 30, max: 43, decimales: 1, ejemplo: '36.5' },
  { valor: 'oxigenacion', etiqueta: 'Oxigenación', corto: 'Oxigenación', unidad: '%', min: 50, max: 100, decimales: 0, ejemplo: '96' },
  { valor: 'pulso', etiqueta: 'Pulso', corto: 'Pulso', unidad: 'lpm', min: 25, max: 220, decimales: 0, ejemplo: '72' },
  { valor: 'peso', etiqueta: 'Peso', corto: 'Peso', unidad: 'kg', min: 20, max: 300, decimales: 1, ejemplo: '68.5' },
];

/** Presión diastólica (el segundo número): sus propios límites. */
export const LIMITES_DIASTOLICA = { min: 30, max: 160 };

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
  /** Si se midió al marcar una tarea de la rutina: de cuál (su id es `{tareaId}-{idRegistro}-{tipo}`) */
  tareaId?: string;
}
