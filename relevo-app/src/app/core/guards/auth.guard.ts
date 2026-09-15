import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { AuthService } from '../services/auth.service';

/** Solo deja pasar con sesión iniciada; si no, manda a /login recordando a dónde iba. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.user$.pipe(
    take(1),
    map((user) =>
      user ? true : router.createUrlTree(['/login'], { queryParams: { volver: state.url } }),
    ),
  );
};

/** Para /login: si ya hay sesión, manda a donde iba (o a /home). */
export const noAuthGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const volver = route.queryParamMap.get('volver');
  return auth.user$.pipe(
    take(1),
    map((user) => {
      if (!user) return true;
      return volver && volver.startsWith('/') ? router.parseUrl(volver) : router.createUrlTree(['/home']);
    }),
  );
};
