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
    // Enlace de los códigos QR: https://<app>/unirse/CODIGO
    path: 'unirse/:codigo',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/unirse/unirse.page').then((m) => m.UnirsePage),
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
