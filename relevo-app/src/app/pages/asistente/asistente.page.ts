import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonLabel,
  IonSpinner,
  IonText,
  IonTextarea,
  IonTitle,
  IonToolbar,
  ModalController,
} from '@ionic/angular';
import { AsistenteService, MensajeChat } from '../../core/services/asistente.service';
import { personaActual } from '../../core/utils/persona-actual';

const SUGERENCIAS = [
  '¿Cómo ha estado esta semana?',
  '¿Cuántas veces se le olvidó la pastilla de la presión?',
  '¿Qué incidentes ha habido este mes?',
  '¿Cómo ha dormido los últimos días?',
  '¿Cuándo es la próxima cita médica?',
  '¿Cómo va la presión arterial?',
];

/** Lo que un médico tratante suele preguntar entre consultas */
const SUGERENCIAS_MEDICO = [
  '¿Cómo ha estado la presión en las últimas dos semanas?',
  '¿Qué dosis se han omitido este mes y a qué hora?',
  '¿Ha habido caídas, fiebre o síntomas nuevos?',
  '¿Qué pasó después de mi última indicación?',
  '¿Cómo van la glucosa en ayunas y el peso?',
  '¿Cómo ha dormido y comido estas semanas?',
];

/** Chat en lenguaje natural sobre la bitácora de la persona cuidada. */
@Component({
  selector: 'app-asistente',
  imports: [
    FormsModule,
    DatePipe,
    IonHeader,
    IonToolbar,
    IonButtons,
    IonBackButton,
    IonButton,
    IonTitle,
    IonIcon,
    IonContent,
    IonFooter,
    IonTextarea,
    IonChip,
    IonLabel,
    IonSpinner,
    IonText,
  ],
  templateUrl: './asistente.page.html',
  styleUrl: './asistente.page.scss',
})
export class AsistentePage {
  private readonly asistente = inject(AsistenteService);
  private readonly alertCtrl = inject(AlertController);
  private readonly modalCtrl = inject(ModalController);
  private readonly contenido = viewChild.required<IonContent>(IonContent);
  private readonly caja = viewChild<ElementRef<HTMLElement>>('caja');

  private readonly ctx = personaActual();
  readonly persona = this.ctx.persona;
  readonly rol = this.ctx.rol;

  /*
   * Cuando el asistente se abre como MODAL, la persona no puede venir de la
   * ruta: ActivatedRoute dentro del modal es la raíz y no trae el :id. Llega
   * por componentProps, que ModalController asigna sobre la instancia; por eso
   * son propiedades planas y no signal inputs (esos son de solo lectura).
   */
  personaIdFijo?: string;
  nombreFijo?: string;
  /** Rol de quien pregunta cuando se abre como modal (la ruta no lo trae): elige las sugerencias */
  rolFijo?: string;
  enModal = false;

  /** El médico ve preguntas de seguimiento clínico; la familia, las del día a día */
  readonly sugerencias = computed(() =>
    (this.rolFijo ?? this.rol()) === 'medico' ? SUGERENCIAS_MEDICO : SUGERENCIAS,
  );
  readonly mensajes = signal<MensajeChat[]>([]);
  readonly pensando = signal(false);
  readonly vacio = computed(() => this.mensajes().length === 0);
  pregunta = '';

  /** Nombre corto para los textos ("Carmen") */
  readonly nombreCorto = computed(() => {
    const nombre = this.persona()?.nombre ?? this.nombreFijo;
    return nombre?.split(' ')[0] ?? 'la persona cuidada';
  });

  async enviar(texto = this.pregunta) {
    const pregunta = texto.trim();
    const personaId = this.personaIdFijo ?? this.ctx.personaId();
    if (!pregunta || !personaId || this.pensando()) return;

    this.pregunta = '';
    const historial = this.mensajes();
    this.mensajes.update((m) => [...m, { rol: 'usuario', texto: pregunta, fecha: new Date() }]);
    this.pensando.set(true);
    await this.bajar();

    try {
      const respuesta = await this.asistente.preguntar(personaId, pregunta, historial);
      this.mensajes.update((m) => [...m, { rol: 'asistente', texto: respuesta, fecha: new Date() }]);
    } catch (error) {
      console.error(error);
      this.mensajes.update((m) => [
        ...m,
        { rol: 'asistente', texto: this.asistente.mensajeError(error), fecha: new Date(), error: true },
      ]);
    } finally {
      this.pensando.set(false);
      await this.bajar();
    }
  }

  enviarConEnter(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void this.enviar();
    }
  }

  async limpiar() {
    if (this.vacio()) return;
    const alerta = await this.alertCtrl.create({
      header: '¿Borrar la conversación?',
      message: 'Las preguntas y respuestas no se guardan; solo se limpian de la pantalla.',
      buttons: [
        { text: 'Cancelar', role: 'cancel' },
        { text: 'Borrar', role: 'destructive' },
      ],
    });
    await alerta.present();
    const { role } = await alerta.onDidDismiss();
    if (role === 'destructive') this.mensajes.set([]);
  }

  /** Sólo en modo modal: cierra la ventana. */
  async cerrar() {
    await this.modalCtrl.dismiss();
  }

  private async bajar() {
    await new Promise((r) => setTimeout(r, 50));
    await this.contenido().scrollToBottom(300);
  }
}
