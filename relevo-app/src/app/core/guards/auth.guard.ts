import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, of, switchMap, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * Solo deja pasar con sesión iniciada y el correo verificado; sin sesión manda a /login y sin
 * verificar a /verificar-correo, recordando a dónde iba.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.user$.pipe(
    take(1),
    switchMap((user) => {
      if (!user) return of(router.createUrlTree(['/login'], { queryParams: { volver: state.url } }));
      return from(
        auth
          .asegurarVerificado(user)
          .then((ok) =>
            ok ? true : router.createUrlTree(['/verificar-correo'], { queryParams: { volver: state.url } }),
          ),
      );
    }),
  );
};

/** Para /verificar-correo: con sesión y sin verificar; si ya está verificado sigue a donde iba. */
export const verificarGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const volver = route.queryParamMap.get('volver');
  return auth.user$.pipe(
    take(1),
    switchMap((user) => {
      if (!user) return of(router.createUrlTree(['/login']));
      return from(
        auth
          .asegurarVerificado(user)
          .then((ok) =>
            ok ? (volver && volver.startsWith('/') ? router.parseUrl(volver) : router.createUrlTree(['/home'])) : true,
          ),
      );
    }),
  );
};

/** Para /login: si ya hay sesión, manda a donde iba (o a /home); la verificación la revisa authGuard. */
export const noAuthGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const volver = route.queryParamMap.get('volver');
  return auth.user$.pipe(
    take(1),
    switchMap((user) => {
      if (!user) return of(true);
      return of(volver && volver.startsWith('/') ? router.parseUrl(volver) : router.createUrlTree(['/home']));
    }),
  );
};
