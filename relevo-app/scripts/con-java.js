#!/usr/bin/env node
/**
 * Ejecuta un comando asegurando que `java` esté en el PATH.
 *
 * Los emuladores de Firebase necesitan Java, pero una terminal abierta antes de
 * instalarlo (o VS Code sin reiniciar) no lo ve. Este wrapper busca el JDK en las
 * rutas habituales y lo antepone al PATH solo para el proceso hijo.
 *
 * Uso:  node scripts/con-java.js firebase emulators:start --project demo-relevo
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const esWindows = process.platform === 'win32';
const javaExe = esWindows ? 'java.exe' : 'java';

function tieneJava(dir) {
  return !!dir && fs.existsSync(path.join(dir, 'bin', javaExe));
}

function subcarpetas(base, prefijo) {
  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith(prefijo))
      .map((d) => path.join(base, d.name))
      .sort()
      .reverse(); // la versión más nueva primero
  } catch {
    return [];
  }
}

function javaYaDisponible() {
  const r = spawnSync(javaExe, ['-version'], { stdio: 'ignore', shell: false });
  return !r.error && r.status === 0;
}

function buscarJdk() {
  if (tieneJava(process.env.JAVA_HOME)) return process.env.JAVA_HOME;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const candidatos = [
    ...subcarpetas(path.join(pf, 'Eclipse Adoptium'), 'jdk-'),
    ...subcarpetas(path.join(pf, 'Java'), 'jdk-'),
    ...subcarpetas(path.join(pf, 'Microsoft'), 'jdk-'),
    path.join(pf, 'Android', 'Android Studio', 'jbr'), // JDK que trae Android Studio
    '/usr/lib/jvm/default-java',
    '/opt/homebrew/opt/openjdk',
  ];
  return candidatos.find(tieneJava);
}

const [, , cmd, ...args] = process.argv;
if (!cmd) {
  console.error('Uso: node scripts/con-java.js <comando> [args...]');
  process.exit(2);
}

if (!javaYaDisponible()) {
  const jdk = buscarJdk();
  if (jdk) {
    process.env.PATH = path.join(jdk, 'bin') + path.delimiter + (process.env.PATH || '');
    process.env.JAVA_HOME = process.env.JAVA_HOME || jdk;
    console.log(`[con-java] usando JDK: ${jdk}`);
  } else {
    console.error(
      '[con-java] No se encontró Java. Instálalo con:\n' +
        '  winget install EclipseAdoptium.Temurin.21.JDK\n' +
        'y luego reinicia la terminal (o VS Code completo).',
    );
    process.exit(1);
  }
}

// shell:true para resolver .cmd en Windows; se re-citan los argumentos con espacios
const citar = (a) => (/\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const linea = [cmd, ...args].map(citar).join(' ');
const hijo = spawn(linea, { stdio: 'inherit', shell: true, env: process.env });
hijo.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
