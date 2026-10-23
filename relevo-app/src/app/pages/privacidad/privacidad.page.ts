import { Component } from '@angular/core';
import {
  IonBackButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';

/** Fecha de la versión vigente del aviso (se muestra arriba; cámbiala si el texto cambia). */
export const PRIVACIDAD_VERSION = '22 de octubre de 2026';

/**
 * Aviso de privacidad de Relevo (/privacidad, pública). Se acepta al registrarse y se puede releer
 * desde Mi perfil y desde la pantalla de entrada. Redactado en términos sencillos siguiendo la Ley
 * Federal de Protección de Datos Personales en Posesión de los Particulares; es un borrador para
 * que el equipo del proyecto lo revise antes de la entrega.
 */
@Component({
  selector: 'app-privacidad',
  imports: [IonHeader, IonToolbar, IonButtons, IonBackButton, IonTitle, IonContent],
  template: `
    <ion-header>
      <ion-toolbar color="primary">
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/login" text="" />
        </ion-buttons>
        <ion-title>Aviso de privacidad</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <article class="aviso">
        <p class="version">Versión del {{ version }}</p>

        <h2>Quién trata tus datos</h2>
        <p>
          Relevo es un proyecto de la Universidad UNE desarrollado por Bryan Salazar, Alfredo Santos
          Gutiérrez y Juan Pablo Rodríguez Torres. Para cualquier duda sobre tus datos escribe a
          <a href="mailto:relevo740@gmail.com">relevo740@gmail.com</a>.
        </p>

        <h2>Qué datos se guardan</h2>
        <ul>
          <li><strong>De tu cuenta:</strong> nombre, correo, tipo de cuenta (familiar, enfermero/a o médico) y, si aceptas notificaciones, un identificador del teléfono.</li>
          <li>
            <strong>De la persona cuidada:</strong> lo que el equipo registra sobre ella: nombre, fecha
            de nacimiento, ficha médica (alergias, condiciones, contactos de emergencia), medicamentos
            y tomas, rutina, signos vitales, citas, registros de la bitácora, indicaciones del médico y
            preguntas para la consulta. Son datos sensibles: solo los ve el equipo de esa persona.
          </li>
        </ul>

        <h2>Para qué se usan</h2>
        <ul>
          <li>Para que el equipo de cuidado comparta la misma información en tiempo real.</li>
          <li>Para enviar avisos y recordatorios a quienes cuidan, según lo que cada quien elija.</li>
          <li>Para preparar el reporte y la hoja que la familia lleva al médico.</li>
          <li>Para responder las preguntas que hagas al asistente y redactar el resumen del periodo, solo cuando tú lo pides.</li>
        </ul>
        <p>No se usan para publicidad ni se venden.</p>

        <h2>Con quién se comparten</h2>
        <ul>
          <li>Con los miembros del equipo de cada persona cuidada, que entran con un código que da el responsable.</li>
          <li>
            Con los proveedores que hacen funcionar la app: Google Firebase (cuentas, base de datos,
            notificaciones) y Google Gemini (asistente y resumen con inteligencia artificial, que reciben
            los registros del periodo únicamente cuando lo solicitas). Sus servidores pueden estar fuera de México.
          </li>
        </ul>

        <h2>Cuánto tiempo se conservan</h2>
        <p>
          Mientras tu cuenta exista. Si eliminas tu cuenta desde Mi perfil, dejas de formar parte de
          todos los equipos; si eras la única persona en la bitácora de alguien, esa bitácora se borra
          con todo su historial. El responsable de una persona puede eliminarla desde Equipo.
        </p>

        <h2>Tus derechos</h2>
        <p>
          Puedes ver y corregir tus datos en la app, cancelar tu cuenta y oponerte al uso de tus datos
          escribiendo al correo de arriba (derechos ARCO). Si registras datos de otra persona, hazlo con su
          consentimiento o el de quien la representa.
        </p>

        <h2>Cambios al aviso</h2>
        <p>Si este aviso cambia, la nueva versión se publica aquí con su fecha.</p>
      </article>
    </ion-content>
  `,
  styles: [
    `
      .aviso {
        max-width: 680px;
        margin: 0 auto;
        line-height: 1.5;
      }
      .version {
        margin: 0 0 12px;
        font-size: 0.82rem;
        color: var(--relevo-texto-3);
      }
      h2 {
        margin: 18px 0 6px;
        font-size: 1.05rem;
        font-weight: 700;
      }
      p,
      li {
        margin: 0 0 8px;
        font-size: 0.95rem;
      }
      ul {
        padding-left: 20px;
      }
      a {
        color: var(--ion-color-primary);
        font-weight: 600;
      }
    `,
  ],
})
export class PrivacidadPage {
  readonly version = PRIVACIDAD_VERSION;
}
