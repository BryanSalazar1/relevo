import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
  ModalController,
  ToastController,
} from '@ionic/angular';
import { combineLatest, switchMap } from 'rxjs';
import { Medicamento, PUEDE_EDITAR_MEDICAMENTOS, PUEDE_REGISTRAR_TOMAS, Toma } from '../../core/models';
import {
  DatosMedicamento,
  DosisProgramada,
  EstadoToma,
  MedicamentosService,
  finTratamiento,
  vigenteEnDia,
} from '../../core/services/medicamentos.service';
import { claveDia, etiquetaDia, haceCuanto, inicioDeDia, sumarDias } from '../../core/utils/fechas';
import { formatDate } from '@angular/common';
import { pedirNota } from '../../core/utils/notas';
import { personaActual } from '../../core/utils/persona-actual';
import { MedicamentoModal } from './medicamento.modal';
import { FabAsistente } from '../../shared/fab-asistente.component';

@Component({
  selector: 'app-medicamentos',
  imports: [
    FabAsistente,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonBadge,
    IonSpinner,
    IonText,
  ],
  templateUrl: './medicamentos.page.html',
  styleUrl: './medicamentos.page.scss',
})
export class MedicamentosPage {
  private readonly medsSvc = inject(MedicamentosService);
  private readonly modalCtrl = inject(ModalController);
  private readonly actionSheetCtrl = inject(ActionSheetController);
  private readonly alertCtrl = inject(AlertController);
  private readonly toast = inject(ToastController);

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /** Día que se muestra en la agenda de tomas (por defecto hoy) */
  readonly dia = signal<Date>(inicioDeDia(new Date()));
  readonly esHoy = computed(() => claveDia(this.dia()) === claveDia(new Date()));
  readonly etiquetaDia = etiquetaDia;

