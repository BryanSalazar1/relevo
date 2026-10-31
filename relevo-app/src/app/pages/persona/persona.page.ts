import { Component, computed, effect, inject, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { IonBadge, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs, ToastController } from '@ionic/angular';
import { filter, map, switchMap } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { PersonasService } from '../../core/services/personas.service';
import { MedicamentosService, estadoInventario } from '../../core/services/medicamentos.service';
import { personaActual } from '../../core/utils/persona-actual';

/**
 * Contenedor con pestañas de una persona cuidada: hoy, bitácora, plan (medicinas, rutina y citas),
 * equipo y reporte. El asistente se abre con el botón flotante de cada pantalla (shared/fab-asistente).
 *
 * El médico ve otras pestañas: Seguimiento (su inicio), Historial (la bitácora, filtrada a lo
 * clínico), Reporte y Equipo. Hoy y Plan son la operación diaria de la familia: si cae ahí (ruta por
 * defecto, enlace de un aviso o un marcador), se le manda a Seguimiento.
 */
@Component({
  selector: 'app-persona',
  imports: [IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonBadge],
  template: `
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        @if (esMedico()) {
          <ion-tab-button tab="seguimiento">
            <ion-icon name="pulse-outline" />
            <ion-label>Seguimiento</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="bitacora">
            <ion-icon name="book-outline" />
            <ion-label>Historial</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="reporte">
            <ion-icon name="document-text-outline" />
            <ion-label>Reporte</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="equipo">
            <ion-icon name="people-outline" />
            <ion-label>Equipo</ion-label>
          </ion-tab-button>
        } @else {
          <ion-tab-button tab="hoy">
            <ion-icon name="today-outline" />
            <ion-label>Hoy</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="bitacora">
            <ion-icon name="book-outline" />
            <ion-label>Bitácora</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="plan">
            <ion-icon name="clipboard-outline" />
            <ion-label>Plan</ion-label>
            @if (esResponsable() && porResurtir().total > 0) {
              <ion-badge
                [color]="porResurtir().agotados > 0 ? 'danger' : 'warning'"
                [attr.aria-label]="porResurtir().total + ' por resurtir'"
                >{{ porResurtir().total }}</ion-badge
              >
            }
          </ion-tab-button>
          <ion-tab-button tab="equipo">
            <ion-icon name="people-outline" />
            <ion-label>Equipo</ion-label>
          </ion-tab-button>
          <ion-tab-button tab="reporte">
            <ion-icon name="document-text-outline" />
            <ion-label>Reporte</ion-label>
          </ion-tab-button>
        }
      </ion-tab-bar>
    </ion-tabs>
  `,
  styleUrl: './persona.page.scss',
})
export class PersonaPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastController);
  private readonly personasSvc = inject(PersonasService);
  private readonly ctx = personaActual();

  private readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );

  /** URL actual, para sacar al médico de Hoy y Plan también cuando llega por un enlace */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Una cuenta de tipo médico solo puede tener el rol médico (ROLES_COMPATIBLES), así que el tipo
   * del perfil basta y evita que el médico vea un instante las pestañas de la familia.
   */
  readonly esMedico = computed(
    () => this.auth.tipoActual === 'medico' || this.ctx.rol() === 'medico',
  );

  private async sinAcceso(personaId: string) {
    this.personasSvc.marcarSinAcceso(personaId);
    await this.router.navigateByUrl('/home', { replaceUrl: true });
    const t = await this.toast.create({
      message: 'Ya no formas parte de este equipo de cuidado.',
      color: 'warning',
      duration: 4000,
      position: 'top',
    });
    await t.present();
  }

  /** Solo el responsable resurte: a los demás el aviso les sale en Hoy, sin insignia en Plan */
  readonly esResponsable = computed(() => this.ctx.rol() === 'cuidador_principal');

  /** Medicamentos por resurtir (agotados o por acabarse), para el aviso de la pestaña Plan. */
  readonly porResurtir = computed(() => {
    const niveles = (this.medicamentos() ?? []).map((m) => estadoInventario(m)?.nivel);
    const agotados = niveles.filter((n) => n === 'agotado').length;
    return { total: agotados + niveles.filter((n) => n === 'bajo').length, agotados };
  });

  constructor() {
    // Sin rol = no es (o dejó de ser) miembro: p. ej. el responsable lo quitó del equipo con la
    // pantalla abierta, o abrió un enlace viejo. Las reglas ya le niegan los datos; aquí se le saca
    // a su inicio con un aviso y la persona deja de aparecer en su lista
    effect(() => {
      const id = this.ctx.personaId();
      if (id && this.ctx.rol() === null) untracked(() => void this.sinAcceso(id));
    });
    effect(() => {
      const id = this.ctx.personaId();
      const url = this.url();
      if (!id || !this.esMedico()) return;
      const base = `/personas/${id}/`;
      if (url.startsWith(`${base}hoy`) || url.startsWith(`${base}plan`)) {
        untracked(() => void this.router.navigate([base + 'seguimiento'], { replaceUrl: true }));
      }
    });
  }
}
