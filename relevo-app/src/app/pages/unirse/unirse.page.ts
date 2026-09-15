import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  AlertController,
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
  IonInput,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';
import { Invitacion, ROL_ETIQUETA, TIPO_USUARIO_ETIQUETA } from '../../core/models';
import { AuthService } from '../../core/services/auth.service';
import {
  EstadoInvitacion,
  InvitacionesService,
  extraerCodigo,
  formatearCodigo,
  normalizarCodigo,
} from '../../core/services/invitaciones.service';
import { MiembrosService } from '../../core/services/miembros.service';
import { pedirTipoCuenta } from '../../core/utils/tipo-cuenta';
import { EscanerModal } from './escaner.modal';

@Component({
  selector: 'app-unirse',
  imports: [
    FormsModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonTitle,
    IonContent,
    IonInput,
    IonButton,
    IonIcon,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonText,
    IonBadge,
    IonSpinner,
  ],
  templateUrl: './unirse.page.html',
})
export class UnirsePage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly invitacionesSvc = inject(InvitacionesService);
  private readonly miembrosSvc = inject(MiembrosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  codigo = '';
  readonly buscando = signal(false);
  readonly uniendo = signal(false);
  readonly resultado = signal<{ estado: EstadoInvitacion; invitacion: Invitacion | null } | null>(
    null,
  );

  /** Rol con el que entraría esta cuenta (según su tipo) */
  readonly rolEtiqueta = computed(() => {
    const rol = this.auth.rolAlUnirse;
    return rol ? ROL_ETIQUETA[rol] : null;
  });
  readonly tipoEtiqueta = computed(() => {
    const tipo = this.auth.tipoActual;
    return tipo ? TIPO_USUARIO_ETIQUETA[tipo] : null;
  });

  readonly motivos: Record<EstadoInvitacion, string> = {
    valida: '',
    inexistente: 'No existe una invitación con ese código. Revisa que esté bien escrito.',
    inactiva: 'Esta invitación fue cancelada por quien la creó.',
    vencida: 'Esta invitación ya venció. Pide una nueva.',
    agotada: 'Esta invitación ya alcanzó su límite de usos.',
  };

  ngOnInit() {
    // Llegada desde un enlace/QR: /unirse/CODIGO
    const codigo = this.route.snapshot.paramMap.get('codigo');
    if (codigo) {
      this.codigo = formatearCodigo(codigo);
      void this.buscar();
    }
  }

  formatear() {
    this.codigo = formatearCodigo(this.codigo);
  }

  async buscar() {
    const codigo = normalizarCodigo(this.codigo);
    this.codigo = formatearCodigo(codigo);
    if (codigo.length < 8) {
      await this.aviso('El código tiene 8 letras o números (ej. ABCD-EFGH).');
      return;
    }
    this.buscando.set(true);
    try {
      this.resultado.set(await this.invitacionesSvc.buscar(codigo));
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo consultar la invitación. Revisa tu conexión.');
    } finally {
      this.buscando.set(false);
    }
  }

  async escanear() {
    const modal = await this.modalCtrl.create({ component: EscanerModal });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<string>();
    if (role !== 'ok' || !data) return;
    const codigo = extraerCodigo(data);
    if (!codigo) {
      await this.aviso('Ese QR no es una invitación de Relevo.');
      return;
    }
    this.codigo = formatearCodigo(codigo);
    await this.buscar();
  }

  async unirme() {
    const inv = this.resultado()?.invitacion;
    if (!inv) return;
    this.uniendo.set(true);
    try {
      // Cuentas antiguas sin tipo: se define aquí una sola vez
      if (!this.auth.tipoActual) {
        const tipo = await pedirTipoCuenta(this.alertCtrl);
        if (!tipo) return;
        await this.auth.definirTipo(tipo);
        await firstValueFrom(this.auth.perfil$);
      }
      const rolActual = await firstValueFrom(this.miembrosSvc.miRol(inv.personaId));
      if (rolActual) {
        await this.aviso('Ya formas parte de este equipo.');
      } else {
        await this.invitacionesSvc.canjear(inv);
        await this.aviso(`Te uniste a la bitácora de ${inv.personaNombre}.`);
      }
      await this.router.navigate(['/personas', inv.personaId], { replaceUrl: true });
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo completar. La invitación puede haber vencido o sido cancelada.');
    } finally {
      this.uniendo.set(false);
    }
  }

  private async aviso(message: string) {
    const t = await this.toast.create({ message, duration: 3000, position: 'top' });
    await t.present();
  }
}