  readonly medicamentos = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.medicamentos(id))),
  );
  readonly agenda = toSignal(
    combineLatest([this.ctx.personaId$, toObservable(this.dia)]).pipe(
      switchMap(([id, dia]) => this.medsSvc.agendaDelDia(id, dia)),
    ),
  );
  readonly tomadas = computed(() => this.agenda()?.filter((d) => d.toma?.tomado).length ?? 0);

  /** Medicamentos activos sin horario fijo: se registran en el momento. */
  readonly segunNecesidad = computed(
    () =>
      this.medicamentos()?.filter(
        (m) => m.segunNecesidad && m.activo !== false && vigenteEnDia(m, new Date()),
      ) ?? [],
  );
  /** Última toma de cada medicamento según necesidad (id → toma). */
  readonly ultimas = toSignal(
    this.ctx.personaId$.pipe(switchMap((id) => this.medsSvc.ultimasTomasSegunNecesidad(id))),
  );

  readonly puedeEditar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_EDITAR_MEDICAMENTOS.includes(r);
  });
  readonly puedeRegistrar = computed(() => {
    const r = this.rol();
    return !!r && PUEDE_REGISTRAR_TOMAS.includes(r);
  });

  /** Ya pasó el último día del tratamiento (se muestra atenuado, como los suspendidos). */
  terminado(m: Medicamento): boolean {
    const fin = finTratamiento(m);
    return !!fin && fin.getTime() <= inicioDeDia(new Date()).getTime();
  }

  /** "Del 15 sep al 21 sep · 7 días", "Desde el 15 sep · hasta indicación médica" o "Terminó el 21 sep". */
  duracionTexto(m: Medicamento): string {
    if (!m.inicio) return '';
    const f = (d: Date) => formatDate(d, 'd MMM', 'es');
    const inicio = new Date(`${m.inicio}T00:00:00`);
    const fin = finTratamiento(m);
    if (!fin) return `Desde el ${f(inicio)} · hasta indicación médica`;
    const ultimo = sumarDias(fin, -1);
    if (this.terminado(m)) return `Terminó el ${f(ultimo)}`;
    if (inicio.getTime() > Date.now()) return `Empieza el ${f(inicio)} · ${m.duracionDias} días`;
    return `Del ${f(inicio)} al ${f(ultimo)} · ${m.duracionDias} días`;
  }

  /** "Última toma: hace 3 h (10:15) · Ana" para la sección según necesidad. */
  ultimaTomaTexto(m: Medicamento): string {
    const t: Toma | undefined = m.id ? this.ultimas()?.[m.id] : undefined;
    if (!t) return 'Sin tomas registradas';
    const quien = t.registradoNombre ? ` · ${t.registradoNombre}` : '';
    const nota = t.nota ? ` · ${t.nota}` : '';
    return `Última toma: ${haceCuanto((t.horaReal ?? t.horaProgramada).toDate())}${quien}${nota}`;
  }

  /** Registra una toma "ahora" de un medicamento según necesidad (con confirmación). */
  async registrarAhora(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrar() || !m.id) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Registrar una toma de ${m.nombre}?`,
      message: `${m.dosis} · ahora. ${this.ultimaTomaTexto(m)}.`,
      inputs: [
        {
          name: 'nota',
          type: 'textarea',
          placeholder: 'Nota (opcional): motivo, cómo se sentía…',
          attributes: { maxlength: 200, autocapitalize: 'sentences' },
        },
      ],
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Registrar', role: 'confirm' },
      ],
    });
    await alerta.present();
    const { role, data } = await alerta.onDidDismiss<{ values: { nota?: string } }>();
    if (role !== 'confirm') return;
    const nota = data?.values?.nota?.trim() || undefined;
    try {
      await this.medsSvc.registrarToma(personaId, this.medsSvc.dosisAhora(m), 'tomada', nota);
      await this.aviso(`Toma de ${m.nombre} registrada.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la toma.', 'danger');
    }
  }

  cambiarDia(delta: number) {
    this.dia.update((d) => sumarDias(d, delta));
  }

  hoy() {
    this.dia.set(inicioDeDia(new Date()));
  }

  icono(d: DosisProgramada): string {
    if (!d.toma) return d.hora.getTime() < Date.now() ? 'time-outline' : 'ellipse-outline';
    return d.toma.tomado ? 'checkmark-circle' : 'close-circle';
  }

  color(d: DosisProgramada): string {
    if (!d.toma) return d.hora.getTime() < Date.now() ? 'warning' : 'medium';
    return d.toma.tomado ? 'success' : 'danger';
  }

  /** Marca una dosis programada; para tomada / no tomada pide confirmación con nota opcional. */
  async marcar(d: DosisProgramada, estado: EstadoToma) {
    const personaId = this.ctx.personaId();
    if (!personaId || !this.puedeRegistrar()) return;
    let nota: string | undefined;
    if (estado !== 'quitar') {
      const r = await pedirNota(this.alertCtrl, {
        header: `¿Marcar como ${estado === 'tomada' ? 'tomada' : 'no tomada'}?`,
        message: `${d.medicamento.nombre} ${d.medicamento.dosis} · dosis de las ${d.horario}`,
        confirmar: 'Marcar',
      });
      if (!r.ok) return;
      nota = r.nota;
    }
    try {
      await this.medsSvc.registrarToma(personaId, d, estado, nota);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo registrar la toma.', 'danger');
    }
  }

  async opcionesDosis(d: DosisProgramada) {
    if (!this.puedeRegistrar()) return;
    if (d.aDemanda) return this.opcionesTomaADemanda(d);
    const sheet = await this.actionSheetCtrl.create({
      header: `${d.medicamento.nombre} · ${d.horario}`,
      buttons: [
        {
          text: 'Marcar como tomada',
          icon: 'checkmark-circle-outline',
          handler: () => {
            void this.marcar(d, 'tomada');
          },
        },
        {
          text: 'Marcar como no tomada',
          icon: 'close-circle-outline',
          handler: () => {
            void this.marcar(d, 'omitida');
          },
        },
        ...(d.toma
          ? [
              {
                text: d.toma.nota ? 'Editar nota' : 'Agregar nota',
                icon: 'create-outline',
                handler: () => {
                  void this.editarNota(d);
                },
              },
              {
                text: 'Quitar registro',
                icon: 'trash-outline',
                role: 'destructive',
                handler: () => {
                  void this.marcar(d, 'quitar');
                },
              },
            ]
          : []),
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Una toma según necesidad ya está registrada: solo se puede quitar si fue un error. */
  private async opcionesTomaADemanda(d: DosisProgramada) {
    const sheet = await this.actionSheetCtrl.create({
      header: `${d.medicamento.nombre} · ${d.horario} · según necesidad`,
      buttons: [
        {
          text: d.toma?.nota ? 'Editar nota' : 'Agregar nota',
          icon: 'create-outline',
          handler: () => {
            void this.editarNota(d);
          },
        },
        {
          text: 'Quitar registro',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.marcar(d, 'quitar');
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** Agrega o corrige la nota de una toma ya registrada (quien la registró o el responsable). */
  private async editarNota(d: DosisProgramada) {
    const personaId = this.ctx.personaId();
    if (!personaId || !d.medicamento.id || !d.toma?.id) return;
    const r = await pedirNota(this.alertCtrl, {
      header: 'Nota de la toma',
      message: `${d.medicamento.nombre} ${d.medicamento.dosis} · ${d.horario}`,
      confirmar: 'Guardar',
      nota: d.toma.nota,
    });
    if (!r.ok) return;
    try {
      await this.medsSvc.actualizarNotaToma(personaId, d.medicamento.id, d.toma.id, r.nota);
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar la nota. Solo quien registró la toma o el responsable pueden cambiarla.', 'danger');
    }
  }

  nuevo() {
    return this.editar(null);
  }

  async editar(medicamento: Medicamento | null) {
    if (!this.puedeEditar()) return;
    const modal = await this.modalCtrl.create({
      component: MedicamentoModal,
      componentProps: { medicamento },
    });
    await modal.present();
    const { data, role } = await modal.onWillDismiss<DatosMedicamento>();
    if (role !== 'guardar' || !data) return;
    const personaId = this.ctx.personaId();
    if (!personaId) return;
    try {
      if (medicamento?.id) {
        await this.medsSvc.actualizar(personaId, medicamento.id, data);
        await this.aviso('Medicamento actualizado.', 'success');
      } else {
        await this.medsSvc.crear(personaId, data);
        await this.aviso(`${data.nombre} registrado.`, 'success');
      }
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo guardar el medicamento.', 'danger');
    }
  }

  async opcionesMedicamento(m: Medicamento) {
    if (!this.puedeEditar()) return;
    const personaId = this.ctx.personaId();
    if (!personaId || !m.id) return;
    const sheet = await this.actionSheetCtrl.create({
      header: `${m.nombre} · ${m.dosis}`,
      buttons: [
        {
          text: 'Editar',
          icon: 'create-outline',
          handler: () => {
            void this.editar(m);
          },
        },
        {
          text: m.activo === false ? 'Reactivar' : 'Suspender',
          icon: m.activo === false ? 'play-circle-outline' : 'pause-circle-outline',
          handler: () => {
            void this.medsSvc.cambiarActivo(personaId, m.id!, m.activo === false);
          },
        },
        {
          text: 'Eliminar',
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => {
            void this.eliminar(m);
          },
        },
        { text: 'Cancelar', role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async eliminar(m: Medicamento) {
    const personaId = this.ctx.personaId();
    if (!personaId || !m.id) return;
    const alerta = await this.alertCtrl.create({
      header: `¿Eliminar ${m.nombre}?`,
      message: 'Se borrará también su historial de tomas. Si solo dejó de tomarlo, mejor usa "Suspender".',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Eliminar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role !== 'destructive') return;
    try {
      await this.medsSvc.eliminar(personaId, m.id);
      await this.aviso(`${m.nombre} eliminado.`, 'success');
    } catch (error) {
      console.error(error);
      await this.aviso('No se pudo eliminar.', 'danger');
    }
  }

  private async aviso(message: string, color: 'success' | 'danger') {
    const t = await this.toast.create({ message, color, duration: 2500, position: 'top' });
    await t.present();
  }
}
