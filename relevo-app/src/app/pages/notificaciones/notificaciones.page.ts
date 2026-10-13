import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonIcon,
  IonLabel,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { combineLatest, map, of, switchMap } from 'rxjs';

import {
  MODOS_AVISOS,
  Miembro,
  ModoAvisos,
  PersonaCuidada,
  PreferenciasAvisos,
  ROL_COLOR,
  ROL_ETIQUETA,
  preferenciasDe,
} from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { PersonasService } from '../../core/services/personas.service';
import { textoTurnos } from '../../core/utils/fechas';

type Permiso = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'desconocido';

/**
 * Centro de notificaciones: por cada persona cuidada, qué avisos del equipo recibe el usuario
 * (todos, solo los importantes o ninguno) y, bajo "Avanzado", si recibe los recordatorios de su
 * guardia y si quiere que los avisos lleguen solo durante sus turnos. Las preferencias viven en su
 * documento de miembro y las aplican las Cloud Functions (functions/logica.js). Un miembro nuevo
 * entra con AVISOS_POR_DEFECTO según su rol.
 */
@Component({
  selector: 'app-notificaciones',
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonSegment,
    IonSegmentButton,
    IonLabel,
    IonToggle,
    IonNote,
    IonBadge,
    IonIcon,
    IonSpinner,
  ],
  template: `
    <ion-header class="ion-no-border">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/home" text="" />
        </ion-buttons>
        <ion-title>Notificaciones</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-card class="canal">
        <div class="fila">
          <div class="icono" [class.apagado]="nativo && permiso() === 'denied'" aria-hidden="true">
            <ion-icon [name]="nativo ? 'phone-portrait-outline' : 'mail-outline'" />
          </div>
          <div class="texto">
            @if (nativo) {
              @switch (permiso()) {
                @case ('granted') {
                  <h2>Avisos en este teléfono</h2>
                  <p>Llegan como notificación push. Si apagas las notificaciones de Relevo en Android, recibirás correo.</p>
                }
                @case ('denied') {
                  <h2>Notificaciones apagadas en el teléfono</h2>
                  <p>Android bloqueó las notificaciones de Relevo. Actívalas en Ajustes → Aplicaciones → Relevo para recibir avisos aquí.</p>
                }
                @default {
                  <h2>Permiso pendiente</h2>
                  <p>Toca para permitir las notificaciones en este teléfono.</p>
                  <ion-button size="small" (click)="pedirPermiso()">Permitir notificaciones</ion-button>
                }
              }
            } @else {
              <h2>Avisos por correo</h2>
              <p>
                Usas Relevo en el navegador: los avisos llegan a <strong>{{ correo() }}</strong>.
                @if (tieneTelefono()) {
                  Como también tienes la app en el teléfono, ahí llegan como notificación push y no por correo.
                } @else {
                  Instala la app en tu teléfono para recibirlos como notificación.
                }
              </p>
            }
          </div>
        </div>
      </ion-card>

      @if (personas(); as lista) {
        @if (lista.length === 0) {
          <ion-card class="vacio">
            <ion-icon name="notifications-off-outline" aria-hidden="true" />
            <p>Cuando formes parte de la bitácora de alguien, aquí eliges qué avisos recibir.</p>
          </ion-card>
        }
        @for (p of lista; track p.id) {
          @let m = membresia(p.id!);
          @let prefs = preferenciasDe(m);
          <ion-card class="persona">
            <ion-card-header>
              <ion-card-subtitle>
                @if (m) {
                  <ion-badge [color]="ROL_COLOR[m.rol]">{{ ROL_ETIQUETA[m.rol] }}</ion-badge>
                }
              </ion-card-subtitle>
              <ion-card-title>{{ p.nombre }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <p class="etiqueta">Avisos del equipo</p>
              <ion-segment
                [value]="prefs.avisos"
                [disabled]="!m || guardando() === p.id"
                (ionChange)="cambiar(p, prefs, { avisos: $any($event).detail.value })"
              >
                @for (modo of modos; track modo.valor) {
                  <ion-segment-button [value]="modo.valor">
                    <ion-label>{{ modo.etiqueta }}</ion-label>
                  </ion-segment-button>
                }
              </ion-segment>
              <ion-note class="ayuda">{{ descripcion(prefs.avisos) }}</ion-note>

              @if (m && m.rol !== 'medico') {
                <ion-button
                  fill="clear"
                  size="small"
                  class="avanzado"
                  (click)="alternarAvanzado(p.id!)"
                  [attr.aria-expanded]="avanzadoAbierto(p.id!)"
                >
                  Avanzado
                  <ion-icon
                    slot="end"
                    [name]="avanzadoAbierto(p.id!) ? 'chevron-up-outline' : 'chevron-down-outline'"
                  />
                </ion-button>
                @if (avanzadoAbierto(p.id!)) {
                <ion-toggle
                  [checked]="prefs.recordatorios"
                  [disabled]="guardando() === p.id"
                  (ionChange)="cambiar(p, prefs, { recordatorios: $any($event).detail.checked })"
                  labelPlacement="start"
                  justify="space-between"
                >
                  <div class="opcion">
                    Recordatorios de mi guardia
                    <ion-note class="ayuda">Tomas y tareas de {{ p.nombre }} que se acercan o siguen sin registrarse.</ion-note>
                  </div>
                </ion-toggle>
                <ion-toggle
                  [checked]="prefs.soloEnTurno && tieneTurnos(m)"
                  [disabled]="!tieneTurnos(m) || guardando() === p.id"
                  (ionChange)="cambiar(p, prefs, { soloEnTurno: $any($event).detail.checked })"
                  labelPlacement="start"
                  justify="space-between"
                >
                  <div class="opcion">
                    Solo durante mis turnos
                    <ion-note class="ayuda">
                      @if (tieneTurnos(m)) {
                        Fuera de tus guardias no te llega ningún aviso del equipo.
                      } @else {
                        Pide al responsable que defina tus turnos en Equipo para poder activarlo.
                      }
                    </ion-note>
                  </div>
                </ion-toggle>
                <p class="turnos">
                  <ion-icon name="time-outline" aria-hidden="true" />
                  {{ textoTurnos(m.turnos) }}
                </p>
                }
              } @else if (m) {
                <ion-note class="ayuda">Como médico recibes avisos del equipo, nunca recordatorios de rutina.</ion-note>
              }
            </ion-card-content>
          </ion-card>
        }
      } @else {
        <div class="ion-text-center ion-padding"><ion-spinner name="crescent" /></div>
      }
    </ion-content>
  `,
  styles: [
    `
      ion-card.canal {
        margin: 16px;

        .fila {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          padding: 16px;
        }
        .icono {
          flex: none;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: 24px;
          color: var(--ion-color-primary);
          background: var(--relevo-primario-suave);

          &.apagado {
            color: var(--ion-color-danger);
            background: rgba(229, 72, 77, 0.12);
          }
        }
        h2 {
          margin: 0 0 4px;
          font-size: 1rem;
          font-weight: 700;
        }
        p {
          margin: 0;
          font-size: 0.86rem;
          line-height: 1.45;
          color: var(--relevo-texto-2);
        }
        ion-button {
          margin: 10px 0 0;
        }
      }

      ion-card.persona {
        margin: 12px 16px;
      }

      ion-segment-button {
        --padding-start: 4px;
        --padding-end: 4px;
        min-width: 0;
        font-size: 0.875rem;
      }

      .etiqueta {
        margin: 0 0 8px;
        font-size: 0.8125rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--relevo-texto-3);
      }

      ion-note.ayuda {
        display: block;
        margin: 8px 0 4px;
        font-size: 0.82rem;
        line-height: 1.4;
      }

      ion-button.avanzado {
        margin: 8px 0 0;
        --padding-start: 4px;
        --padding-end: 4px;
        font-size: 0.85rem;
        text-transform: none;
      }

      ion-toggle {
        margin-top: 14px;
        padding: 12px 14px;
        border-radius: var(--relevo-radio-medio);
        background: var(--relevo-superficie-alta);

        .opcion {
          font-weight: 600;
          white-space: normal;
        }
        .opcion ion-note {
          margin: 2px 0 0;
          font-weight: 400;
        }
      }

      .turnos {
        margin: 12px 0 0;
        font-size: 0.82rem;
        color: var(--relevo-texto-2);

        ion-icon {
          vertical-align: -2px;
          margin-right: 4px;
        }
      }

      ion-card.vacio {
        margin: 24px 16px;
        padding: 28px 20px;
        text-align: center;
        color: var(--relevo-texto-2);

        ion-icon {
          font-size: 48px;
          color: var(--relevo-texto-3);
        }
        p {
          margin: 10px 0 0;
        }
      }
    `,
  ],
})
export class NotificacionesPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly personasSvc = inject(PersonasService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly toast = inject(ToastController);

  readonly ROL_COLOR = ROL_COLOR;
  readonly ROL_ETIQUETA = ROL_ETIQUETA;
  readonly modos = MODOS_AVISOS;
  readonly preferenciasDe = preferenciasDe;
  readonly textoTurnos = textoTurnos;

  readonly nativo = Capacitor.isNativePlatform();
  readonly permiso = signal<Permiso>('desconocido');
  /** Id de la persona cuyas preferencias se están guardando */
  readonly guardando = signal<string | null>(null);
  /** Personas con el apartado "Avanzado" (recordatorios de guardia, solo en turno) desplegado */
  private readonly avanzado = signal(new Set<string>());

  readonly personas = toSignal(this.personasSvc.misPersonas());
  private readonly membresias = toSignal(
    this.personasSvc.misPersonas().pipe(
      switchMap((lista) =>
        lista.length
          ? combineLatest(
              lista.map((p) => this.miembrosSvc.miMembresia(p.id!).pipe(map((m) => [p.id!, m] as const))),
            )
          : of([] as (readonly [string, Miembro | null])[]),
      ),
      map((pares) => Object.fromEntries(pares) as Record<string, Miembro | null>),
    ),
  );

  readonly correo = computed(() => this.auth.user()?.email ?? this.auth.perfil()?.email ?? '');
  readonly tieneTelefono = computed(() => (this.auth.perfil()?.fcmTokens?.length ?? 0) > 0);

  ngOnInit() {
    if (this.nativo) void this.revisarPermiso();
  }

  membresia(personaId: string): Miembro | null {
    return this.membresias()?.[personaId] ?? null;
  }

  tieneTurnos(m: Miembro | null): boolean {
    return !!m?.turnos?.length;
  }

  avanzadoAbierto(personaId: string): boolean {
    return this.avanzado().has(personaId);
  }

  alternarAvanzado(personaId: string) {
    this.avanzado.update((abiertos) => {
      const nuevos = new Set(abiertos);
      if (nuevos.has(personaId)) nuevos.delete(personaId);
      else nuevos.add(personaId);
      return nuevos;
    });
  }

  descripcion(modo: ModoAvisos): string {
    return MODOS_AVISOS.find((x) => x.valor === modo)?.descripcion ?? '';
  }

  /** Guarda un cambio de preferencias de esa persona (el resto se conserva). */
  async cambiar(p: PersonaCuidada, actuales: PreferenciasAvisos, cambio: Partial<PreferenciasAvisos>) {
    if (!p.id) return;
    const nuevas = { ...actuales, ...cambio };
    if (
      nuevas.avisos === actuales.avisos &&
      nuevas.recordatorios === actuales.recordatorios &&
      nuevas.soloEnTurno === actuales.soloEnTurno
    ) {
      return;
    }
    this.guardando.set(p.id);
    try {
      await this.miembrosSvc.actualizarPreferencias(p.id, nuevas);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      this.guardando.set(null);
    }
  }

  async pedirPermiso() {
    try {
      const r = await PushNotifications.requestPermissions();
      this.permiso.set(r.receive);
      if (r.receive === 'granted') await PushNotifications.register();
    } catch (error) {
      console.warn('No se pudo pedir el permiso de notificaciones', error);
    }
  }

  private async revisarPermiso() {
    try {
      const r = await PushNotifications.checkPermissions();
      this.permiso.set(r.receive);
    } catch {
      this.permiso.set('desconocido');
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, color: 'danger', duration: 4000, position: 'top' });
    await t.present();
  }
}
