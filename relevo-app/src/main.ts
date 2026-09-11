import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Fechas y números en español en toda la app (DatePipe, formatDate, DecimalPipe)
registerLocaleData(localeEs);

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
