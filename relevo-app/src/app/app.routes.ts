import { Routes } from '@angular/router';
import { authGuard, noAuthGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'home', pathMatch: 'full' },
  {
    path: 'login',
    canActivate: [noAuthGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    // Aviso de privacidad: pública, se acepta al registrarse y se relee desde Mi perfil
    path: 'privacidad',
    loadComponent: () => import('./pages/privacidad/privacidad.page').then((m) => m.PrivacidadPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'unirse',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/unirse/unirse.page').then((m) => m.UnirsePage),
  },
  {
    // Centro de notificaciones: qué avisos y recordatorios recibe el usuario de cada persona
    path: 'notificaciones',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/notificaciones/notificaciones.page').then((m) => m.NotificacionesPage),
  },
  {
    // Enlace de los códigos QR: https://<app>/unirse/CODIGO
    path: 'unirse/:codigo',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/unirse/unirse.page').then((m) => m.UnirsePage),
  },
  {
    // Ficha de emergencia: pantalla completa de lectura rápida, fuera de las pestañas
    path: 'personas/:id/ficha',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/ficha/ficha.page').then((m) => m.FichaPage),
  },
  {
    // Pantalla completa, fuera de las pestañas: va antes de personas/:id
    path: 'personas/:id/semaforo',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/semaforo/semaforo.page').then((m) => m.SemaforoPage),
  },
  {
    path: 'personas/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/persona/persona.page').then((m) => m.PersonaPage),
    children: [
      {
        // Lo que toca en el día: tomas y tareas con botones para marcar (primera pestaña)
        path: 'hoy',
        loadComponent: () => import('./pages/hoy/hoy.page').then((m) => m.HoyPage),
      },
      {
        path: 'bitacora',
        loadComponent: () =>
          import('./pages/bitacora/bitacora.page').then((m) => m.BitacoraPage),
      },
      {
        // Plan: medicamentos y rutina en una pestaña con segmento (plan/medicamentos, plan/rutina)
        path: 'plan',
        loadComponent: () => import('./pages/plan/plan.page').then((m) => m.PlanPage),
      },
      {
        path: 'plan/:seccion',
        loadComponent: () => import('./pages/plan/plan.page').then((m) => m.PlanPage),
      },
      // Rutas anteriores (enlaces de avisos y marcadores): van a su sección del plan
      { path: 'medicamentos', redirectTo: 'plan/medicamentos' },
      { path: 'rutina', redirectTo: 'plan/rutina' },
      {
        path: 'equipo',
        loadComponent: () => import('./pages/equipo/equipo.page').then((m) => m.EquipoPage),
      },
      {
        path: 'reporte',
        loadComponent: () => import('./pages/reporte/reporte.page').then((m) => m.ReportePage),
      },
      // El asistente ya no es pestaña: se abre con el botón flotante (shared/fab-asistente)
      { path: 'asistente', redirectTo: 'hoy' },
      { path: '', redirectTo: 'hoy', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
