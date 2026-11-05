import { computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, filter, map, shareReplay, switchMap, timer } from 'rxjs';
import { MiembrosService } from '../services/miembros.service';
import { PersonasService } from '../services/personas.service';
import { estadoRegistro } from './registro-turno';

/**
 * Contexto de la persona cuidada de la ruta actual (/personas/:id/...).
 * Llamar desde el inicializador de un campo del componente (contexto de inyección).
 */
export function personaActual() {
  const route = inject(ActivatedRoute);
  const personasSvc = inject(PersonasService);
  const miembrosSvc = inject(MiembrosService);

  const personaId$ = route.paramMap.pipe(
    map((p) => p.get('id')),
    filter((id): id is string => !!id),
    distinctUntilChanged(),
  );
  const membresia$ = personaId$.pipe(
    switchMap((id) => miembrosSvc.miMembresia(id)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  const rol = toSignal(personaId$.pipe(switchMap((id) => miembrosSvc.miRol(id))));
  const membresia = toSignal(membresia$);
  /** Reloj de la pantalla: el turno empieza o termina sin que el usuario toque nada */
  const ahora = toSignal(timer(0, 30_000).pipe(map(() => new Date())), { initialValue: new Date() });
  const registro = computed(() => estadoRegistro(rol(), membresia(), ahora()));

  return {
    personaId$,
    personaId: toSignal(personaId$),
    persona: toSignal(personaId$.pipe(switchMap((id) => personasSvc.persona(id)))),
    rol,
    /** Mi membresía en esta persona (turnos, preferencias, pausa y permiso de registrar) */
    membresia,
    /** En pausa: el responsable lo dejó solo con lectura (las rules no le dejan registrar) */
    enPausa: toSignal(membresia$.pipe(map((m) => m?.pausado === true)), { initialValue: false }),
    ahora,
    /** Si puede registrar ahora (rol, turno, permiso y pausa) y cuándo termina su turno */
    registro,
    /** Atajo: puede registrar tomas, tareas, bitácora y signos en este momento */
    puedeRegistrar: computed(() => registro().puede),
  };
}
