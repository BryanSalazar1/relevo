// Ayudas para los recorridos contra los EMULADORES (nunca contra producción).

const FIRESTORE = `http://127.0.0.1:${process.env.FIRESTORE_PORT ?? 8080}`;

/**
 * Código de verificación que mandó enviarCodigoCorreo a `email`. En el emulador, sin correo
 * configurado, la función lo deja en verificaciones_correo/{uid}.codigoEmulador; se lee con la
 * credencial de administración del emulador ("Bearer owner"), que no existe en producción.
 */
export async function codigoDeCorreo(email, intentos = 30) {
  for (let i = 0; i < intentos; i++) {
    const r = await fetch(`${FIRESTORE}/v1/projects/demo-relevo/databases/(default)/documents/verificaciones_correo?pageSize=300`, {
      headers: { Authorization: 'Bearer owner' },
    });
    const datos = await r.json();
    const doc = (datos.documents ?? []).find((d) => d.fields?.email?.stringValue === email);
    const codigo = doc?.fields?.codigoEmulador?.stringValue;
    if (codigo) return codigo;
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`No llegó el código de ${email}`);
}

/** En la pantalla /verificar-correo: escribe el código que llegó y verifica. */
export async function verificarCorreo(page, email) {
  await page.waitForURL(/\/verificar-correo/, { timeout: 40000 });
  await page.waitForSelector('text=Te enviamos un código', { timeout: 40000 });
  const codigo = await codigoDeCorreo(email);
  await page.fill('ion-input[name="codigo"] input', codigo);
  await page.click('ion-button[type="submit"]');
  return codigo;
}
