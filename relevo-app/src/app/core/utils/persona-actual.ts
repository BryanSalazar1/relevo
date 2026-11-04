import { inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, filter, map, shareReplay, switchMap } from 'rxjs';
import { MiembrosService } from '../services/miembros.service';
import { PersonasService } from '../services/personas.service';

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

  return {
    personaId$,
    personaId: toSignal(personaId$),
    persona: toSignal(personaId$.pipe(switchMap((id) => personasSvc.persona(id)))),
    rol: toSignal(personaId$.pipe(switchMap((id) => miembrosSvc.miRol(id)))),
    /** Mi membresía en esta persona (turnos, preferencias y pausa) */
    membresia: toSignal(membresia$),
    /** En pausa: el responsable lo dejó solo con lectura (las rules no le dejan registrar) */
    enPausa: toSignal(membresia$.pipe(map((m) => m?.pausado === true)), { initialValue: false }),
  };
}
