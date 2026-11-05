import { MAX_PERFILES, inicialesPerfil, leerPerfiles, olvidarPerfil, recordarPerfil } from './perfiles-guardados';

describe('perfiles guardados', () => {
  const rosa = { email: 'relevo740rosa@gmail.com', nombre: 'Rosa Martínez', usadoEn: 100 };
  const marta = { email: 'relevo740marta@gmail.com', nombre: 'Marta Ruiz', usadoEn: 200 };

  it('recuerda el último perfil primero, sin repetir el correo (sin distinguir mayúsculas)', () => {
    let lista = recordarPerfil([], rosa);
    lista = recordarPerfil(lista, marta);
    expect(lista.map((p) => p.nombre)).toEqual(['Marta Ruiz', 'Rosa Martínez']);
    lista = recordarPerfil(lista, { email: ' Relevo740Rosa@gmail.com ', nombre: '', usadoEn: 300 });
    expect(lista.length).toBe(2);
    expect(lista[0]).toEqual({ email: 'relevo740rosa@gmail.com', nombre: 'Rosa Martínez', usadoEn: 300 });
  });

  it('nunca guarda la contraseña: solo correo, nombre y fecha de uso', () => {
    const lista = recordarPerfil([], { ...rosa, password: 'secreta' } as typeof rosa);
    expect(Object.keys(lista[0]).sort()).toEqual(['email', 'nombre', 'usadoEn']);
  });

  it(`guarda como mucho ${MAX_PERFILES} perfiles, los más recientes`, () => {
    let lista: ReturnType<typeof recordarPerfil> = [];
    for (let i = 0; i < MAX_PERFILES + 3; i++) {
      lista = recordarPerfil(lista, { email: `p${i}@x.com`, nombre: `P${i}`, usadoEn: i });
    }
    expect(lista.length).toBe(MAX_PERFILES);
    expect(lista[0].email).toBe(`p${MAX_PERFILES + 2}@x.com`);
    expect(lista.some((p) => p.email === 'p0@x.com')).toBeFalse();
  });

  it('olvida un perfil', () => {
    expect(olvidarPerfil([rosa, marta], 'RELEVO740ROSA@gmail.com')).toEqual([marta]);
  });

  it('lo guardado dañado o inválido no rompe la entrada', () => {
    expect(leerPerfiles(null)).toEqual([]);
    expect(leerPerfiles('no es json')).toEqual([]);
    expect(leerPerfiles('{"email":"x"}')).toEqual([]);
    expect(leerPerfiles(JSON.stringify([rosa, { email: 'sin-arroba', nombre: 'X' }, null, marta])).map((p) => p.nombre)).toEqual([
      'Marta Ruiz',
      'Rosa Martínez',
    ]);
  });

  it('iniciales del perfil, sin el título', () => {
    expect(inicialesPerfil(rosa)).toBe('RM');
    expect(inicialesPerfil({ nombre: 'Dr. Javier Soto', email: 'd@x.com' })).toBe('JS');
    expect(inicialesPerfil({ nombre: '', email: 'carlos@x.com' })).toBe('C');
  });
});
