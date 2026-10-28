import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { IonButton, IonContent, IonIcon, IonSpinner, NavController } from '@ionic/angular';
import { switchMap } from 'rxjs';
import { MedicamentosService, vigenteEnDia } from '../../core/services/medicamentos.service';
import { edad } from '../../core/utils/fechas';
import { personaActual } from '../../core/utils/persona-actual';

/**
 * Ficha de emergencia: lo que hay que tener a mano en una urgencia, en pantalla completa y con
 * letra grande para leerla de prisa o enseñarla al personal de salud. La ven todos los roles.
 * Los datos son la ficha médica de la persona (se edita en Equipo) y sus medicamentos activos.
 */
@Component({
  selector: 'app-ficha',
  imports: [IonContent, IonButton, IonIcon, IonSpinner],
  templateUrl: './ficha.page.html',
  styleUrl: './ficha.page.scss',
})
export class FichaPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly router = inject(Router);
  private readonly nav = inject(NavController);
  private readonly ctx = personaActual();

  readonly persona = this.ctx.persona;
  readonly edad = computed(() => edad(this.persona()?.fechaNacimiento));

  private readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );
  /** Medicamentos que se toman hoy (activos y dentro de su tratamiento), con dosis y horarios */
  readonly activos = computed(() =>
    (this.medicamentos() ?? []).filter((m) => m.activo !== false && vigenteEnDia(m, new Date())),
  );

  /** "tel:+523312345678" a partir de lo escrito ("33 1234 5678"). */
  tel(telefono: string): string {
    return `tel:${telefono.replace(/[^\d+]/g, '')}`;
  }

  /** Vuelve a donde se abrió (inicio, Hoy, Equipo…); si se entró directo (enlace, recarga), a la persona. */
  salir() {
    if (this.router.lastSuccessfulNavigation?.previousNavigation) {
      this.nav.back();
      return;
    }
    const id = this.ctx.personaId();
    void this.router.navigate(id ? ['/personas', id] : ['/home']);
  }


}
