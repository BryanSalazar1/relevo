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
        path: 'bitacora',
        loadComponent: () =>
          import('./pages/bitacora/bitacora.page').then((m) => m.BitacoraPage),
      },
      {
        path: 'medicamentos',
        loadComponent: () =>
          import('./pages/medicamentos/medicamentos.page').then((m) => m.MedicamentosPage),
      },
      {
        path: 'rutina',
        loadComponent: () => import('./pages/rutina/rutina.page').then((m) => m.RutinaPage),
      },
      {
        path: 'equipo',
        loadComponent: () => import('./pages/equipo/equipo.page').then((m) => m.EquipoPage),
      },
      {
        path: 'reporte',
        loadComponent: () => import('./pages/reporte/reporte.page').then((m) => m.ReportePage),
      },
      {
        path: 'asistente',
        loadComponent: () =>
          import('./pages/asistente/asistente.page').then((m) => m.AsistentePage),
      },
      { path: '', redirectTo: 'bitacora', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: 'home' },
];
