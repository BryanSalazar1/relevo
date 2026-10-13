import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { NotificacionesService } from './core/services/notificaciones.service';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        // El servicio real necesita Firebase Auth; aquí solo importa que la raíz se construya
        { provide: NotificacionesService, useValue: { iniciar() {} } },
      ],
    }).compileComponents();
  });

  it('debe crearse', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
